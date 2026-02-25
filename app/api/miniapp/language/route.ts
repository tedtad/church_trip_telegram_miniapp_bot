import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);

type Lang = 'am' | 'en';

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

function resolveLang(raw: unknown): Lang {
  return String(raw || '').trim().toLowerCase() === 'en' ? 'en' : 'am';
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Invalid Telegram Mini App session' }, { status: 401 });
    }

    const languageCode = resolveLang(body?.languageCode);
    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }

    const now = new Date().toISOString();

    const payloads = [
      { id: auth.user.id, language_code: languageCode, last_activity: now, last_interaction: now },
      { id: auth.user.id, language_code: languageCode, last_activity: now },
      { id: auth.user.id, language_code: languageCode },
    ];

    let upserted = false;
    for (const payload of payloads) {
      const result = await client.from('telegram_users').upsert(payload, { onConflict: 'id' });
      if (!result.error) {
        upserted = true;
        break;
      }
    }

    if (!upserted) {
      return NextResponse.json({ ok: false, error: 'Failed to update language' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, languageCode });
  } catch (error) {
    console.error('[miniapp-language] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
