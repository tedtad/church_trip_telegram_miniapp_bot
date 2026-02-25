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

function normalizePhoneNumber(raw: unknown) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const compact = value.replace(/[\s()-]/g, '');
  if (!/^\+?[0-9]{7,20}$/.test(compact)) return '';
  return compact;
}

function normalizeName(raw: unknown) {
  return String(raw || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function splitName(fullName: string) {
  const normalized = normalizeName(fullName);
  if (!normalized) return { firstName: '', lastName: null as string | null };
  const parts = normalized.split(' ');
  const firstName = parts.shift() || '';
  const lastName = parts.length ? parts.join(' ') : null;
  return { firstName, lastName };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Invalid Telegram Mini App session' }, { status: 401 });
    }

    const phoneNumber = normalizePhoneNumber(body?.phoneNumber);
    const customerName = normalizeName(body?.customerName);
    if (!phoneNumber) {
      return NextResponse.json(
        { ok: false, error: 'Valid phone number is required (digits, optional +).' },
        { status: 400 }
      );
    }

    const client = await getPrimaryClient();
    const appSettings = await getMiniAppRuntimeSettings(client);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, error: 'MINIAPP_MAINTENANCE', message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }

    const { firstName, lastName } = splitName(customerName);
    const now = new Date().toISOString();
    const payloads = [
      {
        id: auth.user.id,
        phone_number: phoneNumber,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName !== null ? { last_name: lastName } : {}),
        last_activity: now,
        last_interaction: now,
      },
      {
        id: auth.user.id,
        phone_number: phoneNumber,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName !== null ? { last_name: lastName } : {}),
        last_activity: now,
      },
      {
        id: auth.user.id,
        phone_number: phoneNumber,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName !== null ? { last_name: lastName } : {}),
      },
    ];

    for (const payload of payloads) {
      const result = await client.from('telegram_users').upsert(payload, { onConflict: 'id' });
      if (!result.error) {
        return NextResponse.json({ ok: true, phoneNumber, customerName });
      }
    }

    return NextResponse.json({ ok: false, error: 'Failed to save phone number' }, { status: 500 });
  } catch (error) {
    console.error('[miniapp-profile-phone] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
