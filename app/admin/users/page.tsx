'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  phone_number?: string;
  role: string;
  is_active: boolean;
  telegram_user_id?: number | null;
  two_factor_enabled?: boolean;
  created_at?: string;
  last_login?: string | null;
};

type OnboardingInfo = {
  token: string;
  otp: string;
  expiresAt: string;
  message: string;
  botStartLink: string;
  telegramShareLink: string;
  email: string;
};

const FALLBACK_ROLE_OPTIONS = ['system_admin', 'admin', 'moderator', 'analyst', 'sales_agent', 'user'];

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhoneNumber, setNewPhoneNumber] = useState('');
  const [newRole, setNewRole] = useState('moderator');
  const [newTwoFactorEnabled, setNewTwoFactorEnabled] = useState(true);
  const [onboardingInfo, setOnboardingInfo] = useState<OnboardingInfo | null>(null);
  const [roleOptions, setRoleOptions] = useState<Array<{ code: string; name: string }>>([]);

  const headers = useMemo(
    () => ({
      'Content-Type': 'application/json',
    }),
    []
  );

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/admin/users', {
        cache: 'no-store',
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
  }, []);

  const loadRoleOptions = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/rbac', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) return;
      const roles = Array.isArray(json?.roles) ? json.roles : [];
      const mapped = roles
        .filter((role: any) => role?.code && role?.is_active !== false)
        .map((role: any) => ({
          code: String(role.code),
          name: String(role.name || role.code),
        }));
      if (mapped.length) {
        setRoleOptions(mapped);
      }
    } catch {
      // keep fallback roles
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadRoleOptions();
  }, [loadRoleOptions, loadUsers]);

  const availableRoleOptions = useMemo(() => {
    if (roleOptions.length) return roleOptions;
    return FALLBACK_ROLE_OPTIONS.map((code) => ({ code, name: code }));
  }, [roleOptions]);

  useEffect(() => {
    if (!availableRoleOptions.find((role) => role.code === newRole)) {
      setNewRole(availableRoleOptions[0]?.code || 'admin');
    }
  }, [availableRoleOptions, newRole]);

  const applyOnboarding = useCallback((payload: any, email: string) => {
    if (!payload?.message) return;
    setOnboardingInfo({
      token: String(payload.token || ''),
      otp: String(payload.otp || ''),
      expiresAt: String(payload.expiresAt || ''),
      message: String(payload.message || ''),
      botStartLink: String(payload.botStartLink || ''),
      telegramShareLink: String(payload.telegramShareLink || ''),
      email,
    });
  }, []);

  const createUser = useCallback(async () => {
    try {
      if (!newEmail.trim() || !newName.trim()) {
        setError('Name and email are required');
        return;
      }
      if (!newPhoneNumber.trim()) {
        setError('Phone number is required');
        return;
      }

      setSaving(true);
      setError('');
      setNotice('');
      setOnboardingInfo(null);

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          email: newEmail.trim(),
          name: newName.trim(),
          phone_number: newPhoneNumber.trim(),
          role: newRole,
          two_factor_enabled: newTwoFactorEnabled,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to create admin user');
      }

      setNewEmail('');
      setNewName('');
      setNewPhoneNumber('');
      setNewRole('moderator');
      setNewTwoFactorEnabled(true);
      setNotice('Admin user created. Send onboarding message via Telegram.');
      applyOnboarding(json?.onboarding, String(json?.user?.email || ''));
      await loadUsers();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to create admin user');
    } finally {
      setSaving(false);
    }
  }, [applyOnboarding, headers, loadUsers, newEmail, newName, newPhoneNumber, newRole, newTwoFactorEnabled]);

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

  const resetUser = useCallback(
    async (user: AdminUserRow) => {
      try {
        setSaving(true);
        setError('');
        setNotice('');
        setOnboardingInfo(null);

        const response = await fetch('/api/admin/users', {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            id: user.id,
            action: 'reset_user',
          }),
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to reset user');
        }

        setNotice('User reset completed. Share the onboarding message.');
        applyOnboarding(json?.onboarding, String(json?.user?.email || user.email));
        await loadUsers();
      } catch (err) {
        setError((err as Error)?.message || 'Failed to reset user');
      } finally {
        setSaving(false);
      }
    },
    [applyOnboarding, headers, loadUsers]
  );

  const deactivateUser = useCallback(
    async (id: string) => {
      try {
        setSaving(true);
        setError('');
        setNotice('');
        const response = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
          method: 'DELETE',
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
    [loadUsers]
  );

  const copyOnboardingMessage = useCallback(async () => {
    if (!onboardingInfo?.message) return;
    await navigator.clipboard.writeText(onboardingInfo.message);
    setNotice('Onboarding message copied to clipboard');
  }, [onboardingInfo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading admin users...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-white">Admin Users</h1>
        <a href="/admin/rbac" className="text-sm text-cyan-300 underline">
          Open RBAC Matrix
        </a>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white">Create Admin User</h2>
        <p className="text-sm text-slate-300">
          Flow: create user with email + phone, then share onboarding Telegram message with one-time code.
        </p>

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
          <input
            type="text"
            value={newPhoneNumber}
            onChange={(e) => setNewPhoneNumber(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            placeholder="Phone Number"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            {availableRoleOptions.map((role) => (
              <option key={role.code} value={role.code}>
                {role.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-center">
          <label className="inline-flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={newTwoFactorEnabled}
              onChange={(e) => setNewTwoFactorEnabled(e.target.checked)}
            />
            Enable 2FA
          </label>
          <Button onClick={createUser} disabled={saving} className="bg-primary hover:bg-primary/90 text-white">
            {saving ? 'Saving...' : 'Create'}
          </Button>
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}
      </Card>

      {onboardingInfo ? (
        <Card className="bg-slate-800 border-slate-700 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-white">Onboarding Message: {onboardingInfo.email}</h3>
            <Button
              className="bg-slate-700 hover:bg-slate-600 text-white"
              onClick={() => setOnboardingInfo(null)}
            >
              Close
            </Button>
          </div>
          <p className="text-sm text-slate-300">One-time code: {onboardingInfo.otp}</p>
          <p className="text-sm text-slate-300">
            Expires: {onboardingInfo.expiresAt ? new Date(onboardingInfo.expiresAt).toLocaleString() : 'N/A'}
          </p>
          <textarea
            className="w-full p-3 bg-slate-900 border border-slate-700 text-slate-100 rounded min-h-[180px]"
            readOnly
            value={onboardingInfo.message}
          />
          <div className="flex flex-wrap gap-2">
            <Button className="bg-primary hover:bg-primary/90 text-white" onClick={copyOnboardingMessage}>
              Copy Message
            </Button>
            {onboardingInfo.telegramShareLink ? (
              <a
                href={onboardingInfo.telegramShareLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md bg-cyan-700 px-3 py-2 text-sm text-white hover:bg-cyan-600"
              >
                Share via Telegram
              </a>
            ) : null}
            {onboardingInfo.botStartLink ? (
              <a
                href={onboardingInfo.botStartLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600"
              >
                Open Bot Start Link
              </a>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Email</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Role</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Telegram</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">2FA</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-slate-700/40">
                  <td className="px-4 py-3 text-sm text-white">{user.name}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{user.email}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">
                    <div className="flex items-center gap-2">
                      <span>{user.phone_number || 'N/A'}</span>
                      <Button
                        onClick={() => {
                          const value = window.prompt('Enter phone number', user.phone_number || '');
                          if (value === null) return;
                          updateUser(user, { phone_number: value } as any);
                        }}
                        disabled={saving}
                        className="bg-slate-700 hover:bg-slate-600 text-white"
                      >
                        Set
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user, { role: e.target.value })}
                      disabled={saving || !user.is_active}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
                    >
                      {availableRoleOptions.map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.name}
                        </option>
                      ))}
                      {!availableRoleOptions.find((role) => role.code === user.role) ? (
                        <option value={user.role}>{user.role}</option>
                      ) : null}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-300">
                    <div className="flex items-center gap-2">
                      <span>{user.telegram_user_id ? String(user.telegram_user_id) : 'Unlinked'}</span>
                      <Button
                        onClick={() => {
                          const value = window.prompt(
                            'Enter Telegram User ID',
                            user.telegram_user_id ? String(user.telegram_user_id) : ''
                          );
                          if (value === null) return;
                          updateUser(user, { telegram_user_id: value.replace(/\D/g, '') || null } as any);
                        }}
                        disabled={saving}
                        className="bg-slate-700 hover:bg-slate-600 text-white"
                      >
                        Set
                      </Button>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <Button
                      onClick={() =>
                        updateUser(user, { two_factor_enabled: !(user.two_factor_enabled !== false) } as any)
                      }
                      disabled={saving}
                      className={
                        user.two_factor_enabled !== false
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-amber-600 hover:bg-amber-700 text-white'
                      }
                    >
                      {user.two_factor_enabled !== false ? 'Enabled' : 'Disabled'}
                    </Button>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className={user.is_active ? 'text-emerald-400' : 'text-amber-300'}>
                      {user.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => resetUser(user)}
                        disabled={saving}
                        className="bg-cyan-700 hover:bg-cyan-600 text-white"
                      >
                        Reset User
                      </Button>
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
                    </div>
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
