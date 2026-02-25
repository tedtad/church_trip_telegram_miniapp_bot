import { normalizeAdminRole } from '@/lib/admin-rbac';

function isRelationMissing(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  const code = String((error as any)?.code || '').toUpperCase();
  if (code === '42P01') return true;
  return message.includes('relation') && message.includes(relationName.toLowerCase()) && message.includes('does not exist');
}

export function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(String(columnName || '').toLowerCase());
}

export async function computeAdminCashSales(supabase: any, adminId: string) {
  const normalizedAdminId = String(adminId || '').trim();
  if (!normalizedAdminId) {
    return { totalCashSold: 0, cashSaleCount: 0 };
  }

  const receiptQuery = await supabase
    .from('receipts')
    .select('amount_paid, approval_status, payment_method, manual_sale_admin_id')
    .eq('payment_method', 'cash')
    .eq('manual_sale_admin_id', normalizedAdminId)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (!receiptQuery.error) {
    const rows = receiptQuery.data || [];
    const activeRows = rows.filter((row: any) => String(row?.approval_status || '').toLowerCase() !== 'rejected');
    const totalCashSold = activeRows.reduce((sum: number, row: any) => sum + Number(row?.amount_paid || 0), 0);
    return { totalCashSold: Number(totalCashSold.toFixed(2)), cashSaleCount: activeRows.length };
  }

  if (!isMissingColumn(receiptQuery.error, 'manual_sale_admin_id')) {
    throw receiptQuery.error;
  }

  const { data: logs, error: logsError } = await supabase
    .from('activity_logs')
    .select('metadata, action, action_type')
    .eq('admin_id', normalizedAdminId)
    .order('created_at', { ascending: false })
    .limit(5000);
  if (logsError) throw logsError;

  const rows = (logs || []).filter((row: any) => {
    const action = String(row?.action || row?.action_type || '').toUpperCase();
    return action === 'TICKET_MANUAL_SALE';
  });
  const cashRows = rows.filter((row: any) => String((row?.metadata as any)?.paymentMethod || '').toLowerCase() === 'cash');
  const totalCashSold = cashRows.reduce(
    (sum: number, row: any) => sum + Number((row?.metadata as any)?.amountPaid || 0),
    0
  );
  return { totalCashSold: Number(totalCashSold.toFixed(2)), cashSaleCount: cashRows.length };
}

export async function computeAdminCashRemittance(supabase: any, adminId: string) {
  const normalizedAdminId = String(adminId || '').trim();
  if (!normalizedAdminId) {
    return {
      approvedRemittedAmount: 0,
      pendingRemittedAmount: 0,
      totalSubmittedAmount: 0,
      submissions: [],
    };
  }

  const { data, error } = await supabase
    .from('manual_cash_remittances')
    .select('*')
    .eq('submitted_by_admin_id', normalizedAdminId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    if (isRelationMissing(error, 'manual_cash_remittances')) {
      return {
        approvedRemittedAmount: 0,
        pendingRemittedAmount: 0,
        totalSubmittedAmount: 0,
        submissions: [],
      };
    }
    throw error;
  }

  const rows = data || [];
  const approvedRemittedAmount = rows
    .filter((row: any) => String(row?.approval_status || '').toLowerCase() === 'approved')
    .reduce((sum: number, row: any) => sum + Number(row?.remitted_amount || 0), 0);
  const pendingRemittedAmount = rows
    .filter((row: any) => String(row?.approval_status || '').toLowerCase() === 'pending')
    .reduce((sum: number, row: any) => sum + Number(row?.remitted_amount || 0), 0);
  const totalSubmittedAmount = rows.reduce((sum: number, row: any) => sum + Number(row?.remitted_amount || 0), 0);

  return {
    approvedRemittedAmount: Number(approvedRemittedAmount.toFixed(2)),
    pendingRemittedAmount: Number(pendingRemittedAmount.toFixed(2)),
    totalSubmittedAmount: Number(totalSubmittedAmount.toFixed(2)),
    submissions: rows,
  };
}

export async function loadManualCashApproverRole(supabase: any) {
  const { data } = await supabase
    .from('app_settings')
    .select('manual_cash_approver_role')
    .eq('id', 'default')
    .maybeSingle();
  const raw = String((data as any)?.manual_cash_approver_role || '').trim();
  return raw ? normalizeAdminRole(raw) : 'admin';
}

export function canActorApproveManualCash(actorRoleInput: unknown, approverRoleInput: unknown) {
  const actorRole = normalizeAdminRole(actorRoleInput);
  const approverRole = normalizeAdminRole(approverRoleInput);
  if (actorRole === 'system_admin') return true;
  return actorRole === approverRole;
}
