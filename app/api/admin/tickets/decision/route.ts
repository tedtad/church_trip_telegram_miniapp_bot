import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { generateTicketQRCode } from '@/lib/qr-code';
import { sendTelegramDocument, sendTelegramMessage } from '@/lib/telegram';
import { requireAdminPermission } from '@/lib/admin-rbac';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app';

type ReceiptRow = {
  id: string;
  reference_number: string;
  telegram_user_id: string | number;
  approval_status?: string | null;
};

type TicketRow = {
  id: string;
  serial_number: string;
  ticket_number: string;
  trip_id: string;
  ticket_status?: string | null;
};

type TripSeatRow = {
  id: string;
  available_seats: number | null;
};

function getDbClient() {
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    return createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return null;
}

async function getPrimaryClient() {
  return (getDbClient() || (await createServerClient()));
}

function resolveAppBaseUrl(...candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    const value = String(candidate || '').trim();
    if (!value) continue;
    try {
      return new URL(value).origin.replace(/\/+$/, '');
    } catch { }
  }
  return '';
}

function isMissingColumn(error: unknown, columnName: string) {
  const msg = String((error as any)?.message || '').toLowerCase();
  return msg.includes('column') && msg.includes(columnName.toLowerCase());
}

async function insertApprovalRecord(
  client: any,
  receiptId: string,
  adminId: string,
  status: 'approved' | 'rejected',
  notes: string
) {
  const withApprovalDate = await client.from('approvals').insert({
    receipt_id: receiptId,
    admin_id: adminId,
    status,
    notes,
    approval_date: new Date().toISOString(),
  });

  if (!withApprovalDate.error) return;

  await client.from('approvals').insert({
    receipt_id: receiptId,
    admin_id: adminId,
    status,
    notes,
  });
}

async function insertActivityLog(
  client: any,
  adminId: string,
  actionName: string,
  receiptId: string,
  description: string,
  metadata: Record<string, unknown>
) {
  const payload = {
    admin_id: adminId,
    entity_type: 'receipt',
    entity_id: receiptId,
    description,
    metadata,
  };

  const actionInsert = await client.from('activity_logs').insert({
    ...payload,
    action: actionName,
  });

  if (!actionInsert.error) return;

  await client.from('activity_logs').insert({
    ...payload,
    action_type: actionName,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { receiptId, action, notes, reason, confirmationTicketNumber } = await request.json();
    const appBaseUrl = resolveAppBaseUrl(process.env.NEXT_PUBLIC_APP_URL, request.nextUrl.origin, APP_URL);

    if (!receiptId || !action) {
      return NextResponse.json(
        { ok: false, error: 'receiptId and action are required' },
        { status: 400 }
      );
    }

    if (action !== 'approve' && action !== 'reject' && action !== 'rollback') {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }

    const client = await getPrimaryClient();
    const auth = await requireAdminPermission({
      supabase: client,
      request,
      permission: 'tickets_review',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }
    const adminId = auth.actor.id;

    const { data: receipt, error: receiptError } = await client
      .from('receipts')
      .select('*')
      .eq('id', receiptId)
      .maybeSingle();

    if (receiptError || !receipt) {
      return NextResponse.json({ ok: false, error: 'Receipt not found' }, { status: 404 });
    }

    if (receipt.approval_status === 'approved' && action === 'approve') {
      return NextResponse.json({ ok: true, message: 'Receipt already approved' });
    }

    const { data: tickets, error: ticketsError } = await client
      .from('tickets')
      .select('*')
      .eq('receipt_id', receiptId);

    if (ticketsError || !tickets || tickets.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'No pending tickets found for this receipt' },
        { status: 400 }
      );
    }

    const receiptRow = receipt as ReceiptRow;
    const ticketRows = tickets as TicketRow[];

    if (action === 'rollback') {
      if (receipt.approval_status !== 'approved') {
        return NextResponse.json(
          { ok: false, error: 'Only approved receipts can be rolled back' },
          { status: 400 }
        );
      }

      const normalizedConfirmation = String(confirmationTicketNumber || '')
        .trim()
        .toUpperCase();
      if (!normalizedConfirmation) {
        return NextResponse.json(
          { ok: false, error: 'confirmationTicketNumber is required for rollback' },
          { status: 400 }
        );
      }

      const hasMatchingTicket = ticketRows.some(
        (ticket) => String(ticket.ticket_number || '').trim().toUpperCase() === normalizedConfirmation
      );
      if (!hasMatchingTicket) {
        return NextResponse.json(
          { ok: false, error: 'Confirmation ticket number does not match this receipt' },
          { status: 400 }
        );
      }

      const usedTickets = ticketRows.filter((ticket) => String(ticket.ticket_status || '').toLowerCase() === 'used');
      if (usedTickets.length > 0) {
        return NextResponse.json(
          { ok: false, error: 'Cannot rollback because one or more tickets are already used' },
          { status: 400 }
        );
      }

      const seatRestoreCounts = new Map<string, number>();
      for (const ticket of ticketRows) {
        if (!ticket.trip_id) continue;
        const normalized = String(ticket.ticket_status || '').toLowerCase();
        if (normalized === 'confirmed') {
          seatRestoreCounts.set(ticket.trip_id, (seatRestoreCounts.get(ticket.trip_id) || 0) + 1);
        }
      }

      const restoreTripIds = [...seatRestoreCounts.keys()];
      if (restoreTripIds.length > 0) {
        const { data: trips, error: tripsError } = await client
          .from('trips')
          .select('id, available_seats')
          .in('id', restoreTripIds);

        if (tripsError) {
          return NextResponse.json({ ok: false, error: 'Failed to restore seats' }, { status: 500 });
        }

        const tripMap = new Map<string, TripSeatRow>((trips || []).map((t: TripSeatRow) => [t.id, t]));
        for (const [tripId, restoreCount] of seatRestoreCounts.entries()) {
          const current = tripMap.get(tripId)?.available_seats ?? 0;
          const { error: seatRestoreError } = await client
            .from('trips')
            .update({ available_seats: current + restoreCount })
            .eq('id', tripId);
          if (seatRestoreError) {
            return NextResponse.json({ ok: false, error: 'Failed to restore trip seats' }, { status: 500 });
          }
        }
      }

      const receiptUpdateVariants: Array<Record<string, unknown>> = [
        {
          approval_status: 'pending',
          rejection_reason: null,
          approval_notes: notes || null,
          approved_at: null,
        },
        {
          approval_status: 'pending',
          rejection_reason: null,
          approval_notes: notes || null,
        },
      ];

      let receiptRollbackError: unknown = null;
      for (const updatePayload of receiptUpdateVariants) {
        const result = await client.from('receipts').update(updatePayload).eq('id', receiptId);
        if (!result.error) {
          receiptRollbackError = null;
          break;
        }
        receiptRollbackError = result.error;
      }

      if (receiptRollbackError) {
        return NextResponse.json({ ok: false, error: 'Failed to rollback receipt status' }, { status: 500 });
      }

      const ticketUpdateVariants: Array<Record<string, unknown>> = [
        { ticket_status: 'pending', issued_at: null, qr_code: null },
        { ticket_status: 'pending', qr_code: null },
        { ticket_status: 'pending', issued_at: null },
        { ticket_status: 'pending' },
      ];

      let ticketRollbackError: unknown = null;
      for (const updatePayload of ticketUpdateVariants) {
        const result = await client.from('tickets').update(updatePayload).eq('receipt_id', receiptId);
        if (!result.error) {
          ticketRollbackError = null;
          break;
        }
        ticketRollbackError = result.error;
      }

      if (ticketRollbackError) {
        return NextResponse.json({ ok: false, error: 'Failed to rollback tickets' }, { status: 500 });
      }

      await insertApprovalRecord(
        client,
        receiptId,
        adminId,
        'rejected',
        `Rollback confirmation: ${normalizedConfirmation}${notes ? ` | ${notes}` : ''}`
      );
      await insertActivityLog(
        client,
        adminId,
        'ticket_rollback',
        receiptId,
        `Rolled back approved receipt ${receiptRow.reference_number}`,
        {
          reference_number: receiptRow.reference_number,
          confirmation_ticket_number: normalizedConfirmation,
          tickets_rolled_back: ticketRows.length,
          seat_restored_count: [...seatRestoreCounts.values()].reduce((sum, n) => sum + n, 0),
          notes: notes || null,
        }
      );

      await sendTelegramMessage(
        receiptRow.telegram_user_id,
        [
          'Ticket approval has been rolled back for review.',
          `Reference: ${receiptRow.reference_number}`,
          'Your tickets are now pending re-approval.',
        ].join('\n')
      );

      return NextResponse.json({
        ok: true,
        action: 'rolled_back',
        ticketCount: ticketRows.length,
      });
    }

    if (action === 'approve') {
      const tripCounts = new Map<string, number>();
      for (const ticket of ticketRows) {
        if (!ticket.trip_id) continue;
        tripCounts.set(ticket.trip_id, (tripCounts.get(ticket.trip_id) || 0) + 1);
      }

      const tripIds = [...tripCounts.keys()];
      const { data: trips, error: tripsError } = await client
        .from('trips')
        .select('id, available_seats')
        .in('id', tripIds);

      if (tripsError) {
        return NextResponse.json({ ok: false, error: 'Unable to verify seat availability' }, { status: 500 });
      }

      const tripMap = new Map<string, TripSeatRow>((trips || []).map((t: TripSeatRow) => [t.id, t]));
      for (const [tripId, count] of tripCounts.entries()) {
        const trip = tripMap.get(tripId);
        const available = trip?.available_seats ?? 0;
        if (available < count) {
          return NextResponse.json(
            { ok: false, error: `Not enough seats for trip ${tripId}. Available: ${available}, needed: ${count}` },
            { status: 400 }
          );
        }
      }

      for (const [tripId, count] of tripCounts.entries()) {
        const trip = tripMap.get(tripId);
        const available = trip?.available_seats ?? 0;
        const { error: seatError } = await client
          .from('trips')
          .update({ available_seats: available - count })
          .eq('id', tripId);
        if (seatError) {
          return NextResponse.json({ ok: false, error: 'Failed to reserve seats' }, { status: 500 });
        }
      }

      let receiptUpdate = await client
        .from('receipts')
        .update({
          approval_status: 'approved',
          approval_notes: notes || null,
          approved_at: new Date().toISOString(),
        })
        .eq('id', receiptId);

      if (receiptUpdate.error && isMissingColumn(receiptUpdate.error, 'approved_at')) {
        receiptUpdate = await client
          .from('receipts')
          .update({
            approval_status: 'approved',
            approval_notes: notes || null,
          })
          .eq('id', receiptId);
      }

      if (receiptUpdate.error) {
        return NextResponse.json({ ok: false, error: 'Failed to approve receipt' }, { status: 500 });
      }

      const serials: string[] = [];
      for (const ticket of ticketRows) {
        const qr = await generateTicketQRCode(ticket.id, ticket.serial_number);
        const { error: ticketUpdateError } = await client
          .from('tickets')
          .update({
            ticket_status: 'confirmed',
            issued_at: new Date().toISOString(),
            qr_code: qr,
          })
          .eq('id', ticket.id);

        if (ticketUpdateError) {
          return NextResponse.json({ ok: false, error: 'Failed to issue digital ticket' }, { status: 500 });
        }

        serials.push(ticket.serial_number);

        // Best effort: deliver a signed digital ticket card to the customer in Telegram.
        try {
          const cardUrl = `${appBaseUrl}/api/tickets/${ticket.id}/card?serial=${encodeURIComponent(ticket.serial_number)}`;
          const sent = await sendTelegramDocument(
            receiptRow.telegram_user_id,
            cardUrl,
            `Digital Ticket ${serials.length}/${ticketRows.length}\nSerial: ${ticket.serial_number}`
          );
          if (!sent) {
            await sendTelegramMessage(
              receiptRow.telegram_user_id,
              `Ticket ${serials.length}/${ticketRows.length}\nSerial: ${ticket.serial_number}\nOpen: ${cardUrl}`
            );
          }
        } catch (sendError) {
          console.error('[tickets-decision] Failed to send ticket card:', sendError);
        }
      }

      await insertApprovalRecord(client, receiptId, adminId, 'approved', notes || '');
      await insertActivityLog(
        client,
        adminId,
        'ticket_approved',
        receiptId,
        `Approved receipt ${receiptRow.reference_number}`,
        {
          reference_number: receiptRow.reference_number,
          serial_numbers: serials,
          notes: notes || null,
        }
      );

      await sendTelegramMessage(
        receiptRow.telegram_user_id,
        [
          'Your ticket has been approved.',
          `Reference: ${receiptRow.reference_number}`,
          `Ticket(s): ${ticketRows.length}`,
          `Serial(s): ${serials.join(', ')}`,
          '',
          'You can now use your digital ticket.',
        ].join('\n')
      );

      return NextResponse.json({
        ok: true,
        action: 'approved',
        ticketCount: ticketRows.length,
        serials,
      });
    }

    const rejectReason = reason || notes || 'No reason provided';
    const receiptRejectUpdate = await client
      .from('receipts')
      .update({
        approval_status: 'rejected',
        rejection_reason: rejectReason,
      })
      .eq('id', receiptId);

    if (receiptRejectUpdate.error) {
      return NextResponse.json({ ok: false, error: 'Failed to reject receipt' }, { status: 500 });
    }

    const ticketReject = await client
      .from('tickets')
      .update({ ticket_status: 'cancelled' })
      .eq('receipt_id', receiptId);

    if (ticketReject.error) {
      return NextResponse.json({ ok: false, error: 'Failed to cancel pending tickets' }, { status: 500 });
    }

    await insertApprovalRecord(client, receiptId, adminId, 'rejected', rejectReason);
    await insertActivityLog(
      client,
      adminId,
      'ticket_rejected',
      receiptId,
      `Rejected receipt ${receiptRow.reference_number}`,
      {
        reference_number: receiptRow.reference_number,
        reason: rejectReason,
      }
    );

    await sendTelegramMessage(
      receiptRow.telegram_user_id,
      [
        'Your ticket request was rejected.',
        `Reference: ${receiptRow.reference_number}`,
        `Reason: ${rejectReason}`,
      ].join('\n')
    );

    return NextResponse.json({ ok: true, action: 'rejected' });
  } catch (error) {
    console.error('[tickets-decision] Error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
