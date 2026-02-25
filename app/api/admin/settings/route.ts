import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

const DEFAULT_SETTINGS = {
  id: 'default',
  app_name: 'TicketHub',
  app_description: 'Telegram Ticket Reservation System',
  app_color: '#06b6d4',
  logo_url: null as string | null,
  logo_filename: null as string | null,
  receipt_cache_ttl: 3600,
  max_file_size: 10,
  supported_file_types: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf', 'image/webp'],
  smtp_enabled: false,
  sms_enabled: false,
  telegram_notifications_enabled: true,
  two_factor_enabled: false,
  maintenance_mode: false,
  maintenance_message: null as string | null,
  telegram_channel_chat_id: null as string | null,
  telegram_channel_url: null as string | null,
  telegram_channel_name: null as string | null,
  telegram_post_new_trip: true,
  telegram_post_weekly_summary: true,
  telegram_post_daily_countdown: true,
  telegram_recommendation_interval_hours: 24,
  charity_channel_chat_id: null as string | null,
  charity_channel_url: null as string | null,
  charity_group_chat_id: null as string | null,
  charity_group_url: null as string | null,
  charity_auto_post_new_campaign: true,
  charity_auto_post_summary: true,
  gnpl_enabled: false,
  gnpl_require_admin_approval: true,
  gnpl_default_term_days: 14,
  gnpl_penalty_enabled: true,
  gnpl_penalty_percent: 5,
  gnpl_penalty_period_days: 7,
  gnpl_reminder_enabled: true,
  gnpl_reminder_days_before: 0,
  receipt_intelligence_enabled: false,
  receipt_sample_collection_enabled: false,
};

const UPDATABLE_FIELDS = new Set([
  'app_name',
  'app_description',
  'app_color',
  'logo_url',
  'logo_filename',
  'receipt_cache_ttl',
  'max_file_size',
  'supported_file_types',
  'smtp_enabled',
  'sms_enabled',
  'telegram_notifications_enabled',
  'two_factor_enabled',
  'maintenance_mode',
  'maintenance_message',
  'telegram_channel_chat_id',
  'telegram_channel_url',
  'telegram_channel_name',
  'telegram_post_new_trip',
  'telegram_post_weekly_summary',
  'telegram_post_daily_countdown',
  'telegram_recommendation_interval_hours',
  'charity_channel_chat_id',
  'charity_channel_url',
  'charity_group_chat_id',
  'charity_group_url',
  'charity_auto_post_new_campaign',
  'charity_auto_post_summary',
  'gnpl_enabled',
  'gnpl_require_admin_approval',
  'gnpl_default_term_days',
  'gnpl_penalty_enabled',
  'gnpl_penalty_percent',
  'gnpl_penalty_period_days',
  'gnpl_reminder_enabled',
  'gnpl_reminder_days_before',
  'receipt_intelligence_enabled',
  'receipt_sample_collection_enabled',
]);

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

function isMissingAppSettingsRelation(error: unknown) {
  const code = String((error as any)?.code || '').toUpperCase();
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '42P01' || message.includes('relation') && message.includes('app_settings') && message.includes('does not exist');
}

async function loadSettings(supabase: any) {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle();
  if (!error) return data || null;
  if ((error as any)?.code === 'PGRST116') return null;
  if (isMissingAppSettingsRelation(error)) {
    throw new Error(
      'app_settings table is missing. Run DB migrations: scripts/06-automation-discount-and-booking-enhancements.sql, scripts/08-gnpl-credit-module.sql, scripts/10-receipt-intelligence-settings.sql'
    );
  }
  throw error;
}

function normalizeBody(body: any) {
  const payload: Record<string, unknown> = {};
  for (const key of Object.keys(body || {})) {
    if (!UPDATABLE_FIELDS.has(key)) continue;
    payload[key] = body[key];
  }

  payload.id = 'default';
  payload.updated_at = new Date().toISOString();

  if ('app_name' in payload) {
    payload.app_name = String(payload.app_name || '').trim() || DEFAULT_SETTINGS.app_name;
  }
  if ('app_description' in payload) {
    payload.app_description = String(payload.app_description || '').trim() || DEFAULT_SETTINGS.app_description;
  }
  if ('app_color' in payload) {
    const color = String(payload.app_color || '').trim();
    payload.app_color = /^#[0-9a-f]{6}$/i.test(color) ? color : DEFAULT_SETTINGS.app_color;
  }
  if ('logo_url' in payload) {
    payload.logo_url = String(payload.logo_url || '').trim() || null;
  }
  if ('logo_filename' in payload) {
    payload.logo_filename = String(payload.logo_filename || '').trim() || null;
  }
  if ('receipt_cache_ttl' in payload) {
    const numeric = Number(payload.receipt_cache_ttl);
    payload.receipt_cache_ttl = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : DEFAULT_SETTINGS.receipt_cache_ttl;
  }
  if ('max_file_size' in payload) {
    const numeric = Number(payload.max_file_size);
    payload.max_file_size = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : DEFAULT_SETTINGS.max_file_size;
  }
  if ('supported_file_types' in payload) {
    const list = Array.isArray(payload.supported_file_types)
      ? payload.supported_file_types.map((v) => String(v || '').trim()).filter(Boolean)
      : [];
    payload.supported_file_types = list.length ? list : DEFAULT_SETTINGS.supported_file_types;
  }
  if ('smtp_enabled' in payload) {
    payload.smtp_enabled = Boolean(payload.smtp_enabled);
  }
  if ('sms_enabled' in payload) {
    payload.sms_enabled = Boolean(payload.sms_enabled);
  }
  if ('telegram_notifications_enabled' in payload) {
    payload.telegram_notifications_enabled = Boolean(payload.telegram_notifications_enabled);
  }
  if ('two_factor_enabled' in payload) {
    payload.two_factor_enabled = Boolean(payload.two_factor_enabled);
  }
  if ('maintenance_mode' in payload) {
    payload.maintenance_mode = Boolean(payload.maintenance_mode);
  }
  if ('maintenance_message' in payload) {
    payload.maintenance_message = String(payload.maintenance_message || '').trim() || null;
  }

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

function normalizeSettingsRow(row: any) {
  const merged = { ...DEFAULT_SETTINGS, ...(row || {}) } as Record<string, unknown>;
  return {
    ...merged,
    id: 'default',
    app_name: String(merged.app_name || DEFAULT_SETTINGS.app_name),
    app_description: String(merged.app_description || DEFAULT_SETTINGS.app_description),
    app_color: /^#[0-9a-f]{6}$/i.test(String(merged.app_color || ''))
      ? String(merged.app_color)
      : DEFAULT_SETTINGS.app_color,
    logo_url: String(merged.logo_url || '').trim() || null,
    logo_filename: String(merged.logo_filename || '').trim() || null,
    receipt_cache_ttl: Math.max(1, Math.floor(Number(merged.receipt_cache_ttl || DEFAULT_SETTINGS.receipt_cache_ttl))),
    max_file_size: Math.max(1, Math.floor(Number(merged.max_file_size || DEFAULT_SETTINGS.max_file_size))),
    supported_file_types: Array.isArray(merged.supported_file_types) && merged.supported_file_types.length
      ? merged.supported_file_types
      : DEFAULT_SETTINGS.supported_file_types,
    smtp_enabled: Boolean(merged.smtp_enabled),
    sms_enabled: Boolean(merged.sms_enabled),
    telegram_notifications_enabled: merged.telegram_notifications_enabled !== false,
    two_factor_enabled: Boolean(merged.two_factor_enabled),
    maintenance_mode: Boolean(merged.maintenance_mode),
    maintenance_message: String(merged.maintenance_message || '').trim() || null,
    telegram_channel_chat_id: String(merged.telegram_channel_chat_id || '').trim() || null,
    telegram_channel_url: String(merged.telegram_channel_url || '').trim() || null,
    telegram_channel_name: String(merged.telegram_channel_name || '').trim() || null,
    telegram_post_new_trip: merged.telegram_post_new_trip !== false,
    telegram_post_weekly_summary: merged.telegram_post_weekly_summary !== false,
    telegram_post_daily_countdown: merged.telegram_post_daily_countdown !== false,
    telegram_recommendation_interval_hours: Math.max(
      1,
      Math.floor(Number(merged.telegram_recommendation_interval_hours || DEFAULT_SETTINGS.telegram_recommendation_interval_hours))
    ),
    charity_channel_chat_id: String(merged.charity_channel_chat_id || '').trim() || null,
    charity_channel_url: String(merged.charity_channel_url || '').trim() || null,
    charity_group_chat_id: String(merged.charity_group_chat_id || '').trim() || null,
    charity_group_url: String(merged.charity_group_url || '').trim() || null,
    charity_auto_post_new_campaign: merged.charity_auto_post_new_campaign !== false,
    charity_auto_post_summary: merged.charity_auto_post_summary !== false,
    gnpl_enabled: Boolean(merged.gnpl_enabled),
    gnpl_require_admin_approval: merged.gnpl_require_admin_approval !== false,
    gnpl_default_term_days: Math.max(1, Math.floor(Number(merged.gnpl_default_term_days || DEFAULT_SETTINGS.gnpl_default_term_days))),
    gnpl_penalty_enabled: merged.gnpl_penalty_enabled !== false,
    gnpl_penalty_percent: Math.max(0, Number(Number(merged.gnpl_penalty_percent || DEFAULT_SETTINGS.gnpl_penalty_percent).toFixed(2))),
    gnpl_penalty_period_days: Math.max(1, Math.floor(Number(merged.gnpl_penalty_period_days || DEFAULT_SETTINGS.gnpl_penalty_period_days))),
    gnpl_reminder_enabled: merged.gnpl_reminder_enabled !== false,
    gnpl_reminder_days_before: Math.max(0, Math.floor(Number(merged.gnpl_reminder_days_before || DEFAULT_SETTINGS.gnpl_reminder_days_before))),
    receipt_intelligence_enabled: Boolean(merged.receipt_intelligence_enabled),
    receipt_sample_collection_enabled: Boolean(merged.receipt_sample_collection_enabled),
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'settings_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    const settings = normalizeSettingsRow(await loadSettings(supabase));

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
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'settings_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, success: false, error: auth.error }, { status: auth.status });
    }

    const payload = normalizeBody(body);
    const result = await supabase.from('app_settings').upsert(payload, { onConflict: 'id' }).select().single();
    if (result.error) {
      if (isMissingAppSettingsRelation(result.error)) {
        throw new Error(
          'app_settings table is missing. Run DB migrations: scripts/06-automation-discount-and-booking-enhancements.sql, scripts/08-gnpl-credit-module.sql, scripts/10-receipt-intelligence-settings.sql'
        );
      }
      const missingColumn = detectMissingColumn(result.error);
      if (missingColumn) {
        throw new Error(
          `Missing app_settings column "${missingColumn}". Run DB migrations: scripts/06-automation-discount-and-booking-enhancements.sql, scripts/08-gnpl-credit-module.sql, scripts/10-receipt-intelligence-settings.sql`
        );
      }
      throw result.error;
    }

    return NextResponse.json(
      { ok: true, success: true, settings: normalizeSettingsRow(result.data) },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, success: false, error: error instanceof Error ? error.message : 'Failed to update settings' },
      { status: 500 }
    );
  }
}
