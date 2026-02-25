import { NextRequest } from 'next/server';

type AuditInput = {
  adminId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  description: string;
  metadata?: Record<string, unknown>;
};

export async function resolveAdminId(
  supabase: any,
  request?: NextRequest,
  explicitAdminId?: string | null
): Promise<string | null> {
  try {
    const { getAdminSessionTokenFromRequest, verifyAdminSessionToken } = await import('@/lib/admin-session');
    const claims = verifyAdminSessionToken(getAdminSessionTokenFromRequest(request as any));
    if (claims?.adminId) return String(claims.adminId);
  } catch {
    // fall through
  }

  const headerAdminId = String(
    request?.headers.get('x-admin-id') || request?.headers.get('x-admin-user-id') || ''
  ).trim();
  if (headerAdminId) return headerAdminId;

  const normalizedExplicit = String(explicitAdminId || '').trim();
  if (normalizedExplicit && normalizedExplicit === headerAdminId) return normalizedExplicit;

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const authEmail = String(user?.email || '').trim().toLowerCase();
    if (authEmail) {
      const { data: currentAdmin } = await supabase
        .from('admin_users')
        .select('id, is_active')
        .eq('email', authEmail)
        .maybeSingle();
      if (currentAdmin?.id && currentAdmin?.is_active !== false) {
        return String(currentAdmin.id);
      }
    }

    const { data: byAuthUserId } = await supabase
      .from('admin_users')
      .select('id, is_active')
      .eq('id', String(user?.id || ''))
      .maybeSingle();
    if (byAuthUserId?.id && byAuthUserId?.is_active !== false) {
      return String(byAuthUserId.id);
    }
  } catch {
    // fall through
  }

  return null;
}

export async function writeAdminAuditLog(supabase: any, input: AuditInput) {
  const payload = {
    admin_id: input.adminId,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    description: input.description,
    metadata: input.metadata || {},
  };

  const actionInsert = await supabase.from('activity_logs').insert({
    ...payload,
    action: input.action,
  });
  if (!actionInsert.error) return;

  await supabase.from('activity_logs').insert({
    ...payload,
    action_type: input.action,
  });
}
