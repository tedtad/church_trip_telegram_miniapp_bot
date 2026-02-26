import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

type ReportType = 'sales_summary' | 'payment_methods' | 'ticket_status' | 'daily_sales' | 'manual_cash_by_admin';

function toIsoDateStart(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function toIsoDateEnd(value: string) {
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isReportType(value: string): value is ReportType {
  return ['sales_summary', 'payment_methods', 'ticket_status', 'daily_sales', 'manual_cash_by_admin'].includes(value);
}

function isRelationMissing(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  const code = String((error as any)?.code || '').toUpperCase();
  if (code === '42P01') return true;
  return message.includes('relation') && message.includes(relationName.toLowerCase()) && message.includes('does not exist');
}

function toCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    const line = headers
      .map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`)
      .join(',');
    lines.push(line);
  }
  return lines.join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'reports_view',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const typeParam = String(request.nextUrl.searchParams.get('type') || 'sales_summary').trim().toLowerCase();
    const type: ReportType = isReportType(typeParam) ? typeParam : 'sales_summary';
    const dateFrom = String(request.nextUrl.searchParams.get('dateFrom') || '').trim();
    const dateTo = String(request.nextUrl.searchParams.get('dateTo') || '').trim();
    const exportMode = String(request.nextUrl.searchParams.get('export') || '').trim().toLowerCase();

    let fromIso = '';
    let toIso = '';
    if (dateFrom) fromIso = toIsoDateStart(dateFrom);
    if (dateTo) toIso = toIsoDateEnd(dateTo);

    if (type === 'payment_methods') {
      let query = supabase
        .from('receipts')
        .select('payment_method, amount_paid, approval_status, created_at')
        .order('created_at', { ascending: false })
        .limit(10000);
      if (fromIso) query = query.gte('created_at', fromIso);
      if (toIso) query = query.lte('created_at', toIso);
      const { data, error } = await query;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      const buckets = new Map<string, { method: string; records: number; totalAmount: number; approvedAmount: number }>();
      for (const row of data || []) {
        const method = String((row as any).payment_method || 'unknown').toLowerCase();
        const amount = Number((row as any).amount_paid || 0);
        const status = String((row as any).approval_status || '').toLowerCase();
        const current = buckets.get(method) || { method, records: 0, totalAmount: 0, approvedAmount: 0 };
        current.records += 1;
        current.totalAmount += amount;
        if (status === 'approved') current.approvedAmount += amount;
        buckets.set(method, current);
      }

      const rows = [...buckets.values()]
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .map((row) => ({
          ...row,
          totalAmount: Number(row.totalAmount.toFixed(2)),
          approvedAmount: Number(row.approvedAmount.toFixed(2)),
        }));
      const headers = ['method', 'records', 'totalAmount', 'approvedAmount'];
      if (exportMode === 'csv') {
        return new NextResponse(toCsv(headers, rows), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="report_payment_methods_${Date.now()}.csv"`,
          },
        });
      }
      return NextResponse.json({ ok: true, type, filters: { dateFrom, dateTo }, headers, rows });
    }

    if (type === 'ticket_status') {
      let query = supabase
        .from('tickets')
        .select('ticket_status, created_at')
        .order('created_at', { ascending: false })
        .limit(10000);
      if (fromIso) query = query.gte('created_at', fromIso);
      if (toIso) query = query.lte('created_at', toIso);
      const { data, error } = await query;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      const buckets = new Map<string, number>();
      for (const row of data || []) {
        const status = String((row as any).ticket_status || 'unknown').toLowerCase();
        buckets.set(status, (buckets.get(status) || 0) + 1);
      }
      const rows = [...buckets.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count);
      const headers = ['status', 'count'];
      if (exportMode === 'csv') {
        return new NextResponse(toCsv(headers, rows), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="report_ticket_status_${Date.now()}.csv"`,
          },
        });
      }
      return NextResponse.json({ ok: true, type, filters: { dateFrom, dateTo }, headers, rows });
    }

    if (type === 'daily_sales') {
      let query = supabase
        .from('receipts')
        .select('amount_paid, approval_status, created_at')
        .eq('approval_status', 'approved')
        .order('created_at', { ascending: true })
        .limit(10000);
      if (fromIso) query = query.gte('created_at', fromIso);
      if (toIso) query = query.lte('created_at', toIso);
      const { data, error } = await query;
      if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

      const dayMap = new Map<string, { date: string; receipts: number; amount: number }>();
      for (const row of data || []) {
        const date = new Date((row as any).created_at || '').toISOString().slice(0, 10);
        const amount = Number((row as any).amount_paid || 0);
        const current = dayMap.get(date) || { date, receipts: 0, amount: 0 };
        current.receipts += 1;
        current.amount += amount;
        dayMap.set(date, current);
      }
      const rows = [...dayMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((row) => ({ ...row, amount: Number(row.amount.toFixed(2)) }));
      const headers = ['date', 'receipts', 'amount'];
      if (exportMode === 'csv') {
        return new NextResponse(toCsv(headers, rows), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="report_daily_sales_${Date.now()}.csv"`,
          },
        });
      }
      return NextResponse.json({ ok: true, type, filters: { dateFrom, dateTo }, headers, rows });
    }

    if (type === 'manual_cash_by_admin') {
      let salesQuery = supabase
        .from('receipts')
        .select('manual_sale_admin_id, amount_paid, approval_status, payment_method, created_at')
        .eq('payment_method', 'cash')
        .not('manual_sale_admin_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10000);
      if (fromIso) salesQuery = salesQuery.gte('created_at', fromIso);
      if (toIso) salesQuery = salesQuery.lte('created_at', toIso);
      const { data: salesData, error: salesError } = await salesQuery;
      if (salesError) return NextResponse.json({ ok: false, error: salesError.message }, { status: 500 });

      let remittanceData: any[] = [];
      let remittanceQuery = supabase
        .from('manual_cash_remittances')
        .select('submitted_by_admin_id, remitted_amount, approval_status, created_at')
        .order('created_at', { ascending: false })
        .limit(10000);
      if (fromIso) remittanceQuery = remittanceQuery.gte('created_at', fromIso);
      if (toIso) remittanceQuery = remittanceQuery.lte('created_at', toIso);
      const { data: remittances, error: remittanceError } = await remittanceQuery;
      if (remittanceError && !isRelationMissing(remittanceError, 'manual_cash_remittances')) {
        return NextResponse.json({ ok: false, error: remittanceError.message }, { status: 500 });
      }
      if (!remittanceError) {
        remittanceData = remittances || [];
      }

      const byAdmin = new Map<
        string,
        {
          adminId: string;
          cashSalesCount: number;
          totalCashSold: number;
          approvedRemitted: number;
          pendingRemitted: number;
        }
      >();

      for (const row of salesData || []) {
        const adminId = String((row as any).manual_sale_admin_id || '').trim();
        if (!adminId) continue;
        const status = String((row as any).approval_status || '').toLowerCase();
        if (status === 'rejected') continue;
        const amount = Number((row as any).amount_paid || 0);
        const current = byAdmin.get(adminId) || {
          adminId,
          cashSalesCount: 0,
          totalCashSold: 0,
          approvedRemitted: 0,
          pendingRemitted: 0,
        };
        current.cashSalesCount += 1;
        current.totalCashSold += amount;
        byAdmin.set(adminId, current);
      }

      for (const row of remittanceData) {
        const adminId = String((row as any).submitted_by_admin_id || '').trim();
        if (!adminId) continue;
        const amount = Number((row as any).remitted_amount || 0);
        const status = String((row as any).approval_status || '').toLowerCase();
        const current = byAdmin.get(adminId) || {
          adminId,
          cashSalesCount: 0,
          totalCashSold: 0,
          approvedRemitted: 0,
          pendingRemitted: 0,
        };
        if (status === 'approved') current.approvedRemitted += amount;
        if (status === 'pending') current.pendingRemitted += amount;
        byAdmin.set(adminId, current);
      }

      const rows = [...byAdmin.values()]
        .map((row) => {
          const outstanding = Math.max(0, row.totalCashSold - row.approvedRemitted);
          return {
            adminId: row.adminId,
            cashSalesCount: row.cashSalesCount,
            totalCashSold: Number(row.totalCashSold.toFixed(2)),
            approvedRemitted: Number(row.approvedRemitted.toFixed(2)),
            pendingRemitted: Number(row.pendingRemitted.toFixed(2)),
            outstanding: Number(outstanding.toFixed(2)),
          };
        })
        .sort((a, b) => b.outstanding - a.outstanding);
      const headers = ['adminId', 'cashSalesCount', 'totalCashSold', 'approvedRemitted', 'pendingRemitted', 'outstanding'];
      if (exportMode === 'csv') {
        return new NextResponse(toCsv(headers, rows), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="report_manual_cash_by_admin_${Date.now()}.csv"`,
          },
        });
      }
      return NextResponse.json({ ok: true, type, filters: { dateFrom, dateTo }, headers, rows });
    }

    let query = supabase
      .from('tickets')
      .select('purchase_price, ticket_status, created_at, trips(name, destination)')
      .order('created_at', { ascending: false })
      .limit(10000);
    if (fromIso) query = query.gte('created_at', fromIso);
    if (toIso) query = query.lte('created_at', toIso);
    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const tripMap = new Map<
      string,
      {
        tripName: string;
        destination: string;
        totalTickets: number;
        pendingTickets: number;
        confirmedTickets: number;
        usedTickets: number;
        cancelledTickets: number;
        soldTickets: number;
        revenue: number;
      }
    >();
    for (const row of data || []) {
      let status = String((row as any).ticket_status || '').toLowerCase();
      if (status === 'canceled') status = 'cancelled';
      const trip = Array.isArray((row as any).trips) ? (row as any).trips[0] : (row as any).trips;
      const tripName = String(trip?.name || 'Trip');
      const destination = String(trip?.destination || 'N/A');
      const key = `${tripName}__${destination}`;
      const current = tripMap.get(key) || {
        tripName,
        destination,
        totalTickets: 0,
        pendingTickets: 0,
        confirmedTickets: 0,
        usedTickets: 0,
        cancelledTickets: 0,
        soldTickets: 0,
        revenue: 0,
      };
      current.totalTickets += 1;
      if (status === 'pending') current.pendingTickets += 1;
      if (status === 'confirmed') current.confirmedTickets += 1;
      if (status === 'used') current.usedTickets += 1;
      if (status === 'cancelled') current.cancelledTickets += 1;
      if (status === 'confirmed' || status === 'used') {
        current.soldTickets += 1;
        current.revenue += Number((row as any).purchase_price || 0);
      }
      tripMap.set(key, current);
    }

    const rows = [...tripMap.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .map((row) => ({ ...row, revenue: Number(row.revenue.toFixed(2)) }));
    const headers = [
      'tripName',
      'destination',
      'totalTickets',
      'pendingTickets',
      'confirmedTickets',
      'usedTickets',
      'cancelledTickets',
      'soldTickets',
      'revenue',
    ];
    if (exportMode === 'csv') {
      return new NextResponse(toCsv(headers, rows), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="report_sales_summary_${Date.now()}.csv"`,
        },
      });
    }
    return NextResponse.json({ ok: true, type, filters: { dateFrom, dateTo }, headers, rows });
  } catch (error) {
    console.error('[admin-reports] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load report' }, { status: 500 });
  }
}
