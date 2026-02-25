import { sendTelegramMessage } from '@/lib/telegram';

type AnnounceTarget = number | string;

function getPositiveInt(value: string, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function getBroadcastLimit() {
  return getPositiveInt(String(process.env.TELEGRAM_NEW_ITEM_BROADCAST_LIMIT || ''), 500);
}

export function resolveMiniAppURL() {
  const raw = String(process.env.NEXT_PUBLIC_APP_URL || '').trim();
  if (!raw) return '';
  try {
    const origin = new URL(raw).origin.replace(/\/+$/, '');
    return `${origin}/miniapp`;
  } catch {
    return '';
  }
}

function normalizeId(value: unknown): AnnounceTarget | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isSafeInteger(numeric)) return numeric;
  return text;
}

async function sendInBatches(userIds: AnnounceTarget[], message: string) {
  const batchSize = 20;
  let delivered = 0;
  let attempted = 0;

  for (let i = 0; i < userIds.length; i += batchSize) {
    const batch = userIds.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (userId) => {
        const sent = await sendTelegramMessage(userId, message, { disable_web_page_preview: true });
        return Boolean(sent);
      })
    );

    attempted += batch.length;
    delivered += results.filter((item) => item.status === 'fulfilled' && item.value).length;
  }

  return { attempted, delivered };
}

async function loadPriorTripAudience(supabase: any, excludeTripId?: string) {
  const { data, error } = await supabase
    .from('tickets')
    .select('telegram_user_id, trip_id')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return [];

  const unique = new Set<string>();
  const output: AnnounceTarget[] = [];

  for (const row of data || []) {
    const tripId = String((row as any)?.trip_id || '').trim();
    if (excludeTripId && tripId && tripId === excludeTripId) continue;

    const normalized = normalizeId((row as any)?.telegram_user_id);
    if (normalized === null) continue;
    const key = String(normalized);
    if (unique.has(key)) continue;
    unique.add(key);
    output.push(normalized);
  }

  return output.slice(0, getBroadcastLimit());
}

async function loadPriorCampaignAudience(supabase: any, excludeCampaignId?: string) {
  const { data, error } = await supabase
    .from('charity_donations')
    .select('telegram_user_id, campaign_id')
    .order('created_at', { ascending: false })
    .limit(5000);
  if (error) return [];

  const unique = new Set<string>();
  const output: AnnounceTarget[] = [];

  for (const row of data || []) {
    const campaignId = String((row as any)?.campaign_id || '').trim();
    if (excludeCampaignId && campaignId && campaignId === excludeCampaignId) continue;

    const normalized = normalizeId((row as any)?.telegram_user_id);
    if (normalized === null) continue;
    const key = String(normalized);
    if (unique.has(key)) continue;
    unique.add(key);
    output.push(normalized);
  }

  return output.slice(0, getBroadcastLimit());
}

export async function announceNewTripToPriorUsers(
  supabase: any,
  trip: {
    id: string;
    name?: string | null;
    destination?: string | null;
    departure_date?: string | null;
  }
) {
  const users = await loadPriorTripAudience(supabase, String(trip.id || '').trim());
  if (!users.length) return { attempted: 0, delivered: 0 };

  const miniAppUrl = resolveMiniAppURL();
  const departure = trip.departure_date ? new Date(trip.departure_date) : null;
  const departureText =
    departure && !Number.isNaN(departure.getTime())
      ? departure.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : 'N/A';

  const message = [
    'New trip is now available.',
    `Trip: ${String(trip.name || 'Trip')}`,
    `Destination: ${String(trip.destination || 'N/A')}`,
    `Departure: ${departureText}`,
    miniAppUrl ? `Open Mini App: ${miniAppUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return sendInBatches(users, message);
}

export async function announceNewCampaignToPriorUsers(
  supabase: any,
  campaign: {
    id: string;
    name?: string | null;
    cause?: string | null;
    end_date?: string | null;
  }
) {
  const users = await loadPriorCampaignAudience(supabase, String(campaign.id || '').trim());
  if (!users.length) return { attempted: 0, delivered: 0 };

  const miniAppUrl = resolveMiniAppURL();
  const endDate = campaign.end_date ? new Date(campaign.end_date) : null;
  const endText =
    endDate && !Number.isNaN(endDate.getTime())
      ? endDate.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      : 'N/A';

  const message = [
    'New charity campaign is now available.',
    `Campaign: ${String(campaign.name || 'Campaign')}`,
    `Cause: ${String(campaign.cause || 'N/A')}`,
    `End date: ${endText}`,
    miniAppUrl ? `Open Mini App: ${miniAppUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return sendInBatches(users, message);
}
