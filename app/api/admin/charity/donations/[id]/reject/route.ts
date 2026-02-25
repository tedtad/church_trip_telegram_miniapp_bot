import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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

async function rejectExecutionWithFallback(
  supabase: any,
  executionId: string,
  input: { approvedBy: string; reason: string }
) {
  const payloadCandidates = [
    {
      approval_status: 'rejected',
      approved_by: input.approvedBy,
      approved_at: new Date().toISOString(),
      rejection_reason: input.reason || null,
      approval_notes: null,
      updated_at: new Date().toISOString(),
    },
    {
      approval_status: 'rejected',
      approved_by: input.approvedBy,
      approved_at: new Date().toISOString(),
      rejection_reason: input.reason || null,
      approval_notes: null,
    },
  ];
  for (const payload of payloadCandidates) {
    const result = await supabase.from('charity_promise_executions').update(payload).eq('id', executionId);
    if (!result.error) return true;
    if (
      isMissingColumn(result.error, 'approval_status') ||
      isMissingColumn(result.error, 'approved_by') ||
      isMissingColumn(result.error, 'approved_at') ||
      isMissingColumn(result.error, 'rejection_reason') ||
      isMissingColumn(result.error, 'approval_notes') ||
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
  { params }: { params: { id: string } }
) {
  const supabase = await createClient();
  const body = await request.json();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const reason = String(body?.reason || '').trim();

  const { data, error } = await supabase
    .from('charity_donations')
    .update({
      approval_status: 'rejected',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', params.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const promiseId = String((data as any)?.promise_id || '').trim();
  const executionIdDirect = String((data as any)?.promise_execution_id || '').trim();
  if (promiseId) {
    await updatePromiseStatusWithFallback(supabase, promiseId, 'active');

    let executionId = executionIdDirect;
    if (!executionId) {
      const { data: executionRow } = await supabase
        .from('charity_promise_executions')
        .select('id')
        .eq('donation_id', params.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      executionId = String((executionRow as any)?.id || '').trim();
    }

    if (executionId) {
      await rejectExecutionWithFallback(supabase, executionId, {
        approvedBy: user.id,
        reason,
      });
    }
  }

  return NextResponse.json({ donation: data });
}
