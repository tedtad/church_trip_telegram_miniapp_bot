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
  const normalizedExplicit = String(explicitAdminId || '').trim();
  if (normalizedExplicit) return normalizedExplicit;

  const headerAdminId = String(
    request?.headers.get('x-admin-id') || request?.headers.get('x-admin-user-id') || ''
  ).trim();
  if (headerAdminId) return headerAdminId;

  const queryAdminId = String(request?.nextUrl.searchParams.get('adminId') || '').trim();
  if (queryAdminId) return queryAdminId;

  try {
    const { data: activeAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (activeAdmin?.id) return String(activeAdmin.id);

    const { data: anyAdmin } = await supabase
      .from('admin_users')
      .select('id')
      .limit(1)
      .maybeSingle();

    return anyAdmin?.id ? String(anyAdmin.id) : null;
  } catch {
    return null;
  }
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
