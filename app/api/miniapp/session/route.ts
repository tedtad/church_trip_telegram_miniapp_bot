import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';

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
    const now = new Date().toISOString();
    const { data: existingUser } = await client
      .from('telegram_users')
      .select('language_code, phone_number')
      .eq('id', auth.user.id)
      .maybeSingle();

    let appSettings: {
      telegramChannelUrl: string;
      telegramChannelName: string;
      gnplEnabled: boolean;
      gnplRequireAdminApproval: boolean;
      gnplDefaultTermDays: number;
      gnplPenaltyEnabled: boolean;
      gnplPenaltyPercent: number;
      gnplPenaltyPeriodDays: number;
    } | null = null;
    {
      const settingsResult = await client
        .from('app_settings')
        .select(
          'telegram_channel_url, telegram_channel_name, gnpl_enabled, gnpl_require_admin_approval, gnpl_default_term_days, gnpl_penalty_enabled, gnpl_penalty_percent, gnpl_penalty_period_days'
        )
        .eq('id', 'default')
        .maybeSingle();
      if (!settingsResult.error && settingsResult.data) {
        appSettings = {
          telegramChannelUrl: String((settingsResult.data as any).telegram_channel_url || '').trim(),
          telegramChannelName: String((settingsResult.data as any).telegram_channel_name || '').trim(),
          gnplEnabled: Boolean((settingsResult.data as any).gnpl_enabled),
          gnplRequireAdminApproval: (settingsResult.data as any).gnpl_require_admin_approval !== false,
          gnplDefaultTermDays: Math.max(1, Number((settingsResult.data as any).gnpl_default_term_days || 14)),
          gnplPenaltyEnabled: (settingsResult.data as any).gnpl_penalty_enabled !== false,
          gnplPenaltyPercent: Math.max(0, Number((settingsResult.data as any).gnpl_penalty_percent || 0)),
          gnplPenaltyPeriodDays: Math.max(1, Number((settingsResult.data as any).gnpl_penalty_period_days || 7)),
        };
      }
    }
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
      appSettings,
    });
  } catch (error) {
    console.error('[miniapp-session] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
