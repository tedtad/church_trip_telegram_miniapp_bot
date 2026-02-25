import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeAdminRole, requireAdminPermission } from '@/lib/admin-rbac';
import { writeAdminAuditLog } from '@/lib/admin-audit';
import {
  ONBOARDING_MAX_ATTEMPTS,
  ONBOARDING_OTP_TTL_SECONDS,
  buildOnboardingTelegramMessage,
  generateOnboardingOtp,
  generateOnboardingToken,
  hashOnboardingOtp,
} from '@/lib/admin-onboarding';

type OnboardingPayload = {
  token: string;
  otp: string;
  expiresAt: string;
  expiresInSeconds: number;
  message: string;
  botStartLink: string;
  telegramShareLink: string;
};

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

function normalizePhone(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/[^\d+]/g, '');
}

function normalizeAdminPayload(input: any) {
  const telegramUserIdRaw = String(input?.telegram_user_id ?? input?.telegramUserId ?? '').trim();
  const telegramUserId = telegramUserIdRaw ? Number(telegramUserIdRaw) : null;
  return {
    id: String(input?.id || '').trim() || randomUUID(),
    email: normalizeEmail(input?.email),
    name: normalizeName(input?.name),
    phone_number: normalizePhone(input?.phone_number ?? input?.phoneNumber),
    role: normalizeAdminRole(input?.role),
    is_active: input?.is_active === false ? false : true,
    telegram_user_id: Number.isFinite(telegramUserId) ? telegramUserId : null,
    two_factor_enabled: input?.two_factor_enabled === false ? false : true,
  };
}

function isSystemAdminRole(role: unknown) {
  return normalizeAdminRole(role) === 'system_admin';
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('relation') && message.includes(relationName.toLowerCase()) && message.includes('does not exist');
}

function isConflictError(error: unknown) {
  const code = String((error as any)?.code || '').trim();
  const message = String((error as any)?.message || '').toLowerCase();
  return code === '23505' || message.includes('already registered') || message.includes('already exists') || message.includes('duplicate key');
}

function generateTemporaryAuthPassword() {
  return `Tmp#${randomUUID().replace(/-/g, '').slice(0, 18)}A!`;
}

function validateNewPassword(password: string) {
  const value = String(password || '');
  if (value.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter.';
  if (!/\d/.test(value)) return 'Password must contain at least one number.';
  return '';
}

async function countOtherActiveSystemAdmins(supabase: any, excludeId: string) {
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, role, is_active')
    .neq('id', excludeId)
    .eq('is_active', true);
  if (error) return 0;
  const rows = (data || []) as Array<{ role?: string }>;
  return rows.filter((row) => isSystemAdminRole(row.role)).length;
}

async function listAdminUsersWithFallback(supabase: any) {
  const fullSelect =
    'id, email, name, phone_number, role, is_active, telegram_user_id, two_factor_enabled, created_at, last_login';
  const full = await supabase
    .from('admin_users')
    .select(fullSelect)
    .order('created_at', { ascending: false });
  if (!full.error) return full.data || [];

  const recoverable =
    isMissingColumn(full.error, 'telegram_user_id') ||
    isMissingColumn(full.error, 'two_factor_enabled') ||
    isMissingColumn(full.error, 'phone_number');
  if (!recoverable) {
    throw full.error;
  }

  const fallback = await supabase
    .from('admin_users')
    .select('id, email, name, role, is_active, created_at, last_login')
    .order('created_at', { ascending: false });
  if (fallback.error) throw fallback.error;

  return (fallback.data || []).map((row: any) => ({
    ...row,
    phone_number: '',
    telegram_user_id: null,
    two_factor_enabled: true,
  }));
}

async function findAuthUserByEmail(supabase: any, email: string) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;

  for (let page = 1; page <= 25; page += 1) {
    const result = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (result.error) throw result.error;
    const users = result.data?.users || [];
    const match = users.find((user: any) => normalizeEmail(user?.email) === normalizedEmail);
    if (match) return match;
    if (users.length < 200) break;
  }

  return null;
}

async function ensureAuthUserForAdmin(supabase: any, input: {
  email: string;
  name: string;
  role: string;
}) {
  const tempPassword = generateTemporaryAuthPassword();
  const create = await supabase.auth.admin.createUser({
    email: input.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      display_name: input.name,
      role: input.role,
    },
  });

  if (!create.error && create.data?.user?.id) {
    return {
      userId: String(create.data.user.id),
      tempPassword,
      created: true,
    };
  }

  if (!isConflictError(create.error)) {
    throw create.error;
  }

  const existing = await findAuthUserByEmail(supabase, input.email);
  if (!existing?.id) {
    throw create.error || new Error('Unable to resolve existing auth user');
  }

  await supabase.auth.admin.updateUserById(String(existing.id), {
    password: tempPassword,
    user_metadata: {
      display_name: input.name,
      role: input.role,
    },
  });

  return {
    userId: String(existing.id),
    tempPassword,
    created: false,
  };
}

async function upsertAdminUserWithFallback(supabase: any, payload: Record<string, unknown>) {
  const selectClause =
    'id, email, name, phone_number, role, is_active, telegram_user_id, two_factor_enabled, created_at, last_login';

  let workingPayload: Record<string, unknown> = { ...payload };
  let lastError: any = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase
      .from('admin_users')
      .upsert(workingPayload, { onConflict: 'email' })
      .select(selectClause)
      .single();

    if (!result.error) {
      return result.data;
    }

    lastError = result.error;
    if (isMissingColumn(lastError, 'telegram_user_id') && 'telegram_user_id' in workingPayload) {
      delete workingPayload.telegram_user_id;
      continue;
    }
    if (isMissingColumn(lastError, 'two_factor_enabled') && 'two_factor_enabled' in workingPayload) {
      delete workingPayload.two_factor_enabled;
      continue;
    }
    if (isMissingColumn(lastError, 'phone_number') && 'phone_number' in workingPayload) {
      delete workingPayload.phone_number;
      continue;
    }

    break;
  }

  throw lastError;
}

async function updateAdminUserWithFallback(
  supabase: any,
  id: string,
  payload: Record<string, unknown>
) {
  const selectClause =
    'id, email, name, phone_number, role, is_active, telegram_user_id, two_factor_enabled, created_at, last_login';

  let workingPayload: Record<string, unknown> = { ...payload };
  let lastError: any = null;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase
      .from('admin_users')
      .update(workingPayload)
      .eq('id', id)
      .select(selectClause)
      .single();

    if (!result.error) {
      return result.data;
    }

    lastError = result.error;
    if (isMissingColumn(lastError, 'telegram_user_id') && 'telegram_user_id' in workingPayload) {
      delete workingPayload.telegram_user_id;
      continue;
    }
    if (isMissingColumn(lastError, 'two_factor_enabled') && 'two_factor_enabled' in workingPayload) {
      delete workingPayload.two_factor_enabled;
      continue;
    }
    if (isMissingColumn(lastError, 'phone_number') && 'phone_number' in workingPayload) {
      delete workingPayload.phone_number;
      continue;
    }

    break;
  }

  throw lastError;
}

async function createOnboardingChallenge(supabase: any, input: {
  adminId: string;
  email: string;
  phoneNumber: string;
  name: string;
  createdBy: string;
}): Promise<OnboardingPayload> {
  const token = generateOnboardingToken();
  const otp = generateOnboardingOtp();
  const otpHash = hashOnboardingOtp(token, otp);
  const expiresAt = new Date(Date.now() + ONBOARDING_OTP_TTL_SECONDS * 1000).toISOString();

  await supabase
    .from('admin_user_onboarding')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('admin_id', input.adminId)
    .in('status', ['pending', 'linked', 'reset']);

  const insert = await supabase
    .from('admin_user_onboarding')
    .insert({
      admin_id: input.adminId,
      email: input.email,
      phone_number: input.phoneNumber || null,
      onboarding_token: token,
      otp_hash: otpHash,
      status: 'pending',
      attempts: 0,
      max_attempts: ONBOARDING_MAX_ATTEMPTS,
      expires_at: expiresAt,
      created_by: input.createdBy,
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (insert.error) {
    if (isMissingRelation(insert.error, 'admin_user_onboarding')) {
      throw new Error('admin_user_onboarding table is missing. Run scripts/15-admin-user-onboarding-and-lock-policy.sql.');
    }
    throw insert.error;
  }

  const messagePayload = buildOnboardingTelegramMessage({
    name: input.name,
    token,
    otp,
    expiresInMinutes: Math.floor(ONBOARDING_OTP_TTL_SECONDS / 60),
  });

  const telegramShareLink = `https://t.me/share/url?text=${encodeURIComponent(messagePayload.text)}`;

  return {
    token,
    otp,
    expiresAt,
    expiresInSeconds: ONBOARDING_OTP_TTL_SECONDS,
    message: messagePayload.text,
    botStartLink: messagePayload.botStartLink,
    telegramShareLink,
  };
}

async function syncAdminAuthEmailIfNeeded(supabase: any, id: string, email?: string) {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  await supabase.auth.admin.updateUserById(id, { email: normalized });
}

async function forceAdminAuthPasswordReset(supabase: any, id: string) {
  const temporaryPassword = generateTemporaryAuthPassword();
  await supabase.auth.admin.updateUserById(id, { password: temporaryPassword });
  return temporaryPassword;
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

    const data = await listAdminUsersWithFallback(supabase);

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
    if (!payload.phone_number) {
      return NextResponse.json({ ok: false, error: 'Phone number is required' }, { status: 400 });
    }
    if (isSystemAdminRole(payload.role) && !isSystemAdminRole(auth.actor.role)) {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can create system admin users' },
        { status: 403 }
      );
    }

    const passwordCheck = validateNewPassword(String(body?.temporary_password || 'StrongPass!234'));
    if (body?.temporary_password && passwordCheck) {
      return NextResponse.json({ ok: false, error: passwordCheck }, { status: 400 });
    }

    const authUser = await ensureAuthUserForAdmin(supabase, {
      email: payload.email,
      name: payload.name,
      role: payload.role,
    });

    const user = await upsertAdminUserWithFallback(supabase, {
      ...payload,
      id: authUser.userId,
      telegram_user_id: null,
    });

    const onboarding = await createOnboardingChallenge(supabase, {
      adminId: String(user.id),
      email: String(user.email),
      phoneNumber: payload.phone_number,
      name: String(user.name || payload.name),
      createdBy: auth.actor.id,
    });

    await writeAdminAuditLog(supabase, {
      adminId: auth.actor.id,
      action: 'ADMIN_USER_CREATE',
      entityType: 'admin_user',
      entityId: user.id,
      description: `Created admin user ${user.email}`,
      metadata: {
        role: user.role,
        isActive: user.is_active,
        phoneNumber: payload.phone_number,
        authUserCreated: authUser.created,
        onboardingToken: onboarding.token,
      },
    });

    return NextResponse.json({ ok: true, user, onboarding }, { status: 201 });
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

    const { data: existingUser, error: existingUserError } = await supabase
      .from('admin_users')
      .select('id, email, name, phone_number, role, is_active')
      .eq('id', id)
      .maybeSingle();
    if (existingUserError || !existingUser) {
      return NextResponse.json({ ok: false, error: 'Admin user not found' }, { status: 404 });
    }

    const action = String(body?.action || '').trim().toLowerCase();

    const actorIsSystemAdmin = isSystemAdminRole(auth.actor.role);
    const targetIsSystemAdmin = isSystemAdminRole(existingUser.role);
    if (targetIsSystemAdmin && !actorIsSystemAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can modify system admin users' },
        { status: 403 }
      );
    }

    if (action === 'reset_user') {
      if (id === auth.actor.id) {
        return NextResponse.json({ ok: false, error: 'You cannot reset your own account here' }, { status: 400 });
      }

      const email = normalizeEmail(body?.email || existingUser.email);
      const name = normalizeName(body?.name || existingUser.name);
      const phoneNumber = normalizePhone(body?.phone_number ?? body?.phoneNumber ?? existingUser.phone_number);

      if (!email) {
        return NextResponse.json({ ok: false, error: 'Email is required for reset' }, { status: 400 });
      }
      if (!name) {
        return NextResponse.json({ ok: false, error: 'Name is required for reset' }, { status: 400 });
      }
      if (!phoneNumber) {
        return NextResponse.json({ ok: false, error: 'Phone number is required for reset' }, { status: 400 });
      }

      await syncAdminAuthEmailIfNeeded(supabase, id, email);
      await forceAdminAuthPasswordReset(supabase, id);

      const resetUser = await updateAdminUserWithFallback(supabase, id, {
        email,
        name,
        phone_number: phoneNumber,
        is_active: true,
        telegram_user_id: null,
      });

      const onboarding = await createOnboardingChallenge(supabase, {
        adminId: id,
        email,
        phoneNumber,
        name,
        createdBy: auth.actor.id,
      });

      await writeAdminAuditLog(supabase, {
        adminId: auth.actor.id,
        action: 'ADMIN_USER_RESET',
        entityType: 'admin_user',
        entityId: id,
        description: `Reset onboarding for admin user ${email}`,
        metadata: {
          onboardingToken: onboarding.token,
        },
      });

      return NextResponse.json({ ok: true, user: resetUser, onboarding });
    }

    const updatePayload: Record<string, unknown> = {};
    if ('name' in body) updatePayload.name = normalizeName(body?.name);
    if ('email' in body) updatePayload.email = normalizeEmail(body?.email);
    if ('phone_number' in body || 'phoneNumber' in body) {
      updatePayload.phone_number = normalizePhone(body?.phone_number ?? body?.phoneNumber);
    }
    if ('role' in body) updatePayload.role = normalizeAdminRole(body?.role);
    if ('is_active' in body) updatePayload.is_active = Boolean(body?.is_active);
    if ('telegram_user_id' in body || 'telegramUserId' in body) {
      const raw = String(body?.telegram_user_id ?? body?.telegramUserId ?? '').trim();
      const numeric = raw ? Number(raw) : null;
      updatePayload.telegram_user_id = Number.isFinite(numeric as number) ? numeric : null;
    }
    if ('two_factor_enabled' in body) updatePayload.two_factor_enabled = Boolean(body?.two_factor_enabled);
    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ ok: false, error: 'No fields to update' }, { status: 400 });
    }

    if ('role' in updatePayload && isSystemAdminRole(updatePayload.role) && !actorIsSystemAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can assign system admin role' },
        { status: 403 }
      );
    }

    if (id === auth.actor.id) {
      if ('is_active' in updatePayload && updatePayload.is_active === false) {
        return NextResponse.json({ ok: false, error: 'You cannot deactivate your own account' }, { status: 400 });
      }
      if ('role' in updatePayload && normalizeAdminRole(updatePayload.role) !== normalizeAdminRole(auth.actor.role)) {
        return NextResponse.json({ ok: false, error: 'You cannot change your own role' }, { status: 400 });
      }
    }

    if (targetIsSystemAdmin) {
      const nextRole =
        'role' in updatePayload ? normalizeAdminRole(updatePayload.role) : normalizeAdminRole(existingUser.role);
      const nextActive =
        'is_active' in updatePayload ? Boolean(updatePayload.is_active) : Boolean(existingUser.is_active);
      if (nextRole !== 'system_admin' || !nextActive) {
        const otherSystemAdmins = await countOtherActiveSystemAdmins(supabase, id);
        if (otherSystemAdmins <= 0) {
          return NextResponse.json(
            { ok: false, error: 'At least one active system admin must remain' },
            { status: 400 }
          );
        }
      }
    }

    if ('email' in updatePayload) {
      await syncAdminAuthEmailIfNeeded(supabase, id, String(updatePayload.email));
    }

    const data = await updateAdminUserWithFallback(supabase, id, updatePayload);

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

    if (id === auth.actor.id) {
      return NextResponse.json({ ok: false, error: 'You cannot deactivate your own account' }, { status: 400 });
    }

    const { data: existingUser, error: existingUserError } = await supabase
      .from('admin_users')
      .select('id, email, role, is_active')
      .eq('id', id)
      .maybeSingle();
    if (existingUserError || !existingUser) {
      return NextResponse.json({ ok: false, error: 'Admin user not found' }, { status: 404 });
    }

    const actorIsSystemAdmin = isSystemAdminRole(auth.actor.role);
    if (isSystemAdminRole(existingUser.role) && !actorIsSystemAdmin) {
      return NextResponse.json(
        { ok: false, error: 'Only system admins can deactivate system admin users' },
        { status: 403 }
      );
    }

    if (isSystemAdminRole(existingUser.role)) {
      const otherSystemAdmins = await countOtherActiveSystemAdmins(supabase, id);
      if (otherSystemAdmins <= 0) {
        return NextResponse.json(
          { ok: false, error: 'At least one active system admin must remain' },
          { status: 400 }
        );
      }
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
