import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getTelebirrConfigStatus, initiateTelebirrPayment } from '@/lib/telebirr';
import { calculateDiscountAmount, normalizeDiscountCode, resolveDiscountVoucher } from '@/lib/discount-vouchers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

type SessionRow = {
  id: string;
  telegram_user_id: number;
  trip_id: string;
  quantity: number;
  status: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_code?: string | null;
  discount_percent?: number | null;
  discount_voucher_id?: string | null;
};

type TripRow = {
  id: string;
  name?: string | null;
  price_per_ticket?: number | null;
};

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

function resolveAppBase(request: NextRequest) {
  const candidates = [String(APP_URL || '').trim(), String(request.nextUrl.origin || '').trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return new URL(candidate).origin.replace(/\/+$/, '');
    } catch { }
  }
  return '';
}

function parseRequiredQuery(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  const tripId = request.nextUrl.searchParams.get('tripId') || '';
  const telegramUserId = Number(request.nextUrl.searchParams.get('telegramUserId') || 0);
  const discountCode = normalizeDiscountCode(request.nextUrl.searchParams.get('discountCode') || '');

  return { sessionId, tripId, telegramUserId, discountCode };
}

async function resolveSession(
  sessionId: string,
  tripId: string,
  telegramUserId: number
): Promise<SessionRow | null> {
  const client = await getPrimaryClient();

  if (sessionId) {
    const { data } = await client
      .from('telegram_booking_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('telegram_user_id', telegramUserId)
      .eq('trip_id', tripId)
      .eq('status', 'awaiting_auto_payment')
      .maybeSingle();
    if (data) return data as SessionRow;
  }

  const { data } = await client
    .from('telegram_booking_sessions')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .eq('trip_id', tripId)
    .eq('status', 'awaiting_auto_payment')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as SessionRow | null) || null;
}

export async function GET(request: NextRequest) {
  try {
    const { sessionId, tripId, telegramUserId, discountCode } = parseRequiredQuery(request);
    if (!sessionId || !tripId || !telegramUserId) {
      return NextResponse.json(
        { ok: false, error: 'sessionId, tripId and telegramUserId are required' },
        { status: 400 }
      );
    }

    const config = getTelebirrConfigStatus();
    if (!config.configured) {
      return NextResponse.json(
        { ok: false, error: `Telebirr not configured. Missing: ${config.missing.join(', ')}` },
        { status: 500 }
      );
    }

    const client = await getPrimaryClient();
    const session = await resolveSession(sessionId, tripId, telegramUserId);
    if (!session) {
      return NextResponse.json({ ok: false, error: 'Booking session not found or expired' }, { status: 404 });
    }

    const { data: trip, error: tripError } = await client
      .from('trips')
      .select('id, name, price_per_ticket')
      .eq('id', session.trip_id)
      .maybeSingle();
    if (tripError || !trip) {
      return NextResponse.json({ ok: false, error: 'Trip not found' }, { status: 404 });
    }

    const tripRow = trip as TripRow;
    const quantity = Math.max(1, Number(session.quantity || 1));
    const unitPrice = Number(tripRow.price_per_ticket || 0);
    const baseAmount = Number((quantity * unitPrice).toFixed(2));
    const sessionDiscountCode = normalizeDiscountCode((session as any)?.discount_code || '');
    const effectiveDiscountCode = discountCode || sessionDiscountCode;
    const discountResolution = await resolveDiscountVoucher(
      client,
      effectiveDiscountCode,
      session.trip_id,
      session.telegram_user_id
    );
    if (discountResolution.error && effectiveDiscountCode) {
      return NextResponse.json({ ok: false, error: discountResolution.error }, { status: 400 });
    }
    const voucher = discountResolution.voucher;
    const pricing = voucher
      ? calculateDiscountAmount(baseAmount, voucher.discountPercent)
      : calculateDiscountAmount(baseAmount, 0);
    const amount = pricing.finalAmount;
    const referenceNumber = `TB-${session.id}-${Date.now().toString().slice(-4)}`;
    const base = resolveAppBase(request);
    const callbackURL = `${base}/api/telebirr/callback?sessionId=${encodeURIComponent(
      session.id
    )}&telegramUserId=${encodeURIComponent(String(session.telegram_user_id))}&tripId=${encodeURIComponent(session.trip_id)}`;
    const callbackURLWithDiscount = voucher?.code
      ? `${callbackURL}&discountCode=${encodeURIComponent(voucher.code)}`
      : callbackURL;
    const returnURL = `${base}/miniapp?telebirr=return&sessionId=${encodeURIComponent(
      session.id
    )}&tripId=${encodeURIComponent(session.trip_id)}`;

    const { data: user } = await client
      .from('telegram_users')
      .select('phone_number')
      .eq('id', session.telegram_user_id)
      .maybeSingle();
    const resolvedPhone = String((session as any)?.customer_phone || user?.phone_number || '').trim() || undefined;

    const payment = await initiateTelebirrPayment({
      amount,
      phoneNumber: resolvedPhone,
      referenceNumber,
      description: `Trip ticket for ${tripRow.name || 'Trip'}`,
      tradeType: 'Checkout',
      callbackURL: callbackURLWithDiscount,
      returnURL,
      metadata: {
        sessionId: session.id,
        tripId: session.trip_id,
        telegramUserId: session.telegram_user_id,
        quantity,
        baseAmount: pricing.baseAmount,
        discountCode: voucher?.code || null,
        discountPercent: voucher?.discountPercent || 0,
        discountAmount: pricing.discountAmount,
        finalAmount: pricing.finalAmount,
      },
    });

    if (payment.status === 'failed') {
      return NextResponse.json(
        { ok: false, error: payment.message, details: payment.raw || null },
        { status: 502 }
      );
    }

    if (!payment.redirectURL) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Telebirr responded without checkout URL',
          details: payment.raw || null,
        },
        { status: 502 }
      );
    }

    return NextResponse.redirect(payment.redirectURL, { status: 302 });
  } catch (error) {
    console.error('[telebirr-checkout] Error:', error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        details: (error as any)?.cause || null,
      },
      { status: 500 }
    );
  }
}
