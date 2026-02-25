import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { resolveAdminId, writeAdminAuditLog } from '@/lib/admin-audit';
import { allocateGnplPayment, computeGnplAccountSnapshot, normalizeGnplSettings } from '@/lib/gnpl';
import { generateTicketNumber, generateTripSerialNumber, sendTelegramMessage } from '@/lib/telegram';
import { generateTicketQRCode } from '@/lib/qr-code';

function safeString(value: unknown) {
  return String(value || '').trim();
}

function toPositiveInt(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function toIsoDate(value: unknown) {
  const text = safeString(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const output = new Date(date);
  output.setDate(output.getDate() + Math.floor(days));
  return output;
}

function uniqueGnplReceiptReference(accountId: string) {
  const suffix = safeString(accountId).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'GNPL';
  return `GNPL-${Date.now()}-${suffix}`;
}

function buildTicketNumberUnique(receiptId: string, index: number) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${index + 1}-${Math.floor(Math.random() * 90 + 10)}`;
}

async function loadGnplSettings(supabase: any) {
  const { data } = await supabase
    .from('app_settings')
    .select(
      'gnpl_enabled, gnpl_require_admin_approval, gnpl_default_term_days, gnpl_penalty_enabled, gnpl_penalty_percent, gnpl_penalty_period_days'
    )
    .eq('id', 'default')
    .maybeSingle();
  return normalizeGnplSettings(data || {});
}

async function loadUserMap(supabase: any, ids: Array<string | number>) {
  const normalized = Array.from(new Set(ids.map((id) => safeString(id)).filter(Boolean)));
  if (!normalized.length) return new Map<string, any>();

  const { data } = await supabase
    .from('telegram_users')
    .select('id, first_name, last_name, username, phone_number')
    .in('id', normalized)
    .limit(1000);
  const map = new Map<string, any>();
  for (const row of data || []) {
    map.set(safeString((row as any).id), row);
  }
  return map;
}

function accountDto(account: any, user: any, now = new Date()) {
  const snapshot = computeGnplAccountSnapshot(account, now);
  const trip = Array.isArray(account.trips) ? account.trips[0] : account.trips;
  return {
    id: account.id,
    status: snapshot.status,
    tripId: account.trip_id,
    tripName: safeString(trip?.name || 'Trip'),
    destination: safeString(trip?.destination || 'N/A'),
    departureDate: safeString(trip?.departure_date || ''),
    telegramUserId: safeString(account.telegram_user_id),
    customerName:
      safeString(account.customer_name) ||
      [safeString(user?.first_name), safeString(user?.last_name)].filter(Boolean).join(' ') ||
      safeString(user?.username ? `@${user.username}` : ''),
    customerPhone: safeString(account.customer_phone || user?.phone_number),
    idNumber: safeString(account.id_number),
    idCardFileUrl: safeString(account.id_card_file_url),
    idCardFileName: safeString(account.id_card_file_name),
    idCardMimeType: safeString(account.id_card_mime_type),
    idCardUploadedAt: safeString(account.id_card_uploaded_at),
    quantity: Number(account.quantity || 1),
    dueDate: snapshot.dueDate,
    overdueDays: snapshot.overdueDays,
    principalAmount: snapshot.principalAmount,
    principalPaid: snapshot.principalPaid,
    principalOutstanding: snapshot.principalOutstanding,
    penaltyAccrued: snapshot.penaltyAccrued,
    penaltyPaid: snapshot.penaltyPaid,
    penaltyOutstanding: snapshot.penaltyOutstanding,
    totalDue: snapshot.totalDue,
    approvedAt: safeString(account.approved_at),
    approvedBy: safeString(account.approved_by),
    rejectionReason: safeString(account.rejection_reason),
    createdAt: safeString(account.created_at),
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'tickets_review',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const status = safeString(request.nextUrl.searchParams.get('status') || '');
    const search = safeString(request.nextUrl.searchParams.get('search') || '');
    const includePayments = String(request.nextUrl.searchParams.get('includePayments') || 'true') !== 'false';

    let accountQuery = supabase
      .from('gnpl_accounts')
      .select(
        `
        *,
        trips (id, name, destination, departure_date)
      `
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (status) {
      accountQuery = accountQuery.eq('status', status);
    }
    if (search) {
      const phoneDigits = search.replace(/\D/g, '');
      accountQuery = accountQuery.or(
        [
          `customer_phone.ilike.%${search}%`,
          `customer_name.ilike.%${search}%`,
          `id_number.ilike.%${search}%`,
          phoneDigits ? `customer_phone.ilike.%${phoneDigits}%` : '',
        ]
          .filter(Boolean)
          .join(',')
      );
    }

    const { data: accounts, error } = await accountQuery;
    if (error) {
      return NextResponse.json({ ok: false, error: 'GNPL table not ready. Run migration 08 first.' }, { status: 500 });
    }

    const userMap = await loadUserMap(
      supabase,
      (accounts || []).map((row: any) => row.telegram_user_id)
    );

    let pendingPayments: any[] = [];
    if (includePayments) {
      const { data: payments } = await supabase
        .from('gnpl_payments')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(500);
      pendingPayments = payments || [];
    }

    const accountMap = new Map<string, any>();
    for (const row of accounts || []) {
      accountMap.set(safeString((row as any).id), row);
    }

    const now = new Date();
    const accountRows = (accounts || []).map((row: any) =>
      accountDto(row, userMap.get(safeString(row.telegram_user_id)), now)
    );

    return NextResponse.json({
      ok: true,
      accounts: accountRows,
      pendingPayments: pendingPayments.map((payment: any) => {
        const account = accountMap.get(safeString(payment.gnpl_account_id));
        const user = account ? userMap.get(safeString(account.telegram_user_id)) : null;
        return {
          id: payment.id,
          gnplAccountId: payment.gnpl_account_id,
          amount: Number(payment.amount || 0),
          paymentReference: safeString(payment.payment_reference),
          paymentDate: safeString(payment.payment_date),
          createdAt: safeString(payment.created_at),
          receiptLink: safeString(payment.receipt_link),
          customerName:
            safeString(account?.customer_name) ||
            [safeString(user?.first_name), safeString(user?.last_name)].filter(Boolean).join(' ') ||
            safeString(user?.username ? `@${user.username}` : ''),
          customerPhone: safeString(account?.customer_phone || user?.phone_number),
          tripId: safeString(account?.trip_id),
          accountStatus: safeString(account?.status),
        };
      }),
    });
  } catch (error) {
    console.error('[admin-gnpl] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'tickets_review',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const action = safeString(body?.action).toLowerCase();
    const accountId = safeString(body?.accountId);
    const paymentId = safeString(body?.paymentId);
    const explicitAdminId = safeString(body?.adminId) || auth.actor.id;
    const adminId = await resolveAdminId(supabase, request, explicitAdminId);

    if (!adminId) {
      return NextResponse.json({ ok: false, error: 'Admin identity is required' }, { status: 401 });
    }

    if (!['approve_application', 'reject_application', 'approve_payment', 'reject_payment'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }

    if (action.endsWith('application') && !accountId) {
      return NextResponse.json({ ok: false, error: 'accountId is required' }, { status: 400 });
    }
    if (action.endsWith('payment') && !paymentId) {
      return NextResponse.json({ ok: false, error: 'paymentId is required' }, { status: 400 });
    }

    if (action === 'approve_application') {
      const { data: account, error: accountError } = await supabase
        .from('gnpl_accounts')
        .select('*')
        .eq('id', accountId)
        .maybeSingle();
      if (accountError || !account) {
        return NextResponse.json({ ok: false, error: 'GNPL account not found' }, { status: 404 });
      }
      if (safeString(account.status) !== 'pending_approval') {
        return NextResponse.json({ ok: false, error: 'Only pending applications can be approved' }, { status: 400 });
      }

      const settings = await loadGnplSettings(supabase);
      const termDays = toPositiveInt(body?.termDays, settings.defaultTermDays);
      const dueDateInput = toIsoDate(body?.dueDate);
      const dueDate = dueDateInput ? new Date(`${dueDateInput}T00:00:00.000Z`) : addDays(new Date(), termDays);

      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .select('id, name, available_seats')
        .eq('id', account.trip_id)
        .maybeSingle();
      if (tripError || !trip) {
        return NextResponse.json({ ok: false, error: 'Trip not found for this GNPL account' }, { status: 404 });
      }

      const quantity = Math.max(1, Number(account.quantity || 1));
      const availableSeats = Number((trip as any).available_seats || 0);
      if (availableSeats < quantity) {
        return NextResponse.json(
          { ok: false, error: `Not enough seats. Available ${availableSeats}, requested ${quantity}.` },
          { status: 400 }
        );
      }

      const approvedAmount = Math.max(0, Number(account.approved_amount || account.base_amount || 0));
      const receiptReference = uniqueGnplReceiptReference(account.id);
      const { data: receipt, error: receiptError } = await supabase
        .from('receipts')
        .insert({
          reference_number: receiptReference,
          telegram_user_id: account.telegram_user_id,
          trip_id: account.trip_id,
          payment_method: 'gnpl',
          amount_paid: 0,
          base_amount: approvedAmount,
          discount_amount: 0,
          discount_percent: 0,
          quantity,
          currency: 'ETB',
          approval_status: 'approved',
          approval_notes: safeString(body?.notes) || 'GNPL approved by admin',
          approved_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (receiptError || !receipt) {
        return NextResponse.json({ ok: false, error: 'Failed to create GNPL receipt' }, { status: 500 });
      }

      const unitPrice = quantity > 0 ? Number((approvedAmount / quantity).toFixed(2)) : approvedAmount;
      const ticketRows = [];
      for (let idx = 0; idx < quantity; idx += 1) {
        const serial = generateTripSerialNumber(safeString((trip as any).name), safeString(account.trip_id), idx);
        const qr = await generateTicketQRCode(`gnpl-${safeString(receipt.id)}-${idx + 1}`, serial);
        ticketRows.push({
          ticket_number: buildTicketNumberUnique(safeString(receipt.id), idx),
          serial_number: serial,
          receipt_id: receipt.id,
          trip_id: account.trip_id,
          telegram_user_id: account.telegram_user_id,
          purchase_price: unitPrice,
          ticket_status: 'confirmed',
          issued_at: new Date().toISOString(),
          qr_code: qr,
        });
      }

      const { error: ticketError } = await supabase.from('tickets').insert(ticketRows);
      if (ticketError) {
        return NextResponse.json({ ok: false, error: 'Failed to issue GNPL tickets' }, { status: 500 });
      }

      const { error: seatError } = await supabase
        .from('trips')
        .update({ available_seats: availableSeats - quantity })
        .eq('id', account.trip_id);
      if (seatError) {
        return NextResponse.json({ ok: false, error: 'Failed to update trip seat inventory' }, { status: 500 });
      }

      const penaltyPercent = settings.penaltyEnabled ? settings.penaltyPercent : 0;
      const penaltyPeriodDays = settings.penaltyEnabled ? settings.penaltyPeriodDays : 0;
      const nextPenaltyAt =
        settings.penaltyEnabled && penaltyPercent > 0
          ? addDays(dueDate, Math.max(1, penaltyPeriodDays)).toISOString()
          : null;

      const { error: accountUpdateError } = await supabase
        .from('gnpl_accounts')
        .update({
          status: 'approved',
          approved_by: adminId,
          approved_at: new Date().toISOString(),
          approved_amount: approvedAmount,
          principal_paid: 0,
          penalty_accrued: 0,
          penalty_paid: 0,
          outstanding_amount: approvedAmount,
          due_date: dueDate.toISOString().slice(0, 10),
          penalty_percent: penaltyPercent,
          penalty_period_days: Math.max(1, penaltyPeriodDays || settings.penaltyPeriodDays),
          next_penalty_at: nextPenaltyAt,
          rejection_reason: null,
          notes: safeString(body?.notes) || null,
        })
        .eq('id', accountId);
      if (accountUpdateError) {
        return NextResponse.json({ ok: false, error: 'Failed to finalize GNPL approval' }, { status: 500 });
      }

      await writeAdminAuditLog(supabase, {
        adminId,
        action: 'GNPL_APPROVED',
        entityType: 'gnpl_account',
        entityId: accountId,
        description: `Approved GNPL account ${accountId}`,
        metadata: {
          accountId,
          tripId: account.trip_id,
          quantity,
          approvedAmount,
          dueDate: dueDate.toISOString().slice(0, 10),
          receiptId: receipt.id,
        },
      });

      await sendTelegramMessage(
        account.telegram_user_id,
        [
          'GNPL request approved.',
          `Trip booking is confirmed.`,
          `Due date: ${dueDate.toISOString().slice(0, 10)}`,
          `Total due: ETB ${Number(approvedAmount).toFixed(2)}`,
          penaltyPercent > 0
            ? `Penalty: ${Number(penaltyPercent).toFixed(2)}% every ${Math.max(1, penaltyPeriodDays)} day(s) after due date`
            : 'Penalty: disabled',
        ].join('\n')
      );

      return NextResponse.json({ ok: true, message: 'GNPL application approved' });
    }

    if (action === 'reject_application') {
      const reason = safeString(body?.reason) || 'GNPL request rejected';
      const { data: account, error: accountError } = await supabase
        .from('gnpl_accounts')
        .select('*')
        .eq('id', accountId)
        .maybeSingle();
      if (accountError || !account) {
        return NextResponse.json({ ok: false, error: 'GNPL account not found' }, { status: 404 });
      }

      const { error: updateError } = await supabase
        .from('gnpl_accounts')
        .update({
          status: 'rejected',
          rejected_by: adminId,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq('id', accountId);
      if (updateError) {
        return NextResponse.json({ ok: false, error: 'Failed to reject GNPL account' }, { status: 500 });
      }

      await writeAdminAuditLog(supabase, {
        adminId,
        action: 'GNPL_REJECTED',
        entityType: 'gnpl_account',
        entityId: accountId,
        description: `Rejected GNPL account ${accountId}`,
        metadata: { accountId, reason },
      });

      await sendTelegramMessage(
        account.telegram_user_id,
        ['GNPL request rejected.', `Reason: ${reason}`].join('\n')
      );

      return NextResponse.json({ ok: true, message: 'GNPL application rejected' });
    }

    if (action === 'approve_payment') {
      const { data: payment, error: paymentError } = await supabase
        .from('gnpl_payments')
        .select('*')
        .eq('id', paymentId)
        .maybeSingle();
      if (paymentError || !payment) {
        return NextResponse.json({ ok: false, error: 'GNPL payment not found' }, { status: 404 });
      }
      if (safeString(payment.status) !== 'pending') {
        return NextResponse.json({ ok: false, error: 'Only pending payments can be approved' }, { status: 400 });
      }

      const { data: account, error: accountError } = await supabase
        .from('gnpl_accounts')
        .select('*')
        .eq('id', payment.gnpl_account_id)
        .maybeSingle();
      if (accountError || !account) {
        return NextResponse.json({ ok: false, error: 'GNPL account not found for payment' }, { status: 404 });
      }

      const snapshot = computeGnplAccountSnapshot(account);
      const allocation = allocateGnplPayment(snapshot, payment.amount);
      if (allocation.principalComponent <= 0 && allocation.penaltyComponent <= 0) {
        return NextResponse.json({ ok: false, error: 'Nothing due on this GNPL account' }, { status: 400 });
      }

      const { error: paymentUpdateError } = await supabase
        .from('gnpl_payments')
        .update({
          status: 'approved',
          principal_component: allocation.principalComponent,
          penalty_component: allocation.penaltyComponent,
          unapplied_amount: allocation.unapplied,
          approved_by: adminId,
          approved_at: new Date().toISOString(),
          rejection_reason: null,
        })
        .eq('id', paymentId);
      if (paymentUpdateError) {
        return NextResponse.json({ ok: false, error: 'Failed to approve GNPL payment' }, { status: 500 });
      }

      const nextPrincipalPaid = Number((Number(account.principal_paid || 0) + allocation.principalComponent).toFixed(2));
      const nextPenaltyPaid = Number((Number(account.penalty_paid || 0) + allocation.penaltyComponent).toFixed(2));
      const approvedAmount = Number(account.approved_amount || account.base_amount || 0);
      const penaltyAccrued = Number(account.penalty_accrued || 0);
      const principalOutstanding = Math.max(0, Number((approvedAmount - nextPrincipalPaid).toFixed(2)));
      const penaltyOutstanding = Math.max(0, Number((penaltyAccrued - nextPenaltyPaid).toFixed(2)));
      const totalOutstanding = Math.max(0, Number((principalOutstanding + penaltyOutstanding).toFixed(2)));

      const dueDate = safeString(account.due_date);
      const dueDateObj = dueDate ? new Date(`${dueDate}T00:00:00.000Z`) : null;
      const overdue = dueDateObj ? dueDateObj.getTime() < Date.now() : false;

      const nextStatus =
        totalOutstanding <= 0
          ? 'completed'
          : overdue
            ? 'overdue'
            : 'approved';

      const { error: accountUpdateError } = await supabase
        .from('gnpl_accounts')
        .update({
          status: nextStatus,
          principal_paid: nextPrincipalPaid,
          penalty_paid: nextPenaltyPaid,
          outstanding_amount: totalOutstanding,
          next_penalty_at: totalOutstanding <= 0 ? null : account.next_penalty_at,
        })
        .eq('id', account.id);
      if (accountUpdateError) {
        return NextResponse.json({ ok: false, error: 'Failed to update GNPL balance' }, { status: 500 });
      }

      await writeAdminAuditLog(supabase, {
        adminId,
        action: 'GNPL_PAYMENT_APPROVED',
        entityType: 'gnpl_payment',
        entityId: paymentId,
        description: `Approved GNPL payment ${paymentId}`,
        metadata: {
          accountId: account.id,
          paymentId,
          amount: Number(payment.amount || 0),
          principalComponent: allocation.principalComponent,
          penaltyComponent: allocation.penaltyComponent,
          totalOutstanding,
          status: nextStatus,
        },
      });

      await sendTelegramMessage(
        account.telegram_user_id,
        [
          'GNPL payment approved.',
          `Paid: ETB ${Number(payment.amount || 0).toFixed(2)}`,
          `Remaining due: ETB ${totalOutstanding.toFixed(2)}`,
          totalOutstanding <= 0 ? 'Your GNPL balance is fully cleared.' : '',
        ]
          .filter(Boolean)
          .join('\n')
      );

      return NextResponse.json({ ok: true, message: 'GNPL payment approved', outstandingAmount: totalOutstanding });
    }

    if (action === 'reject_payment') {
      const reason = safeString(body?.reason) || 'Payment evidence rejected';
      const { data: payment, error: paymentError } = await supabase
        .from('gnpl_payments')
        .select('*')
        .eq('id', paymentId)
        .maybeSingle();
      if (paymentError || !payment) {
        return NextResponse.json({ ok: false, error: 'GNPL payment not found' }, { status: 404 });
      }

      const { error: paymentUpdateError } = await supabase
        .from('gnpl_payments')
        .update({
          status: 'rejected',
          rejected_by: adminId,
          rejected_at: new Date().toISOString(),
          rejection_reason: reason,
        })
        .eq('id', paymentId);
      if (paymentUpdateError) {
        return NextResponse.json({ ok: false, error: 'Failed to reject GNPL payment' }, { status: 500 });
      }

      const { data: account } = await supabase
        .from('gnpl_accounts')
        .select('id, telegram_user_id')
        .eq('id', payment.gnpl_account_id)
        .maybeSingle();

      await writeAdminAuditLog(supabase, {
        adminId,
        action: 'GNPL_PAYMENT_REJECTED',
        entityType: 'gnpl_payment',
        entityId: paymentId,
        description: `Rejected GNPL payment ${paymentId}`,
        metadata: {
          paymentId,
          accountId: payment.gnpl_account_id,
          reason,
        },
      });

      if (account?.telegram_user_id) {
        await sendTelegramMessage(
          account.telegram_user_id,
          ['GNPL payment was rejected.', `Reason: ${reason}`].join('\n')
        );
      }

      return NextResponse.json({ ok: true, message: 'GNPL payment rejected' });
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    console.error('[admin-gnpl] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
