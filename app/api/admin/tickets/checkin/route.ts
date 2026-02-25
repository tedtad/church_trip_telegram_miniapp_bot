import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveAdminId, writeAdminAuditLog } from '@/lib/admin-audit';

type TelegramUserRow = {
  id: string | number;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  phone_number?: string | null;
};

type TicketRow = {
  id: string;
  ticket_number?: string | null;
  serial_number?: string | null;
  ticket_status?: string | null;
  trip_id?: string | null;
  telegram_user_id?: string | number | null;
  trips?:
  | {
    name?: string | null;
    destination?: string | null;
    departure_date?: string | null;
  }
  | Array<{
    name?: string | null;
    destination?: string | null;
    departure_date?: string | null;
  }>;
  receipts?:
  | {
    reference_number?: string | null;
  }
  | Array<{
    reference_number?: string | null;
  }>;
};

function normalizeDigits(value: string) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeDateYmd(value: string | Date | null | undefined) {
  if (!value) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(String(columnName || '').toLowerCase());
}

async function findUsersByPhone(supabase: any, phoneQuery: string) {
  const normalized = phoneQuery.trim();
  const digits = normalizeDigits(normalized);
  const seen = new Set<string>();
  const users: TelegramUserRow[] = [];

  const queries = [normalized, digits].filter(Boolean);
  for (const q of queries) {
    const { data } = await supabase
      .from('telegram_users')
      .select('id, first_name, last_name, username, phone_number')
      .ilike('phone_number', `%${q}%`)
      .limit(100);

    for (const row of (data || []) as TelegramUserRow[]) {
      const id = String(row.id);
      if (seen.has(id)) continue;
      seen.add(id);
      users.push(row);
    }
  }

  return users;
}

async function findUsersByIds(supabase: any, userIds: Array<string | number>) {
  const normalized = Array.from(new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
  if (normalized.length === 0) return new Map<string, TelegramUserRow>();

  const { data } = await supabase
    .from('telegram_users')
    .select('id, first_name, last_name, username, phone_number')
    .in('id', normalized)
    .limit(500);

  const map = new Map<string, TelegramUserRow>();
  for (const row of (data || []) as TelegramUserRow[]) {
    map.set(String(row.id), row);
  }
  return map;
}

function toCheckinResult(ticket: TicketRow, user: TelegramUserRow | undefined) {
  const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
  const receipt = Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts;

  return {
    ticketId: ticket.id,
    ticketNumber: String(ticket.ticket_number || ''),
    serialNumber: String(ticket.serial_number || ''),
    status: String(ticket.ticket_status || ''),
    tripId: String(ticket.trip_id || ''),
    tripName: String(trip?.name || 'Trip'),
    destination: String(trip?.destination || 'N/A'),
    departureDate: String(trip?.departure_date || ''),
    telegramUserId: String(ticket.telegram_user_id || ''),
    customerName: [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || (user?.username ? `@${user.username}` : 'Unknown'),
    phoneNumber: String(user?.phone_number || ''),
    referenceNumber: String(receipt?.reference_number || ''),
  };
}

export async function GET(request: NextRequest) {
  try {
    const phone = String(request.nextUrl.searchParams.get('phone') || '').trim();
    const ticketId = String(request.nextUrl.searchParams.get('ticketId') || '').trim();
    const tripDate = normalizeDateYmd(request.nextUrl.searchParams.get('tripDate') || '');

    const supabase = await createAdminClient();
    let rows: TicketRow[] = [];

    if (ticketId) {
      const { data, error } = await supabase
        .from('tickets')
        .select(
          `
          id,
          ticket_number,
          serial_number,
          ticket_status,
          trip_id,
          telegram_user_id,
          trips (name, destination, departure_date),
          receipts (reference_number)
        `
        )
        .eq('id', ticketId)
        .maybeSingle();

      if (error) {
        return NextResponse.json({ ok: false, error: 'Failed to load ticket' }, { status: 500 });
      }
      if (!data) {
        return NextResponse.json({ ok: true, results: [] });
      }
      rows = [data as TicketRow];
    } else {
      if (!phone) {
        return NextResponse.json({ ok: false, error: 'phone is required' }, { status: 400 });
      }

      const users = await findUsersByPhone(supabase, phone);
      if (users.length === 0) {
        return NextResponse.json({ ok: true, results: [] });
      }

      const userIds = users.map((u) => u.id);
      const { data, error } = await supabase
        .from('tickets')
        .select(
          `
          id,
          ticket_number,
          serial_number,
          ticket_status,
          trip_id,
          telegram_user_id,
          trips (name, destination, departure_date),
          receipts (reference_number)
        `
        )
        .in('telegram_user_id', userIds)
        .in('ticket_status', ['confirmed', 'used'])
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) {
        return NextResponse.json({ ok: false, error: 'Failed to search tickets' }, { status: 500 });
      }
      rows = (data || []) as TicketRow[];
    }

    const userMap = await findUsersByIds(
      supabase,
      rows.map((ticket) => ticket.telegram_user_id || '').filter(Boolean) as Array<string | number>
    );

    const results = rows
      .filter((ticket) => {
        if (!tripDate) return true;
        const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
        return normalizeDateYmd(trip?.departure_date || '') === tripDate;
      })
      .map((ticket) => toCheckinResult(ticket, userMap.get(String(ticket.telegram_user_id || ''))));

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('[tickets-checkin] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const ticketId = String(body?.ticketId || '').trim();
    const requestedDate = normalizeDateYmd(body?.tripDate || '') || normalizeDateYmd(new Date());

    if (!ticketId) {
      return NextResponse.json({ ok: false, error: 'ticketId is required' }, { status: 400 });
    }

    const supabase = await createAdminClient();
    const adminId = await resolveAdminId(supabase, request, String(body?.adminId || '').trim() || null);
    const { data: ticket, error: ticketError } = await supabase
      .from('tickets')
      .select(
        `
        id,
        ticket_number,
        serial_number,
        ticket_status,
        trip_id,
        telegram_user_id,
        trips (name, destination, departure_date),
        receipts (reference_number)
      `
      )
      .eq('id', ticketId)
      .maybeSingle();

    if (ticketError || !ticket) {
      return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
    }

    const row = ticket as TicketRow;
    const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
    const departureYmd = normalizeDateYmd(trip?.departure_date || '');
    if (requestedDate && departureYmd && requestedDate !== departureYmd) {
      return NextResponse.json(
        { ok: false, error: `This ticket is for ${departureYmd}. Check-in is allowed only on trip day.` },
        { status: 400 }
      );
    }

    const normalizedStatus = String(row.ticket_status || '').toLowerCase();
    if (normalizedStatus === 'used') {
      return NextResponse.json({ ok: true, message: 'Ticket already checked in', ticket: toCheckinResult(row, undefined) });
    }
    if (normalizedStatus !== 'confirmed') {
      return NextResponse.json({ ok: false, error: 'Only confirmed tickets can be checked in' }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const updateVariants: Array<Record<string, unknown>> = [
      { ticket_status: 'used', used_at: nowIso, checked_in_at: nowIso },
      { ticket_status: 'used', used_at: nowIso },
      { ticket_status: 'used', checked_in_at: nowIso },
      { ticket_status: 'used' },
    ];

    let updateError: unknown = null;
    let finalVariant: Record<string, unknown> | null = null;
    for (const variant of updateVariants) {
      const result = await supabase.from('tickets').update(variant).eq('id', ticketId);
      if (!result.error) {
        updateError = null;
        finalVariant = variant;
        break;
      }

      if (
        isMissingColumn(result.error, 'used_at') ||
        isMissingColumn(result.error, 'checked_in_at')
      ) {
        updateError = result.error;
        continue;
      }

      updateError = result.error;
      break;
    }

    if (updateError || !finalVariant) {
      return NextResponse.json({ ok: false, error: 'Failed to check in ticket' }, { status: 500 });
    }

    await writeAdminAuditLog(supabase, {
      adminId,
      action: 'TICKET_MANUAL_CHECKIN',
      entityType: 'ticket',
      entityId: ticketId,
      description: `Manually checked in ticket ${row.ticket_number || row.serial_number || ticketId}`,
      metadata: {
        ticketId,
        tripId: row.trip_id || null,
        tripDate: departureYmd || null,
        checkInDate: requestedDate || null,
        ticketNumber: row.ticket_number || null,
        serialNumber: row.serial_number || null,
      },
    });

    const updatedTicket = {
      ...row,
      ticket_status: 'used',
    };
    return NextResponse.json({
      ok: true,
      message: 'Customer checked in successfully',
      ticket: toCheckinResult(updatedTicket, undefined),
    });
  } catch (error) {
    console.error('[tickets-checkin] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
