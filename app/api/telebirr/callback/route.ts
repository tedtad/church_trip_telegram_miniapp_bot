import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { sendTelegramDocument, sendTelegramMessage, generateTicketNumber, generateTripSerialNumber } from '@/lib/telegram';
import { getTelebirrConfigStatus, validateTelebirrWebhookSignature } from '@/lib/telebirr';
import { generateTicketQRCode } from '@/lib/qr-code';
import { calculateDiscountAmount, incrementVoucherUsage, normalizeDiscountCode, resolveDiscountVoucher } from '@/lib/discount-vouchers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TELEBIRR_CALLBACK_SECRET = process.env.TELEBIRR_CALLBACK_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';

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
  discount_amount?: number | null;
  base_amount?: number | null;
  final_amount?: number | null;
  discount_voucher_id?: string | null;
};

type TripRow = {
  id: string;
  name?: string | null;
  price_per_ticket: number | null;
  available_seats?: number | null;
};

type CallbackInput = {
  sessionId: string;
  telegramUserId: number;
  tripId: string;
  transactionId: string;
  paymentStatus: string;
  discountCode?: string;
  rawPayload: unknown;
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

function resolveAppBaseUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    try {
      return new URL(value).origin.replace(/\/+$/, '');
    } catch { }
  }
  return '';
}

function buildTicketNumberUnique(receiptId: string, index: number) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${index + 1}-${Math.floor(Math.random() * 90 + 10)}`;
}

function parseSeatCount(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function pickString(source: any, keys: string[]) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function parseRawRequestFromPayload(payload: any) {
  const rawRequest =
    pickString(payload, ['rawRequest', 'raw_request']) ||
    pickString(payload?.result, ['rawRequest', 'raw_request']) ||
    pickString(payload?.data, ['rawRequest', 'raw_request']) ||
    pickString(payload?.biz_content, ['rawRequest', 'raw_request']) ||
    pickString(payload?.bizContent, ['rawRequest', 'raw_request']);

  if (!rawRequest) return new URLSearchParams();
  return new URLSearchParams(rawRequest.replace(/\r/g, '').replace(/\n/g, '').trim());
}

function parseInput(request: NextRequest, payload: any): CallbackInput {
  const q = request.nextUrl.searchParams;
  const raw = parseRawRequestFromPayload(payload);
  const fromRaw = (key: string) => raw.get(key) || '';
  const sessionId =
    pickString(payload, ['sessionId', 'session_id']) ||
    fromRaw('sessionId') ||
    fromRaw('session_id') ||
    q.get('sessionId') ||
    q.get('session_id') ||
    '';
  const telegramUserId = Number(
    pickString(payload, ['telegramUserId', 'telegram_user_id']) ||
    fromRaw('telegramUserId') ||
    fromRaw('telegram_user_id') ||
    q.get('telegramUserId') ||
    q.get('telegram_user_id') ||
    0
  );
  const tripId =
    pickString(payload, ['tripId', 'trip_id']) ||
    fromRaw('tripId') ||
    fromRaw('trip_id') ||
    q.get('tripId') ||
    q.get('trip_id') ||
    '';
  const transactionId =
    pickString(payload, [
      'transactionId',
      'transaction_id',
      'reference',
      'outTradeNo',
      'tradeNo',
      'trxId',
      'prepay_id',
      'prepayId',
      'merch_order_id',
      'merchOrderId',
      'out_trade_no',
    ]) ||
    pickString(payload?.result, [
      'transactionId',
      'transaction_id',
      'reference',
      'outTradeNo',
      'tradeNo',
      'trxId',
      'prepay_id',
      'prepayId',
      'merch_order_id',
      'merchOrderId',
      'out_trade_no',
    ]) ||
    pickString(payload?.data, [
      'transactionId',
      'transaction_id',
      'reference',
      'outTradeNo',
      'tradeNo',
      'trxId',
      'prepay_id',
      'prepayId',
      'merch_order_id',
      'merchOrderId',
      'out_trade_no',
    ]) ||
    pickString(payload?.biz_content, [
      'transactionId',
      'transaction_id',
      'reference',
      'outTradeNo',
      'tradeNo',
      'trxId',
      'prepay_id',
      'prepayId',
      'merch_order_id',
      'merchOrderId',
      'out_trade_no',
    ]) ||
    pickString(payload?.bizContent, [
      'transactionId',
      'transaction_id',
      'reference',
      'outTradeNo',
      'tradeNo',
      'trxId',
      'prepay_id',
      'prepayId',
      'merch_order_id',
      'merchOrderId',
      'out_trade_no',
    ]) ||
    fromRaw('transactionId') ||
    fromRaw('transaction_id') ||
    fromRaw('reference') ||
    fromRaw('outTradeNo') ||
    fromRaw('tradeNo') ||
    fromRaw('trxId') ||
    fromRaw('prepay_id') ||
    fromRaw('prepayId') ||
    fromRaw('merch_order_id') ||
    fromRaw('merchOrderId') ||
    fromRaw('out_trade_no') ||
    q.get('transactionId') ||
    q.get('transaction_id') ||
    q.get('reference') ||
    q.get('outTradeNo') ||
    q.get('tradeNo') ||
    q.get('prepay_id') ||
    q.get('prepayId') ||
    q.get('merch_order_id') ||
    q.get('merchOrderId') ||
    q.get('out_trade_no') ||
    '';
  const paymentStatus =
    pickString(payload, ['status', 'tradeStatus', 'trade_status', 'result', 'resultCode', 'respCode']) ||
    pickString(payload?.result, ['status', 'tradeStatus', 'trade_status', 'result', 'resultCode', 'respCode']) ||
    pickString(payload?.data, ['status', 'tradeStatus', 'trade_status', 'result', 'resultCode', 'respCode']) ||
    pickString(payload?.biz_content, ['status', 'tradeStatus', 'trade_status', 'result', 'resultCode', 'respCode']) ||
    pickString(payload?.bizContent, ['status', 'tradeStatus', 'trade_status', 'result', 'resultCode', 'respCode']) ||
    fromRaw('status') ||
    fromRaw('tradeStatus') ||
    fromRaw('trade_status') ||
    fromRaw('result') ||
    fromRaw('resultCode') ||
    fromRaw('respCode') ||
    q.get('status') ||
    q.get('tradeStatus') ||
    q.get('trade_status') ||
    q.get('resultCode') ||
    q.get('respCode') ||
    '';

  const discountCode =
    pickString(payload, ['discountCode', 'discount_code']) ||
    pickString(payload?.result, ['discountCode', 'discount_code']) ||
    pickString(payload?.data, ['discountCode', 'discount_code']) ||
    fromRaw('discountCode') ||
    fromRaw('discount_code') ||
    q.get('discountCode') ||
    q.get('discount_code') ||
    '';

  return {
    sessionId,
    telegramUserId,
    tripId,
    transactionId,
    paymentStatus: paymentStatus.toLowerCase(),
    discountCode: normalizeDiscountCode(discountCode),
    rawPayload: payload,
  };
}

function isSuccessfulPayment(status: string) {
  return ['success', 'paid', 'confirmed', 'completed', 'successful', 'ok', '0', 'succeed'].includes(status);
}

function buildMiniAppReturnRedirect(request: NextRequest, input: CallbackInput) {
  const base = resolveAppBaseUrl(APP_URL, request.nextUrl.origin);
  if (!base) return null;

  const target = new URL('/miniapp', base);
  target.searchParams.set('telebirr', 'return');
  if (input.sessionId) target.searchParams.set('sessionId', input.sessionId);
  if (input.tripId) target.searchParams.set('tripId', input.tripId);
  if (input.telegramUserId > 0) target.searchParams.set('telegramUserId', String(input.telegramUserId));
  return target.toString();
}

function extractSessionIdFromTransactionId(transactionId: string) {
  const match = String(transactionId || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match ? match[0] : '';
}

async function handleCallback(input: CallbackInput) {
  if (!input.transactionId) {
    return NextResponse.json({ ok: false, error: 'Missing transactionId' }, { status: 400 });
  }

  if (!isSuccessfulPayment(input.paymentStatus)) {
    return NextResponse.json({ ok: true, message: 'Ignored non-success payment status' });
  }

  const client = await getPrimaryClient();

  let session: SessionRow | null = null;
  if (input.sessionId) {
    const { data } = await client
      .from('telegram_booking_sessions')
      .select('*')
      .eq('id', input.sessionId)
      .in('status', ['awaiting_auto_payment', 'awaiting_receipt'])
      .maybeSingle();
    session = (data as SessionRow | null) || null;
  }

  if (!session) {
    const sessionFromReference = extractSessionIdFromTransactionId(input.transactionId);
    if (sessionFromReference) {
      const { data } = await client
        .from('telegram_booking_sessions')
        .select('*')
        .eq('id', sessionFromReference)
        .in('status', ['awaiting_auto_payment', 'awaiting_receipt'])
        .maybeSingle();
      session = (data as SessionRow | null) || null;
    }
  }

  if (!session && input.telegramUserId > 0) {
    const { data } = await client
      .from('telegram_booking_sessions')
      .select('*')
      .eq('telegram_user_id', input.telegramUserId)
      .eq('status', 'awaiting_auto_payment')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    session = (data as SessionRow | null) || null;
  }

  if (!session && input.telegramUserId > 0 && input.tripId) {
    session = {
      id: '',
      telegram_user_id: input.telegramUserId,
      trip_id: input.tripId,
      quantity: 1,
      status: 'awaiting_auto_payment',
    };
  }

  if (!session) {
    return NextResponse.json({ ok: false, error: 'No matching booking session found' }, { status: 404 });
  }

  const { data: existingReceipt } = await client
    .from('receipts')
    .select('id, reference_number')
    .ilike('reference_number', `${input.transactionId}%`)
    .limit(1)
    .maybeSingle();

  if (existingReceipt) {
    return NextResponse.json({ ok: true, message: 'Already processed', receiptId: existingReceipt.id });
  }

  const { data: trip, error: tripError } = await client
    .from('trips')
    .select('id, name, price_per_ticket, available_seats')
    .eq('id', session.trip_id)
    .maybeSingle();

  if (tripError || !trip) {
    return NextResponse.json({ ok: false, error: 'Trip not found for session' }, { status: 400 });
  }

  const tripRow = trip as TripRow;
  const quantity = Math.max(1, Number(session.quantity || 1));
  const unitPrice = Number(tripRow.price_per_ticket || 0);
  const baseAmount = Number((unitPrice * quantity).toFixed(2));
  const sessionDiscountCode = normalizeDiscountCode((session as any)?.discount_code || '');
  const effectiveDiscountCode = normalizeDiscountCode(input.discountCode || sessionDiscountCode);
  const discountResolution = await resolveDiscountVoucher(client, effectiveDiscountCode, session.trip_id);
  if (discountResolution.error && effectiveDiscountCode) {
    return NextResponse.json({ ok: false, error: discountResolution.error }, { status: 400 });
  }
  const voucher = discountResolution.voucher;
  const pricing = voucher
    ? calculateDiscountAmount(baseAmount, voucher.discountPercent)
    : calculateDiscountAmount(baseAmount, 0);
  const amountPaid = pricing.finalAmount;
  const finalUnitPrice = quantity > 0 ? Number((pricing.finalAmount / quantity).toFixed(2)) : 0;
  const uniqueReference = `${input.transactionId}-${Date.now().toString().slice(-6)}`;

  const availableSeats = parseSeatCount(tripRow.available_seats);
  if (availableSeats !== null && availableSeats < quantity) {
    return NextResponse.json(
      {
        ok: false,
        error: `Paid but no seats available for auto-approval. Available: ${availableSeats}, requested: ${quantity}`,
      },
      { status: 409 }
    );
  }

  let seatsReserved = false;
  if (availableSeats !== null) {
    const { error: reserveSeatError } = await client
      .from('trips')
      .update({ available_seats: availableSeats - quantity })
      .eq('id', session.trip_id);
    if (reserveSeatError) {
      return NextResponse.json({ ok: false, error: 'Failed to reserve seats for paid booking' }, { status: 500 });
    }
    seatsReserved = true;
  }

  const receiptPayloadWithApprovedAt = {
    reference_number: uniqueReference,
    telegram_user_id: session.telegram_user_id,
    trip_id: session.trip_id,
    payment_method: 'telebirr_auto',
    amount_paid: amountPaid,
    base_amount: pricing.baseAmount,
    discount_code: voucher?.code || null,
    discount_percent: voucher?.discountPercent || 0,
    discount_amount: pricing.discountAmount,
    currency: 'ETB',
    quantity,
    approval_status: 'approved',
    approval_notes: 'Auto-approved via Telebirr callback',
    approved_at: new Date().toISOString(),
  };
  const receiptPayloadWithoutApprovedAt = {
    reference_number: uniqueReference,
    telegram_user_id: session.telegram_user_id,
    trip_id: session.trip_id,
    payment_method: 'telebirr_auto',
    amount_paid: amountPaid,
    base_amount: pricing.baseAmount,
    discount_code: voucher?.code || null,
    discount_percent: voucher?.discountPercent || 0,
    discount_amount: pricing.discountAmount,
    currency: 'ETB',
    quantity,
    approval_status: 'approved',
    approval_notes: 'Auto-approved via Telebirr callback',
  };

  const detectMissingColumn = (error: unknown): string | null => {
    const message = String((error as any)?.message || '');
    if (!message.toLowerCase().includes('column')) return null;
    const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
    if (quoted?.[1]) return quoted[1].split('.').pop() || null;
    const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
    if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
    return null;
  };

  let receipt: any = null;
  let receiptError: any = null;
  let payloadWithApprovedAt: Record<string, unknown> = { ...receiptPayloadWithApprovedAt };
  let payloadWithoutApprovedAt: Record<string, unknown> = { ...receiptPayloadWithoutApprovedAt };

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const firstTry = await client.from('receipts').insert(payloadWithApprovedAt).select('*').single();
    if (!firstTry.error && firstTry.data) {
      receipt = firstTry.data;
      receiptError = null;
      break;
    }

    const missingInFirst = detectMissingColumn(firstTry.error);
    if (missingInFirst && missingInFirst in payloadWithApprovedAt) {
      delete payloadWithApprovedAt[missingInFirst];
      if (missingInFirst in payloadWithoutApprovedAt) delete payloadWithoutApprovedAt[missingInFirst];
      receiptError = firstTry.error;
      continue;
    }

    const secondTry = await client.from('receipts').insert(payloadWithoutApprovedAt).select('*').single();
    if (!secondTry.error && secondTry.data) {
      receipt = secondTry.data;
      receiptError = null;
      break;
    }

    const missingInSecond = detectMissingColumn(secondTry.error);
    if (missingInSecond && missingInSecond in payloadWithoutApprovedAt) {
      delete payloadWithoutApprovedAt[missingInSecond];
      if (missingInSecond in payloadWithApprovedAt) delete payloadWithApprovedAt[missingInSecond];
      receiptError = secondTry.error;
      continue;
    }

    receiptError = secondTry.error || firstTry.error;
    break;
  }

  if (receiptError || !receipt) {
    if (seatsReserved) {
      await client.from('trips').update({ available_seats: availableSeats }).eq('id', session.trip_id);
      seatsReserved = false;
    }
    return NextResponse.json({ ok: false, error: 'Failed to create auto-payment receipt' }, { status: 500 });
  }

  const issuedAt = new Date().toISOString();
  const ticketRows = Array.from({ length: quantity }).map((_, idx) => ({
    ticket_number: buildTicketNumberUnique(receipt.id, idx),
    serial_number: generateTripSerialNumber(tripRow.name, tripRow.id, idx),
    receipt_id: receipt.id,
    trip_id: session.trip_id,
    telegram_user_id: session.telegram_user_id,
    purchase_price: finalUnitPrice,
    ticket_status: 'confirmed',
    issued_at: issuedAt,
  }));

  const { data: insertedTickets, error: ticketsError } = await client
    .from('tickets')
    .insert(ticketRows)
    .select('id, serial_number');
  if (ticketsError) {
    if (seatsReserved) {
      await client.from('trips').update({ available_seats: availableSeats }).eq('id', session.trip_id);
      seatsReserved = false;
    }
    await client
      .from('receipts')
      .update({ approval_status: 'rejected', rejection_reason: 'Auto-approval failed during ticket generation' })
      .eq('id', receipt.id);
    return NextResponse.json({ ok: false, error: 'Failed to create pending tickets' }, { status: 500 });
  }
  if (!insertedTickets || insertedTickets.length !== quantity) {
    if (seatsReserved) {
      await client.from('trips').update({ available_seats: availableSeats }).eq('id', session.trip_id);
      seatsReserved = false;
    }
    await client
      .from('receipts')
      .update({ approval_status: 'rejected', rejection_reason: 'Auto-approval ticket count mismatch' })
      .eq('id', receipt.id);
    return NextResponse.json(
      { ok: false, error: `Ticket generation mismatch. Expected ${quantity}, got ${insertedTickets?.length || 0}` },
      { status: 500 }
    );
  }

  for (const ticket of insertedTickets as Array<{ id: string; serial_number: string }>) {
    try {
      const qr = await generateTicketQRCode(ticket.id, ticket.serial_number);
      await client.from('tickets').update({ qr_code: qr }).eq('id', ticket.id);
    } catch (error) {
      console.error('[telebirr-callback] Failed to generate QR for ticket:', ticket.id, error);
    }
  }

  await client
    .from('telegram_booking_sessions')
    .update({ status: 'completed' })
    .eq('telegram_user_id', session.telegram_user_id)
    .eq('trip_id', session.trip_id)
    .in('status', ['awaiting_auto_payment', 'awaiting_receipt']);

  await client.from('telebirr_payments').insert({
    receipt_id: receipt.id,
    telebirr_transaction_id: input.transactionId,
    status: 'confirmed',
    amount: amountPaid,
    response_data: input.rawPayload,
  });

  if (voucher?.id) {
    try {
      await incrementVoucherUsage(client, voucher.id);
    } catch (voucherError) {
      console.error('[telebirr-callback] Failed to increment voucher usage:', voucherError);
    }
  }

  await sendTelegramMessage(
    session.telegram_user_id,
    [
      'Telebirr payment confirmed and auto-approved.',
      `Reference: ${uniqueReference}`,
      `Tickets issued: ${quantity}`,
      'Your digital ticket is ready to use.',
    ].join('\n')
  );

  const appBase = resolveAppBaseUrl(APP_URL);
  if (appBase) {
    for (const [index, ticket] of (insertedTickets as Array<{ id: string; serial_number: string }>).entries()) {
      try {
        const cardUrl = `${appBase}/api/tickets/${ticket.id}/card?serial=${encodeURIComponent(ticket.serial_number)}`;
        const sent = await sendTelegramDocument(
          session.telegram_user_id,
          cardUrl,
          `Digital Ticket ${index + 1}/${quantity}\nReference: ${uniqueReference}`
        );
        if (!sent) {
          await sendTelegramMessage(session.telegram_user_id, `Open ticket: ${cardUrl}`);
        }
      } catch (error) {
        console.error('[telebirr-callback] Failed to send digital ticket card:', error);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    receiptId: receipt.id,
    reference: uniqueReference,
    confirmedTickets: quantity,
  });
}

function ensureCallbackAuthorized(request: NextRequest, payload: unknown) {
  if (TELEBIRR_CALLBACK_SECRET) {
    const providedSecret =
      request.headers.get('x-telebirr-secret') ||
      request.nextUrl.searchParams.get('secret') ||
      '';
    if (providedSecret && providedSecret !== TELEBIRR_CALLBACK_SECRET) {
      return NextResponse.json({ ok: false, error: 'Unauthorized callback' }, { status: 401 });
    }
  }

  const signature = request.headers.get('x-telebirr-signature') || '';
  const configStatus = getTelebirrConfigStatus();
  const hasAppSecret = !configStatus.optionalMissing.includes('TELEBIRR_APP_SECRET');
  if (
    configStatus.mode === 'live' &&
    hasAppSecret &&
    signature &&
    !validateTelebirrWebhookSignature(payload, signature)
  ) {
    return NextResponse.json({ ok: false, error: 'Invalid callback signature' }, { status: 401 });
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let payload: any = {};
    if (rawBody) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = Object.fromEntries(new URLSearchParams(rawBody).entries());
      }
    }

    const authError = ensureCallbackAuthorized(request, payload);
    if (authError) return authError;

    const input = parseInput(request, payload);
    input.rawPayload = payload && Object.keys(payload).length > 0 ? payload : rawBody;
    return await handleCallback(input);
  } catch (error) {
    console.error('[telebirr-callback] POST Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const payload = Object.fromEntries(request.nextUrl.searchParams.entries());
    const authError = ensureCallbackAuthorized(request, payload);
    if (authError) return authError;

    const input = parseInput(request, payload);
    if (!input.transactionId) {
      const redirect = buildMiniAppReturnRedirect(request, input);
      if (redirect) {
        return NextResponse.redirect(redirect, { status: 302 });
      }
      return NextResponse.json({
        ok: true,
        message: 'Payment return received. Waiting for payment confirmation callback.',
      });
    }
    return await handleCallback(input);
  } catch (error) {
    console.error('[telebirr-callback] GET Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
