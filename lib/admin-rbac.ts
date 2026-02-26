export type AdminRole = string;

export type AdminPermission =
  | 'dashboard_view'
  | 'tickets_review'
  | 'tickets_checkin'
  | 'tickets_manual_sale'
  | 'customers_view'
  | 'trips_manage'
  | 'analytics_view'
  | 'discounts_manage'
  | 'charity_manage'
  | 'invitations_manage'
  | 'bulk_ops_manage'
  | 'bot_manage'
  | 'backups_manage'
  | 'settings_manage'
  | 'admin_users_manage'
  | 'reconciliation_view'
  | 'reports_view';

export const ADMIN_ROLES: ReadonlyArray<AdminRole> = [
  'system_admin',
  'admin',
  'moderator',
  'analyst',
  'sales_agent',
  'user',
];

export const ADMIN_PERMISSIONS: ReadonlyArray<AdminPermission> = [
  'dashboard_view',
  'tickets_review',
  'tickets_checkin',
  'tickets_manual_sale',
  'customers_view',
  'trips_manage',
  'analytics_view',
  'discounts_manage',
  'charity_manage',
  'invitations_manage',
  'bulk_ops_manage',
  'bot_manage',
  'backups_manage',
  'settings_manage',
  'admin_users_manage',
  'reconciliation_view',
  'reports_view',
];

const ROLE_PERMISSION_MAP: Record<string, ReadonlyArray<AdminPermission>> = {
  system_admin: [
    'dashboard_view',
    'tickets_review',
    'tickets_checkin',
    'tickets_manual_sale',
    'customers_view',
    'trips_manage',
    'analytics_view',
    'discounts_manage',
    'charity_manage',
    'invitations_manage',
    'bulk_ops_manage',
    'bot_manage',
    'backups_manage',
    'settings_manage',
    'admin_users_manage',
    'reconciliation_view',
    'reports_view',
  ],
  admin: [
    'dashboard_view',
    'tickets_review',
    'tickets_checkin',
    'tickets_manual_sale',
    'customers_view',
    'trips_manage',
    'analytics_view',
    'discounts_manage',
    'charity_manage',
    'invitations_manage',
    'bulk_ops_manage',
    'bot_manage',
    'backups_manage',
    'settings_manage',
    'admin_users_manage',
    'reconciliation_view',
    'reports_view',
  ],
  moderator: [
    'dashboard_view',
    'tickets_review',
    'tickets_checkin',
    'customers_view',
    'analytics_view',
    'reports_view',
  ],
  analyst: ['dashboard_view', 'analytics_view', 'reports_view', 'reconciliation_view'],
  sales_agent: [
    'dashboard_view',
    'tickets_review',
    'tickets_checkin',
    'tickets_manual_sale',
    'customers_view',
    'reports_view',
  ],
  user: ['dashboard_view'],
};

const ROLE_ALIASES: Record<string, string> = {
  super_admin: 'system_admin',
  superadmin: 'system_admin',
  owner: 'system_admin',
  manager: 'admin',
  seller: 'sales_agent',
  sales: 'sales_agent',
};

const ROLE_PERMISSION_CACHE = new Map<string, { permissions: ReadonlyArray<string>; expiresAt: number }>();
const ROLE_PERMISSION_CACHE_TTL_MS = 30_000;

function isMissingRelation(error: unknown, relationName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return (
    message.includes('relation') &&
    message.includes(relationName.toLowerCase()) &&
    message.includes('does not exist')
  );
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(columnName.toLowerCase());
}

function toRoleLabel(roleCode: string) {
  return roleCode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function toPermissionLabel(permissionCode: string) {
  return permissionCode
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function normalizeAdminRole(input: unknown): AdminRole {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  if (!raw) return 'admin';
  const alias = ROLE_ALIASES[raw];
  if (alias) return alias;
  if (raw in ROLE_PERMISSION_MAP) return raw;
  if (/^[a-z0-9_:-]+$/.test(raw)) return raw;
  return 'admin';
}

export function hasAdminPermission(roleInput: unknown, permission: AdminPermission): boolean {
  const role = normalizeAdminRole(roleInput);
  const permissions = ROLE_PERMISSION_MAP[role] || [];
  return permissions.includes(permission);
}

export function getAdminPermissionsForRole(roleInput: unknown): ReadonlyArray<AdminPermission> {
  const role = normalizeAdminRole(roleInput);
  return ROLE_PERMISSION_MAP[role] || [];
}

async function loadSchemaPermissionsForRole(supabase: any, roleInput: unknown): Promise<ReadonlyArray<string> | null> {
  const roleCode = normalizeAdminRole(roleInput);
  if (!roleCode || !supabase?.from) return null;

  const now = Date.now();
  const cached = ROLE_PERMISSION_CACHE.get(roleCode);
  if (cached && cached.expiresAt > now) {
    return cached.permissions;
  }

  const roleResult = await supabase
    .from('admin_roles')
    .select('code, is_active')
    .eq('code', roleCode)
    .maybeSingle();

  if (roleResult.error) {
    if (isMissingRelation(roleResult.error, 'admin_roles')) {
      return null;
    }
    throw roleResult.error;
  }

  if (!roleResult.data || roleResult.data.is_active === false) {
    ROLE_PERMISSION_CACHE.set(roleCode, {
      permissions: [],
      expiresAt: now + ROLE_PERMISSION_CACHE_TTL_MS,
    });
    return [];
  }

  let permissionsResult = await supabase
    .from('admin_role_permissions')
    .select('permission_code, is_allowed')
    .eq('role_code', roleCode);

  if (permissionsResult.error && isMissingColumn(permissionsResult.error, 'is_allowed')) {
    permissionsResult = await supabase
      .from('admin_role_permissions')
      .select('permission_code')
      .eq('role_code', roleCode);
  }

  if (permissionsResult.error) {
    if (isMissingRelation(permissionsResult.error, 'admin_role_permissions')) {
      return null;
    }
    throw permissionsResult.error;
  }

  const permissions = ((permissionsResult.data || []) as Array<{ permission_code?: string; is_allowed?: boolean }>)
    .filter((row) => row.is_allowed !== false)
    .map((row) => String(row.permission_code || '').trim())
    .filter(Boolean);

  ROLE_PERMISSION_CACHE.set(roleCode, {
    permissions,
    expiresAt: now + ROLE_PERMISSION_CACHE_TTL_MS,
  });

  return permissions;
}

export async function hasAdminPermissionResolved(params: {
  supabase: any;
  roleInput: unknown;
  permission: AdminPermission;
}) {
  const schemaPermissions = await loadSchemaPermissionsForRole(params.supabase, params.roleInput);
  if (schemaPermissions !== null) {
    // Backward-compatibility: older RBAC seeds missed this mapping for `admin`.
    if (
      params.permission === 'admin_users_manage' &&
      normalizeAdminRole(params.roleInput) === 'admin'
    ) {
      return true;
    }
    return schemaPermissions.includes(params.permission);
  }
  return hasAdminPermission(params.roleInput, params.permission);
}

export async function listRbacConfig(supabase: any) {
  if (!supabase?.from) {
    return {
      source: 'fallback' as const,
      roles: ADMIN_ROLES.map((code) => ({
        code,
        name: toRoleLabel(code),
        description: null as string | null,
        is_system: code === 'system_admin',
        is_active: true,
      })),
      permissions: ADMIN_PERMISSIONS.map((code) => ({
        code,
        name: toPermissionLabel(code),
        description: null as string | null,
        category: null as string | null,
        is_active: true,
      })),
      rolePermissions: Object.fromEntries(
        ADMIN_ROLES.map((role) => [role, [...getAdminPermissionsForRole(role)]])
      ) as Record<string, Array<string>>,
    };
  }

  const [rolesResult, permissionsResult, mappingsResult] = await Promise.all([
    supabase
      .from('admin_roles')
      .select('code, name, description, is_system, is_active')
      .order('code', { ascending: true }),
    supabase
      .from('admin_permissions')
      .select('code, name, description, category, is_active')
      .order('code', { ascending: true }),
    supabase
      .from('admin_role_permissions')
      .select('role_code, permission_code, is_allowed'),
  ]);

  if (
    (rolesResult.error && isMissingRelation(rolesResult.error, 'admin_roles')) ||
    (permissionsResult.error && isMissingRelation(permissionsResult.error, 'admin_permissions')) ||
    (mappingsResult.error && isMissingRelation(mappingsResult.error, 'admin_role_permissions'))
  ) {
    return {
      source: 'fallback' as const,
      roles: ADMIN_ROLES.map((code) => ({
        code,
        name: toRoleLabel(code),
        description: null as string | null,
        is_system: code === 'system_admin',
        is_active: true,
      })),
      permissions: ADMIN_PERMISSIONS.map((code) => ({
        code,
        name: toPermissionLabel(code),
        description: null as string | null,
        category: null as string | null,
        is_active: true,
      })),
      rolePermissions: Object.fromEntries(
        ADMIN_ROLES.map((role) => [role, [...getAdminPermissionsForRole(role)]])
      ) as Record<string, Array<string>>,
    };
  }

  if (rolesResult.error) throw rolesResult.error;
  if (permissionsResult.error) throw permissionsResult.error;
  if (mappingsResult.error) throw mappingsResult.error;

  const roles = ((rolesResult.data || []) as Array<any>).map((row) => ({
    code: String(row.code || '').trim(),
    name: String(row.name || '').trim() || toRoleLabel(String(row.code || '')),
    description: row.description ? String(row.description) : null,
    is_system: Boolean(row.is_system),
    is_active: row.is_active !== false,
  }));

  const permissions = ((permissionsResult.data || []) as Array<any>).map((row) => ({
    code: String(row.code || '').trim(),
    name: String(row.name || '').trim() || toPermissionLabel(String(row.code || '')),
    description: row.description ? String(row.description) : null,
    category: row.category ? String(row.category) : null,
    is_active: row.is_active !== false,
  }));

  const rolePermissions: Record<string, Array<string>> = {};
  for (const role of roles) {
    rolePermissions[role.code] = [];
  }

  for (const row of (mappingsResult.data || []) as Array<any>) {
    if (row?.is_allowed === false) continue;
    const roleCode = String(row?.role_code || '').trim();
    const permissionCode = String(row?.permission_code || '').trim();
    if (!roleCode || !permissionCode) continue;
    if (!rolePermissions[roleCode]) rolePermissions[roleCode] = [];
    if (!rolePermissions[roleCode].includes(permissionCode)) {
      rolePermissions[roleCode].push(permissionCode);
    }
  }

  return {
    source: 'schema' as const,
    roles,
    permissions,
    rolePermissions,
  };
}

export async function ensureRoleExistsAndActive(supabase: any, roleInput: unknown) {
  const roleCode = normalizeAdminRole(roleInput);
  if (!roleCode) return { ok: false as const, error: 'Role is required', schema: false };
  if (!supabase?.from) return { ok: true as const, roleCode, schema: false };

  const result = await supabase
    .from('admin_roles')
    .select('code, is_active')
    .eq('code', roleCode)
    .maybeSingle();

  if (result.error) {
    if (isMissingRelation(result.error, 'admin_roles')) {
      return { ok: true as const, roleCode, schema: false };
    }
    throw result.error;
  }

  if (!result.data) {
    return { ok: false as const, error: `Role "${roleCode}" does not exist`, schema: true };
  }
  if (result.data.is_active === false) {
    return { ok: false as const, error: `Role "${roleCode}" is inactive`, schema: true };
  }

  return { ok: true as const, roleCode, schema: true };
}

export function resolvePermissionForAdminApi(pathnameInput: string): AdminPermission | null {
  const pathname = String(pathnameInput || '').replace(/\/+$/, '');
  if (!pathname.startsWith('/api/admin')) return null;

  if (pathname === '/api/admin/analytics') return 'analytics_view';
  if (pathname === '/api/admin/gnpl') return 'tickets_review';
  if (pathname === '/api/admin/reports') return 'reports_view';
  if (pathname === '/api/admin/reconciliation') return 'reconciliation_view';
  if (pathname === '/api/admin/reconciliation/match') return 'reconciliation_view';
  if (pathname === '/api/admin/manual-cash/summary') return 'tickets_manual_sale';
  if (pathname === '/api/admin/manual-cash/remittances') return 'reports_view';
  if (pathname.startsWith('/api/admin/manual-cash/remittances/')) return 'reports_view';
  if (pathname === '/api/admin/users') return 'admin_users_manage';
  if (pathname === '/api/admin/rbac') return 'dashboard_view';
  if (pathname === '/api/admin/trips') return 'trips_manage';
  if (pathname === '/api/admin/settings') return 'settings_manage';
  if (pathname === '/api/admin/settings/upload-logo') return 'settings_manage';
  if (pathname === '/api/admin/receipt-intelligence/samples') return 'settings_manage';
  if (pathname === '/api/admin/tickets/checkin') return 'tickets_checkin';
  if (pathname === '/api/admin/tickets/decision') return 'tickets_review';
  if (pathname === '/api/admin/tickets/manual-sale') return 'tickets_manual_sale';
  if (pathname.startsWith('/api/admin/discount-codes')) return 'discounts_manage';
  if (pathname.startsWith('/api/admin/invitations')) return 'invitations_manage';
  if (pathname.startsWith('/api/admin/charity')) return 'charity_manage';
  if (pathname.startsWith('/api/admin/backups')) return 'backups_manage';
  if (pathname.startsWith('/api/admin/bulk-operations')) return 'bulk_ops_manage';
  if (pathname.startsWith('/api/admin/bot')) return 'bot_manage';
  if (pathname.startsWith('/api/admin/telebirr')) return 'settings_manage';

  return null;
}

export function extractAdminIdFromRequest(request: any, explicitAdminId?: string | null) {
  const fromHeader = String(
    request?.headers?.get?.('x-admin-id') ||
      request?.headers?.get?.('x-admin-user-id') ||
      ''
  ).trim();
  if (fromHeader) return fromHeader;

  const explicit = String(explicitAdminId || '').trim();
  if (explicit) return explicit;

  return '';
}

export async function loadAdminActor(supabase: any, adminId: string) {
  const normalizedId = String(adminId || '').trim();
  if (!normalizedId) return null;
  const { data, error } = await supabase
    .from('admin_users')
    .select('id, email, name, role, is_active')
    .eq('id', normalizedId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: String(data.id),
    email: String(data.email || ''),
    name: String(data.name || ''),
    role: normalizeAdminRole(data.role),
    isActive: Boolean(data.is_active),
  };
}

export async function requireAdminPermission(params: {
  supabase: any;
  request: any;
  permission: AdminPermission;
  explicitAdminId?: string | null;
}) {
  let adminId = '';
  try {
    const { getAdminSessionTokenFromRequest, verifyAdminSessionToken } = await import('@/lib/admin-session');
    const claims = verifyAdminSessionToken(getAdminSessionTokenFromRequest(params.request));
    if (claims?.adminId) {
      adminId = String(claims.adminId);
    }
  } catch {
    // ignore and continue with proxy-injected headers fallback
  }

  if (!adminId) {
    adminId = extractAdminIdFromRequest(params.request, params.explicitAdminId);
  }

  if (!adminId) {
    return { ok: false as const, status: 401, error: 'Admin identity is required' };
  }

  const actor = await loadAdminActor(params.supabase, adminId);
  if (!actor || !actor.isActive) {
    return { ok: false as const, status: 403, error: 'Admin account is inactive or missing' };
  }

  const allowed = await hasAdminPermissionResolved({
    supabase: params.supabase,
    roleInput: actor.role,
    permission: params.permission,
  });
  if (!allowed) {
    return { ok: false as const, status: 403, error: 'Insufficient role permission' };
  }

  return { ok: true as const, actor };
}
