import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
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

function resolveInitData(request: NextRequest) {
  return String(
    request.headers.get('x-telegram-init-data') || request.nextUrl.searchParams.get('initData') || ''
  ).trim();
}

export async function GET(request: NextRequest) {
  try {
    const appBaseUrl = resolveAppBaseUrl(APP_URL, request.nextUrl.origin);
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

    const { data, error } = await client
      .from('tickets')
      .select(
        `
        id,
        ticket_number,
        serial_number,
        ticket_status,
        created_at,
        trips (id, name, destination, departure_date),
        receipts (reference_number, approval_status)
      `
      )
      .eq('telegram_user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      return NextResponse.json({ ok: false, error: 'Failed to load bookings' }, { status: 500 });
    }

    const bookings = (data || []).map((ticket: any) => {
      const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
      const receipt = Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts;
      const normalizedStatus = String(ticket.ticket_status || '').toLowerCase();
      const hasDigitalCard = ['confirmed', 'used'].includes(normalizedStatus);

      return {
        id: ticket.id,
        tripId: trip?.id || null,
        serialNumber: ticket.serial_number,
        ticketNumber: ticket.ticket_number,
        status: ticket.ticket_status,
        tripName: trip?.name || 'Trip',
        destination: trip?.destination || 'N/A',
        departureDate: trip?.departure_date || null,
        referenceNumber: receipt?.reference_number || null,
        approvalStatus: receipt?.approval_status || null,
        cardUrl:
          appBaseUrl && hasDigitalCard
            ? `${appBaseUrl}/api/tickets/${ticket.id}/card?serial=${encodeURIComponent(ticket.serial_number || '')}`
            : null,
      };
    });

    return NextResponse.json({ ok: true, bookings });
  } catch (error) {
    console.error('[miniapp-bookings] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
