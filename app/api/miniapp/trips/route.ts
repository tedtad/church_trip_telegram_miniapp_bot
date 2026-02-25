import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
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

function resolveInitData(request: NextRequest) {
  return String(
    request.headers.get('x-telegram-init-data') || request.nextUrl.searchParams.get('initData') || ''
  ).trim();
}

function isBookableStatus(status: string | null | undefined): boolean {
  const normalized = String(status || 'active').trim().toLowerCase();
  if (!normalized || normalized === 'active') return true;
  return !['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(normalized);
}

async function queryTripsWithFallback(client: any) {
  const selectCandidates = [
    'id, name, description, destination, departure_date, arrival_date, price_per_ticket, available_seats, total_seats, status, trip_status, image_url, trip_image_url, cover_image_url, bank_accounts, telebirr_manual_account_name, telebirr_manual_account_number, manual_payment_note, allow_gnpl, telegram_group_url, telegram_group_chat_id',
    'id, name, description, destination, departure_date, arrival_date, price_per_ticket, available_seats, total_seats, status, trip_status',
    '*',
  ];

  let lastError: any = null;

  for (const selectClause of selectCandidates) {
    const { data, error } = await client
      .from('trips')
      .select(selectClause)
      .order('departure_date', { ascending: true });

    if (!error) {
      return { data: data || [], error: null };
    }

    lastError = error;
  }

  return { data: [], error: lastError };
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
    const { data, error } = await queryTripsWithFallback(client);

    if (error) {
      console.error('[miniapp-trips] Query error:', error);
      return NextResponse.json({ ok: false, error: 'Failed to load trips' }, { status: 500 });
    }

    const trips = (data || []).filter((row: any) => isBookableStatus(row.status ?? row.trip_status));
    return NextResponse.json({ ok: true, trips });
  } catch (error) {
    console.error('[miniapp-trips] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
