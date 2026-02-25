import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTelegramMessage } from '@/lib/telegram';

type SendMode = 'single' | 'broadcast';

function buildMessage(title: string | undefined, message: string) {
  const trimmedTitle = title?.trim();
  const trimmedMessage = message.trim();
  return trimmedTitle ? `[Announcement] ${trimmedTitle}\n\n${trimmedMessage}` : trimmedMessage;
}

async function storeNotification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  telegramUserId: string,
  message: string,
  title?: string
) {
  try {
    await supabase.from('notifications').insert({
      telegram_user_id: telegramUserId,
      notification_type: 'announcement',
      title: title || 'announcement',
      message,
    });
  } catch (error) {
    console.error('[bot-send] Failed to store notification:', error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { mode, telegramUserId, title, message } = await request.json();
    const sendMode = mode as SendMode;

    if (sendMode !== 'single' && sendMode !== 'broadcast') {
      return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const finalMessage = buildMessage(title, message);
    const supabase = await createClient();

    if (sendMode === 'single') {
      const id = String(telegramUserId || '').trim();
      if (!id) {
        return NextResponse.json({ error: 'telegramUserId is required for single mode' }, { status: 400 });
      }

      const result = await sendTelegramMessage(id, finalMessage);
      if (!result) {
        return NextResponse.json({ error: 'Failed to send Telegram message' }, { status: 500 });
      }

      await storeNotification(supabase, id, finalMessage, title);
      return NextResponse.json({ ok: true, sent: 1, failed: 0, mode: sendMode });
    }

    const { data: users, error } = await supabase
      .from('telegram_users')
      .select('id')
      .eq('status', 'active');

    if (error) {
      return NextResponse.json({ error: 'Failed to load active users' }, { status: 500 });
    }

    if (!users || users.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, failed: 0, mode: sendMode });
    }

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      const userId = String(user.id);
      const result = await sendTelegramMessage(userId, finalMessage);
      if (result) {
        sent += 1;
        await storeNotification(supabase, userId, finalMessage, title);
      } else {
        failed += 1;
      }
    }

    return NextResponse.json({ ok: true, sent, failed, mode: sendMode });
  } catch (error) {
    console.error('[bot-send] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
