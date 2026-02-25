import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getTelebirrConfigStatus } from '@/lib/telebirr';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

type StatusResponse = {
  ok: boolean;
  botTokenConfigured: boolean;
  botApiReachable: boolean;
  botUsername: string | null;
  telegramUsers: number;
  activeUsers: number;
  activeTrips: number;
  pendingApprovals: number;
  telebirrConfigured: boolean;
  telebirrMode: 'live' | 'demo';
  telebirrMissing: string[];
};

export async function GET() {
  try {
    const supabase = await createClient();

    const [{ count: telegramUsers }, { count: activeUsers }, { data: tripsData }, { count: pendingApprovals }] =
      await Promise.all([
        supabase.from('telegram_users').select('*', { count: 'exact', head: true }),
        supabase.from('telegram_users').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('trips').select('status, trip_status'),
        supabase.from('receipts').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending'),
      ]);

    const activeTrips =
      (tripsData || []).filter((trip: any) => {
        const normalized = String(trip.status ?? trip.trip_status ?? 'active').toLowerCase();
        return normalized === 'active';
      }).length || 0;

    let botApiReachable = false;
    let botUsername: string | null = null;

    if (BOT_TOKEN) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`, {
          cache: 'no-store',
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.ok) {
            botApiReachable = true;
            botUsername = data?.result?.username || null;
          }
        }
      } catch (error) {
        console.error('[bot-status] Telegram API check failed:', error);
      }
    }

    const telebirr = getTelebirrConfigStatus();

    const payload: StatusResponse = {
      ok: true,
      botTokenConfigured: Boolean(BOT_TOKEN),
      botApiReachable,
      botUsername,
      telegramUsers: telegramUsers || 0,
      activeUsers: activeUsers || 0,
      activeTrips,
      pendingApprovals: pendingApprovals || 0,
      telebirrConfigured: telebirr.configured,
      telebirrMode: telebirr.mode,
      telebirrMissing: telebirr.missing,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[bot-status] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load bot status' }, { status: 500 });
  }
}
