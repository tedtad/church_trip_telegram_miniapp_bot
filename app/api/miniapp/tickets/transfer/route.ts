import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { generateTicketNumber } from '@/lib/telegram';
import { generateTicketQRCode } from '@/lib/qr-code';
import { resolveOrCreateCustomerByPhone } from '@/lib/offline-customer';

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

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      body?.initData ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function normalizePhone(raw: unknown) {
  return String(raw || '').trim().replace(/[^\d+]/g, '');
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

async function insertWithFallback(query: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await query.insert(working).select('*').single();
    if (!result.error && result.data) return result.data;

    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in working)) break;
    delete working[missing];
  }
  return null;
}

function buildTicketNumberUnique(receiptId: string, suffix: string) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${suffix}`.slice(0, 64);
}

function buildTransferSerial(serial: string) {
  const clean = String(serial || '').replace(/[^A-Za-z0-9-]/g, '');
  const tail = Date.now().toString().slice(-6);
  return `${clean || 'TRF'}-T${tail}`.slice(0, 64);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const ticketId = String(body?.ticketId || '').trim();
    const toPhone = normalizePhone(body?.toPhone);
    const toName = String(body?.toName || '').trim();
    if (!ticketId) return NextResponse.json({ ok: false, error: 'ticketId is required' }, { status: 400 });
    if (!/^\+?[0-9]{7,20}$/.test(toPhone)) {
      return NextResponse.json({ ok: false, error: 'Valid recipient phone is required' }, { status: 400 });
    }

    const client = await getPrimaryClient();
    const { data: ticket, error: ticketError } = await client
      .from('tickets')
      .select(
        `
        id,
        ticket_number,
        serial_number,
        ticket_status,
        trip_id,
        receipt_id,
        purchase_price,
        telegram_user_id,
        trips (name, departure_date),
        receipts (reference_number, payment_method, amount_paid, currency)
      `
      )
      .eq('id', ticketId)
      .eq('telegram_user_id', auth.user.id)
      .maybeSingle();

    if (ticketError || !ticket) {
      return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
    }

    const status = String((ticket as any).ticket_status || '').toLowerCase();
    if (status !== 'confirmed') {
      return NextResponse.json(
        { ok: false, error: 'Only confirmed tickets can be transferred' },
        { status: 400 }
      );
    }

    const trip = Array.isArray((ticket as any).trips) ? (ticket as any).trips[0] : (ticket as any).trips;
    const departureDate = String(trip?.departure_date || '');
    if (departureDate) {
      const departure = new Date(departureDate);
      if (!Number.isNaN(departure.getTime()) && Date.now() > departure.getTime()) {
        return NextResponse.json(
          { ok: false, error: 'Expired tickets cannot be transferred' },
          { status: 400 }
        );
      }
    }

    const recipient = await resolveOrCreateCustomerByPhone({
      supabase: client,
      phone: toPhone,
      fullName: toName || 'Transferred Ticket',
      languageCode: 'en',
    });

    if (String(recipient.userId) === String(auth.user.id)) {
      return NextResponse.json({ ok: false, error: 'Cannot transfer ticket to yourself' }, { status: 400 });
    }

    const sourceReceipt = Array.isArray((ticket as any).receipts) ? (ticket as any).receipts[0] : (ticket as any).receipts;
    const sourceReference = String(sourceReceipt?.reference_number || `TRF-${Date.now()}`).replace(/\s+/g, '');
    const newReference = `${sourceReference}-TRF${Date.now().toString().slice(-6)}`.slice(0, 80);

    const receiptHash = createHash('sha256')
      .update(`${ticketId}:${auth.user.id}:${recipient.userId}:${Date.now()}`)
      .digest('hex');

    const transferReceipt = await insertWithFallback(client.from('receipts'), {
      reference_number: newReference,
      telegram_user_id: recipient.userId,
      trip_id: String((ticket as any).trip_id || ''),
      payment_method: String(sourceReceipt?.payment_method || 'transfer'),
      amount_paid: Number((ticket as any).purchase_price || sourceReceipt?.amount_paid || 0),
      currency: String(sourceReceipt?.currency || 'ETB'),
      quantity: 1,
      receipt_file_url: null,
      receipt_file_name: `transfer_${ticketId}.txt`,
      receipt_hash: receiptHash,
      approval_status: 'approved',
      approval_notes: `Ticket transfer from user ${auth.user.id} to phone ${toPhone}`,
      approved_at: new Date().toISOString(),
    });
    if (!transferReceipt?.id) {
      return NextResponse.json({ ok: false, error: 'Failed to create transfer receipt' }, { status: 500 });
    }

    const newTicket = await insertWithFallback(client.from('tickets'), {
      ticket_number: buildTicketNumberUnique(transferReceipt.id, Date.now().toString().slice(-4)),
      serial_number: buildTransferSerial(String((ticket as any).serial_number || 'TRF')),
      receipt_id: transferReceipt.id,
      trip_id: String((ticket as any).trip_id || ''),
      telegram_user_id: recipient.userId,
      purchase_price: Number((ticket as any).purchase_price || 0),
      ticket_status: 'confirmed',
      issued_at: new Date().toISOString(),
    });
    if (!newTicket?.id) {
      return NextResponse.json({ ok: false, error: 'Failed to create transferred ticket' }, { status: 500 });
    }

    try {
      const qr = await generateTicketQRCode(String(newTicket.id), String(newTicket.serial_number || ''));
      await client.from('tickets').update({ qr_code: qr }).eq('id', newTicket.id);
    } catch (qrError) {
      console.error('[miniapp-ticket-transfer] QR generation failed:', qrError);
    }

    const updateVariants: Array<Record<string, unknown>> = [
      {
        ticket_status: 'transferred',
        transferred_at: new Date().toISOString(),
        transferred_to_phone: toPhone,
        transferred_to_user_id: recipient.userId,
      },
      {
        ticket_status: 'transferred',
        transferred_at: new Date().toISOString(),
      },
      {
        ticket_status: 'transferred',
      },
    ];

    let updated = false;
    for (const payload of updateVariants) {
      const result = await client.from('tickets').update(payload).eq('id', ticketId);
      if (!result.error) {
        updated = true;
        break;
      }
      const missing = detectMissingColumn(result.error);
      if (!missing) break;
    }
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'Failed to close source ticket' }, { status: 500 });
    }

    try {
      await client.from('ticket_transfers').insert({
        source_ticket_id: ticketId,
        target_ticket_id: newTicket.id,
        source_user_id: auth.user.id,
        target_user_id: recipient.userId,
        target_phone: toPhone,
        transfer_reference: newReference,
        transferred_by: auth.user.id,
        notes: toName || null,
      });
    } catch {}

    return NextResponse.json({
      ok: true,
      message: 'Ticket transferred successfully',
      newTicketId: String(newTicket.id),
      newReferenceNumber: newReference,
      recipientPhone: toPhone,
    });
  } catch (error) {
    console.error('[miniapp-ticket-transfer] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
