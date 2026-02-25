import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { computeGnplAccountSnapshot } from '@/lib/gnpl';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);

function getDbClient() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    return createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return null;
}

async function getPrimaryClient() {
  return getDbClient() || (await createServerClient());
}

function resolveInitData(request: NextRequest, body?: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      body?.initData ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function normalizeReference(raw: unknown) {
  const token = String(raw || '').trim().match(/[A-Za-z0-9_-]{3,120}/g)?.[0] || '';
  return token;
}

function normalizeDate(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const initData = resolveInitData(request);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }

    const { data: accounts, error } = await client
      .from('gnpl_accounts')
      .select(
        `
        *,
        trips (id, name, destination, departure_date)
      `
      )
      .eq('telegram_user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json({ ok: false, error: 'GNPL is not configured yet. Run migration 08 first.' }, { status: 500 });
    }

    const accountIds = (accounts || []).map((row: any) => row.id);
    let paymentsByAccount = new Map<string, any[]>();
    if (accountIds.length > 0) {
      const { data: payments } = await client
        .from('gnpl_payments')
        .select('*')
        .in('gnpl_account_id', accountIds)
        .order('created_at', { ascending: false })
        .limit(500);

      for (const payment of payments || []) {
        const accountId = String((payment as any).gnpl_account_id || '');
        if (!paymentsByAccount.has(accountId)) {
          paymentsByAccount.set(accountId, []);
        }
        paymentsByAccount.get(accountId)!.push(payment);
      }
    }

    const rows = (accounts || []).map((row: any) => {
      const snapshot = computeGnplAccountSnapshot(row);
      const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
      return {
        id: row.id,
        status: snapshot.status,
        tripId: row.trip_id,
        tripName: String(trip?.name || 'Trip'),
        destination: String(trip?.destination || 'N/A'),
        departureDate: String(trip?.departure_date || ''),
        quantity: Number(row.quantity || 1),
        dueDate: snapshot.dueDate,
        overdueDays: snapshot.overdueDays,
        principalAmount: snapshot.principalAmount,
        principalPaid: snapshot.principalPaid,
        principalOutstanding: snapshot.principalOutstanding,
        penaltyAccrued: snapshot.penaltyAccrued,
        penaltyPaid: snapshot.penaltyPaid,
        penaltyOutstanding: snapshot.penaltyOutstanding,
        totalDue: snapshot.totalDue,
        canPay:
          snapshot.totalDue > 0 &&
          ['approved', 'overdue'].includes(snapshot.status),
        payments: (paymentsByAccount.get(String(row.id)) || []).map((payment: any) => ({
          id: payment.id,
          amount: Number(payment.amount || 0),
          status: String(payment.status || 'pending'),
          paymentDate: String(payment.payment_date || ''),
          paymentReference: String(payment.payment_reference || ''),
          createdAt: String(payment.created_at || ''),
        })),
      };
    });

    return NextResponse.json({ ok: true, accounts: rows });
  } catch (error) {
    console.error('[miniapp-gnpl] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = String(body?.accountId || '').trim();
    const amount = Number(body?.amount || 0);
    const paymentReference = normalizeReference(body?.paymentReference);
    const paymentDate = normalizeDate(body?.paymentDate) || new Date().toISOString().slice(0, 10);
    const receiptLink = String(body?.receiptLink || '').trim();

    if (!accountId || !paymentReference) {
      return NextResponse.json({ ok: false, error: 'accountId and paymentReference are required' }, { status: 400 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ ok: false, error: 'Payment amount must be greater than zero' }, { status: 400 });
    }

    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }

    const { data: account, error: accountError } = await client
      .from('gnpl_accounts')
      .select('*')
      .eq('id', accountId)
      .eq('telegram_user_id', auth.user.id)
      .maybeSingle();
    if (accountError || !account) {
      return NextResponse.json({ ok: false, error: 'GNPL account not found' }, { status: 404 });
    }

    const snapshot = computeGnplAccountSnapshot(account);
    if (!['approved', 'overdue'].includes(snapshot.status)) {
      return NextResponse.json({ ok: false, error: 'Payments are allowed only for approved GNPL accounts' }, { status: 400 });
    }
    if (snapshot.totalDue <= 0) {
      return NextResponse.json({ ok: false, error: 'This GNPL account is already fully paid' }, { status: 400 });
    }

    const { data: inserted, error: insertError } = await client
      .from('gnpl_payments')
      .insert({
        gnpl_account_id: accountId,
        amount: Number(amount.toFixed(2)),
        payment_reference: paymentReference,
        payment_method: 'manual',
        payment_date: paymentDate,
        receipt_link: receiptLink || null,
        status: 'pending',
        submitted_by_user_id: auth.user.id,
      })
      .select('id, amount, status, payment_reference, payment_date, created_at')
      .single();
    if (insertError || !inserted) {
      return NextResponse.json({ ok: false, error: 'Failed to submit GNPL payment' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: 'GNPL payment submitted. Waiting for admin approval.',
      payment: {
        id: inserted.id,
        amount: Number(inserted.amount || 0),
        status: String(inserted.status || 'pending'),
        paymentReference: String(inserted.payment_reference || ''),
        paymentDate: String(inserted.payment_date || ''),
      },
    });
  } catch (error) {
    console.error('[miniapp-gnpl] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
