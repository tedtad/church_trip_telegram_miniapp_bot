import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculatePenaltyApplications, computeGnplAccountSnapshot, normalizeGnplSettings } from '@/lib/gnpl';
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

function toDate(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function dateYmd(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysUntil(date: Date, from: Date) {
  const startA = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const startB = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return Math.floor((startB.getTime() - startA.getTime()) / (24 * 60 * 60 * 1000));
}

async function runJob() {
  const now = new Date();
  const today = dateYmd(now);
  const supabase = await createAdminClient();

  const { data: settingsRaw } = await supabase
    .from('app_settings')
    .select(
      'app_name, gnpl_enabled, gnpl_penalty_enabled, gnpl_penalty_percent, gnpl_penalty_period_days, gnpl_reminder_enabled, gnpl_reminder_days_before'
    )
    .eq('id', 'default')
    .maybeSingle();
  const settings = normalizeGnplSettings(settingsRaw || {});
  const appName = String((settingsRaw as any)?.app_name || 'TicketHub');

  if (!settings.enabled) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'GNPL disabled' });
  }

  const { data: accounts, error } = await supabase
    .from('gnpl_accounts')
    .select('id, telegram_user_id, status, due_date, next_penalty_at, penalty_percent, penalty_period_days, penalty_accrued, penalty_paid, principal_paid, approved_amount, base_amount, reminder_last_sent_on')
    .in('status', ['approved', 'overdue'])
    .order('created_at', { ascending: true })
    .limit(2000);
  if (error) {
    return NextResponse.json({ ok: false, error: 'GNPL table missing. Run migration 08.' }, { status: 500 });
  }

  let penaltiesApplied = 0;
  let remindersSent = 0;
  let processed = 0;

  for (const account of accounts || []) {
    processed += 1;
    let working = { ...(account as any) };
    const snapshotBefore = computeGnplAccountSnapshot(working, now);

    if (settings.penaltyEnabled && snapshotBefore.principalOutstanding > 0) {
      const nextPenaltyAt = toDate(working.next_penalty_at);
      const penaltyPercent = Math.max(0, Number(working.penalty_percent ?? settings.penaltyPercent));
      const penaltyPeriodDays = Math.max(1, Number(working.penalty_period_days ?? settings.penaltyPeriodDays));

      if (nextPenaltyAt && penaltyPercent > 0) {
        const application = calculatePenaltyApplications(nextPenaltyAt, now, penaltyPeriodDays);
        if (application.periods > 0) {
          const penaltyPerPeriod = Number(
            ((snapshotBefore.principalOutstanding * penaltyPercent) / 100).toFixed(2)
          );
          const addPenalty = Number((penaltyPerPeriod * application.periods).toFixed(2));
          const nextPenaltyAccrued = Number((Number(working.penalty_accrued || 0) + addPenalty).toFixed(2));
          const penaltyOutstanding = Math.max(0, nextPenaltyAccrued - Number(working.penalty_paid || 0));
          const outstandingAmount = Number((snapshotBefore.principalOutstanding + penaltyOutstanding).toFixed(2));

          const { error: updateError } = await supabase
            .from('gnpl_accounts')
            .update({
              status: 'overdue',
              penalty_accrued: nextPenaltyAccrued,
              outstanding_amount: outstandingAmount,
              next_penalty_at: application.nextPenaltyAt ? application.nextPenaltyAt.toISOString() : null,
            })
            .eq('id', working.id);

          if (!updateError) {
            penaltiesApplied += 1;
            working = {
              ...working,
              status: 'overdue',
              penalty_accrued: nextPenaltyAccrued,
              outstanding_amount: outstandingAmount,
              next_penalty_at: application.nextPenaltyAt ? application.nextPenaltyAt.toISOString() : null,
            };
          }
        }
      }
    }

    if (!settings.reminderEnabled) continue;
    const snapshot = computeGnplAccountSnapshot(working, now);
    if (snapshot.totalDue <= 0) continue;

    const dueDate = toDate(working.due_date);
    if (!dueDate) continue;

    const dueInDays = daysUntil(dueDate, now);
    const shouldRemind = dueInDays <= settings.reminderDaysBefore || dueInDays < 0;
    if (!shouldRemind) continue;

    if (String(working.reminder_last_sent_on || '') === today) continue;

    const message = [
      `${appName} GNPL payment reminder`,
      '',
      `Due date: ${dueDate.toISOString().slice(0, 10)}`,
      `Outstanding total: ETB ${snapshot.totalDue.toFixed(2)}`,
      `Principal due: ETB ${snapshot.principalOutstanding.toFixed(2)}`,
      `Penalty due: ETB ${snapshot.penaltyOutstanding.toFixed(2)}`,
      dueInDays < 0 ? `Overdue by ${Math.abs(dueInDays)} day(s).` : `${Math.max(0, dueInDays)} day(s) left.`,
      'Open Mini App and submit your GNPL repayment.',
    ].join('\n');

    const sent = await sendTelegramMessage(working.telegram_user_id, message, {
      disable_web_page_preview: true,
    });
    if (!sent) continue;

    remindersSent += 1;
    await supabase
      .from('gnpl_accounts')
      .update({ reminder_last_sent_on: today })
      .eq('id', working.id);
  }

  return NextResponse.json({
    ok: true,
    processed,
    penaltiesApplied,
    remindersSent,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runJob();
  } catch (error) {
    console.error('[cron-gnpl-reminders] GET error:', error);
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
    console.error('[cron-gnpl-reminders] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
