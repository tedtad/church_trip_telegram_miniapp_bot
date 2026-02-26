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
  if (/^[a-z0-9_:-]+$/.test(raw)) return raw as AdminRole;
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
