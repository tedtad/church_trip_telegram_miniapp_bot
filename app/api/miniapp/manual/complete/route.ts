import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { generateTicketNumber, generateTripSerialNumber } from '@/lib/telegram';
import { getTripManualPaymentConfig } from '@/lib/payment-config';
import { calculateDiscountAmount, incrementVoucherUsage, normalizeDiscountCode, resolveDiscountVoucher } from '@/lib/discount-vouchers';
import { analyzeReceiptSubmission, normalizeReferenceToken, parseReceiptDateToken } from '@/lib/receipt-intelligence';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);
const DEFAULT_MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const MIN_RECEIPT_BYTES = 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
]);

type PaymentMethod = 'bank' | 'telebirr';

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

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
    body?.initData ||
    request.nextUrl.searchParams.get('initData') ||
    ''
  ).trim();
}

function normalizePaymentMethod(value: unknown): PaymentMethod | null {
  const normalized = String(value || '').trim();
  if (normalized === 'bank' || normalized === 'telebirr') return normalized;
  return null;
}

function parseSeatCount(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.floor(numeric);
}

function buildTicketNumberUnique(receiptId: string, index: number) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${index + 1}-${Math.floor(Math.random() * 90 + 10)}`;
}

function isMissingColumn(error: unknown, column: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes(String(column || '').toLowerCase());
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

function resolveMaxReceiptBytes(maxFileSizeMbRaw: unknown) {
  const numeric = Number(maxFileSizeMbRaw);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_RECEIPT_BYTES;
  const mb = Math.max(1, Math.min(50, Math.floor(numeric)));
  return mb * 1024 * 1024;
}

async function persistReceiptIntelligenceSample(client: any, payload: Record<string, unknown>) {
  let workingPayload: Record<string, unknown> = { ...payload };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.from('receipt_intelligence_samples').insert(workingPayload);
    if (!result.error) return;

    const missingColumn = detectMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in workingPayload)) return;
    delete workingPayload[missingColumn];
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

    const tripId = String(body?.tripId || '').trim();
    const paymentMethod = normalizePaymentMethod(body?.paymentMethod);
    const rawQuantity = Number(body?.quantity);
    const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? Math.floor(rawQuantity) : 1;
    const amountPaid = Number(body?.amountPaid || 0);
    const bankIndex = Number(body?.bankIndex ?? -1);
    const referenceInput = normalizeReferenceToken(body?.referenceNumber);
    const discountCodeInput = normalizeDiscountCode(body?.discountCode);
    const receiptDataUrl = String(body?.receiptDataUrl || '').trim();
    const receiptLinkInput = String(body?.receiptLink || '').trim();
    const receiptDateInput = parseReceiptDateToken(body?.receiptDate);
    const receiptFileName = String(body?.receiptFileName || '').trim() || `receipt_${Date.now()}.bin`;

    if (!tripId || !paymentMethod) {
      return NextResponse.json({ ok: false, error: 'tripId and paymentMethod are required' }, { status: 400 });
    }
    if (!Number.isFinite(amountPaid) || amountPaid <= 0) {
      return NextResponse.json({ ok: false, error: 'Paid amount must be greater than zero' }, { status: 400 });
    }

    const client = await getPrimaryClient();
    const { data: settingsRaw } = await client
      .from('app_settings')
      .select('receipt_intelligence_enabled, receipt_sample_collection_enabled, max_file_size')
      .eq('id', 'default')
      .maybeSingle();
    const receiptIntelligenceEnabled = Boolean((settingsRaw as any)?.receipt_intelligence_enabled);
    const receiptSampleCollectionEnabled = Boolean((settingsRaw as any)?.receipt_sample_collection_enabled);
    const maxReceiptBytes = resolveMaxReceiptBytes((settingsRaw as any)?.max_file_size);

    const analysis = analyzeReceiptSubmission({
      receiptLink: receiptLinkInput,
      referenceInput,
      receiptDateInput,
      amountPaid,
      strict: receiptIntelligenceEnabled,
    });
    if (analysis.error) {
      return NextResponse.json({ ok: false, error: analysis.error }, { status: 400 });
    }
    const receiptLink = analysis.link;
    const reference = analysis.reference;
    const receiptDate = analysis.receiptDate;

    if (!reference) {
      return NextResponse.json({ ok: false, error: 'Valid reference number is required' }, { status: 400 });
    }

    const parsedReceipt = receiptDataUrl ? parseDataUrl(receiptDataUrl) : null;
    if (!parsedReceipt && !receiptLink.url) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Receipt file or receipt link is required',
        },
        { status: 400 }
      );
    }
    if (parsedReceipt && !ALLOWED_RECEIPT_MIME_TYPES.has(parsedReceipt.mimeType)) {
      return NextResponse.json(
        { ok: false, error: 'Receipt type must be JPG, PNG, or PDF' },
        { status: 400 }
      );
    }

    if (parsedReceipt) {
      const receiptBytes = estimateBase64Bytes(parsedReceipt.base64Data);
      if (receiptBytes <= 0) {
        return NextResponse.json({ ok: false, error: 'Receipt file is empty' }, { status: 400 });
      }
      if (receiptBytes < MIN_RECEIPT_BYTES) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Receipt image quality is too low. Please upload a clearer receipt or provide receipt link.',
          },
          { status: 400 }
        );
      }
      if (receiptBytes > maxReceiptBytes) {
        return NextResponse.json(
          { ok: false, error: `Receipt file is too large. Max allowed is ${Math.floor(maxReceiptBytes / (1024 * 1024))}MB.` },
          { status: 413 }
        );
      }
    }

    const { data: trip, error: tripError } = await client
      .from('trips')
      .select(
        'id, name, price_per_ticket, available_seats, status, trip_status, departure_date, created_at, bank_accounts, telebirr_manual_account_name, telebirr_manual_account_number, manual_payment_note'
      )
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ ok: false, error: 'Trip not found' }, { status: 404 });
    }

    const tripStatus = String((trip as any).status ?? (trip as any).trip_status ?? 'active').toLowerCase();
    if (['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(tripStatus)) {
      return NextResponse.json({ ok: false, error: 'Trip is not available' }, { status: 400 });
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

    if (receiptDate) {
      const tripCreatedDate = parseReceiptDateToken((trip as any).created_at);
      const departureDate = parseReceiptDateToken((trip as any).departure_date);

      if (tripCreatedDate && receiptDate < tripCreatedDate) {
        return NextResponse.json(
          { ok: false, error: 'Receipt date is earlier than trip publication period' },
          { status: 400 }
        );
      }
      if (departureDate && receiptDate > departureDate) {
        return NextResponse.json(
          { ok: false, error: 'Receipt date cannot be after trip departure date' },
          { status: 400 }
        );
      }
    }

    const duplicateExact = await client
      .from('receipts')
      .select('id, reference_number')
      .eq('reference_number', reference)
      .limit(1);
    const duplicatePrefixed = await client
      .from('receipts')
      .select('id, reference_number')
      .ilike('reference_number', `${reference}-%`)
      .limit(1);
    if ((!duplicateExact.error && (duplicateExact.data || []).length > 0) || (!duplicatePrefixed.error && (duplicatePrefixed.data || []).length > 0)) {
      return NextResponse.json(
        { ok: false, error: 'Duplicate payment reference detected. Please use a unique payment reference.' },
        { status: 409 }
      );
    }

    const manualConfig = getTripManualPaymentConfig(trip);
    if (paymentMethod === 'bank' && manualConfig.bankAccounts.length > 0) {
      if (!Number.isInteger(bankIndex) || bankIndex < 0 || bankIndex >= manualConfig.bankAccounts.length) {
        return NextResponse.json({ ok: false, error: 'Please select a valid bank account' }, { status: 400 });
      }
    }

    const pricePerTicket = Number((trip as any).price_per_ticket || 0);
    const baseAmount = Number((pricePerTicket * quantity).toFixed(2));

    let existingSession: any = null;
    {
      const selectCandidates = [
        'id, discount_code, discount_percent, discount_amount, base_amount, final_amount, discount_voucher_id',
        'id, discount_code, discount_percent, discount_amount, base_amount, final_amount',
        'id, discount_code, discount_percent, discount_amount',
        'id, discount_code, discount_percent',
        'id',
      ];

      for (const selectClause of selectCandidates) {
        const result = await client
          .from('telegram_booking_sessions')
          .select(selectClause)
          .eq('telegram_user_id', auth.user.id)
          .eq('trip_id', tripId)
          .eq('payment_method', paymentMethod)
          .eq('status', 'awaiting_receipt')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!result.error) {
          existingSession = result.data || null;
          break;
        }
      }
    }

    const sessionDiscountCode = normalizeDiscountCode(existingSession?.discount_code);
    const effectiveDiscountCode = discountCodeInput || sessionDiscountCode;
    const discountResolution = await resolveDiscountVoucher(client, effectiveDiscountCode, tripId);
    if (discountResolution.error && effectiveDiscountCode) {
      return NextResponse.json({ ok: false, error: discountResolution.error }, { status: 400 });
    }
    const voucher = discountResolution.voucher;
    const pricing = voucher
      ? calculateDiscountAmount(baseAmount, voucher.discountPercent)
      : calculateDiscountAmount(baseAmount, 0);
    const finalUnitPrice = quantity > 0 ? Number((pricing.finalAmount / quantity).toFixed(2)) : 0;

    const expectedAmount = pricing.finalAmount;
    if (amountPaid + 0.0001 < expectedAmount) {
      return NextResponse.json(
        { ok: false, error: `Paid amount is less than expected total (${expectedAmount.toFixed(2)} ETB)` },
        { status: 400 }
      );
    }

    let sessionId = String(existingSession?.id || '').trim();

    if (!sessionId) {
      let sessionPayload: Record<string, unknown> = {
        telegram_user_id: auth.user.id,
        trip_id: tripId,
        payment_method: paymentMethod,
        quantity,
        status: 'awaiting_receipt',
        discount_code: voucher?.code || null,
        discount_percent: voucher?.discountPercent || 0,
        discount_amount: pricing.discountAmount,
        base_amount: pricing.baseAmount,
        final_amount: pricing.finalAmount,
        discount_voucher_id: voucher?.id || null,
      };
      let insertedSession: any = null;
      let sessionError: any = null;
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const result = await client
          .from('telegram_booking_sessions')
          .insert(sessionPayload)
          .select('id')
          .single();
        if (!result.error && result.data) {
          insertedSession = result.data;
          sessionError = null;
          break;
        }
        sessionError = result.error;
        const missingColumn = detectMissingColumn(result.error);
        if (!missingColumn || !(missingColumn in sessionPayload)) break;
        delete sessionPayload[missingColumn];
      }

      if (sessionError || !insertedSession) {
        return NextResponse.json({ ok: false, error: 'Failed to create booking session' }, { status: 500 });
      }
      sessionId = insertedSession.id;
    } else {
      let updatePayload: Record<string, unknown> = {
        quantity,
        discount_code: voucher?.code || null,
        discount_percent: voucher?.discountPercent || 0,
        discount_amount: pricing.discountAmount,
        base_amount: pricing.baseAmount,
        final_amount: pricing.finalAmount,
        discount_voucher_id: voucher?.id || null,
      };
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const result = await client.from('telegram_booking_sessions').update(updatePayload).eq('id', sessionId);
        if (!result.error) break;
        const missingColumn = detectMissingColumn(result.error);
        if (!missingColumn || !(missingColumn in updatePayload)) break;
        delete updatePayload[missingColumn];
      }
    }

    const uniqueReference = `${reference}-${Date.now().toString().slice(-6)}`;
    const receiptSourceUrl = parsedReceipt ? receiptDataUrl : receiptLink.url;
    const effectiveReceiptFileName =
      parsedReceipt && receiptFileName
        ? receiptFileName
        : receiptLink.url
          ? `receipt_link_${Date.now()}.txt`
          : receiptFileName;
    const receiptHash = createHash('sha256')
      .update(`${reference}:${auth.user.id}:${effectiveReceiptFileName}:${receiptLink.url}:${Date.now()}`)
      .digest('hex');

    const receiptPayload: Record<string, unknown> = {
      reference_number: uniqueReference,
      telegram_user_id: auth.user.id,
      trip_id: (trip as any).id,
      payment_method: paymentMethod,
      amount_paid: Number(amountPaid.toFixed(2)),
      base_amount: pricing.baseAmount,
      discount_code: voucher?.code || null,
      discount_percent: voucher?.discountPercent || 0,
      discount_amount: pricing.discountAmount,
      currency: 'ETB',
      quantity,
      receipt_file_url: receiptSourceUrl || null,
      receipt_file_name: effectiveReceiptFileName,
      receipt_link: receiptLink.url || null,
      receipt_date: receiptDate || null,
      parsed_reference_number: receiptLink.reference || null,
      parsed_amount: receiptLink.amount,
      receipt_provider: receiptLink.provider || null,
      receipt_validation_mode: receiptIntelligenceEnabled ? 'rules' : 'basic',
      receipt_validation_score: Number(analysis.score.toFixed(2)),
      receipt_validation_flags: analysis.flags,
      receipt_hash: receiptHash,
      approval_status: 'pending',
    };

    let receipt: any = null;
    let workingReceiptPayload: Record<string, unknown> = { ...receiptPayload };
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const insertResult = await client.from('receipts').insert(workingReceiptPayload).select('*').single();
      if (!insertResult.error && insertResult.data) {
        receipt = insertResult.data;
        break;
      }

      const missingColumn = detectMissingColumn(insertResult.error);
      if (!missingColumn || !(missingColumn in workingReceiptPayload)) {
        if (isMissingColumn(insertResult.error, 'receipt_hash') && 'receipt_hash' in workingReceiptPayload) {
          delete workingReceiptPayload.receipt_hash;
          continue;
        }
        break;
      }
      delete workingReceiptPayload[missingColumn];
    }

    if (!receipt) {
      return NextResponse.json({ ok: false, error: 'Failed to create receipt record' }, { status: 500 });
    }

    if (receiptSampleCollectionEnabled) {
      await persistReceiptIntelligenceSample(client, {
        source_type: 'miniapp_manual',
        payment_method: paymentMethod,
        provider: receiptLink.provider || null,
        receipt_link: receiptLink.url || null,
        reference_input: referenceInput || null,
        extracted_reference: receiptLink.reference || reference || null,
        amount_input: Number(amountPaid.toFixed(2)),
        extracted_amount: receiptLink.amount,
        receipt_date_input: receiptDateInput || null,
        extracted_date: receiptLink.date || null,
        validation_mode: receiptIntelligenceEnabled ? 'rules' : 'basic',
        validation_score: Number(analysis.score.toFixed(2)),
        validation_flags: analysis.flags,
      });
    }

    const ticketRows = Array.from({ length: quantity }).map((_, idx) => ({
      ticket_number: buildTicketNumberUnique(receipt.id, idx),
      serial_number: generateTripSerialNumber((trip as any).name, (trip as any).id, idx),
      receipt_id: receipt.id,
      trip_id: (trip as any).id,
      telegram_user_id: auth.user.id,
      purchase_price: finalUnitPrice,
      ticket_status: 'pending',
    }));

    const { error: ticketsError } = await client.from('tickets').insert(ticketRows);
    if (ticketsError) {
      return NextResponse.json({ ok: false, error: 'Failed to create pending tickets' }, { status: 500 });
    }

    if (voucher?.id) {
      try {
        await incrementVoucherUsage(client, voucher.id);
      } catch (voucherError) {
        console.error('[miniapp-manual-complete] Failed to increment voucher usage:', voucherError);
      }
    }

    await client.from('telegram_booking_sessions').update({ status: 'completed' }).eq('id', sessionId);

    return NextResponse.json({
      ok: true,
      message: 'Manual payment submitted. Awaiting admin approval.',
      referenceNumber: uniqueReference,
      ticketCount: quantity,
    });
  } catch (error) {
    console.error('[miniapp-manual-complete] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
