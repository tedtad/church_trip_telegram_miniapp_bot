import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateTicketQRCode } from '@/lib/qr-code';
import { formatLocalizedDateTime } from '@/lib/date-localization';

type TicketRecord = {
  id: string;
  ticket_number: string;
  serial_number: string;
  ticket_status?: string | null;
  created_at?: string;
  issued_at?: string | null;
  trips?:
  | {
    name?: string | null;
    destination?: string | null;
    departure_date?: string | null;
    image_url?: string | null;
    trip_image_url?: string | null;
    cover_image_url?: string | null;
  }
  | Array<{
    name?: string | null;
    destination?: string | null;
    departure_date?: string | null;
    image_url?: string | null;
    trip_image_url?: string | null;
    cover_image_url?: string | null;
  }>;
  receipts?: { reference_number?: string | null } | Array<{ reference_number?: string | null }>;
};

function escapeXml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatDate(value?: string | null, lang: 'en' | 'am' = 'en') {
  return formatLocalizedDateTime(value, lang, 'N/A');
}

function isExpiredTicket(departureDate?: string | null) {
  if (!departureDate) return false;
  const departure = new Date(departureDate);
  if (Number.isNaN(departure.getTime())) return false;
  return Date.now() > departure.getTime();
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

function normalizeImageUrl(url?: string | null) {
  const candidate = String(url || '').trim();
  if (!candidate) return '';
  if (!/^https?:\/\//i.test(candidate)) return '';
  return candidate;
}

async function embedImageAsDataUri(url: string) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return '';

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('image/')) return '';

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) return '';

    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return '';
  }
}

async function queryTicketRecord(supabase: any, ticketId: string, serial: string) {
  const selections = [
    `
      id,
      ticket_number,
      serial_number,
      ticket_status,
      created_at,
      issued_at,
      trips (name, destination, departure_date, image_url, trip_image_url, cover_image_url),
      receipts (reference_number)
    `,
    `
      id,
      ticket_number,
      serial_number,
      ticket_status,
      created_at,
      issued_at,
      trips (name, destination, departure_date, image_url),
      receipts (reference_number)
    `,
    `
      id,
      ticket_number,
      serial_number,
      ticket_status,
      created_at,
      issued_at,
      trips (name, destination, departure_date),
      receipts (reference_number)
    `,
  ];

  let lastError: unknown = null;
  for (const selectClause of selections) {
    const result = await supabase
      .from('tickets')
      .select(selectClause)
      .eq('id', ticketId)
      .eq('serial_number', serial)
      .maybeSingle();

    if (!result.error && result.data) return result.data as TicketRecord;

    if (result.error && (isMissingColumn(result.error, 'image_url') || isMissingColumn(result.error, 'trip_image_url') || isMissingColumn(result.error, 'cover_image_url'))) {
      lastError = result.error;
      continue;
    }

    lastError = result.error;
    if (result.error) break;
  }

  throw lastError || new Error('Ticket not found');
}

export async function GET(
  request: NextRequest,
  context: { params: { ticketId: string } | Promise<{ ticketId: string }> }
) {
  try {
    const { ticketId } = await Promise.resolve(context.params);
    const serial = request.nextUrl.searchParams.get('serial') || '';
    const lang = String(request.nextUrl.searchParams.get('lang') || 'en').toLowerCase() === 'am' ? 'am' : 'en';

    if (!ticketId || !serial) {
      return NextResponse.json({ ok: false, error: 'ticketId and serial are required' }, { status: 400 });
    }

    const supabase = await createAdminClient();
    let ticket: TicketRecord | null = null;
    try {
      ticket = await queryTicketRecord(supabase, ticketId, serial);
    } catch (error) {
      console.error('[ticket-card] Query error:', error);
    }

    if (!ticket) {
      return NextResponse.json({ ok: false, error: 'Ticket not found' }, { status: 404 });
    }
    const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
    const receipt = Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts;
    const tripImage = normalizeImageUrl(trip?.image_url || trip?.trip_image_url || trip?.cover_image_url);
    const embeddedTripImage = tripImage ? await embedImageAsDataUri(tripImage) : '';
    const renderTripImage = embeddedTripImage || tripImage;

    const appURL = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const qrDataUrl = await generateTicketQRCode(ticket.id, ticket.serial_number, appURL);
    const securityCode = createHash('sha256')
      .update(`${ticket.id}:${ticket.serial_number}:${ticket.ticket_number}`)
      .digest('hex')
      .slice(0, 14)
      .toUpperCase();

    const tripName = escapeXml(trip?.name || 'Trip');
    const destination = escapeXml(trip?.destination || 'N/A');
    const reference = escapeXml(receipt?.reference_number || 'N/A');
    const ticketNumber = escapeXml(ticket.ticket_number || 'N/A');
    const serialNumber = escapeXml(ticket.serial_number || 'N/A');
    const issueDate = escapeXml(formatDate(ticket.issued_at || ticket.created_at, lang));
    const departureDate = escapeXml(formatDate(trip?.departure_date, lang));
    const expired = isExpiredTicket(trip?.departure_date);
    const status = escapeXml(expired ? 'EXPIRED' : String(ticket.ticket_status || 'pending').toUpperCase());
    const statusColor = expired ? '#ef4444' : '#22c55e';
    const expiredWatermark = expired
      ? `<g opacity="0.16" transform="rotate(-24 600 340)">
  <text x="600" y="360" fill="#ef4444" font-size="150" font-weight="800" font-family="Arial, sans-serif" text-anchor="middle">EXPIRED</text>
</g>`
      : '';
    const imageLayer = renderTripImage
      ? `<image x="40" y="40" width="1120" height="600" href="${escapeXml(
        renderTripImage
      )}" preserveAspectRatio="xMidYMid slice" opacity="0.35"/>`
      : '';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="680" viewBox="0 0 1200 680">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0ea5e9"/>
      <stop offset="100%" stop-color="#22c55e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="680" rx="28" fill="url(#bg)"/>
  <rect x="0" y="0" width="1200" height="18" fill="url(#accent)"/>
  <clipPath id="tripCardClip">
    <rect x="40" y="40" width="1120" height="600" rx="20"/>
  </clipPath>
  <g clip-path="url(#tripCardClip)">
    ${imageLayer}
    <rect x="40" y="40" width="1120" height="600" fill="#0b1220" opacity="0.78"/>
  </g>
  <rect x="40" y="40" width="1120" height="600" rx="20" fill="none" stroke="#334155" stroke-width="2"/>

  <text x="70" y="95" fill="#e2e8f0" font-size="36" font-weight="700" font-family="Arial, sans-serif">TicketHub Digital Ticket</text>
  <text x="70" y="130" fill="#94a3b8" font-size="20" font-family="Arial, sans-serif">Security Code: ${securityCode}</text>
  <text x="1040" y="95" fill="${statusColor}" font-size="26" font-weight="700" font-family="Arial, sans-serif" text-anchor="end">${status}</text>
  ${expiredWatermark}

  <text x="70" y="190" fill="#94a3b8" font-size="18" font-family="Arial, sans-serif">Trip</text>
  <text x="70" y="222" fill="#f8fafc" font-size="30" font-weight="700" font-family="Arial, sans-serif">${tripName}</text>

  <text x="70" y="272" fill="#94a3b8" font-size="18" font-family="Arial, sans-serif">Destination</text>
  <text x="70" y="304" fill="#f1f5f9" font-size="24" font-family="Arial, sans-serif">${destination}</text>

  <text x="70" y="352" fill="#94a3b8" font-size="18" font-family="Arial, sans-serif">Departure</text>
  <text x="70" y="384" fill="#f1f5f9" font-size="22" font-family="Arial, sans-serif">${departureDate}</text>

  <text x="70" y="432" fill="#94a3b8" font-size="18" font-family="Arial, sans-serif">Ticket Number</text>
  <text x="70" y="464" fill="#f8fafc" font-size="26" font-weight="700" font-family="Arial, sans-serif">${ticketNumber}</text>

  <text x="70" y="512" fill="#94a3b8" font-size="18" font-family="Arial, sans-serif">Serial Number</text>
  <text x="70" y="544" fill="#f8fafc" font-size="24" font-weight="700" font-family="Arial, sans-serif">${serialNumber}</text>

  <text x="70" y="590" fill="#94a3b8" font-size="16" font-family="Arial, sans-serif">Reference: ${reference} | Issued: ${issueDate}</text>

  <rect x="820" y="180" width="300" height="300" rx="14" fill="#ffffff"/>
  <image x="835" y="195" width="270" height="270" href="${qrDataUrl}"/>
  <text x="970" y="530" fill="#94a3b8" font-size="16" font-family="Arial, sans-serif" text-anchor="middle">Scan to verify ticket</text>
</svg>`;

    return new NextResponse(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    });
  } catch (error) {
    console.error('[ticket-card] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to render ticket card' }, { status: 500 });
  }
}
