-- Schema-driven Admin RBAC (roles, permissions, mappings)
-- Safe to run multiple times.

-- 1) Canonical permission catalog
CREATE TABLE IF NOT EXISTS admin_permissions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Role catalog
CREATE TABLE IF NOT EXISTS admin_roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Role-permission mapping
CREATE TABLE IF NOT EXISTS admin_role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_code TEXT NOT NULL REFERENCES admin_roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES admin_permissions(code) ON DELETE CASCADE,
  is_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(role_code, permission_code)
);

CREATE INDEX IF NOT EXISTS idx_admin_roles_active ON admin_roles(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_active ON admin_permissions(is_active);
CREATE INDEX IF NOT EXISTS idx_admin_role_permissions_role_code ON admin_role_permissions(role_code);
CREATE INDEX IF NOT EXISTS idx_admin_role_permissions_permission_code ON admin_role_permissions(permission_code);
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

-- 4) Seed canonical permissions
INSERT INTO admin_permissions (code, name, description, category, is_active)
VALUES
  ('dashboard_view', 'Dashboard View', 'Access admin dashboard widgets and overview data', 'dashboard', TRUE),
  ('tickets_review', 'Ticket Review', 'Review, approve, reject, and inspect ticket receipts', 'tickets', TRUE),
  ('tickets_checkin', 'Ticket Check-In', 'Use scanner/manual check-in flows for issued tickets', 'tickets', TRUE),
  ('tickets_manual_sale', 'Manual Ticket Sale', 'Create manual sales and related remittance submissions', 'tickets', TRUE),
  ('customers_view', 'Customers View', 'View customer and profile records', 'customers', TRUE),
  ('trips_manage', 'Trips Manage', 'Create/update trips and availability', 'trips', TRUE),
  ('analytics_view', 'Analytics View', 'Open analytics dashboards and KPI reports', 'analytics', TRUE),
  ('discounts_manage', 'Discounts Manage', 'Create and manage discount codes', 'discounts', TRUE),
  ('charity_manage', 'Charity Manage', 'Manage charity campaigns, donations, promises, and approvals', 'charity', TRUE),
  ('invitations_manage', 'Invitations Manage', 'Create/manage invitation links and QR codes', 'invitations', TRUE),
  ('bulk_ops_manage', 'Bulk Ops Manage', 'Run bulk operations and automations', 'operations', TRUE),
  ('bot_manage', 'Bot Manage', 'Control Telegram bot operational actions', 'bot', TRUE),
  ('backups_manage', 'Backups Manage', 'Manage backups and exports', 'platform', TRUE),
  ('settings_manage', 'Settings Manage', 'Manage application settings', 'platform', TRUE),
  ('admin_users_manage', 'Admin Users Manage', 'Manage admin users and RBAC', 'security', TRUE),
  ('reconciliation_view', 'Reconciliation View', 'Access reconciliation workflows and data', 'finance', TRUE),
  ('reports_view', 'Reports View', 'Access reporting pages and generated reports', 'reports', TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- 5) Seed canonical roles
INSERT INTO admin_roles (code, name, description, is_system, is_active)
VALUES
  ('system_admin', 'System Admin', 'Full platform access and security administration', TRUE, TRUE),
  ('admin', 'Admin', 'Full operational access excluding system-admin-only controls', FALSE, TRUE),
  ('moderator', 'Moderator', 'Operational moderation for tickets and customer support', FALSE, TRUE),
  ('analyst', 'Analyst', 'Read-focused analytics, reconciliation, and reporting access', FALSE, TRUE),
  ('sales_agent', 'Sales Agent', 'Manual sale, check-in, and ticket support workflows', FALSE, TRUE),
  ('user', 'User', 'Basic dashboard-only role', FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- 6) Auto-register custom legacy roles present in admin_users but missing in admin_roles
INSERT INTO admin_roles (code, name, description, is_system, is_active)
SELECT DISTINCT
  LOWER(TRIM(au.role)) AS code,
  INITCAP(REPLACE(LOWER(TRIM(au.role)), '_', ' ')) AS name,
  'Imported from existing admin_users.role value' AS description,
  FALSE AS is_system,
  TRUE AS is_active
FROM admin_users au
WHERE COALESCE(TRIM(au.role), '') <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM admin_roles ar
    WHERE ar.code = LOWER(TRIM(au.role))
  );

-- 7) Seed canonical role-permission mappings
INSERT INTO admin_role_permissions (role_code, permission_code, is_allowed)
VALUES
  -- system_admin: all permissions
  ('system_admin', 'dashboard_view', TRUE),
  ('system_admin', 'tickets_review', TRUE),
  ('system_admin', 'tickets_checkin', TRUE),
  ('system_admin', 'tickets_manual_sale', TRUE),
  ('system_admin', 'customers_view', TRUE),
  ('system_admin', 'trips_manage', TRUE),
  ('system_admin', 'analytics_view', TRUE),
  ('system_admin', 'discounts_manage', TRUE),
  ('system_admin', 'charity_manage', TRUE),
  ('system_admin', 'invitations_manage', TRUE),
  ('system_admin', 'bulk_ops_manage', TRUE),
  ('system_admin', 'bot_manage', TRUE),
  ('system_admin', 'backups_manage', TRUE),
  ('system_admin', 'settings_manage', TRUE),
  ('system_admin', 'admin_users_manage', TRUE),
  ('system_admin', 'reconciliation_view', TRUE),
  ('system_admin', 'reports_view', TRUE),

  -- admin
  ('admin', 'dashboard_view', TRUE),
  ('admin', 'tickets_review', TRUE),
  ('admin', 'tickets_checkin', TRUE),
  ('admin', 'tickets_manual_sale', TRUE),
  ('admin', 'customers_view', TRUE),
  ('admin', 'trips_manage', TRUE),
  ('admin', 'analytics_view', TRUE),
  ('admin', 'discounts_manage', TRUE),
  ('admin', 'charity_manage', TRUE),
  ('admin', 'invitations_manage', TRUE),
  ('admin', 'bulk_ops_manage', TRUE),
  ('admin', 'bot_manage', TRUE),
  ('admin', 'backups_manage', TRUE),
  ('admin', 'settings_manage', TRUE),
  ('admin', 'admin_users_manage', TRUE),
  ('admin', 'reconciliation_view', TRUE),
  ('admin', 'reports_view', TRUE),

  -- moderator
  ('moderator', 'dashboard_view', TRUE),
  ('moderator', 'tickets_review', TRUE),
  ('moderator', 'tickets_checkin', TRUE),
  ('moderator', 'customers_view', TRUE),
  ('moderator', 'analytics_view', TRUE),
  ('moderator', 'reports_view', TRUE),

  -- analyst
  ('analyst', 'dashboard_view', TRUE),
  ('analyst', 'analytics_view', TRUE),
  ('analyst', 'reconciliation_view', TRUE),
  ('analyst', 'reports_view', TRUE),

  -- sales_agent
  ('sales_agent', 'dashboard_view', TRUE),
  ('sales_agent', 'tickets_review', TRUE),
  ('sales_agent', 'tickets_checkin', TRUE),
  ('sales_agent', 'tickets_manual_sale', TRUE),
  ('sales_agent', 'customers_view', TRUE),
  ('sales_agent', 'reports_view', TRUE),

  -- user
  ('user', 'dashboard_view', TRUE)
ON CONFLICT (role_code, permission_code) DO UPDATE
SET
  is_allowed = EXCLUDED.is_allowed,
  updated_at = NOW();

-- 8) Ensure current admin user roles are normalized and non-empty
UPDATE admin_users
SET role = 'admin'
WHERE COALESCE(TRIM(role), '') = '';
