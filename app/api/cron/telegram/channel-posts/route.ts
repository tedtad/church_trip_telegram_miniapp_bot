import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendTelegramMessage } from '@/lib/telegram';

const CRON_SECRET = String(process.env.TELEGRAM_CRON_SECRET || process.env.CRON_SECRET || '').trim();
const APP_URL = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();

type AppSettingsRow = {
  id?: string;
  app_name?: string | null;
  telegram_channel_chat_id?: string | null;
  telegram_channel_url?: string | null;
  telegram_channel_name?: string | null;
  telegram_post_new_trip?: boolean | null;
  telegram_post_weekly_summary?: boolean | null;
  telegram_post_daily_countdown?: boolean | null;
  telegram_recommendation_interval_hours?: number | null;
  telegram_last_recommendation_post_at?: string | null;
  telegram_last_weekly_post_at?: string | null;
  telegram_last_daily_post_date?: string | null;
};

type TripRow = {
  id: string;
  name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  price_per_ticket?: number | null;
  available_seats?: number | null;
  total_seats?: number | null;
  status?: string | null;
  trip_status?: string | null;
  telegram_announced_at?: string | null;
  telegram_final_summary_posted_at?: string | null;
};

function normalizeBoolean(value: unknown, defaultValue: boolean) {
  if (value === null || value === undefined) return defaultValue;
  return Boolean(value);
}

function normalizeNumber(value: unknown, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return numeric;
}

function normalizeDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(dateValue: string | null | undefined) {
  const date = normalizeDate(dateValue);
  if (!date) return 'N/A';
  return date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatShortDate(dateValue: string | null | undefined) {
  const date = normalizeDate(dateValue);
  if (!date) return 'N/A';
  return date.toLocaleDateString('en-US', { dateStyle: 'medium' });
}

function resolveMiniAppURL() {
  if (!APP_URL) return '';
  try {
    return new URL('/miniapp', APP_URL).toString();
  } catch {
    return '';
  }
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function isActiveTripStatus(trip: TripRow) {
  const status = String(trip.status ?? trip.trip_status ?? 'active')
    .trim()
    .toLowerCase();
  return !['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status);
}

function isUpcomingTrip(trip: TripRow) {
  if (!isActiveTripStatus(trip)) return false;
  const departure = normalizeDate(trip.departure_date);
  if (!departure) return false;
  return departure.getTime() >= Date.now();
}

function isEndedTrip(trip: TripRow) {
  if (!isActiveTripStatus(trip)) return true;
  const departure = normalizeDate(trip.departure_date);
  if (!departure) return false;
  return departure.getTime() < Date.now();
}

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

async function loadAppSettings(supabase: any): Promise<AppSettingsRow> {
  const { data, error } = await supabase.from('app_settings').select('*').eq('id', 'default').maybeSingle();
  if (error && (error as any)?.code !== 'PGRST116') {
    throw error;
  }
  return (data || { id: 'default' }) as AppSettingsRow;
}

async function saveAppSettingsFields(supabase: any, input: Record<string, unknown>) {
  let payload: Record<string, unknown> = {
    id: 'default',
    ...input,
    updated_at: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await supabase.from('app_settings').upsert(payload, { onConflict: 'id' });
    if (!result.error) return;

    const missing = detectMissingColumn(result.error);
    if (!missing || !(missing in payload)) return;
    delete payload[missing];
  }
}

async function loadTripsForAnnouncements(
  supabase: any
): Promise<{ trips: TripRow[]; supportsAnnouncedAt: boolean; supportsFinalSummaryAt: boolean }> {
  const selectCandidates = [
    'id, name, destination, departure_date, price_per_ticket, available_seats, total_seats, status, trip_status, telegram_announced_at, telegram_final_summary_posted_at, created_at',
    'id, name, destination, departure_date, price_per_ticket, available_seats, total_seats, status, trip_status, created_at',
    'id, name, destination, departure_date, price_per_ticket, available_seats, total_seats, status, trip_status',
  ];

  for (const selectClause of selectCandidates) {
    const result = await supabase.from('trips').select(selectClause).order('created_at', { ascending: false }).limit(100);
    if (!result.error) {
      return {
        trips: (result.data || []) as TripRow[],
        supportsAnnouncedAt: selectClause.includes('telegram_announced_at'),
        supportsFinalSummaryAt: selectClause.includes('telegram_final_summary_posted_at'),
      };
    }
  }

  return { trips: [], supportsAnnouncedAt: false, supportsFinalSummaryAt: false };
}

async function markTripAnnounced(supabase: any, tripId: string) {
  await supabase.from('trips').update({ telegram_announced_at: new Date().toISOString() }).eq('id', tripId);
}

async function markTripFinalSummaryPosted(supabase: any, tripId: string) {
  await supabase
    .from('trips')
    .update({ telegram_final_summary_posted_at: new Date().toISOString() })
    .eq('id', tripId);
}

function daysUntilTrip(dateValue: string | null | undefined) {
  const departure = normalizeDate(dateValue);
  if (!departure) return null;
  const now = new Date();
  const startNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDeparture = new Date(departure.getFullYear(), departure.getMonth(), departure.getDate());
  const diffMs = startDeparture.getTime() - startNow.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

async function postNewTripAnnouncements(supabase: any, channelChatId: string, appName: string) {
  const { trips, supportsAnnouncedAt } = await loadTripsForAnnouncements(supabase);
  const upcomingTrips = trips.filter(isUpcomingTrip);

  let candidates = upcomingTrips;
  if (supportsAnnouncedAt) {
    candidates = candidates.filter((trip) => !trip.telegram_announced_at);
  } else {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    candidates = candidates.filter((trip: any) => {
      const createdAt = normalizeDate(trip.created_at);
      return createdAt ? createdAt.getTime() >= oneDayAgo : false;
    });
  }

  let posted = 0;
  const miniAppUrl = resolveMiniAppURL();
  for (const trip of candidates.slice(0, 10)) {
    const sold = Math.max(0, Number(trip.total_seats || 0) - Number(trip.available_seats || 0));
    const message = [
      `New trip published on ${appName}`,
      '',
      `Trip: ${trip.name || 'Trip'}`,
      `Destination: ${trip.destination || 'N/A'}`,
      `Departure: ${formatDate(trip.departure_date)}`,
      `Price: ETB ${Number(trip.price_per_ticket || 0).toFixed(2)}`,
      `Sold / Total: ${sold}/${Number(trip.total_seats || 0)}`,
      `Seats left: ${Number(trip.available_seats || 0)}`,
      miniAppUrl ? `Book now: ${miniAppUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
    if (sent) {
      posted += 1;
      if (supportsAnnouncedAt) {
        await markTripAnnounced(supabase, trip.id);
      }
    }
  }
  return posted;
}

async function postWeeklySummary(supabase: any, channelChatId: string, appName: string, settings: AppSettingsRow) {
  const lastWeekly = normalizeDate(settings.telegram_last_weekly_post_at);
  if (lastWeekly && Date.now() - lastWeekly.getTime() < 6.5 * 24 * 60 * 60 * 1000) {
    return false;
  }

  const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [tripsResult, ticketsResult] = await Promise.all([
    supabase
      .from('trips')
      .select('id, name, destination, departure_date, available_seats, total_seats, status, trip_status')
      .order('departure_date', { ascending: true })
      .limit(200),
    supabase
      .from('tickets')
      .select('id, trip_id, ticket_status')
      .gte('created_at', weekAgoIso),
  ]);

  const trips = ((tripsResult.data || []) as TripRow[]).filter(isUpcomingTrip);
  const weeklyTickets = (ticketsResult.data || []) as Array<{ id: string; trip_id?: string | null; ticket_status?: string | null }>;
  const weeklySold = weeklyTickets.filter((t) =>
    ['pending', 'confirmed', 'used'].includes(String(t.ticket_status || '').toLowerCase())
  ).length;

  const availableTotal = trips.reduce((sum, trip) => sum + Math.max(0, Number(trip.available_seats || 0)), 0);
  const totalSeats = trips.reduce((sum, trip) => sum + Math.max(0, Number(trip.total_seats || 0)), 0);

  const salesByTrip = new Map<string, number>();
  for (const ticket of weeklyTickets) {
    const tripId = String(ticket.trip_id || '').trim();
    if (!tripId) continue;
    const status = String(ticket.ticket_status || '').toLowerCase();
    if (!['pending', 'confirmed', 'used'].includes(status)) continue;
    salesByTrip.set(tripId, (salesByTrip.get(tripId) || 0) + 1);
  }

  const topTrips = [...salesByTrip.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tripId, count]) => {
      const trip = trips.find((t) => t.id === tripId);
      return `- ${trip?.name || 'Trip'}: ${count} ticket(s)`;
    });

  const message = [
    `${appName} weekly summary`,
    '',
    `Tickets sold this week: ${weeklySold}`,
    `Available seats (upcoming trips): ${availableTotal}/${totalSeats}`,
    `Upcoming trips: ${trips.length}`,
    topTrips.length ? 'Top trips this week:' : '',
    ...topTrips,
  ]
    .filter(Boolean)
    .join('\n');

  const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
  if (!sent) return false;

  await saveAppSettingsFields(supabase, { telegram_last_weekly_post_at: new Date().toISOString() });
  return true;
}

async function postDailyCountdown(supabase: any, channelChatId: string, appName: string, settings: AppSettingsRow) {
  const today = dayKey();
  if (String(settings.telegram_last_daily_post_date || '') === today) {
    return false;
  }

  const { data, error } = await supabase
    .from('trips')
    .select('id, name, destination, departure_date, available_seats, total_seats, status, trip_status')
    .order('departure_date', { ascending: true })
    .limit(200);
  if (error) return false;

  const items = ((data || []) as TripRow[])
    .filter(isUpcomingTrip)
    .map((trip) => {
      const daysLeft = daysUntilTrip(trip.departure_date);
      return { trip, daysLeft: daysLeft === null ? 9999 : daysLeft };
    })
    .filter((item) => item.daysLeft >= 0 && item.daysLeft <= 14)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 12);

  if (!items.length) {
    await saveAppSettingsFields(supabase, { telegram_last_daily_post_date: today });
    return false;
  }

  const lines = items.map(({ trip, daysLeft }) => {
    const leftLabel = daysLeft === 0 ? 'today' : `${daysLeft} day(s) left`;
    return `- ${trip.name || 'Trip'} (${trip.destination || 'N/A'}) | ${leftLabel} | seats ${Number(
      trip.available_seats || 0
    )}/${Number(trip.total_seats || 0)} | ${formatShortDate(trip.departure_date)}`;
  });

  const message = [`${appName} daily trip countdown`, '', ...lines].join('\n');
  const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
  if (!sent) return false;

  await saveAppSettingsFields(supabase, { telegram_last_daily_post_date: today });
  return true;
}

async function postRecommendedTripsByInterval(
  supabase: any,
  channelChatId: string,
  appName: string,
  settings: AppSettingsRow
) {
  const intervalHours = Math.max(1, Math.floor(normalizeNumber(settings.telegram_recommendation_interval_hours, 24)));
  const lastPosted = normalizeDate(settings.telegram_last_recommendation_post_at);
  if (lastPosted && Date.now() - lastPosted.getTime() < intervalHours * 60 * 60 * 1000) {
    return false;
  }

  const { data, error } = await supabase
    .from('trips')
    .select('id, name, destination, departure_date, available_seats, total_seats, status, trip_status, price_per_ticket')
    .order('departure_date', { ascending: true })
    .limit(200);
  if (error) return false;

  const picks = ((data || []) as TripRow[])
    .filter(isUpcomingTrip)
    .sort((a, b) => Number(b.available_seats || 0) - Number(a.available_seats || 0))
    .slice(0, 3);
  if (!picks.length) return false;

  const lines = picks.map((trip, idx) => {
    const daysLeft = daysUntilTrip(trip.departure_date);
    const leftLabel = daysLeft === null ? 'N/A' : daysLeft === 0 ? 'today' : `${daysLeft} day(s) left`;
    return `${idx + 1}. ${trip.name || 'Trip'} (${trip.destination || 'N/A'}) | ${leftLabel} | ETB ${Number(
      trip.price_per_ticket || 0
    ).toFixed(2)} | seats ${Number(trip.available_seats || 0)}/${Number(trip.total_seats || 0)}`;
  });

  const message = [`${appName} recommended trips`, '', ...lines].join('\n');
  const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
  if (!sent) return false;

  await saveAppSettingsFields(supabase, { telegram_last_recommendation_post_at: new Date().toISOString() });
  return true;
}

async function getTripTicketSummary(supabase: any, tripId: string) {
  const [ticketsResult, receiptsResult] = await Promise.all([
    supabase.from('tickets').select('ticket_status').eq('trip_id', tripId),
    supabase.from('receipts').select('amount_paid, approval_status').eq('trip_id', tripId),
  ]);

  const tickets = (ticketsResult.data || []) as Array<{ ticket_status?: string | null }>;
  const receipts = (receiptsResult.data || []) as Array<{ amount_paid?: number | null; approval_status?: string | null }>;

  let sold = 0;
  let confirmed = 0;
  let used = 0;
  let pending = 0;
  for (const row of tickets) {
    const status = String(row.ticket_status || '').toLowerCase();
    if (['pending', 'confirmed', 'used'].includes(status)) sold += 1;
    if (status === 'confirmed') confirmed += 1;
    if (status === 'used') used += 1;
    if (status === 'pending') pending += 1;
  }

  let approvedRevenue = 0;
  for (const row of receipts) {
    const status = String(row.approval_status || '').toLowerCase();
    if (status !== 'approved') continue;
    approvedRevenue += Number(row.amount_paid || 0);
  }

  return { sold, confirmed, used, pending, approvedRevenue };
}

async function postTripFinalSummaries(supabase: any, channelChatId: string, appName: string) {
  const { trips, supportsFinalSummaryAt } = await loadTripsForAnnouncements(supabase);
  if (!supportsFinalSummaryAt) return 0;
  const endedTrips = trips.filter((trip) => {
    const alreadyPosted = Boolean(String(trip.telegram_final_summary_posted_at || '').trim());
    return isEndedTrip(trip) && !alreadyPosted;
  });

  let posted = 0;
  const miniAppUrl = resolveMiniAppURL();
  for (const trip of endedTrips.slice(0, 20)) {
    const summary = await getTripTicketSummary(supabase, trip.id);
    const departureText = formatDate(trip.departure_date);

    const message = [
      `${appName} trip summary and thanks`,
      '',
      `Trip: ${trip.name || 'Trip'}`,
      `Destination: ${trip.destination || 'N/A'}`,
      `Departure: ${departureText}`,
      `Tickets sold: ${summary.sold}`,
      `Checked in: ${summary.used}`,
      `Pending: ${summary.pending}`,
      `Confirmed (not used): ${summary.confirmed}`,
      `Approved revenue: ETB ${summary.approvedRevenue.toFixed(2)}`,
      '',
      'Thank you to all travelers and supporters.',
      miniAppUrl ? `See upcoming trips: ${miniAppUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
    if (!sent) continue;

    posted += 1;
    await markTripFinalSummaryPosted(supabase, trip.id);
  }

  return posted;
}

function ensureAuthorized(request: NextRequest) {
  const manual = request.nextUrl.searchParams.get('manual') === 'true';
  const vercelCron = String(request.headers.get('x-vercel-cron') || '').trim() === '1';
  const providedSecret =
    String(request.headers.get('x-cron-secret') || '').trim() ||
    String(request.nextUrl.searchParams.get('secret') || '').trim();
  const adminHeader = String(request.headers.get('x-admin-id') || '').trim();

  if (vercelCron) return true;

  if (!CRON_SECRET) {
    if (!manual) return true;
    return Boolean(adminHeader);
  }

  if (providedSecret && providedSecret === CRON_SECRET) return true;
  if (manual && adminHeader) return true;
  return false;
}

async function runPostingWorkflow(request: NextRequest) {
  const supabase = await createAdminClient();
  const settings = await loadAppSettings(supabase);

  const channelChatId = String(settings.telegram_channel_chat_id || '').trim();
  if (!channelChatId) {
    return NextResponse.json(
      { ok: false, error: 'telegram_channel_chat_id is not configured in app settings' },
      { status: 400 }
    );
  }

  const appName = String(settings.app_name || 'TicketHub');
  const postNewTrip = normalizeBoolean(settings.telegram_post_new_trip, true);
  const postWeekly = normalizeBoolean(settings.telegram_post_weekly_summary, true);
  const postDaily = normalizeBoolean(settings.telegram_post_daily_countdown, true);
  const recommendationInterval = Math.max(1, Math.floor(normalizeNumber(settings.telegram_recommendation_interval_hours, 24)));

  let newTripsPosted = 0;
  let weeklySummaryPosted = false;
  let dailyCountdownPosted = false;
  let recommendedPosted = false;
  let finalTripSummariesPosted = 0;

  if (postNewTrip) {
    newTripsPosted = await postNewTripAnnouncements(supabase, channelChatId, appName);
  }
  if (postWeekly) {
    weeklySummaryPosted = await postWeeklySummary(supabase, channelChatId, appName, settings);
  }
  if (postDaily) {
    dailyCountdownPosted = await postDailyCountdown(supabase, channelChatId, appName, settings);
  }
  recommendedPosted = await postRecommendedTripsByInterval(supabase, channelChatId, appName, settings);
  if (postWeekly) {
    finalTripSummariesPosted = await postTripFinalSummaries(supabase, channelChatId, appName);
  }

  return NextResponse.json({
    ok: true,
    settings: {
      channelChatId,
      channelUrl: settings.telegram_channel_url || null,
      channelName: settings.telegram_channel_name || null,
      recommendationIntervalHours: recommendationInterval,
      postNewTrip,
      postWeekly,
      postDaily,
    },
    newTripsPosted,
    weeklySummaryPosted,
    dailyCountdownPosted,
    recommendedPosted,
    finalTripSummariesPosted,
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!ensureAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runPostingWorkflow(request);
  } catch (error) {
    console.error('[cron-channel-posts] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!ensureAuthorized(request)) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    return await runPostingWorkflow(request);
  } catch (error) {
    console.error('[cron-channel-posts] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
