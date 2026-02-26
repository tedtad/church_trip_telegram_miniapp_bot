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

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      body?.initData ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  const code = String((error as any)?.code || '').toUpperCase();
  if (code === '42P01') return true;
  return message.includes('does not exist') && message.includes(relationName.toLowerCase());
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
    const rating = Number(body?.rating || 0);
    const commentRaw = String(body?.comment || '').trim();
    const comment = commentRaw ? commentRaw.slice(0, 500) : null;

    if (!ticketId) {
      return NextResponse.json({ ok: false, error: 'ticketId is required' }, { status: 400 });
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ ok: false, error: 'rating must be an integer between 1 and 5' }, { status: 400 });
    }

    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }

    const { data: ticket, error: ticketError } = await client
      .from('tickets')
      .select('id, trip_id, ticket_status, telegram_user_id')
      .eq('id', ticketId)
      .maybeSingle();
    if (ticketError) {
      return NextResponse.json({ ok: false, error: 'Failed to validate ticket' }, { status: 500 });
    }
    if (!ticket || Number(ticket.telegram_user_id || 0) !== Number(auth.user.id)) {
      return NextResponse.json({ ok: false, error: 'Ticket not found for this user' }, { status: 404 });
    }

    const normalizedStatus = String(ticket.ticket_status || '').toLowerCase();
    if (normalizedStatus !== 'used') {
      return NextResponse.json({ ok: false, error: 'Rating is allowed only after check-in is completed' }, { status: 400 });
    }

    const payload = {
      ticket_id: ticket.id,
      trip_id: ticket.trip_id,
      telegram_user_id: auth.user.id,
      rating,
      comment,
      updated_at: new Date().toISOString(),
    };

    const { data: savedRating, error: saveError } = await client
      .from('trip_ratings')
      .upsert(payload, { onConflict: 'ticket_id' })
      .select('id, ticket_id, trip_id, rating, comment, created_at, updated_at')
      .single();
    if (saveError) {
      if (isMissingRelation(saveError, 'trip_ratings')) {
        return NextResponse.json(
          { ok: false, error: 'Trip rating schema is missing. Run scripts/19-trip-ratings.sql' },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: false, error: 'Failed to save rating' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, rating: savedRating });
  } catch (error) {
    console.error('[miniapp-trip-rating] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
