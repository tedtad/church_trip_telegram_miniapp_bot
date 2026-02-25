import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { postCharityCampaignAnnouncement } from '@/lib/charity-automation';
import { announceNewCampaignToPriorUsers } from '@/lib/telegram-announcements';
import { validateTelegramGroupNotReused } from '@/lib/telegram-group-policy';

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

export async function GET() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('charity_campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ campaigns: data || [] });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const body = await request.json();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const name = String(body?.name || '').trim();
  const cause = String(body?.cause || '').trim();
  const description = String(body?.description || '').trim();
  const goalAmount = Number(body?.goal_amount || 0);
  const startDate = String(body?.start_date || '').trim();
  const endDate = String(body?.end_date || '').trim();
  const status = String(body?.status || 'active').trim().toLowerCase();

  if (!name || !cause || !Number.isFinite(goalAmount) || goalAmount <= 0) {
    return NextResponse.json({ error: 'name, cause, and positive goal_amount are required' }, { status: 400 });
  }
  if (endDate && Number.isNaN(new Date(endDate).getTime())) {
    return NextResponse.json({ error: 'Invalid end_date' }, { status: 400 });
  }
  if (startDate && Number.isNaN(new Date(startDate).getTime())) {
    return NextResponse.json({ error: 'Invalid start_date' }, { status: 400 });
  }
  const { data: settings } = await supabase
    .from('app_settings')
    .select('charity_channel_chat_id, charity_channel_url, charity_group_chat_id, charity_group_url')
    .eq('id', 'default')
    .maybeSingle();

  const groupUrl = String(body?.telegram_group_url || '').trim();
  const groupChatId = String(body?.telegram_group_chat_id || '').trim();
  const channelUrl = String(body?.telegram_channel_url || (settings as any)?.charity_channel_url || '').trim();
  const channelChatId = String(body?.telegram_channel_chat_id || (settings as any)?.charity_channel_chat_id || '').trim();

  if (groupUrl && !/^https?:\/\//i.test(groupUrl)) {
    return NextResponse.json({ error: 'Charity group URL must start with http:// or https://' }, { status: 400 });
  }

  const groupConflict = await validateTelegramGroupNotReused(supabase, {
    groupUrl,
    groupChatId,
  });
  if (groupConflict) {
    return NextResponse.json({ error: groupConflict }, { status: 400 });
  }

  let insertPayload: Record<string, unknown> = {
    name,
    cause,
    description: description || null,
    goal_amount: Number(goalAmount.toFixed(2)),
    status,
    start_date: startDate ? new Date(startDate).toISOString() : new Date().toISOString(),
    end_date: endDate ? new Date(endDate).toISOString() : null,
    created_by: user.id,
    telegram_channel_chat_id: channelChatId || null,
    telegram_channel_url: channelUrl || null,
    telegram_group_chat_id: groupChatId || null,
    telegram_group_url: groupUrl || null,
  };
  let data: any = null;
  let error: any = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase
      .from('charity_campaigns')
      .insert([insertPayload])
      .select()
      .single();
    if (!result.error) {
      data = result.data;
      error = null;
      break;
    }

    error = result.error;
    const missingColumn = detectMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in insertPayload)) break;
    delete insertPayload[missingColumn];
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await postCharityCampaignAnnouncement(supabase, data);
  await announceNewCampaignToPriorUsers(supabase, data);
  return NextResponse.json({ campaign: data });
}
