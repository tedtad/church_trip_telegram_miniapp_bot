'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type RoleRow = {
  code: string;
  name: string;
  description?: string | null;
  is_system: boolean;
  is_active: boolean;
};

type PermissionRow = {
  code: string;
  name: string;
  description?: string | null;
  category?: string | null;
  is_active: boolean;
};

type RbacResponse = {
  ok: boolean;
  source: 'schema' | 'fallback';
  roles: RoleRow[];
  permissions: PermissionRow[];
  rolePermissions: Record<string, string[]>;
  me?: {
    role: string;
    permissions: string[];
    isSystemAdmin: boolean;
  };
  error?: string;
};

export default function AdminRbacPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [source, setSource] = useState<'schema' | 'fallback'>('fallback');
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Record<string, string[]>>({});
  const [selectedRole, setSelectedRole] = useState('');
  const [isSystemAdmin, setIsSystemAdmin] = useState(false);

  const [newRoleCode, setNewRoleCode] = useState('');
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDescription, setNewRoleDescription] = useState('');
  const [newRoleCloneFrom, setNewRoleCloneFrom] = useState('');

  const loadRbac = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/admin/rbac', { cache: 'no-store' });
      const json = (await response.json().catch(() => ({}))) as RbacResponse;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load RBAC configuration');
      }

      const nextRoles = (json.roles || []).filter((role) => role.code);
      setSource(json.source || 'fallback');
      setRoles(nextRoles);
      setPermissions((json.permissions || []).filter((permission) => permission.code));
      setRolePermissions(json.rolePermissions || {});
      setIsSystemAdmin(Boolean(json.me?.isSystemAdmin));
      setSelectedRole((current) => current || nextRoles[0]?.code || '');
      setNewRoleCloneFrom((current) => current || nextRoles[0]?.code || '');
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load RBAC configuration');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRbac();
  }, [loadRbac]);

  const selectedPermissionSet = useMemo(() => {
    const rows = rolePermissions[selectedRole] || [];
    return new Set(rows);
  }, [rolePermissions, selectedRole]);

  const togglePermission = useCallback((permissionCode: string) => {
    setRolePermissions((current) => {
      const next = { ...current };
      const existing = new Set(next[selectedRole] || []);
      if (existing.has(permissionCode)) {
        existing.delete(permissionCode);
      } else {
        existing.add(permissionCode);
      }
      next[selectedRole] = [...existing];
      return next;
    });
  }, [selectedRole]);

  const saveSelectedRole = useCallback(async () => {
    try {
      if (!selectedRole) return;
      setSaving(true);
      setError('');
      setNotice('');

      const permissionCodes = rolePermissions[selectedRole] || [];
      const response = await fetch('/api/admin/rbac', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roleCode: selectedRole,
          permissionCodes,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to update role permissions');
      }

      setNotice(`Permissions updated for role: ${selectedRole}`);
      await loadRbac();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to update role permissions');
    } finally {
      setSaving(false);
    }
  }, [loadRbac, rolePermissions, selectedRole]);

  const createRole = useCallback(async () => {
    try {
      const roleCode = String(newRoleCode || '').trim().toLowerCase();
      if (!roleCode) {
        setError('Role code is required');
        return;
      }

      setCreatingRole(true);
      setError('');
      setNotice('');

      const response = await fetch('/api/admin/rbac', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: roleCode,
          name: newRoleName,
          description: newRoleDescription,
          cloneFromRole: newRoleCloneFrom || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create role');
      }

      setNotice(`Role created: ${roleCode}`);
      setNewRoleCode('');
      setNewRoleName('');
      setNewRoleDescription('');
      await loadRbac();
      setSelectedRole(roleCode);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to create role');
    } finally {
      setCreatingRole(false);
    }
  }, [loadRbac, newRoleCloneFrom, newRoleCode, newRoleDescription, newRoleName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading RBAC configuration...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">RBAC Management</h1>
        <a href="/admin/users" className="text-sm text-cyan-300 underline">
          Open Admin Users
        </a>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-2">
        <p className="text-sm text-slate-300">
          Source: <span className="font-mono text-slate-100">{source}</span>
        </p>
        {source !== 'schema' ? (
          <p className="text-sm text-amber-300">
            RBAC tables are not active yet. Run <code>scripts/17-admin-rbac-schema-and-seed.sql</code> to enable
            editable role mappings.
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-white">Role Permission Mapping</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-1">
            <label className="block text-xs font-semibold text-slate-300 mb-2">Role</label>
            <select
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            >
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name} ({role.code})
                </option>
              ))}
            </select>
            {selectedRole ? (
              <p className="text-xs text-slate-400 mt-2">
                {roles.find((role) => role.code === selectedRole)?.description || 'No description'}
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-300 mb-2">Permissions</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[360px] overflow-auto pr-2">
              {permissions.map((permission) => (
                <label
                  key={permission.code}
                  className="inline-flex items-start gap-2 rounded border border-slate-700 bg-slate-900/40 p-2 text-sm text-slate-200"
                >
                  <input
                    type="checkbox"
                    checked={selectedPermissionSet.has(permission.code)}
                    onChange={() => togglePermission(permission.code)}
                    disabled={source !== 'schema' || !isSystemAdmin || saving}
                  />
                  <span>
                    <span className="block font-medium">{permission.name}</span>
                    <span className="block text-xs text-slate-400">{permission.code}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={saveSelectedRole}
            disabled={source !== 'schema' || !isSystemAdmin || saving || !selectedRole}
            className="bg-primary hover:bg-primary/90 text-white"
          >
            {saving ? 'Saving...' : 'Save Mapping'}
          </Button>
          <Button
            onClick={loadRbac}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-600 text-white"
          >
            Reload
          </Button>
        </div>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-4">
        <h2 className="text-lg font-semibold text-white">Create Role</h2>
        <p className="text-sm text-slate-300">
          Create a new role and optionally clone permissions from an existing role.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            value={newRoleCode}
            onChange={(e) => setNewRoleCode(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="role_code"
            disabled={source !== 'schema' || !isSystemAdmin || creatingRole}
          />
          <input
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="Role Name"
            disabled={source !== 'schema' || !isSystemAdmin || creatingRole}
          />
          <input
            value={newRoleDescription}
            onChange={(e) => setNewRoleDescription(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="Description"
            disabled={source !== 'schema' || !isSystemAdmin || creatingRole}
          />
          <select
            value={newRoleCloneFrom}
            onChange={(e) => setNewRoleCloneFrom(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            disabled={source !== 'schema' || !isSystemAdmin || creatingRole}
          >
            <option value="">Do not clone</option>
            {roles.map((role) => (
              <option key={role.code} value={role.code}>
                Clone: {role.code}
              </option>
            ))}
          </select>
        </div>
        <Button
          onClick={createRole}
          disabled={source !== 'schema' || !isSystemAdmin || creatingRole}
          className="bg-primary hover:bg-primary/90 text-white"
        >
          {creatingRole ? 'Creating...' : 'Create Role'}
        </Button>
      </Card>
    </div>
  );
}
