import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAdminAuditLog } from '@/lib/admin-audit';
import { generateQRCodeDataURL } from '@/lib/qr-code';
import { normalizeDiscountCode } from '@/lib/discount-vouchers';
import { requireAdminPermission } from '@/lib/admin-rbac';
import {
  ensureExistingTelegramUsers,
  parseTargetTelegramUserIds,
  replaceInvitationTargets,
} from '@/lib/invitation-targeting';

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

type InvitationTargetType = 'booking' | 'charity';
type InvitationTargetMode = 'public' | 'single' | 'bulk';

type CreateInvitationInput = {
  invitationCode?: string;
  target?: InvitationTargetType;
  targetType?: InvitationTargetType;
  tripId?: string | null;
  campaignId?: string | null;
  maxUses?: number | null;
  discountPercent?: number | null;
  validFrom?: string | null;
  expiresAt?: string | null;
  targetMode?: InvitationTargetMode;
  targetTelegramUserId?: number | string | null;
  targetTelegramUserIds?: Array<number | string> | string | null;
};

function parseDateOrNull(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeTargetType(input: unknown): InvitationTargetType {
  const value = String(input || '').trim().toLowerCase();
  return value === 'charity' ? 'charity' : 'booking';
}

function normalizeTargetMode(input: unknown): InvitationTargetMode {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'single') return 'single';
  if (value === 'bulk') return 'bulk';
  return 'public';
}

function isTripClosed(statusInput: unknown) {
  const status = String(statusInput || '').trim().toLowerCase();
  return ['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(status);
}

async function loadTripForInvitation(supabase: any, tripId: string) {
  const selectCandidates = [
    'id, name, destination, status, trip_status, departure_date',
    'id, name, destination, trip_status, departure_date',
    'id, name, destination, status, departure_date',
    'id, name, destination, status, trip_status',
    'id, name, destination',
    'id, name',
  ];

  for (const selectClause of selectCandidates) {
    const result = await supabase.from('trips').select(selectClause).eq('id', tripId).maybeSingle();
    if (!result.error) return result.data || null;
    if (
      isMissingColumn(result.error, 'status') ||
      isMissingColumn(result.error, 'trip_status') ||
      isMissingColumn(result.error, 'departure_date') ||
      isMissingColumn(result.error, 'destination')
    ) {
      continue;
    }
    throw result.error;
  }

  return null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as CreateInvitationInput;
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'invitations_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }
    const adminId = auth.actor.id;

    const target = normalizeTargetType(body.targetType || body.target);
    const targetMode = normalizeTargetMode(body.targetMode);
    const tripId = String(body.tripId || '').trim();
    const campaignId = String(body.campaignId || '').trim();

    const providedCode = normalizeDiscountCode(body.invitationCode);
    const invitationCode =
      providedCode ||
      `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    const maxUsesRaw = body.maxUses;
    const maxUses =
      maxUsesRaw === null || maxUsesRaw === undefined || Number(maxUsesRaw) <= 0
        ? null
        : Math.floor(Number(maxUsesRaw));

    const discountInput = body.discountPercent;
    const discountPercentRaw =
      discountInput === null || discountInput === undefined || String(discountInput).trim() === ''
        ? 0
        : Number(discountInput);
    const discountPercent = Number(discountPercentRaw.toFixed(2));

    const validFrom = parseDateOrNull(body.validFrom);
    const expiresAt = parseDateOrNull(body.expiresAt);

    if (!invitationCode) {
      return NextResponse.json({ success: false, error: 'Invitation code is required' }, { status: 400 });
    }
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent >= 100) {
      return NextResponse.json(
        { success: false, error: 'Discount percent must be from 0 to less than 100' },
        { status: 400 }
      );
    }
    if (validFrom && expiresAt && new Date(validFrom).getTime() >= new Date(expiresAt).getTime()) {
      return NextResponse.json(
        { success: false, error: 'Valid from date must be earlier than expiry date' },
        { status: 400 }
      );
    }

    let linkedTrip: any = null;
    let linkedCampaign: any = null;

    if (target === 'booking') {
      if (!tripId) {
        return NextResponse.json(
          { success: false, error: 'Active trip is required for booking invitation' },
          { status: 400 }
        );
      }
      linkedTrip = await loadTripForInvitation(supabase, tripId);
      if (!linkedTrip?.id) {
        return NextResponse.json({ success: false, error: 'Selected trip was not found' }, { status: 400 });
      }
      const status = String(linkedTrip.status ?? linkedTrip.trip_status ?? 'active').toLowerCase();
      if (isTripClosed(status)) {
        return NextResponse.json({ success: false, error: 'Selected trip is not active' }, { status: 400 });
      }
      const departure = linkedTrip.departure_date ? new Date(linkedTrip.departure_date) : null;
      if (departure && !Number.isNaN(departure.getTime()) && departure.getTime() < Date.now()) {
        return NextResponse.json(
          { success: false, error: 'Selected trip is already departed' },
          { status: 400 }
        );
      }
    } else {
      if (!campaignId) {
        return NextResponse.json(
          { success: false, error: 'Active charity campaign is required for charity invitation' },
          { status: 400 }
        );
      }
      const { data: campaign, error: campaignError } = await supabase
        .from('charity_campaigns')
        .select('id, name, status')
        .eq('id', campaignId)
        .maybeSingle();
      if (campaignError || !campaign) {
        return NextResponse.json(
          { success: false, error: 'Selected charity campaign was not found' },
          { status: 400 }
        );
      }
      if (String((campaign as any).status || 'active').trim().toLowerCase() !== 'active') {
        return NextResponse.json(
          { success: false, error: 'Selected charity campaign is not active' },
          { status: 400 }
        );
      }
      linkedCampaign = campaign;
    }

    const parsedTargetIds = parseTargetTelegramUserIds(
      targetMode === 'single'
        ? body.targetTelegramUserId
        : body.targetTelegramUserIds
    );

    let targetUserIds: number[] = [];
    if (targetMode === 'single') {
      if (parsedTargetIds.length !== 1) {
        return NextResponse.json(
          { success: false, error: 'Single target mode requires exactly one Telegram user id' },
          { status: 400 }
        );
      }
      targetUserIds = [parsedTargetIds[0]];
    } else if (targetMode === 'bulk') {
      if (!parsedTargetIds.length) {
        return NextResponse.json(
          { success: false, error: 'Bulk target mode requires one or more Telegram user ids' },
          { status: 400 }
        );
      }
      targetUserIds = parsedTargetIds;
    }

    if (targetUserIds.length) {
      const existing = await ensureExistingTelegramUsers(supabase, targetUserIds);
      if (!existing.ok) {
        return NextResponse.json(
          { success: false, error: existing.error || 'Some target users do not exist' },
          { status: 400 }
        );
      }
      targetUserIds = existing.ids;
    }

    const inviteParams = new URLSearchParams();
    inviteParams.set('target', target);
    if (target === 'booking' && tripId) inviteParams.set('tripId', tripId);
    if (target === 'charity' && campaignId) inviteParams.set('campaignId', campaignId);
    const inviteQuery = inviteParams.toString();
    const inviteURL = `${process.env.NEXT_PUBLIC_APP_URL || 'https://tickethub.app'}/invite/${invitationCode}${inviteQuery ? `?${inviteQuery}` : ''}`;

    const qrCode = await generateQRCodeDataURL(inviteURL);

    let createPayload: Record<string, unknown> = {
      invitation_code: invitationCode,
      qr_code_data: qrCode,
      qr_code_url: inviteURL,
      created_by: adminId,
      trip_id: target === 'booking' ? tripId : null,
      max_uses: maxUses,
      current_uses: 0,
      discount_percent: discountPercent,
      target,
      campaign_id: target === 'charity' ? campaignId : null,
      valid_from: validFrom,
      expires_at: expiresAt,
      is_active: true,
    };
    let createResult: any = null;

    for (let attempt = 0; attempt < 18; attempt += 1) {
      const result = await supabase.from('invitations').insert(createPayload).select().single();
      if (!result.error) {
        createResult = result;
        break;
      }

      if (isMissingColumn(result.error, 'qr_code_data') && 'qr_code_data' in createPayload) {
        delete createPayload.qr_code_data;
        continue;
      }
      if (isMissingColumn(result.error, 'qr_code_url') && 'qr_code_url' in createPayload) {
        delete createPayload.qr_code_url;
        continue;
      }
      if (isMissingColumn(result.error, 'discount_percent') && 'discount_percent' in createPayload) {
        delete createPayload.discount_percent;
        continue;
      }
      if (isMissingColumn(result.error, 'target') && 'target' in createPayload) {
        delete createPayload.target;
        continue;
      }
      if (isMissingColumn(result.error, 'campaign_id') && 'campaign_id' in createPayload) {
        delete createPayload.campaign_id;
        continue;
      }
      if (isMissingColumn(result.error, 'valid_from') && 'valid_from' in createPayload) {
        delete createPayload.valid_from;
        continue;
      }
      if (isMissingColumn(result.error, 'current_uses') && 'current_uses' in createPayload) {
        delete createPayload.current_uses;
        continue;
      }
      if (isMissingColumn(result.error, 'trip_id') && 'trip_id' in createPayload) {
        delete createPayload.trip_id;
        continue;
      }
      if (isMissingColumn(result.error, 'max_uses') && 'max_uses' in createPayload) {
        delete createPayload.max_uses;
        continue;
      }
      if (isMissingColumn(result.error, 'expires_at') && 'expires_at' in createPayload) {
        delete createPayload.expires_at;
        continue;
      }
      if (isMissingColumn(result.error, 'is_active') && 'is_active' in createPayload) {
        delete createPayload.is_active;
        continue;
      }
      throw result.error;
    }

    if (!createResult?.data) {
      throw new Error('Failed to create invitation');
    }

    if (targetUserIds.length) {
      const targetResult = await replaceInvitationTargets({
        supabase,
        invitationId: String(createResult.data.id || ''),
        telegramUserIds: targetUserIds,
      });
      if (!targetResult.ok) {
        if (targetResult.missingSchema) {
          await supabase
            .from('invitations')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', String(createResult.data.id || ''));
          return NextResponse.json(
            {
              success: false,
              error:
                'Targeted invitation schema is missing. Run scripts/18-invitation-targeting-and-linking.sql and retry.',
            },
            { status: 400 }
          );
        }
        return NextResponse.json(
          { success: false, error: targetResult.error || 'Failed to set invitation targets' },
          { status: 400 }
        );
      }
    }

    await writeAdminAuditLog(supabase, {
      adminId,
      action: 'INVITATION_CREATE',
      entityType: 'invitation',
      entityId: createResult.data?.id || null,
      description: `Created invitation ${invitationCode}`,
      metadata: {
        invitationId: createResult.data?.id || null,
        invitationCode,
        discountPercent,
        maxUses: createResult.data?.max_uses ?? maxUses,
        target,
        tripId: target === 'booking' ? tripId : null,
        campaignId: target === 'charity' ? campaignId : null,
        targetMode,
        targetUserCount: targetUserIds.length,
        validFrom,
        expiresAt,
        isActive: createResult.data?.is_active ?? true,
      },
    });

    return NextResponse.json({
      success: true,
      invite_url: inviteURL,
      targetMode,
      targetUserCount: targetUserIds.length,
      linkedTrip: linkedTrip
        ? {
            id: String(linkedTrip.id),
            name: String(linkedTrip.name || 'Trip'),
            destination: String(linkedTrip.destination || ''),
          }
        : null,
      linkedCampaign: linkedCampaign
        ? {
            id: String(linkedCampaign.id),
            name: String((linkedCampaign as any).name || 'Campaign'),
          }
        : null,
      invitation: createResult.data,
    });
  } catch (error) {
    console.error('[admin-invitations-create] Error:', error);
    const rawMessage = String((error as any)?.message || '').trim();
    const lower = rawMessage.toLowerCase();
    const errorMessage = lower.includes('row-level security')
      ? 'Database denied invitation creation. Ensure SUPABASE_SERVICE_ROLE_KEY is configured for admin APIs.'
      : rawMessage || 'Failed to create invitation';
    return NextResponse.json({ success: false, error: errorMessage }, { status: 500 });
  }
}

