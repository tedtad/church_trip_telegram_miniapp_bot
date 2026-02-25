import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function loadSettings(supabase: any) {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle();
  if (!error) return data || null;
  if ((error as any)?.code === 'PGRST116') return null;
  throw error;
}

function normalizeBody(body: any) {
  const payload: Record<string, unknown> = { ...body };
  payload.id = 'default';
  payload.updated_at = new Date().toISOString();

  if ('telegram_channel_url' in payload) {
    payload.telegram_channel_url = String(payload.telegram_channel_url || '').trim() || null;
  }
  if ('telegram_channel_chat_id' in payload) {
    payload.telegram_channel_chat_id = String(payload.telegram_channel_chat_id || '').trim() || null;
  }
  if ('telegram_channel_name' in payload) {
    payload.telegram_channel_name = String(payload.telegram_channel_name || '').trim() || null;
  }
  if ('telegram_post_new_trip' in payload) {
    payload.telegram_post_new_trip = Boolean(payload.telegram_post_new_trip);
  }
  if ('telegram_post_weekly_summary' in payload) {
    payload.telegram_post_weekly_summary = Boolean(payload.telegram_post_weekly_summary);
  }
  if ('telegram_post_daily_countdown' in payload) {
    payload.telegram_post_daily_countdown = Boolean(payload.telegram_post_daily_countdown);
  }
  if ('telegram_recommendation_interval_hours' in payload) {
    const numeric = Number(payload.telegram_recommendation_interval_hours);
    payload.telegram_recommendation_interval_hours = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 24;
  }
  if ('charity_channel_chat_id' in payload) {
    payload.charity_channel_chat_id = String(payload.charity_channel_chat_id || '').trim() || null;
  }
  if ('charity_channel_url' in payload) {
    payload.charity_channel_url = String(payload.charity_channel_url || '').trim() || null;
  }
  if ('charity_group_chat_id' in payload) {
    payload.charity_group_chat_id = String(payload.charity_group_chat_id || '').trim() || null;
  }
  if ('charity_group_url' in payload) {
    payload.charity_group_url = String(payload.charity_group_url || '').trim() || null;
  }
  if ('charity_auto_post_new_campaign' in payload) {
    payload.charity_auto_post_new_campaign = Boolean(payload.charity_auto_post_new_campaign);
  }
  if ('charity_auto_post_summary' in payload) {
    payload.charity_auto_post_summary = Boolean(payload.charity_auto_post_summary);
  }
  if ('gnpl_enabled' in payload) {
    payload.gnpl_enabled = Boolean(payload.gnpl_enabled);
  }
  if ('gnpl_require_admin_approval' in payload) {
    payload.gnpl_require_admin_approval = Boolean(payload.gnpl_require_admin_approval);
  }
  if ('gnpl_default_term_days' in payload) {
    const numeric = Number(payload.gnpl_default_term_days);
    payload.gnpl_default_term_days = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 14;
  }
  if ('gnpl_penalty_enabled' in payload) {
    payload.gnpl_penalty_enabled = Boolean(payload.gnpl_penalty_enabled);
  }
  if ('gnpl_penalty_percent' in payload) {
    const numeric = Number(payload.gnpl_penalty_percent);
    payload.gnpl_penalty_percent = Number.isFinite(numeric) && numeric >= 0 ? Number(numeric.toFixed(2)) : 0;
  }
  if ('gnpl_penalty_period_days' in payload) {
    const numeric = Number(payload.gnpl_penalty_period_days);
    payload.gnpl_penalty_period_days = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 7;
  }
  if ('gnpl_reminder_enabled' in payload) {
    payload.gnpl_reminder_enabled = Boolean(payload.gnpl_reminder_enabled);
  }
  if ('gnpl_reminder_days_before' in payload) {
    const numeric = Number(payload.gnpl_reminder_days_before);
    payload.gnpl_reminder_days_before = Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : 0;
  }
  if ('receipt_intelligence_enabled' in payload) {
    payload.receipt_intelligence_enabled = Boolean(payload.receipt_intelligence_enabled);
  }
  if ('receipt_sample_collection_enabled' in payload) {
    payload.receipt_sample_collection_enabled = Boolean(payload.receipt_sample_collection_enabled);
  }

  return payload;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const settings = await loadSettings(supabase);

    return NextResponse.json({ ok: true, settings }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const supabase = await createClient();

    let payload = normalizeBody(body);
    let data: any = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = await supabase.from('app_settings').upsert(payload, { onConflict: 'id' }).select().single();
      if (!result.error) {
        data = result.data;
        break;
      }

      const missingColumn = detectMissingColumn(result.error);
      if (!missingColumn || !(missingColumn in payload)) {
        throw result.error;
      }
      delete payload[missingColumn];
    }

    if (!data) {
      throw new Error('Failed to update settings');
    }

    return NextResponse.json({ ok: true, success: true, settings: data }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, success: false, error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
