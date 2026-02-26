import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { writeAdminAuditLog } from '@/lib/admin-audit';
import { requireAdminPermission } from '@/lib/admin-rbac';

function detectMissingColumn(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  if (!message.toLowerCase().includes('column')) return null;

  const quoted = message.match(/'([a-zA-Z0-9_.]+)'/);
  if (quoted?.[1]) return quoted[1].split('.').pop() || null;

  const doubleQuoted = message.match(/"([a-zA-Z0-9_.]+)"/);
  if (doubleQuoted?.[1]) return doubleQuoted[1].split('.').pop() || null;
  return null;
}

function isRelationshipLookupError(error: unknown) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('relationship') || message.includes('foreign key');
}

async function loadInvitationsWithFallback(supabase: any, statusFilter: string) {
  const selectCandidates = [
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, discount_percent, valid_from, expires_at, is_active, qr_code_data, qr_code_url, created_at, trip:trips(id, name, destination, status, departure_date), campaign:charity_campaigns(id, name, status)',
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, discount_percent, valid_from, expires_at, is_active, qr_code_data, qr_code_url, created_at, trip:trips(id, name, destination), campaign:charity_campaigns(id, name)',
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, discount_percent, valid_from, expires_at, is_active, qr_code_data, qr_code_url, created_at',
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, discount_percent, expires_at, is_active, qr_code_data, qr_code_url, created_at',
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, expires_at, is_active, qr_code_data, qr_code_url, created_at',
    'id, invitation_code, target, trip_id, campaign_id, max_uses, current_uses, used_count, expires_at, is_active, created_at',
    'id, invitation_code, trip_id, campaign_id, max_uses, current_uses, used_count, expires_at, is_active, created_at',
    'id, invitation_code, trip_id, max_uses, current_uses, used_count, expires_at, is_active, created_at',
    '*',
  ];

  for (const selectClause of selectCandidates) {
    let query = supabase.from('invitations').select(selectClause).order('created_at', { ascending: false }).limit(300);
    if (statusFilter === 'active') {
      query = query.eq('is_active', true);
    } else if (statusFilter === 'inactive') {
      query = query.eq('is_active', false);
    }

    const { data, error } = await query;
    if (!error) return data || [];

    const missing = detectMissingColumn(error);
    if (!missing && !isRelationshipLookupError(error)) break;
  }

  throw new Error('Failed to fetch invitations');
}

function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('relation') &&
    message.includes(relationName.toLowerCase()) &&
    message.includes('does not exist')
  );
}

async function loadInvitationTargetCounts(supabase: any, invitationIds: string[]) {
  const unique = [...new Set(invitationIds.filter(Boolean))];
  if (!unique.length) return {} as Record<string, number>;

  const { data, error } = await supabase
    .from('invitation_target_users')
    .select('invitation_id')
    .in('invitation_id', unique);
  if (error) {
    if (isMissingRelation(error, 'invitation_target_users')) {
      return {} as Record<string, number>;
    }
    throw error;
  }

  const counts: Record<string, number> = {};
  for (const row of (data || []) as Array<{ invitation_id?: string | null }>) {
    const invitationId = String(row?.invitation_id || '').trim();
    if (!invitationId) continue;
    counts[invitationId] = (counts[invitationId] || 0) + 1;
  }
  return counts;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'invitations_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, success: false, error: auth.error }, { status: auth.status });
    }
    const statusFilter = String(request.nextUrl.searchParams.get('status') || 'all')
      .trim()
      .toLowerCase();
    const invitations = await loadInvitationsWithFallback(supabase, statusFilter);
    const targetCounts = await loadInvitationTargetCounts(
      supabase,
      (invitations || []).map((inv: any) => String(inv?.id || ''))
    );
    const hydratedInvitations = (invitations || []).map((inv: any) => {
      const invitationId = String(inv?.id || '');
      const targetUserCount = targetCounts[invitationId] || 0;
      const targetMode = targetUserCount <= 0 ? 'public' : targetUserCount === 1 ? 'single' : 'bulk';
      return {
        ...inv,
        target_user_count: targetUserCount,
        target_mode: targetMode,
      };
    });

    return NextResponse.json({
      ok: true,
      success: true,
      invitations: hydratedInvitations,
    });
  } catch (error) {
    console.error('[admin-invitations] GET error:', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to fetch invitations' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const invitationId = request.nextUrl.searchParams.get('id');
    if (!invitationId) {
      return NextResponse.json(
        { ok: false, success: false, error: 'Missing invitation id' },
        { status: 400 }
      );
    }

    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'invitations_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, success: false, error: auth.error }, { status: auth.status });
    }
    const adminId = auth.actor.id;
    const { data: invitation } = await supabase
      .from('invitations')
      .select('id, invitation_code, is_active, current_uses, used_count, max_uses')
      .eq('id', invitationId)
      .maybeSingle();

    const { error } = await supabase
      .from('invitations')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', invitationId);

    if (error) throw error;

    await writeAdminAuditLog(supabase, {
      adminId,
      action: 'INVITATION_DEACTIVATE',
      entityType: 'invitation',
      entityId: invitationId,
      description: `Deactivated invitation ${invitation?.invitation_code || invitationId}`,
      metadata: {
        invitationId,
        invitationCode: invitation?.invitation_code || null,
        previousIsActive: invitation?.is_active ?? null,
        usedCount: invitation?.current_uses ?? invitation?.used_count ?? null,
        maxUses: invitation?.max_uses ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      success: true,
      id: invitationId,
    });
  } catch (error) {
    console.error('[admin-invitations] DELETE error:', error);
    return NextResponse.json(
      { ok: false, success: false, error: 'Failed to delete invitation' },
      { status: 500 }
    );
  }
}
