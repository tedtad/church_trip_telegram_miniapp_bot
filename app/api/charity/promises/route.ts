import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { verifyTelegramMiniAppInitData } from '@/lib/telegram-miniapp';
import { normalizeDiscountCode } from '@/lib/discount-vouchers';
import { getMiniAppMaintenanceMessage, getMiniAppRuntimeSettings } from '@/lib/miniapp-access';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const MAX_AGE_SECONDS = Number(process.env.TELEGRAM_MINIAPP_MAX_AGE_SEC || 60 * 60 * 24);

type InvitationRow = {
  id: string;
  max_uses?: number | null;
  current_uses?: number | null;
  used_count?: number | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean | null;
};

function normalizePhone(raw: unknown) {
  return String(raw || '').trim().replace(/[^\d+]/g, '');
}

function normalizePromiseType(raw: unknown) {
  return String(raw || '')
    .trim()
    .toLowerCase() === 'in_kind'
    ? 'in_kind'
    : 'cash';
}

function parseDueDate(raw: unknown) {
  const text = String(raw || '').trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function resolveInitData(request: NextRequest) {
  return String(
    request.headers.get('x-telegram-init-data') ||
      request.nextUrl.searchParams.get('initData') ||
      ''
  ).trim();
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

async function loadInvitationByCode(supabase: any, invitationCode: string): Promise<InvitationRow | null> {
  const selectCandidates = [
    'id, max_uses, current_uses, used_count, valid_from, expires_at, is_active',
    'id, max_uses, current_uses, used_count, expires_at, is_active',
    'id, max_uses, current_uses, used_count, expires_at',
    'id, max_uses, current_uses, used_count',
    'id, max_uses, current_uses',
    'id',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await supabase
      .from('invitations')
      .select(selectClause)
      .ilike('invitation_code', invitationCode)
      .limit(1)
      .maybeSingle();

    if (!error) return (data || null) as InvitationRow | null;
    if (
      isMissingColumn(error, 'valid_from') ||
      isMissingColumn(error, 'expires_at') ||
      isMissingColumn(error, 'is_active') ||
      isMissingColumn(error, 'current_uses') ||
      isMissingColumn(error, 'used_count') ||
      isMissingColumn(error, 'max_uses')
    ) {
      continue;
    }
  }

  return null;
}

async function insertPromiseWithFallback(supabase: any, payload: Record<string, unknown>) {
  let working = { ...payload };
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const result = await supabase.from('charity_promises').insert(working).select('*').single();
    if (!result.error) return result.data || null;

    const missingCandidates = [
      'donor_phone',
      'promise_type',
      'pledged_amount',
      'item_description',
      'reference_note',
      'due_at',
      'reminder_days_before',
      'status',
      'invitation_code',
      'invitation_id',
      'updated_at',
    ];
    const missing = missingCandidates.find((column) => isMissingColumn(result.error, column));
    if (!missing || !(missing in working)) break;
    delete (working as any)[missing];
  }
  return null;
}

export async function GET(request: NextRequest) {
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

    const initData = resolveInitData(request);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, message: 'Unauthorized mini app session' }, { status: 401 });
    }

    const campaignId = String(request.nextUrl.searchParams.get('campaignId') || '').trim();
    let query = supabase
      .from('charity_promises')
      .select('*')
      .eq('telegram_user_id', auth.user.id)
      .order('created_at', { ascending: false })
      .limit(200);

    if (campaignId) query = query.eq('campaign_id', campaignId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, promises: data || [] });
  } catch (error) {
    console.error('[charity-promises] GET error:', error);
    return NextResponse.json({ ok: false, message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    const initData = resolveInitData(request);
    const auth = verifyTelegramMiniAppInitData(initData, TELEGRAM_BOT_TOKEN, MAX_AGE_SECONDS);
    if (!auth) {
      return NextResponse.json({ ok: false, message: 'Unauthorized mini app session' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const campaignId = String(body?.campaignId || '').trim();
    const donorNameInput = String(body?.donorName || '').trim();
    const donorPhone = normalizePhone(body?.donorPhone);
    const promiseType = normalizePromiseType(body?.promiseType);
    const pledgedAmountRaw = Number(body?.pledgedAmount || 0);
    const pledgedAmount =
      Number.isFinite(pledgedAmountRaw) && pledgedAmountRaw > 0
        ? Number(pledgedAmountRaw.toFixed(2))
        : null;
    const itemDescription = String(body?.itemDescription || '').trim();
    const referenceNote = String(body?.referenceNote || '').trim();
    const dueAt = parseDueDate(body?.dueAt);
    const reminderDaysBeforeRaw = Number(body?.reminderDaysBefore ?? 1);
    const reminderDaysBefore =
      Number.isFinite(reminderDaysBeforeRaw) && reminderDaysBeforeRaw >= 0
        ? Math.floor(reminderDaysBeforeRaw)
        : 1;
    const invitationCode = normalizeDiscountCode(body?.invitationCode);
    let invitationId: string | null = null;

    if (!campaignId) {
      return NextResponse.json({ ok: false, message: 'Campaign is required' }, { status: 400 });
    }
    if (promiseType === 'cash' && !pledgedAmount) {
      return NextResponse.json({ ok: false, message: 'Pledged amount is required for cash promise' }, { status: 400 });
    }
    if (promiseType === 'in_kind' && !itemDescription) {
      return NextResponse.json({ ok: false, message: 'In-kind details are required' }, { status: 400 });
    }

    const { data: campaign } = await supabase
      .from('charity_campaigns')
      .select('id, status')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaign || String(campaign.status || 'active').toLowerCase() !== 'active') {
      return NextResponse.json({ ok: false, message: 'Campaign is not available' }, { status: 400 });
    }

    if (invitationCode) {
      const invitation = await loadInvitationByCode(supabase, invitationCode);
      if (!invitation?.id) {
        return NextResponse.json({ ok: false, message: 'Invitation code not found' }, { status: 400 });
      }
      if (invitation.is_active === false) {
        return NextResponse.json({ ok: false, message: 'Invitation code is inactive' }, { status: 400 });
      }
      if (invitation.valid_from) {
        const validFrom = new Date(invitation.valid_from);
        if (!Number.isNaN(validFrom.getTime()) && Date.now() < validFrom.getTime()) {
          return NextResponse.json({ ok: false, message: 'Invitation code is not active yet' }, { status: 400 });
        }
      }
      if (invitation.expires_at) {
        const expiresAt = new Date(invitation.expires_at);
        if (!Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
          return NextResponse.json({ ok: false, message: 'Invitation code has expired' }, { status: 400 });
        }
      }
      invitationId = invitation.id;
    }

    const donorName =
      donorNameInput ||
      [String(auth.user.first_name || ''), String(auth.user.last_name || '')].filter(Boolean).join(' ').trim() ||
      'Telegram Donor';

    await supabase.from('telegram_users').upsert(
      {
        id: auth.user.id,
        first_name: auth.user.first_name || donorName.split(' ')[0] || 'Telegram',
        last_name: auth.user.last_name || null,
        username: auth.user.username || null,
        phone_number: donorPhone || null,
        language_code: auth.user.language_code === 'en' ? 'en' : 'am',
        last_activity: new Date().toISOString(),
        last_interaction: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    const promise = await insertPromiseWithFallback(supabase, {
      campaign_id: campaignId,
      telegram_user_id: auth.user.id,
      donor_name: donorName,
      donor_phone: donorPhone || null,
      promise_type: promiseType,
      pledged_amount: pledgedAmount,
      item_description: itemDescription || null,
      reference_note: referenceNote || null,
      due_at: dueAt,
      reminder_days_before: reminderDaysBefore,
      status: 'pending',
      invitation_code: invitationCode || null,
      invitation_id: invitationId,
      updated_at: new Date().toISOString(),
    });

    if (!promise?.id) {
      return NextResponse.json({ ok: false, message: 'Failed to create promise' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, promise });
  } catch (error) {
    console.error('[charity-promises] POST error:', error);
    return NextResponse.json({ ok: false, message: 'Internal server error' }, { status: 500 });
  }
}
