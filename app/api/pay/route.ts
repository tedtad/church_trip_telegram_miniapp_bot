import { NextRequest, NextResponse } from 'next/server';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);
const TELEBIRR_AUTO_COMING_SOON_MESSAGE =
  'Telebirr Auto is coming soon. Please use Telebirr Manual or Bank Transfer for now.';

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
    body?.initData ||
    request.nextUrl.searchParams.get('initData') ||
    ''
  ).trim();
}

function resolveTelegramId(body: any) {
  const value = Number(body?.telegramId || body?.telegramUserId || 0);
  return Number.isFinite(value) ? value : 0;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);

    if (!auth) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const telegramId = resolveTelegramId(body);
    if (telegramId && telegramId !== auth.user.id) {
      return NextResponse.json({ ok: false, error: 'Telegram user mismatch' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      mode: 'telebirr_auto_disabled',
      message: TELEBIRR_AUTO_COMING_SOON_MESSAGE,
    });
  } catch (error) {
    console.error('[pay] Error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
