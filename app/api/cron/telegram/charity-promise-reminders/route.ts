import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';

const CRON_SECRET = String(process.env.TELEGRAM_CRON_SECRET || process.env.CRON_SECRET || '').trim();

function isAuthorized(request: NextRequest) {
  const manual = request.nextUrl.searchParams.get('manual') === 'true';
  const vercelCron = String(request.headers.get('x-vercel-cron') || '').trim() === '1';
  const providedSecret =
    String(request.headers.get('x-cron-secret') || '').trim() ||
    String(request.nextUrl.searchParams.get('secret') || '').trim();
  const adminHeader = String(request.headers.get('x-admin-id') || '').trim();

  if (vercelCron) return true;
  if (!CRON_SECRET) return manual ? Boolean(adminHeader) : true;
  if (providedSecret && providedSecret === CRON_SECRET) return true;
  if (manual && adminHeader) return true;
  return false;
}

function toIsoDateOnly(value: unknown) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(String(columnName || '').toLowerCase());
}

async function updatePromiseWithFallback(supabase: any, promiseId: string, payload: Record<string, unknown>) {
  const payloadCandidates = [
    { ...payload, updated_at: new Date().toISOString() },
    payload,
  ];
  for (const candidate of payloadCandidates) {
    const result = await supabase.from('charity_promises').update(candidate).eq('id', promiseId);
    if (!result.error) return true;
    if (isMissingColumn(result.error, 'updated_at')) continue;
    return false;
  }
  return false;
}

async function runJob() {
  const supabase = await createAdminClient();
  const { data: settings } = await supabase
    .from('app_settings')
    .select('charity_promise_reminder_enabled, charity_promise_reminder_days_before')
    .eq('id', 'default')
    .maybeSingle();

  const remindersEnabled = (settings as any)?.charity_promise_reminder_enabled !== false;
  const defaultReminderDays = Number((settings as any)?.charity_promise_reminder_days_before ?? 1);
  const reminderDaysBefore =
    Number.isFinite(defaultReminderDays) && defaultReminderDays >= 0 ? Math.floor(defaultReminderDays) : 1;

  if (!remindersEnabled) {
    return NextResponse.json({ ok: true, posted: 0, message: 'Promise reminders disabled' });
  }

  const { data: promises, error } = await supabase
    .from('charity_promises')
    .select('id, campaign_id, telegram_user_id, donor_name, promise_type, pledged_amount, item_description, due_at, reminder_days_before, last_reminder_at, status, charity_campaigns(name)')
    .in('status', ['pending', 'active'])
    .not('due_at', 'is', null)
    .order('due_at', { ascending: true })
    .limit(500);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const now = Date.now();
  const nowDate = new Date(now);
  const nowDateOnly = nowDate.toISOString().slice(0, 10);
  let posted = 0;
  let markedOverdue = 0;

  for (const row of promises || []) {
    const promiseId = String((row as any)?.id || '').trim();
    const chatId = Number((row as any)?.telegram_user_id || 0);
    const dueAt = new Date(String((row as any)?.due_at || ''));
    if (!promiseId || !chatId || Number.isNaN(dueAt.getTime())) continue;

    const dueMs = dueAt.getTime();
    if (dueMs < now) {
      const status = String((row as any)?.status || '').trim().toLowerCase();
      if (status !== 'overdue') {
        const updated = await updatePromiseWithFallback(supabase, promiseId, { status: 'overdue' });
        if (updated) markedOverdue += 1;
      }
      continue;
    }

    const reminderDaysRaw = Number((row as any)?.reminder_days_before);
    const perPromiseReminderDays =
      Number.isFinite(reminderDaysRaw) && reminderDaysRaw >= 0 ? Math.floor(reminderDaysRaw) : reminderDaysBefore;
    const reminderThresholdMs = now + perPromiseReminderDays * 24 * 60 * 60 * 1000;
    if (dueMs > reminderThresholdMs) continue;

    const lastReminderDate = toIsoDateOnly((row as any)?.last_reminder_at);
    if (lastReminderDate && lastReminderDate === nowDateOnly) continue;

    const campaignName =
      String((row as any)?.charity_campaigns?.name || (row as any)?.campaign_name || '').trim() || 'Charity Campaign';
    const promiseType =
      String((row as any)?.promise_type || '').trim().toLowerCase() === 'in_kind' ? 'in-kind' : 'cash';
    const amount = Number((row as any)?.pledged_amount || 0);
    const item = String((row as any)?.item_description || '').trim();

    const message = [
      'Charity promise reminder',
      `Campaign: ${campaignName}`,
      `Due date: ${dueAt.toLocaleString('en-US')}`,
      `Type: ${promiseType}`,
      promiseType === 'cash' && amount > 0 ? `Amount: ETB ${amount.toLocaleString('en-US')}` : '',
      promiseType === 'in-kind' && item ? `In-kind: ${item}` : '',
      'Please execute your promise before the due date.',
    ]
      .filter(Boolean)
      .join('\n');

    const sent = await sendTelegramMessage(chatId, message);
    if (!sent) continue;

    posted += 1;
    await updatePromiseWithFallback(supabase, promiseId, { last_reminder_at: new Date().toISOString() });
  }

  return NextResponse.json({
    ok: true,
    posted,
    markedOverdue,
    reminderDaysBefore,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runJob();
  } catch (error) {
    console.error('[cron-charity-promise-reminders] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runJob();
  } catch (error) {
    console.error('[cron-charity-promise-reminders] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
