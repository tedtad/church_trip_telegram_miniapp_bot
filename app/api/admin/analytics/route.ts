import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

type TicketRow = {
  ticket_status?: string | null;
  purchase_price?: number | null;
  trips?: { name?: string | null; destination?: string | null } | Array<{ name?: string | null; destination?: string | null }>;
};

export async function GET() {
  try {
    const supabase = await createAdminClient();

    const [
      { count: totalUsers },
      { count: totalTickets },
      { count: pendingTickets },
      { count: confirmedTickets },
      { count: cancelledTickets },
      { count: usedTickets },
      { count: pendingApprovals },
      { data: approvedReceipts },
      { data: ticketRows },
    ] = await Promise.all([
      supabase.from('telegram_users').select('*', { count: 'exact', head: true }),
      supabase.from('tickets').select('*', { count: 'exact', head: true }),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('ticket_status', 'pending'),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('ticket_status', 'confirmed'),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('ticket_status', 'cancelled'),
      supabase.from('tickets').select('*', { count: 'exact', head: true }).eq('ticket_status', 'used'),
      supabase.from('receipts').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending'),
      supabase
        .from('receipts')
        .select('amount_paid, created_at')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: false })
        .limit(5000),
      supabase
        .from('tickets')
        .select('ticket_status, purchase_price, trips (name, destination)')
        .order('created_at', { ascending: false })
        .limit(5000),
    ]);

    const approvedList = approvedReceipts || [];
    const totalRevenue = approvedList.reduce((sum: number, row: any) => sum + Number(row.amount_paid || 0), 0);

    const dailyMap = new Map<string, number>();
    for (const row of approvedList) {
      const key = new Date(row.created_at).toISOString().slice(0, 10);
      dailyMap.set(key, (dailyMap.get(key) || 0) + Number(row.amount_paid || 0));
    }

    const dailyRevenue = [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-14)
      .map(([date, revenue]) => ({ date, revenue }));

    const tripMap = new Map<string, { name: string; destination: string; count: number; revenue: number }>();
    for (const row of (ticketRows || []) as TicketRow[]) {
      const normalizedStatus = String(row.ticket_status || '').toLowerCase();
      if (!['confirmed', 'used'].includes(normalizedStatus)) continue;

      const trip = Array.isArray(row.trips) ? row.trips[0] : row.trips;
      const name = trip?.name || 'Trip';
      const destination = trip?.destination || 'N/A';
      const key = `${name}__${destination}`;

      const current = tripMap.get(key) || { name, destination, count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += Number(row.purchase_price || 0);
      tripMap.set(key, current);
    }

    const topTrips = [...tripMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return NextResponse.json({
      ok: true,
      summary: {
        totalUsers: totalUsers || 0,
        totalTickets: totalTickets || 0,
        pendingTickets: pendingTickets || 0,
        confirmedTickets: confirmedTickets || 0,
        cancelledTickets: cancelledTickets || 0,
        usedTickets: usedTickets || 0,
        pendingApprovals: pendingApprovals || 0,
        totalRevenue,
      },
      dailyRevenue,
      topTrips,
    });
  } catch (error) {
    console.error('[analytics] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load analytics' }, { status: 500 });
  }
}
