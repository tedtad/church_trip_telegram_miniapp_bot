import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ADMIN_PERMISSIONS,
  getAdminPermissionsForRole,
  listRbacConfig,
  normalizeAdminRole,
  requireAdminPermission,
} from '@/lib/admin-rbac';
import { writeAdminAuditLog } from '@/lib/admin-audit';

function normalizeRoleCode(input: unknown) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, '');
}

function normalizeRoleName(input: unknown, fallbackCode: string) {
  const value = String(input || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (value) return value;
  return fallbackCode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function asUniquePermissionCodes(input: unknown) {
  const list = Array.isArray(input) ? input : [];
  const unique = new Set<string>();
  for (const item of list) {
    const code = String(item || '').trim();
    if (!code) continue;
    unique.add(code);
  }
  return [...unique];
}

async function ensureRbacSchemaAvailable(supabase: any) {
  const probe = await supabase.from('admin_roles').select('code').limit(1);
  return !probe.error;
}

async function resolveRolePermissionsForActor(supabase: any, actorRole: string) {
  const config = await listRbacConfig(supabase);
  if (config.source === 'schema') {
    return config.rolePermissions[actorRole] || [];
  }
  return [...getAdminPermissionsForRole(actorRole)];
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'dashboard_view',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const config = await listRbacConfig(supabase);
    const actorRole = normalizeAdminRole(auth.actor.role);
    const myPermissions = await resolveRolePermissionsForActor(supabase, actorRole);

    return NextResponse.json({
      ok: true,
      source: config.source,
      roles: config.roles,
      permissions: config.permissions,
      rolePermissions: config.rolePermissions,
      me: {
        role: actorRole,
        permissions: myPermissions,
        isSystemAdmin: actorRole === 'system_admin',
      },
    });
  } catch (error) {
    console.error('[admin-rbac] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load RBAC config' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'admin_users_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const actorRole = normalizeAdminRole(auth.actor.role);
    if (actorRole !== 'system_admin') {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can create roles' },
        { status: 403 }
      );
    }

    if (!(await ensureRbacSchemaAvailable(supabase))) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'RBAC schema is not installed. Run scripts/17-admin-rbac-schema-and-seed.sql first.',
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const roleCode = normalizeRoleCode(body?.code);
    const roleName = normalizeRoleName(body?.name, roleCode);
    const description = String(body?.description || '').trim() || null;
    const requestedPermissions = asUniquePermissionCodes(body?.permissionCodes);
    const cloneFromRole = normalizeRoleCode(body?.cloneFromRole);

    if (!roleCode) {
      return NextResponse.json({ ok: false, error: 'Role code is required' }, { status: 400 });
    }
    if (!roleName) {
      return NextResponse.json({ ok: false, error: 'Role name is required' }, { status: 400 });
    }

    const roleUpsert = await supabase
      .from('admin_roles')
      .upsert(
        {
          code: roleCode,
          name: roleName,
          description,
          is_system: false,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'code' }
      )
      .select('code, name, description, is_system, is_active')
      .single();
    if (roleUpsert.error) throw roleUpsert.error;

    let finalPermissions = requestedPermissions;
    if (!finalPermissions.length && cloneFromRole) {
      const clone = await supabase
        .from('admin_role_permissions')
        .select('permission_code, is_allowed')
        .eq('role_code', cloneFromRole);
      if (!clone.error) {
        finalPermissions = ((clone.data || []) as Array<any>)
          .filter((row) => row.is_allowed !== false)
          .map((row) => String(row.permission_code || '').trim())
          .filter(Boolean);
      }
    }

    const allowedPermissionSet = new Set<string>(ADMIN_PERMISSIONS as string[]);
    const unknown = finalPermissions.filter((code) => !allowedPermissionSet.has(code));
    if (unknown.length) {
      return NextResponse.json(
        { ok: false, error: `Unknown permissions: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    await supabase.from('admin_role_permissions').delete().eq('role_code', roleCode);
    if (finalPermissions.length) {
      const insert = await supabase.from('admin_role_permissions').insert(
        finalPermissions.map((permissionCode) => ({
          role_code: roleCode,
          permission_code: permissionCode,
          is_allowed: true,
        }))
      );
      if (insert.error) throw insert.error;
    }

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_RBAC_ROLE_CREATE',
      entityType: 'admin_role',
      entityId: roleCode,
      description: `Created role ${roleCode}`,
      metadata: {
        roleCode,
        permissionCount: finalPermissions.length,
      },
    });

    return NextResponse.json({ ok: true, role: roleUpsert.data });
  } catch (error) {
    console.error('[admin-rbac] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to create role' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'admin_users_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const actorRole = normalizeAdminRole(auth.actor.role);
    if (actorRole !== 'system_admin') {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can update role permissions' },
        { status: 403 }
      );
    }

    if (!(await ensureRbacSchemaAvailable(supabase))) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'RBAC schema is not installed. Run scripts/17-admin-rbac-schema-and-seed.sql first.',
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const roleCode = normalizeRoleCode(body?.roleCode);
    const permissionCodes = asUniquePermissionCodes(body?.permissionCodes);
    if (!roleCode) {
      return NextResponse.json({ ok: false, error: 'roleCode is required' }, { status: 400 });
    }

    const roleLookup = await supabase
      .from('admin_roles')
      .select('code, is_system, is_active')
      .eq('code', roleCode)
      .maybeSingle();
    if (roleLookup.error) throw roleLookup.error;
    if (!roleLookup.data) {
      return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 });
    }
    if (roleLookup.data.is_active === false) {
      return NextResponse.json({ ok: false, error: 'Role is inactive' }, { status: 400 });
    }

    const allowedPermissionSet = new Set<string>(ADMIN_PERMISSIONS as string[]);
    const unknown = permissionCodes.filter((code) => !allowedPermissionSet.has(code));
    if (unknown.length) {
      return NextResponse.json(
        { ok: false, error: `Unknown permissions: ${unknown.join(', ')}` },
        { status: 400 }
      );
    }

    await supabase.from('admin_role_permissions').delete().eq('role_code', roleCode);
    if (permissionCodes.length) {
      const insert = await supabase.from('admin_role_permissions').insert(
        permissionCodes.map((permissionCode) => ({
          role_code: roleCode,
          permission_code: permissionCode,
          is_allowed: true,
        }))
      );
      if (insert.error) throw insert.error;
    }

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_RBAC_ROLE_PERMISSIONS_UPDATE',
      entityType: 'admin_role',
      entityId: roleCode,
      description: `Updated role-permission mapping for ${roleCode}`,
      metadata: {
        roleCode,
        permissionCodes,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[admin-rbac] PUT error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update role permissions' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'admin_users_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const actorRole = normalizeAdminRole(auth.actor.role);
    if (actorRole !== 'system_admin') {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can update roles' },
        { status: 403 }
      );
    }

    if (!(await ensureRbacSchemaAvailable(supabase))) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'RBAC schema is not installed. Run scripts/17-admin-rbac-schema-and-seed.sql first.',
        },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const roleCode = normalizeRoleCode(body?.roleCode);
    if (!roleCode) {
      return NextResponse.json({ ok: false, error: 'roleCode is required' }, { status: 400 });
    }

    const current = await supabase
      .from('admin_roles')
      .select('code, is_system')
      .eq('code', roleCode)
      .maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) {
      return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 });
    }

    if (current.data.is_system && 'isActive' in body && body?.isActive === false) {
      return NextResponse.json(
        { ok: false, error: 'System roles cannot be deactivated' },
        { status: 400 }
      );
    }

    const payload: Record<string, unknown> = {};
    if ('name' in body) payload.name = normalizeRoleName(body?.name, roleCode);
    if ('description' in body) payload.description = String(body?.description || '').trim() || null;
    if ('isActive' in body) payload.is_active = Boolean(body?.isActive);
    if (!Object.keys(payload).length) {
      return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 });
    }

    const update = await supabase
      .from('admin_roles')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('code', roleCode)
      .select('code, name, description, is_system, is_active')
      .single();
    if (update.error) throw update.error;

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_RBAC_ROLE_UPDATE',
      entityType: 'admin_role',
      entityId: roleCode,
      description: `Updated role ${roleCode}`,
      metadata: payload,
    });

    return NextResponse.json({ ok: true, role: update.data });
  } catch (error) {
    console.error('[admin-rbac] PATCH error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update role' }, { status: 500 });
  }
}
