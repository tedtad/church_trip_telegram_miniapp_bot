import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

type ReceiptRow = {
  id: string;
  reference_number?: string | null;
  payment_method?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  approval_status?: string | null;
  created_at?: string | null;
  telegram_user_id?: string | number | null;
  trip_id?: string | null;
};

function toIsoDateStart(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function toIsoDateEnd(value: string) {
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function buildCsv(rows: ReceiptRow[]) {
  const headers = [
    'receipt_id',
    'reference_number',
    'payment_method',
    'amount_paid',
    'currency',
    'approval_status',
    'created_at',
    'telegram_user_id',
    'trip_id',
  ];
  const csvRows = [headers.join(',')];
  for (const row of rows) {
    const values = [
      row.id,
      row.reference_number || '',
      row.payment_method || '',
      String(Number(row.amount_paid || 0).toFixed(2)),
      row.currency || 'ETB',
      row.approval_status || '',
      row.created_at || '',
      String(row.telegram_user_id || ''),
      String(row.trip_id || ''),
    ].map((value) => `"${String(value).replace(/"/g, '""')}"`);
    csvRows.push(values.join(','));
  }
  return csvRows.join('\n');
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'reconciliation_view',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const dateFrom = String(request.nextUrl.searchParams.get('dateFrom') || '').trim();
    const dateTo = String(request.nextUrl.searchParams.get('dateTo') || '').trim();
    const paymentMethod = String(request.nextUrl.searchParams.get('paymentMethod') || '').trim();
    const exportMode = String(request.nextUrl.searchParams.get('export') || '').trim().toLowerCase();

    let query = supabase
      .from('receipts')
      .select('id, reference_number, payment_method, amount_paid, currency, approval_status, created_at, telegram_user_id, trip_id')
      .order('created_at', { ascending: false })
      .limit(5000);

    if (dateFrom) {
      const startIso = toIsoDateStart(dateFrom);
      if (startIso) query = query.gte('created_at', startIso);
    }
    if (dateTo) {
      const endIso = toIsoDateEnd(dateTo);
      if (endIso) query = query.lte('created_at', endIso);
    }
    if (paymentMethod) {
      query = query.eq('payment_method', paymentMethod);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = (data || []) as ReceiptRow[];
    if (exportMode === 'csv') {
      const csv = buildCsv(rows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="reconciliation_${Date.now()}.csv"`,
        },
      });
    }

    const methodSummary = new Map<
      string,
      { method: string; totalCount: number; totalAmount: number; approvedCount: number; approvedAmount: number; pendingCount: number; pendingAmount: number }
    >();
    let grandTotal = 0;
    let approvedTotal = 0;
    let pendingTotal = 0;

    for (const row of rows) {
      const method = String(row.payment_method || 'unknown').toLowerCase();
      const status = String(row.approval_status || '').toLowerCase();
      const amount = Number(row.amount_paid || 0);
      const bucket =
        methodSummary.get(method) ||
        {
          method,
          totalCount: 0,
          totalAmount: 0,
          approvedCount: 0,
          approvedAmount: 0,
          pendingCount: 0,
          pendingAmount: 0,
        };

      bucket.totalCount += 1;
      bucket.totalAmount += amount;
      grandTotal += amount;

      if (status === 'approved') {
        bucket.approvedCount += 1;
        bucket.approvedAmount += amount;
        approvedTotal += amount;
      }
      if (status === 'pending') {
        bucket.pendingCount += 1;
        bucket.pendingAmount += amount;
        pendingTotal += amount;
      }

      methodSummary.set(method, bucket);
    }

    return NextResponse.json({
      ok: true,
      filters: { dateFrom, dateTo, paymentMethod: paymentMethod || null },
      summary: {
        totalRecords: rows.length,
        grandTotal: Number(grandTotal.toFixed(2)),
        approvedTotal: Number(approvedTotal.toFixed(2)),
        pendingTotal: Number(pendingTotal.toFixed(2)),
      },
      byMethod: [...methodSummary.values()]
        .sort((a, b) => b.totalAmount - a.totalAmount)
        .map((item) => ({
          ...item,
          totalAmount: Number(item.totalAmount.toFixed(2)),
          approvedAmount: Number(item.approvedAmount.toFixed(2)),
          pendingAmount: Number(item.pendingAmount.toFixed(2)),
        })),
      rows,
    });
  } catch (error) {
    console.error('[admin-reconciliation] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load reconciliation' }, { status: 500 });
  }
}
