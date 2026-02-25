import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);

type CharityPromiseRow = {
  id: string;
  campaign_id?: string | null;
  telegram_user_id?: number | null;
  promise_type?: string | null;
  pledged_amount?: number | null;
  item_description?: string | null;
  status?: string | null;
};

function resolveInitData(request: NextRequest, body: any) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      body?.initData ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

async function loadPromiseById(supabase: any, promiseId: string): Promise<CharityPromiseRow | null> {
  const selectCandidates = [
    'id, campaign_id, telegram_user_id, promise_type, pledged_amount, item_description, status',
    'id, campaign_id, telegram_user_id, promise_type, pledged_amount, item_description',
    'id, campaign_id, telegram_user_id, promise_type',
    'id, campaign_id, telegram_user_id',
    'id, campaign_id',
    'id',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await supabase
      .from('charity_promises')
      .select(selectClause)
      .eq('id', promiseId)
      .maybeSingle();
    if (!error) return (data || null) as CharityPromiseRow | null;
    if (
      isMissingColumn(error, 'status') ||
      isMissingColumn(error, 'item_description') ||
      isMissingColumn(error, 'pledged_amount') ||
      isMissingColumn(error, 'promise_type') ||
      isMissingColumn(error, 'telegram_user_id') ||
      isMissingColumn(error, 'campaign_id')
    ) {
      continue;
    }
  }
  return null;
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

async function findExistingPendingExecution(supabase: any, promiseId: string) {
  const selectCandidates = [
    'id, approval_status, execution_type, created_at',
    'id, approval_status, execution_type',
    'id, approval_status',
    'id',
  ];
  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from('charity_promise_executions')
      .select(selectClause)
      .eq('promise_id', promiseId)
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!result.error) return result.data || null;
    if (
      isMissingColumn(result.error, 'approval_status') ||
      isMissingColumn(result.error, 'execution_type') ||
      isMissingColumn(result.error, 'created_at')
    ) {
      continue;
    }
    return null;
  }
  return null;
}

async function insertExecutionWithFallback(supabase: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await supabase.from('charity_promise_executions').insert(working).select('*').single();
    if (!result.error) return result.data || null;

    const missingCandidates = [
      'campaign_id',
      'telegram_user_id',
      'execution_type',
      'in_kind_details',
      'in_kind_estimated_value',
      'notes',
      'approval_status',
      'updated_at',
    ];
    const missing = missingCandidates.find((column) => isMissingColumn(result.error, column));
    if (!missing || !(missing in working)) break;
    delete (working as any)[missing];
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createAdminClient();
    const appSettings = await getMiniAppRuntimeSettings(supabase);
    if (appSettings.maintenanceMode) {
      return NextResponse.json(
        { ok: false, message: getMiniAppMaintenanceMessage(appSettings) },
        { status: 503 }
      );
    }
    if (!appSettings.charityEnabled) {
      return NextResponse.json({ ok: false, message: 'Charity module is currently disabled.' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const initData = resolveInitData(request, body);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, message: 'Unauthorized mini app session' }, { status: 401 });
    }

    const promiseId = String(params?.id || '').trim();
    if (!promiseId) {
      return NextResponse.json({ ok: false, message: 'Promise id is required' }, { status: 400 });
    }

    const promise = await loadPromiseById(supabase, promiseId);
    if (!promise?.id) {
      return NextResponse.json({ ok: false, message: 'Promise not found' }, { status: 404 });
    }

    const ownerId = Number(promise.telegram_user_id || 0);
    if (ownerId && ownerId !== Number(auth.user.id)) {
      return NextResponse.json({ ok: false, message: 'Promise ownership mismatch' }, { status: 403 });
    }

    const status = String(promise.status || '').trim().toLowerCase();
    if (['fulfilled', 'cancelled'].includes(status)) {
      return NextResponse.json({ ok: false, message: 'Promise is already closed' }, { status: 400 });
    }

    const promiseType = String(promise.promise_type || 'cash').trim().toLowerCase() === 'in_kind' ? 'in_kind' : 'cash';
    if (promiseType === 'cash') {
      return NextResponse.json({
        ok: true,
        mode: 'cash',
        message: 'Proceed with normal donation flow for this promise.',
        promise: {
          id: promise.id,
          campaignId: String(promise.campaign_id || '').trim(),
          pledgedAmount: Number(promise.pledged_amount || 0) || null,
        },
      });
    }

    const existingPending = await findExistingPendingExecution(supabase, promise.id);
    if (existingPending?.id) {
      return NextResponse.json({
        ok: true,
        mode: 'in_kind',
        message: 'Promise execution is already pending approval.',
        execution: existingPending,
      });
    }

    const details = String(body?.inKindDetails || body?.details || promise.item_description || '').trim();
    const estimateRaw = Number(body?.estimatedValue || 0);
    const estimatedValue =
      Number.isFinite(estimateRaw) && estimateRaw > 0 ? Number(estimateRaw.toFixed(2)) : null;
    const notes = String(body?.notes || '').trim();

    if (!details) {
      return NextResponse.json({ ok: false, message: 'In-kind execution details are required' }, { status: 400 });
    }

    const execution = await insertExecutionWithFallback(supabase, {
      promise_id: promise.id,
      campaign_id: String(promise.campaign_id || '').trim() || null,
      telegram_user_id: auth.user.id,
      execution_type: 'in_kind_submission',
      in_kind_details: details,
      in_kind_estimated_value: estimatedValue,
      notes: notes || null,
      approval_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    if (!execution?.id) {
      return NextResponse.json({ ok: false, message: 'Failed to submit in-kind execution' }, { status: 500 });
    }

    await updatePromiseStatusWithFallback(supabase, promise.id, 'executed');
    return NextResponse.json({
      ok: true,
      mode: 'in_kind',
      message: 'In-kind execution submitted for admin approval.',
      execution,
    });
  } catch (error) {
    console.error('[charity-promise-execute] POST error:', error);
    return NextResponse.json({ ok: false, message: 'Internal server error' }, { status: 500 });
  }
}
