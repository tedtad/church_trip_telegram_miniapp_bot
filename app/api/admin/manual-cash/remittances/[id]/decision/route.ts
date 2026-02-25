import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { canActorApproveManualCash, isMissingColumn, loadManualCashApproverRole } from '@/lib/manual-cash';

async function updateDecisionWithFallback(
  supabase: any,
  remittanceId: string,
  payload: Record<string, unknown>
) {
  const payloadCandidates = [
    { ...payload, updated_at: new Date().toISOString() },
    payload,
  ];
  for (const candidate of payloadCandidates) {
    const result = await supabase
      .from('manual_cash_remittances')
      .update(candidate)
      .eq('id', remittanceId)
      .select('*')
      .maybeSingle();
    if (!result.error) return result.data || null;
    if (isMissingColumn(result.error, 'updated_at')) continue;
    return null;
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const approverRole = await loadManualCashApproverRole(supabase);
    const canApprove = canActorApproveManualCash(auth.actor.role, approverRole);
    if (!canApprove) {
      return NextResponse.json({ ok: false, error: 'Only designated approver role can review remittance' }, { status: 403 });
    }

    const remittanceId = String(params?.id || '').trim();
    if (!remittanceId) {
      return NextResponse.json({ ok: false, error: 'Remittance id is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '').trim().toLowerCase();
    const notes = String(body?.notes || '').trim();
    const reason = String(body?.reason || '').trim();

    if (!['approve', 'reject'].includes(action)) {
      return NextResponse.json({ ok: false, error: 'action must be approve or reject' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabase
      .from('manual_cash_remittances')
      .select('*')
      .eq('id', remittanceId)
      .maybeSingle();
    if (existingError || !existing) {
      return NextResponse.json({ ok: false, error: 'Remittance request not found' }, { status: 404 });
    }

    const currentStatus = String((existing as any)?.approval_status || '').trim().toLowerCase();
    if (currentStatus !== 'pending') {
      return NextResponse.json({ ok: false, error: `Remittance is already ${currentStatus || 'processed'}` }, { status: 400 });
    }

    const decisionPayload =
      action === 'approve'
        ? {
            approval_status: 'approved',
            approved_by_admin_id: auth.actor.id,
            approved_at: new Date().toISOString(),
            approval_notes: notes || null,
            rejection_reason: null,
          }
        : {
            approval_status: 'rejected',
            approved_by_admin_id: auth.actor.id,
            approved_at: new Date().toISOString(),
            approval_notes: notes || null,
            rejection_reason: reason || notes || 'Rejected by approver',
          };

    const updated = await updateDecisionWithFallback(supabase, remittanceId, decisionPayload);
    if (!updated?.id) {
      return NextResponse.json({ ok: false, error: 'Failed to process remittance decision' }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      remittance: updated,
      action,
    });
  } catch (error) {
    console.error('[admin-manual-cash-remittance-decision] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
