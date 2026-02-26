import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'charity_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await request.json().catch(() => ({}));
    const reason = String(body?.reason || body?.notes || '').trim();

    const executionId = String(id || '').trim();
    if (!executionId) {
      return NextResponse.json({ ok: false, error: 'Execution id is required' }, { status: 400 });
    }

    const updateCandidates = [
      {
        approval_status: 'rejected',
        approved_by: auth.actor.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || null,
        approval_notes: null,
        updated_at: new Date().toISOString(),
      },
      {
        approval_status: 'rejected',
        approved_by: auth.actor.id,
        approved_at: new Date().toISOString(),
        rejection_reason: reason || null,
        approval_notes: null,
      },
    ];

    let execution: any = null;
    let updateError: any = null;
    for (const payload of updateCandidates) {
      const result = await supabase
        .from('charity_promise_executions')
        .update(payload)
        .eq('id', executionId)
        .select('*')
        .maybeSingle();
      if (!result.error) {
        execution = result.data;
        updateError = null;
        break;
      }
      updateError = result.error;
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
      break;
    }

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message || 'Failed to reject execution' }, { status: 500 });
    }
    if (!execution?.id) {
      return NextResponse.json({ ok: false, error: 'Execution not found' }, { status: 404 });
    }

    const promiseId = String(execution?.promise_id || '').trim();
    if (promiseId) {
      await updatePromiseStatusWithFallback(supabase, promiseId, 'active');
    }

    return NextResponse.json({ ok: true, execution });
  } catch (error) {
    console.error('[admin-charity-execution-reject] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}
