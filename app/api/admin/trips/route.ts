import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseBankAccounts } from '@/lib/payment-config';
import { sendTelegramMessage } from '@/lib/telegram';
import { announceNewTripToPriorUsers, resolveMiniAppURL } from '@/lib/telegram-announcements';
import { validateTelegramGroupNotReused } from '@/lib/telegram-group-policy';

type TripInput = {
  id?: string;
  name?: string;
  description?: string | null;
  destination?: string;
  image_url?: string | null;
  bank_accounts?: unknown;
  telebirr_manual_account_name?: string | null;
  telebirr_manual_account_number?: string | null;
  manual_payment_note?: string | null;
  allow_gnpl?: boolean;
  telegram_group_url?: string | null;
  telegram_group_chat_id?: string | null;
  departure_date?: string;
  arrival_date?: string | null;
  price_per_ticket?: number;
  total_seats?: number;
  available_seats?: number;
  status?: string;
};

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) {
    const col = quoted[1].split('.').pop() || '';
    return col.trim() || null;
  }

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) {
    const col = doubleQuoted[1].split('.').pop() || '';
    return col.trim() || null;
  }

  return null;
}

function normalizeTripPayload(input: TripInput) {
  const status = String(input.status || 'active').toLowerCase();
  const bankAccounts = parseBankAccounts(input.bank_accounts);

  return {
    name: String(input.name || '').trim(),
    description: input.description ? String(input.description).trim() : null,
    destination: String(input.destination || '').trim(),
    image_url: input.image_url ? String(input.image_url).trim() : null,
    bank_accounts: bankAccounts.length ? bankAccounts : null,
    telebirr_manual_account_name: input.telebirr_manual_account_name
      ? String(input.telebirr_manual_account_name).trim()
      : null,
    telebirr_manual_account_number: input.telebirr_manual_account_number
      ? String(input.telebirr_manual_account_number).trim()
      : null,
    manual_payment_note: input.manual_payment_note ? String(input.manual_payment_note).trim() : null,
    allow_gnpl: Boolean(input.allow_gnpl),
    telegram_group_url: input.telegram_group_url ? String(input.telegram_group_url).trim() : null,
    telegram_group_chat_id: input.telegram_group_chat_id ? String(input.telegram_group_chat_id).trim() : null,
    departure_date: input.departure_date ? new Date(input.departure_date).toISOString() : null,
    arrival_date: input.arrival_date ? new Date(input.arrival_date).toISOString() : null,
    price_per_ticket: Number(input.price_per_ticket || 0),
    total_seats: Number(input.total_seats || 0),
    available_seats: Number(input.available_seats || 0),
    status,
    trip_status: status,
  };
}

function validateTripPayload(payload: ReturnType<typeof normalizeTripPayload>) {
  if (!payload.name) return 'Trip name is required';
  if (!payload.destination) return 'Destination is required';
  if (!payload.departure_date) return 'Departure date is required';
  if (!Number.isFinite(payload.price_per_ticket) || payload.price_per_ticket <= 0) {
    return 'Price per ticket must be greater than 0';
  }
  if (!Number.isInteger(payload.total_seats) || payload.total_seats <= 0) {
    return 'Total seats must be a positive integer';
  }
  if (!Number.isInteger(payload.available_seats) || payload.available_seats < 0) {
    return 'Available seats must be a non-negative integer';
  }
  if (payload.available_seats > payload.total_seats) {
    return 'Available seats cannot be greater than total seats';
  }
  if (payload.image_url && !/^https?:\/\//i.test(payload.image_url)) {
    return 'Trip image URL must start with http:// or https://';
  }
  if (payload.telegram_group_url && !/^https?:\/\//i.test(payload.telegram_group_url)) {
    return 'Trip Telegram group URL must start with http:// or https://';
  }

  return null;
}

async function insertTrip(client: any, payload: ReturnType<typeof normalizeTripPayload>) {
  let workingPayload: Record<string, unknown> = { ...payload };
  let lastResult: any = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.from('trips').insert(workingPayload).select('*').single();
    if (!result.error) return result;

    lastResult = result;
    const missingColumn = detectMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in workingPayload)) break;

    delete workingPayload[missingColumn];
  }

  return lastResult;
}

async function updateTrip(client: any, id: string, payload: ReturnType<typeof normalizeTripPayload>) {
  let workingPayload: Record<string, unknown> = { ...payload };
  let lastResult: any = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const result = await client.from('trips').update(workingPayload).eq('id', id).select('*').single();
    if (!result.error) return result;

    lastResult = result;
    const missingColumn = detectMissingColumn(result.error);
    if (!missingColumn || !(missingColumn in workingPayload)) break;

    delete workingPayload[missingColumn];
  }

  return lastResult;
}

async function notifyNewTripToChannel(client: any, trip: any) {
  try {
    const status = String(trip?.status ?? trip?.trip_status ?? 'active')
      .trim()
      .toLowerCase();
    if (['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status)) return;
    const departureAt = trip?.departure_date ? new Date(trip.departure_date) : null;
    if (!departureAt || Number.isNaN(departureAt.getTime()) || departureAt.getTime() < Date.now()) return;

    const { data: settings } = await client
      .from('app_settings')
      .select('app_name, telegram_channel_chat_id, telegram_post_new_trip')
      .eq('id', 'default')
      .maybeSingle();
    if (!settings) return;
    if (settings.telegram_post_new_trip === false) return;

    const channelChatId = String(settings.telegram_channel_chat_id || '').trim();
    if (!channelChatId) return;

    const departure = trip?.departure_date ? new Date(trip.departure_date) : null;
    const departureText =
      departure && !Number.isNaN(departure.getTime())
        ? departure.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
        : 'N/A';
    const sold = Math.max(0, Number(trip?.total_seats || 0) - Number(trip?.available_seats || 0));
    const miniAppUrl = resolveMiniAppURL();

    const message = [
      `New trip published on ${String(settings.app_name || 'TicketHub')}`,
      '',
      `Trip: ${String(trip?.name || 'Trip')}`,
      `Destination: ${String(trip?.destination || 'N/A')}`,
      `Departure: ${departureText}`,
      `Price: ETB ${Number(trip?.price_per_ticket || 0).toFixed(2)}`,
      `Sold / Total: ${sold}/${Number(trip?.total_seats || 0)}`,
      `Seats left: ${Number(trip?.available_seats || 0)}`,
      miniAppUrl ? `Open Mini App: ${miniAppUrl}` : '',
    ].join('\n');

    const sent = await sendTelegramMessage(channelChatId, message, { disable_web_page_preview: true });
    if (sent) {
      await client
        .from('trips')
        .update({ telegram_announced_at: new Date().toISOString() })
        .eq('id', String(trip?.id || ''));
    }
  } catch (error) {
    console.error('[admin-trips] Channel notification error:', error);
  }
}

export async function GET() {
  try {
    const supabase = await createAdminClient();
    const { data, error } = await supabase.from('trips').select('*').order('departure_date', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const trips = (data || []).map((trip: any) => ({
      ...trip,
      status: trip.status ?? trip.trip_status ?? 'active',
    }));

    return NextResponse.json({ ok: true, trips });
  } catch (error) {
    console.error('[admin-trips] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load trips' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as TripInput;
    const payload = normalizeTripPayload(body);
    const validationError = validateTripPayload(payload);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const supabase = await createAdminClient();
    const groupConflict = await validateTelegramGroupNotReused(supabase, {
      groupUrl: payload.telegram_group_url,
      groupChatId: payload.telegram_group_chat_id,
    });
    if (groupConflict) {
      return NextResponse.json({ ok: false, error: groupConflict }, { status: 400 });
    }

    const { data, error } = await insertTrip(supabase, payload);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await notifyNewTripToChannel(supabase, data);
    await announceNewTripToPriorUsers(supabase, data);

    return NextResponse.json({ ok: true, trip: data }, { status: 201 });
  } catch (error) {
    console.error('[admin-trips] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to create trip' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as TripInput;
    const id = String(body.id || '');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Trip id is required' }, { status: 400 });
    }

    const payload = normalizeTripPayload(body);
    const validationError = validateTripPayload(payload);
    if (validationError) {
      return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
    }

    const supabase = await createAdminClient();
    const groupConflict = await validateTelegramGroupNotReused(supabase, {
      groupUrl: payload.telegram_group_url,
      groupChatId: payload.telegram_group_chat_id,
      excludeTripId: id,
    });
    if (groupConflict) {
      return NextResponse.json({ ok: false, error: groupConflict }, { status: 400 });
    }

    const { data, error } = await updateTrip(supabase, id, payload);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, trip: data });
  } catch (error) {
    console.error('[admin-trips] PATCH error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update trip' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Trip id is required' }, { status: 400 });
    }

    const supabase = await createAdminClient();
    const { error } = await supabase.from('trips').delete().eq('id', id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id });
  } catch (error) {
    console.error('[admin-trips] DELETE error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to delete trip' }, { status: 500 });
  }
}
