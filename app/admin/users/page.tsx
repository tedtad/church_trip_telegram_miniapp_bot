'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  created_at?: string;
  last_login?: string | null;
};

const ROLE_OPTIONS = ['system_admin', 'admin', 'moderator', 'analyst', 'sales_agent', 'user'];

export default function AdminUsersPage() {
  const session = getAdminSession();
  const adminId = String(session?.admin?.id || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('moderator');

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-admin-id': adminId,
    }),
    [adminId]
  );

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/admin/users', {
        cache: 'no-store',
        headers: { 'x-admin-id': adminId },
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load admin users');
      }
      setUsers((json.users || []) as AdminUserRow[]);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load admin users');
    } finally {
      setLoading(false);
    }
  }, [adminId]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const createUser = useCallback(async () => {
    try {
      if (!newEmail.trim() || !newName.trim()) {
        setError('Name and email are required');
        return;
      }
      setSaving(true);
      setError('');
      setNotice('');
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim(),
          role: newRole,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create admin user');
      }
      setNewEmail('');
      setNewName('');
      setNewRole('moderator');
      setNotice('Admin user created');
      await loadUsers();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to create admin user');
    } finally {
      setSaving(false);
    }
  }, [headers, loadUsers, newEmail, newName, newRole]);

  const updateUser = useCallback(
    async (user: AdminUserRow, patch: Partial<AdminUserRow>) => {
      try {
        setSaving(true);
        setError('');
        setNotice('');
        const response = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id: user.id,
            ...patch,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to update admin user');
        }
        setNotice('Admin user updated');
        await loadUsers();
      } catch (err) {
        setError((err as Error)?.message || 'Failed to update admin user');
      } finally {
        setSaving(false);
      }
    },
    [headers, loadUsers]
  );

  const deactivateUser = useCallback(
    async (id: string) => {
      try {
        setSaving(true);
        setError('');
        setNotice('');
        const response = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'x-admin-id': adminId },
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to deactivate admin user');
        }
        setNotice('Admin user deactivated');
        await loadUsers();
      } catch (err) {
        setError((err as Error)?.message || 'Failed to deactivate admin user');
      } finally {
        setSaving(false);
      }
    },
    [adminId, loadUsers]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading admin users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Admin Users</h1>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white">Create Admin User</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="Name"
          />
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="Email"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            {ROLE_OPTIONS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button onClick={createUser} disabled={saving} className="bg-primary hover:bg-primary/90 text-white">
            {saving ? 'Saving...' : 'Create'}
          </Button>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      </Card>

      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-700/40">
                  <td className="px-4 py-3 text-sm text-white">{user.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{user.email}</td>
                  <td className="px-4 py-3 text-sm">
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user, { role: e.target.value })}
                      disabled={saving || !user.is_active}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
                    >
                      {ROLE_OPTIONS.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={user.is_active ? 'text-emerald-400' : 'text-amber-300'}>
                      {user.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {user.is_active ? (
                      <Button
                        onClick={() => deactivateUser(user.id)}
                        disabled={saving}
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                      >
                        Deactivate
                      </Button>
                    ) : (
                      <Button
                        onClick={() => updateUser(user, { is_active: true })}
                        disabled={saving}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Reactivate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
