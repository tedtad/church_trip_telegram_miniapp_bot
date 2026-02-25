export type AdminRole =
  | 'system_admin'
  | 'admin'
  | 'moderator'
  | 'analyst'
  | 'sales_agent'
  | 'user';

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

const ROLE_PERMISSION_MAP: Record<AdminRole, ReadonlyArray<AdminPermission>> = {
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
  analyst: [
    'dashboard_view',
    'analytics_view',
    'reports_view',
    'reconciliation_view',
  ],
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

const ROLE_ALIASES: Record<string, AdminRole> = {
  super_admin: 'system_admin',
  superadmin: 'system_admin',
  owner: 'system_admin',
  manager: 'admin',
  seller: 'sales_agent',
  sales: 'sales_agent',
};

export function normalizeAdminRole(input: unknown): AdminRole {
  const raw = String(input || '')
    .trim()
    .toLowerCase();
  if (!raw) return 'admin';
  const alias = ROLE_ALIASES[raw];
  if (alias) return alias;
  if (raw in ROLE_PERMISSION_MAP) return raw as AdminRole;
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

export function resolvePermissionForAdminApi(pathnameInput: string): AdminPermission | null {
  const pathname = String(pathnameInput || '').replace(/\/+$/, '');
  if (!pathname.startsWith('/api/admin')) return null;

  if (pathname === '/api/admin/analytics') return 'analytics_view';
  if (pathname === '/api/admin/gnpl') return 'tickets_review';
  if (pathname === '/api/admin/reports') return 'reports_view';
  if (pathname === '/api/admin/reconciliation') return 'reconciliation_view';
  if (pathname === '/api/admin/reconciliation/match') return 'reconciliation_view';
  if (pathname === '/api/admin/users') return 'admin_users_manage';
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

  if (!hasAdminPermission(actor.role, params.permission)) {
    return { ok: false as const, status: 403, error: 'Insufficient role permission' };
  }

  return { ok: true as const, actor };
}
