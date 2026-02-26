import { createAdminClient } from '@/lib/supabase/admin';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminPermission } from '@/lib/admin-rbac';
import { sendCharityDonationThankYou } from '@/lib/charity-automation';

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(String(columnName || '').toLowerCase());
}

async function updatePromiseStatusWithFallback(supabase: any, promiseId: string, status: string) {
  const payloadCandidates = [
    { status, updated_at: new Date().toISOString() },
    { status },
  ];
  for (const payload of payloadCandidates) {
    const result = await supabase.from('charity_promises').update(payload).eq('id', promiseId);
    if (!result.error) return true;
    if (isMissingColumn(result.error, 'status') || isMissingColumn(result.error, 'updated_at')) continue;
    return false;
  }
  return false;
}

async function updateExecutionApprovalWithFallback(
  supabase: any,
  executionId: string,
  input: { approvedBy: string; notes: string }
) {
  const payloadCandidates = [
    {
      approval_status: 'approved',
      approved_by: input.approvedBy,
      approved_at: new Date().toISOString(),
      approval_notes: input.notes || null,
      rejection_reason: null,
      updated_at: new Date().toISOString(),
    },
    {
      approval_status: 'approved',
      approved_by: input.approvedBy,
      approved_at: new Date().toISOString(),
      approval_notes: input.notes || null,
      rejection_reason: null,
    },
  ];
  for (const payload of payloadCandidates) {
    const result = await supabase.from('charity_promise_executions').update(payload).eq('id', executionId);
    if (!result.error) return true;
    if (
      isMissingColumn(result.error, 'approval_status') ||
      isMissingColumn(result.error, 'approved_by') ||
      isMissingColumn(result.error, 'approved_at') ||
      isMissingColumn(result.error, 'approval_notes') ||
      isMissingColumn(result.error, 'rejection_reason') ||
      isMissingColumn(result.error, 'updated_at')
    ) {
      continue;
    }
    return false;
  }
  return false;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createAdminClient();
  const auth = await requireAdminPermission({
    supabase,
    request,
    permission: 'charity_manage',
  });
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await Promise.resolve(context.params);
  const body = await request.json();

  const notes = String(body?.notes || '').trim();

  const { data, error } = await supabase
    .from('charity_donations')
    .update({
      approval_status: 'approved',
      approved_by: auth.actor.id,
      approved_at: new Date().toISOString(),
      approval_notes: notes,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const campaignId = String((data as any)?.campaign_id || '').trim();
  const amount = Number((data as any)?.donation_amount || 0);
  if (campaignId && amount > 0) {
    const { data: campaign } = await supabase
      .from('charity_campaigns')
      .select('id, collected_amount')
      .eq('id', campaignId)
      .maybeSingle();
    if (campaign) {
      const nextCollected = Number(campaign.collected_amount || 0) + amount;
      await supabase
        .from('charity_campaigns')
        .update({ collected_amount: Number(nextCollected.toFixed(2)), updated_at: new Date().toISOString() })
        .eq('id', campaignId);
    }
  }

  const promiseId = String((data as any)?.promise_id || '').trim();
  const executionIdDirect = String((data as any)?.promise_execution_id || '').trim();
  if (promiseId) {
    await updatePromiseStatusWithFallback(supabase, promiseId, 'fulfilled');

    let executionId = executionIdDirect;
    if (!executionId) {
      const { data: executionRow } = await supabase
        .from('charity_promise_executions')
        .select('id')
        .eq('donation_id', id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      executionId = String((executionRow as any)?.id || '').trim();
    }

    if (executionId) {
      await updateExecutionApprovalWithFallback(supabase, executionId, {
        approvedBy: auth.actor.id,
        notes,
      });
    }
  }

  await sendCharityDonationThankYou(supabase, id, 'approved');
  return NextResponse.json({ donation: data });
}
