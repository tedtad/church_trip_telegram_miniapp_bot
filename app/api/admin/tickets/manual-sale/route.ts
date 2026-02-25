import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { resolveOrCreateCustomerByPhone } from '@/lib/offline-customer';
import { generateTicketNumber, generateTripSerialNumber } from '@/lib/telegram';
import { generateTicketQRCode } from '@/lib/qr-code';
import { writeAdminAuditLog } from '@/lib/admin-audit';

function normalizeReference(raw: unknown) {
  const value = String(raw || '').trim();
  const token = (value.match(/[A-Za-z0-9_-]{3,80}/g) || [])[0] || '';
  return token;
}

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;
  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;
  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function insertWithFallback(table: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await table.insert(working).select('*').single();
    if (!result.error && result.data) return result.data;
    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in working)) break;
    delete working[missing];
  }
  return null;
}

function buildTicketNumberUnique(receiptId: string, index: number) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${index + 1}-${Math.floor(Math.random() * 90 + 10)}`;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'tickets_manual_sale',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const tripId = String(body?.tripId || '').trim();
    const quantity = Math.max(1, Math.floor(Number(body?.quantity || 1)));
    const customerName = String(body?.customerName || '').trim().replace(/\s+/g, ' ');
    const customerPhone = String(body?.customerPhone || '').trim();
    const paymentMethod = String(body?.paymentMethod || 'cash').trim().toLowerCase();
    const reference = normalizeReference(body?.referenceNumber);
    const notes = String(body?.notes || '').trim();

    if (!tripId) return NextResponse.json({ ok: false, error: 'tripId is required' }, { status: 400 });
    if (!customerName) return NextResponse.json({ ok: false, error: 'customerName is required' }, { status: 400 });
    if (!customerPhone) return NextResponse.json({ ok: false, error: 'customerPhone is required' }, { status: 400 });
    if (!reference) return NextResponse.json({ ok: false, error: 'Valid reference number is required' }, { status: 400 });

    const { data: trip, error: tripError } = await supabase
      .from('trips')
      .select('id, name, price_per_ticket, available_seats, status, trip_status')
      .eq('id', tripId)
      .maybeSingle();
    if (tripError || !trip) {
      return NextResponse.json({ ok: false, error: 'Trip not found' }, { status: 404 });
    }

    const status = String((trip as any).status ?? (trip as any).trip_status ?? 'active').toLowerCase();
    if (['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status)) {
      return NextResponse.json({ ok: false, error: 'Trip is not available' }, { status: 400 });
    }

    const available = Number((trip as any).available_seats || 0);
    if (!Number.isFinite(available) || available < quantity) {
      return NextResponse.json({ ok: false, error: `Not enough seats. Available: ${available}` }, { status: 400 });
    }

    const { userId: customerUserId } = await resolveOrCreateCustomerByPhone({
      supabase,
      phone: customerPhone,
      fullName: customerName,
      languageCode: 'en',
    });

    const duplicateCheck = await supabase
      .from('receipts')
      .select('id, reference_number')
      .or(`reference_number.eq.${reference},reference_number.ilike.${reference}-%`)
      .limit(1);
    if (!duplicateCheck.error && (duplicateCheck.data || []).length > 0) {
      return NextResponse.json({ ok: false, error: 'Reference number already exists' }, { status: 409 });
    }

    const unitPrice = Number((trip as any).price_per_ticket || 0);
    const expectedAmount = Number((unitPrice * quantity).toFixed(2));
    const amountPaidInput = Number(body?.amountPaid || expectedAmount);
    const amountPaid = Number.isFinite(amountPaidInput) && amountPaidInput > 0 ? amountPaidInput : expectedAmount;
    if (amountPaid + 0.0001 < expectedAmount) {
      return NextResponse.json(
        { ok: false, error: `Amount cannot be below expected total (${expectedAmount.toFixed(2)} ETB)` },
        { status: 400 }
      );
    }

    const uniqueReference = `${reference}-${Date.now().toString().slice(-6)}`;
    const receiptHash = createHash('sha256')
      .update(`${reference}:${customerUserId}:${quantity}:${Date.now()}`)
      .digest('hex');
    const normalizedMethod =
      paymentMethod === 'bank' ? 'bank' : paymentMethod === 'telebirr' ? 'telebirr' : 'cash';

    const receipt = await insertWithFallback(supabase.from('receipts'), {
      reference_number: uniqueReference,
      telegram_user_id: customerUserId,
      trip_id: tripId,
      payment_method: normalizedMethod,
      amount_paid: Number(amountPaid.toFixed(2)),
      currency: 'ETB',
      quantity,
      receipt_file_url: null,
      receipt_file_name: `manual_sale_${Date.now()}.txt`,
      receipt_hash: receiptHash,
      approval_status: 'approved',
      approval_notes: notes || `Manual sale by ${auth.actor.name || auth.actor.email || auth.actor.id}`,
      approved_at: new Date().toISOString(),
    });
    if (!receipt?.id) {
      return NextResponse.json({ ok: false, error: 'Failed to create manual receipt' }, { status: 500 });
    }

    const nowIso = new Date().toISOString();
    const unitFromPaid = quantity > 0 ? Number((amountPaid / quantity).toFixed(2)) : amountPaid;
    const tickets = [];
    for (let idx = 0; idx < quantity; idx += 1) {
      const ticketNumber = buildTicketNumberUnique(receipt.id, idx);
      const serial = generateTripSerialNumber((trip as any).name, tripId, idx);
      tickets.push({
        ticket_number: ticketNumber,
        serial_number: serial,
        receipt_id: receipt.id,
        trip_id: tripId,
        telegram_user_id: customerUserId,
        purchase_price: unitFromPaid,
        ticket_status: 'confirmed',
        issued_at: nowIso,
      });
    }

    let ticketInsertError: any = null;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const insertResult = await supabase.from('tickets').insert(tickets).select('id, ticket_number, serial_number');
      if (!insertResult.error) {
        const insertedTickets = (insertResult.data || []) as Array<{ id: string; serial_number: string }>;
        for (const ticket of insertedTickets) {
          try {
            const qr = await generateTicketQRCode(ticket.id, ticket.serial_number);
            await supabase.from('tickets').update({ qr_code: qr }).eq('id', ticket.id);
          } catch (qrError) {
            console.error('[admin-tickets-manual-sale] Failed to generate QR for ticket:', ticket.id, qrError);
          }
        }

        const seatResult = await supabase
          .from('trips')
          .update({ available_seats: available - quantity })
          .eq('id', tripId);
        if (seatResult.error) {
          return NextResponse.json({ ok: false, error: 'Ticket created but seat update failed' }, { status: 500 });
        }

        await writeAdminAuditLog(supabase, {
          adminId: auth.actor.id,
          action: 'TICKET_MANUAL_SALE',
          entityType: 'receipt',
          entityId: receipt.id,
          description: `Manual sale for ${customerName} (${customerPhone})`,
          metadata: {
            tripId,
            quantity,
            amountPaid: Number(amountPaid.toFixed(2)),
            paymentMethod: normalizedMethod,
            referenceNumber: uniqueReference,
            customerPhone,
            customerUserId,
          },
        });

        return NextResponse.json({
          ok: true,
          message: 'Manual sale completed and tickets issued',
          receipt: {
            id: receipt.id,
            referenceNumber: uniqueReference,
            amountPaid: Number(amountPaid.toFixed(2)),
          },
          tickets: insertResult.data || [],
        });
      }

      ticketInsertError = insertResult.error;
      const missingColumn = detectMissingColumn(insertResult.error);
      if (!missingColumn) break;
      for (const ticket of tickets) {
        if (missingColumn in ticket) {
          delete (ticket as any)[missingColumn];
        }
      }
    }

    return NextResponse.json(
      { ok: false, error: ticketInsertError?.message || 'Failed to create tickets' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[admin-tickets-manual-sale] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
