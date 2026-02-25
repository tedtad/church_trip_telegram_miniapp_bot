import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { computeAdminCashRemittance, computeAdminCashSales } from '@/lib/manual-cash';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'tickets_manual_sale',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const adminId = auth.actor.id;
    const sales = await computeAdminCashSales(supabase, adminId);
    const remittance = await computeAdminCashRemittance(supabase, adminId);
    const outstandingAmount = Math.max(0, Number((sales.totalCashSold - remittance.approvedRemittedAmount).toFixed(2)));

    return NextResponse.json({
      ok: true,
      summary: {
        adminId,
        totalCashSold: sales.totalCashSold,
        cashSaleCount: sales.cashSaleCount,
        approvedRemittedAmount: remittance.approvedRemittedAmount,
        pendingRemittedAmount: remittance.pendingRemittedAmount,
        totalSubmittedAmount: remittance.totalSubmittedAmount,
        outstandingAmount,
      },
      remittances: remittance.submissions.slice(0, 30),
    });
  } catch (error) {
    console.error('[admin-manual-cash-summary] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load manual cash summary' }, { status: 500 });
  }
}
