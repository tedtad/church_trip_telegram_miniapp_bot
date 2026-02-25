import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeAdminRole, requireAdminPermission } from '@/lib/admin-rbac';
import { writeAdminAuditLog } from '@/lib/admin-audit';

function normalizeEmail(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

function normalizeName(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeAdminPayload(input: any) {
  return {
    id: String(input?.id || '').trim() || randomUUID(),
    email: normalizeEmail(input?.email),
    name: normalizeName(input?.name),
    role: normalizeAdminRole(input?.role),
    is_active: input?.is_active === false ? false : true,
  };
}

export async function GET(request: NextRequest) {
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

    const { data, error } = await supabase
      .from('admin_users')
      .select('id, email, name, role, is_active, created_at, last_login')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, users: data || [] });
  } catch (error) {
    console.error('[admin-users] GET error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to load admin users' }, { status: 500 });
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

    const body = await request.json().catch(() => ({}));
    const payload = normalizeAdminPayload(body);
    if (!payload.email) {
      return NextResponse.json({ ok: false, error: 'Email is required' }, { status: 400 });
    }
    if (!payload.name) {
      return NextResponse.json({ ok: false, error: 'Name is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('admin_users')
      .insert(payload)
      .select('id, email, name, role, is_active, created_at, last_login')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_USER_CREATE',
      entityType: 'admin_user',
      entityId: data.id,
      description: `Created admin user ${data.email}`,
      metadata: {
        role: data.role,
        isActive: data.is_active,
      },
    });

    return NextResponse.json({ ok: true, user: data }, { status: 201 });
  } catch (error) {
    console.error('[admin-users] POST error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to create admin user' }, { status: 500 });
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

    const body = await request.json().catch(() => ({}));
    const id = String(body?.id || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if ('name' in body) updatePayload.name = normalizeName(body?.name);
    if ('email' in body) updatePayload.email = normalizeEmail(body?.email);
    if ('role' in body) updatePayload.role = normalizeAdminRole(body?.role);
    if ('is_active' in body) updatePayload.is_active = Boolean(body?.is_active);
    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('admin_users')
      .update(updatePayload)
      .eq('id', id)
      .select('id, email, name, role, is_active, created_at, last_login')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_USER_UPDATE',
      entityType: 'admin_user',
      entityId: data.id,
      description: `Updated admin user ${data.email}`,
      metadata: updatePayload,
    });

    return NextResponse.json({ ok: true, user: data });
  } catch (error) {
    console.error('[admin-users] PATCH error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to update admin user' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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

    const id = String(request.nextUrl.searchParams.get('id') || '').trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('admin_users')
      .update({ is_active: false })
      .eq('id', id)
      .select('id, email, name, role, is_active')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_USER_DEACTIVATE',
      entityType: 'admin_user',
      entityId: data.id,
      description: `Deactivated admin user ${data.email}`,
    });

    return NextResponse.json({ ok: true, user: data });
  } catch (error) {
    console.error('[admin-users] DELETE error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to deactivate admin user' }, { status: 500 });
  }
}
