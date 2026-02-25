import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { formatBankAccounts, getTripManualPaymentConfig } from '@/lib/payment-config';
import { calculateDiscountAmount, normalizeDiscountCode, resolveDiscountVoucher } from '@/lib/discount-vouchers';
import { normalizeGnplSettings } from '@/lib/gnpl';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);
const MAX_GNPL_ID_CARD_BYTES = 2 * 1024 * 1024;
const MIN_GNPL_ID_CARD_BYTES = 1024;
const ALLOWED_GNPL_ID_CARD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
]);

type PaymentMethod = 'bank' | 'telebirr' | 'telebirr_auto' | 'gnpl';
type BookingSessionStatus = 'awaiting_receipt' | 'awaiting_auto_payment' | 'awaiting_gnpl_approval';

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

function normalizeCustomerName(raw: unknown) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function normalizeCustomerPhone(raw: unknown) {
  return String(raw || '').trim().replace(/[\s()-]/g, '');
}

function normalizeIdNumber(raw: unknown) {
  return String(raw || '').trim().replace(/\s+/g, '').toUpperCase();
}

function normalizeUploadedFileName(raw: unknown, fallback: string) {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function splitName(fullName: string) {
  const normalized = normalizeCustomerName(fullName);
  if (!normalized) return { firstName: 'Telegram User', lastName: null as string | null };
  const parts = normalized.split(' ');
  const firstName = parts.shift() || 'Telegram User';
  const lastName = parts.length ? parts.join(' ') : null;
  return { firstName, lastName };
}

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

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
    body?.initData ||
    request.nextUrl.searchParams.get('initData') ||
    ''
  ).trim();
}

function normalizePaymentMethod(raw: string): PaymentMethod | null {
  const value = String(raw || '').trim();
  if (value === 'bank' || value === 'telebirr' || value === 'telebirr_auto' || value === 'gnpl') return value;
  return null;
}

function parseSeatCount(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64Data: string } | null {
  const text = String(dataUrl || '').trim();
  const match = text.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;

  const mimeType = String(match[1] || '').trim().toLowerCase();
  const base64Data = String(match[2] || '').replace(/\s+/g, '');
  if (!mimeType || !base64Data) return null;

  return { mimeType, base64Data };
}

function estimateBase64Bytes(base64Data: string) {
  const cleaned = String(base64Data || '').replace(/\s+/g, '');
  const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((cleaned.length * 3) / 4) - padding);
}

async function queryTripByIdWithFallback(client: any, tripId: string) {
  const selectCandidates = [
    'id, name, available_seats, price_per_ticket, status, trip_status, allow_gnpl, bank_accounts, telebirr_manual_account_name, telebirr_manual_account_number, manual_payment_note, telegram_group_url',
    'id, name, available_seats, price_per_ticket, status, trip_status, bank_accounts, telebirr_manual_account_name, telebirr_manual_account_number, manual_payment_note, telegram_group_url',
  ];

  for (const selectClause of selectCandidates) {
    const result = await client.from('trips').select(selectClause).eq('id', tripId).maybeSingle();
    if (!result.error) {
      return result;
    }
  }

  return client.from('trips').select('*').eq('id', tripId).maybeSingle();
}

function buildManualInstructions(trip: any, method: 'bank' | 'telebirr') {
  const config = getTripManualPaymentConfig(trip);
  const lines: string[] = [];

  if (method === 'telebirr') {
    lines.push('Payment Channel: Telebirr Manual');
    lines.push(
      `Account Name: ${config.telebirrManualAccountName || 'Not configured'}`,
      `Account Number: ${config.telebirrManualAccountNumber || 'Not configured'}`
    );
  } else {
    lines.push('Payment Channel: Bank Transfer');
    if (config.bankAccounts.length) {
      lines.push('Available bank accounts:');
      lines.push(formatBankAccounts(config.bankAccounts));
    } else {
      lines.push('Bank account details are not configured for this trip yet.');
    }
  }

  if (config.manualPaymentNote) {
    lines.push(`Note: ${config.manualPaymentNote}`);
  }

  lines.push('');
  lines.push('Next: complete the manual payment form in Mini App with quantity, paid amount, reference, and receipt.');
  return lines.filter(Boolean).join('\n');
}

function buildManualConfig(trip: any, method: 'bank' | 'telebirr') {
  const config = getTripManualPaymentConfig(trip);
  return {
    method,
    bankAccounts: config.bankAccounts,
    telebirrManualAccountName: config.telebirrManualAccountName,
    telebirrManualAccountNumber: config.telebirrManualAccountNumber,
    manualPaymentNote: config.manualPaymentNote,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tripId = String(body?.tripId || '').trim();
    const paymentMethod = normalizePaymentMethod(String(body?.paymentMethod || '').trim());
    const rawQuantity = Number(body?.quantity);
    const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : 1;
    const customerName = normalizeCustomerName(body?.customerName);
    const customerPhone = normalizeCustomerPhone(body?.customerPhone);
    const discountCode = normalizeDiscountCode(body?.discountCode);
    const legacyIdNumber = normalizeIdNumber(body?.idNumber);
    const gnplIdCardDataUrl = String(body?.gnplIdCardDataUrl || '').trim();
    const gnplIdCardFileName = normalizeUploadedFileName(body?.gnplIdCardFileName, `gnpl_id_${Date.now()}.bin`);
    const parsedGnplIdCard = gnplIdCardDataUrl ? parseDataUrl(gnplIdCardDataUrl) : null;

    if (!tripId || !paymentMethod) {
      return NextResponse.json({ ok: false, error: 'tripId and paymentMethod are required' }, { status: 400 });
    }
    if (!customerName) {
      return NextResponse.json({ ok: false, error: 'Customer name is required' }, { status: 400 });
    }
    if (!/^\+?[0-9]{7,20}$/.test(customerPhone)) {
      return NextResponse.json({ ok: false, error: 'Valid customer phone number is required' }, { status: 400 });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ ok: false, error: 'Quantity must be a positive integer' }, { status: 400 });
    }
    if (paymentMethod === 'gnpl' && !parsedGnplIdCard) {
      return NextResponse.json({ ok: false, error: 'Scanned ID card file is required for GNPL' }, { status: 400 });
    }
    if (paymentMethod === 'gnpl' && parsedGnplIdCard && !ALLOWED_GNPL_ID_CARD_MIME_TYPES.has(parsedGnplIdCard.mimeType)) {
      return NextResponse.json({ ok: false, error: 'ID card file must be JPG, PNG, or PDF' }, { status: 400 });
    }
    if (paymentMethod === 'gnpl' && parsedGnplIdCard) {
      const idCardBytes = estimateBase64Bytes(parsedGnplIdCard.base64Data);
      if (idCardBytes <= 0) {
        return NextResponse.json({ ok: false, error: 'ID card file is empty' }, { status: 400 });
      }
      if (idCardBytes < MIN_GNPL_ID_CARD_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error: 'ID card image quality is too low. Please upload a clearer image or PDF.',
          },
          { status: 400 }
        );
      }
      if (idCardBytes > MAX_GNPL_ID_CARD_BYTES) {
        return NextResponse.json({ ok: false, error: 'ID card file is too large' }, { status: 413 });
      }
    }

    const client = await getPrimaryClient();
    const { data: settingsRaw } = await client
      .from('app_settings')
      .select(
        'gnpl_enabled, gnpl_require_admin_approval, gnpl_default_term_days, gnpl_penalty_enabled, gnpl_penalty_percent, gnpl_penalty_period_days'
      )
      .eq('id', 'default')
      .maybeSingle();
    const gnplSettings = normalizeGnplSettings(settingsRaw || {});
    if (paymentMethod === 'gnpl' && !gnplSettings.enabled) {
      return NextResponse.json({ ok: false, error: 'GNPL is currently disabled' }, { status: 400 });
    }

    const { firstName, lastName } = splitName(customerName);
    const userUpsertCandidates = [
      {
        id: auth.user.id,
        first_name: firstName,
        last_name: lastName,
        username: auth.user.username || null,
        phone_number: customerPhone,
        last_activity: new Date().toISOString(),
        last_interaction: new Date().toISOString(),
      },
      {
        id: auth.user.id,
        first_name: firstName,
        last_name: lastName,
        username: auth.user.username || null,
        phone_number: customerPhone,
        last_activity: new Date().toISOString(),
      },
      {
        id: auth.user.id,
        first_name: firstName,
        last_name: lastName,
        username: auth.user.username || null,
        phone_number: customerPhone,
      },
    ];
    for (const payload of userUpsertCandidates) {
      const result = await client.from('telegram_users').upsert(payload, { onConflict: 'id' });
      if (!result.error) break;
    }

    const { data: trip, error: tripError } = await queryTripByIdWithFallback(client, tripId);

    if (tripError || !trip) {
      return NextResponse.json({ ok: false, error: 'Trip not found' }, { status: 404 });
    }

    const status = String((trip as any).status ?? (trip as any).trip_status ?? 'active').toLowerCase();
    if (['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status)) {
      return NextResponse.json({ ok: false, error: 'Trip is not available' }, { status: 400 });
    }
    if (paymentMethod === 'gnpl' && !(trip as any).allow_gnpl) {
      return NextResponse.json({ ok: false, error: 'GNPL is not enabled for this trip' }, { status: 400 });
    }

    const availableSeats = parseSeatCount((trip as any).available_seats);
    if (availableSeats !== null && availableSeats < quantity) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Not enough seats available',
          details: { availableSeats, requested: quantity },
        },
        { status: 400 }
      );
    }

    const unitPrice = Number((trip as any).price_per_ticket || 0);
    const baseTotal = Number((unitPrice * quantity).toFixed(2));
    const discountResolution = await resolveDiscountVoucher(client, discountCode, tripId);
    if (discountResolution.error) {
      return NextResponse.json({ ok: false, error: discountResolution.error }, { status: 400 });
    }
    const voucher = discountResolution.voucher;
    const pricing = voucher
      ? calculateDiscountAmount(baseTotal, voucher.discountPercent)
      : calculateDiscountAmount(baseTotal, 0);
    const finalUnitPrice = quantity > 0 ? Number((pricing.finalAmount / quantity).toFixed(2)) : 0;

    const sessionStatus: BookingSessionStatus =
      paymentMethod === 'telebirr_auto'
        ? 'awaiting_auto_payment'
        : paymentMethod === 'gnpl'
          ? 'awaiting_gnpl_approval'
          : 'awaiting_receipt';

    await client
      .from('telegram_booking_sessions')
      .update({ status: 'cancelled' })
      .eq('telegram_user_id', auth.user.id)
      .in('status', ['awaiting_receipt', 'awaiting_auto_payment', 'awaiting_gnpl_approval']);

    let sessionInsertPayload: Record<string, unknown> = {
      telegram_user_id: auth.user.id,
      trip_id: tripId,
      payment_method: paymentMethod,
      quantity,
      status: sessionStatus,
      customer_name: customerName,
      customer_phone: customerPhone,
      discount_code: voucher?.code || null,
      discount_percent: voucher?.discountPercent || 0,
      discount_amount: pricing.discountAmount,
      base_amount: pricing.baseAmount,
      final_amount: pricing.finalAmount,
      discount_voucher_id: voucher?.id || null,
    };

    let session: any = null;
    let sessionError: any = null;
    for (let attempt = 0; attempt < 16; attempt += 1) {
      const result = await client
        .from('telegram_booking_sessions')
        .insert(sessionInsertPayload)
        .select('id, telegram_user_id, trip_id, quantity')
        .single();
      if (!result.error && result.data) {
        session = result.data;
        sessionError = null;
        break;
      }

      sessionError = result.error;
      const missingColumn = detectMissingColumn(result.error);
      if (!missingColumn || !(missingColumn in sessionInsertPayload)) break;
      delete sessionInsertPayload[missingColumn];
    }

    if (sessionError || !session) {
      return NextResponse.json({ ok: false, error: 'Failed to start booking session' }, { status: 500 });
    }

    if (paymentMethod === 'gnpl') {
      const { data: existingGnpl } = await client
        .from('gnpl_accounts')
        .select('id, status')
        .eq('telegram_user_id', auth.user.id)
        .eq('trip_id', tripId)
        .in('status', ['pending_approval', 'approved', 'overdue'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingGnpl?.id) {
        return NextResponse.json(
          { ok: false, error: 'You already have an active GNPL request for this trip' },
          { status: 400 }
        );
      }

      let gnplPayload: Record<string, unknown> = {
        telegram_user_id: auth.user.id,
        trip_id: tripId,
        booking_session_id: session.id,
        status: 'pending_approval',
        customer_name: customerName,
        customer_phone: customerPhone,
        id_number: legacyIdNumber || `SCANNED-${Date.now()}`,
        id_card_file_url: gnplIdCardDataUrl || null,
        id_card_file_name: gnplIdCardFileName || null,
        id_card_mime_type: parsedGnplIdCard?.mimeType || null,
        id_card_uploaded_at: new Date().toISOString(),
        quantity,
        base_amount: pricing.finalAmount,
        approved_amount: pricing.finalAmount,
        principal_paid: 0,
        penalty_accrued: 0,
        penalty_paid: 0,
        outstanding_amount: pricing.finalAmount,
        penalty_percent: gnplSettings.penaltyEnabled ? gnplSettings.penaltyPercent : 0,
        penalty_period_days: gnplSettings.penaltyPeriodDays,
        notes: gnplSettings.requireAdminApproval
          ? 'Awaiting admin approval'
          : 'Queued for processing',
      };

      let gnplError: unknown = null;
      let gnplAccount: any = null;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const result = await client.from('gnpl_accounts').insert(gnplPayload).select('id, status').single();
        if (!result.error && result.data) {
          gnplAccount = result.data;
          gnplError = null;
          break;
        }

        gnplError = result.error;
        const missingColumn = detectMissingColumn(result.error);
        if (!missingColumn || !(missingColumn in gnplPayload)) break;
        delete gnplPayload[missingColumn];
      }

      if (gnplError || !gnplAccount) {
        return NextResponse.json(
          { ok: false, error: 'GNPL module is not configured in database. Run migrations 08 and 09 first.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        mode: 'gnpl',
        message:
          'GNPL request submitted. Admin approval is required before ticket issuance. You can monitor and repay in Mini App.',
        gnpl: {
          accountId: gnplAccount.id,
          status: gnplAccount.status,
          requiresAdminApproval: gnplSettings.requireAdminApproval,
          idCardUploaded: true,
          quantity,
        },
        trip: {
          id: (trip as any).id,
          name: (trip as any).name || 'Trip',
          telegramGroupUrl: String((trip as any).telegram_group_url || '').trim() || null,
          pricePerTicket: unitPrice,
          finalPricePerTicket: finalUnitPrice,
          quantity,
        },
        pricing: {
          unitPrice,
          finalUnitPrice,
          quantity,
          ...pricing,
          discountCode: voucher?.code || null,
        },
      });
    }

    if (paymentMethod === 'telebirr_auto') {
      const base = resolveAppBaseUrl(APP_URL, request.nextUrl.origin);
      if (!base) {
        return NextResponse.json({ ok: false, error: 'Public app URL is not configured' }, { status: 500 });
      }
      const checkout = new URL('/api/telebirr/checkout', base);
      checkout.searchParams.set('telegramUserId', String(auth.user.id));
      checkout.searchParams.set('tripId', tripId);
      checkout.searchParams.set('sessionId', session.id);
      if (voucher?.code) {
        checkout.searchParams.set('discountCode', voucher.code);
      }

      return NextResponse.json({
        ok: true,
        mode: 'telebirr_auto',
        pricing: {
          unitPrice,
          finalUnitPrice,
          quantity,
          ...pricing,
          discountCode: voucher?.code || null,
        },
        tripGroupUrl: String((trip as any).telegram_group_url || '').trim() || null,
        checkoutUrl: checkout.toString(),
      });
    }

    return NextResponse.json({
      ok: true,
      mode: paymentMethod,
      instructions: buildManualInstructions(trip as any, paymentMethod as 'bank' | 'telebirr'),
      manualConfig: buildManualConfig(trip as any, paymentMethod as 'bank' | 'telebirr'),
      message:
        paymentMethod === 'bank'
          ? 'Booking started. Complete bank transfer and submit your receipt in Mini App.'
          : 'Booking started. Complete Telebirr manual payment and submit your receipt in Mini App.',
      trip: {
        id: (trip as any).id,
        name: (trip as any).name || 'Trip',
        telegramGroupUrl: String((trip as any).telegram_group_url || '').trim() || null,
        pricePerTicket: unitPrice,
        finalPricePerTicket: finalUnitPrice,
        quantity,
      },
      pricing: {
        unitPrice,
        finalUnitPrice,
        quantity,
        ...pricing,
        discountCode: voucher?.code || null,
      },
      discount: voucher
        ? {
          id: voucher.id,
          code: voucher.code,
          percent: voucher.discountPercent,
          expiresAt: voucher.expiresAt,
        }
        : null,
    });
  } catch (error) {
    console.error('[miniapp-book] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
