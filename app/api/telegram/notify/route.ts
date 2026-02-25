import { NextRequest, NextResponse } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const { telegramUserId, type, referenceNumber, reason, title, message } = await request.json();

    if (!telegramUserId) {
      return NextResponse.json({ error: 'Missing user ID' }, { status: 400 });
    }

    let notificationMessage = '';

    switch (type) {
      case 'ticket_approved':
        notificationMessage = `✅ Your ticket has been approved!\n\nReference: ${referenceNumber}\n\nYou can now view your digital ticket in the app.`;
        break;

      case 'ticket_rejected':
        notificationMessage = `❌ Your ticket was rejected.\n\nReference: ${referenceNumber}\nReason: ${reason || 'No reason provided'}\n\nPlease contact support for assistance.`;
        break;

      case 'new_trip':
        notificationMessage = `🎫 A new trip is available!\n\nCheck the app to see details and book now.`;
        break;

      case 'announcement':
        notificationMessage = `📢 ${title}\n\n${message}`;
        break;

      default:
        notificationMessage = message || 'You have a new notification';
    }

    // Send Telegram message
    const result = await sendTelegramMessage(telegramUserId, notificationMessage);

    if (!result) {
      return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
    }

    // Store notification in database
    try {
      const supabase = await createClient();
      await supabase.from('notifications').insert({
        telegram_user_id: telegramUserId,
        notification_type: type,
        title: title || type,
        message: notificationMessage,
      });
    } catch (dbError) {
      console.error('[notify] DB error:', dbError);
      // Don't fail if database insert fails - message was still sent
    }

    return NextResponse.json({ ok: true, sent: true });
  } catch (error) {
    console.error('[notify] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
