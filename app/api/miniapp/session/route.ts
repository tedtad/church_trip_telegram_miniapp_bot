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

function resolveInitData(request: NextRequest, body?: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
    body?.initData ||
    request.nextUrl.searchParams.get('initData') ||
    ''
  ).trim();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);

    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Invalid Telegram Mini App session' }, { status: 401 });
    }

    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        {
          ok: false,
          error: 'MINIAPP_MAINTENANCE',
          message: getMiniAppMaintenanceMessage(appSettings),
          appSettings: {
            appName: appSettings.appName,
            logoUrl: appSettings.logoUrl,
            logoFilename: appSettings.logoFilename,
            maintenanceMode: true,
            maintenanceMessage: getMiniAppMaintenanceMessage(appSettings),
            charityEnabled: appSettings.charityEnabled,
            discountEnabled: appSettings.discountEnabled,
          },
        },
        { status: 503 }
      );
    }

    const now = new Date().toISOString();
    const { data: existingUser } = await client
      .from('telegram_users')
      .select('language_code, phone_number')
      .eq('id', auth.user.id)
      .maybeSingle();
    const existingLang = String(existingUser?.language_code || '').trim().toLowerCase();
    const lang =
      existingLang === 'am' || existingLang === 'en'
        ? (existingLang as 'am' | 'en')
        : auth.user.language_code === 'en'
          ? 'en'
          : 'am';
    const upsertCandidates = [
      {
        id: auth.user.id,
        first_name: auth.user.first_name || 'Telegram User',
        last_name: auth.user.last_name || null,
        username: auth.user.username || null,
        language_code: lang,
        status: 'active',
        last_activity: now,
        last_interaction: now,
      },
      {
        id: auth.user.id,
        first_name: auth.user.first_name || 'Telegram User',
        last_name: auth.user.last_name || null,
        username: auth.user.username || null,
        language_code: lang,
        last_activity: now,
      },
      {
        id: auth.user.id,
        first_name: auth.user.first_name || 'Telegram User',
        last_name: auth.user.last_name || null,
        username: auth.user.username || null,
        language_code: lang,
      },
    ];

    for (const payload of upsertCandidates) {
      const result = await client.from('telegram_users').upsert(payload, { onConflict: 'id' });
      if (!result.error) break;
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: auth.user.id,
        firstName: auth.user.first_name || 'Telegram User',
        lastName: auth.user.last_name || '',
        username: auth.user.username || '',
        phoneNumber: String(existingUser?.phone_number || '').trim(),
        languageCode: lang,
      },
      appSettings: {
        appName: appSettings.appName,
        logoUrl: appSettings.logoUrl,
        logoFilename: appSettings.logoFilename,
        telegramChannelUrl: appSettings.telegramChannelUrl,
        telegramChannelName: appSettings.telegramChannelName,
        gnplEnabled: appSettings.gnplEnabled,
        gnplRequireAdminApproval: appSettings.gnplRequireAdminApproval,
        gnplDefaultTermDays: appSettings.gnplDefaultTermDays,
        gnplPenaltyEnabled: appSettings.gnplPenaltyEnabled,
        gnplPenaltyPercent: appSettings.gnplPenaltyPercent,
        gnplPenaltyPeriodDays: appSettings.gnplPenaltyPeriodDays,
        maintenanceMode: appSettings.maintenanceMode,
        maintenanceMessage: appSettings.maintenanceMessage,
        charityEnabled: appSettings.charityEnabled,
        discountEnabled: appSettings.discountEnabled,
      },
    });
  } catch (error) {
    console.error('[miniapp-session] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
