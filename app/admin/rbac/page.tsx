'use client';

import { Card } from '@/components/ui/card';
import { ADMIN_PERMISSIONS, ADMIN_ROLES, getAdminPermissionsForRole } from '@/lib/admin-rbac';

function formatLabel(value: string) {
  return value.replace(/_/g, ' ');
}

export default function AdminRbacPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">RBAC and Role Management</h1>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-3">
        <h2 className="text-lg font-semibold text-white">Admin User Management</h2>
        <p className="text-sm text-slate-300">
          Manage users and assign roles on the <a href="/admin/users" className="text-cyan-300 underline">Admin Users</a> page.
        </p>
        <p className="text-xs text-slate-400">
          Security guardrails: only system admins can grant/remove the <code>system_admin</code> role, and users cannot deactivate themselves.
        </p>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Role Permission Matrix</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="p-2 text-left text-xs font-semibold text-slate-300">Permission</th>
                {ADMIN_ROLES.map((role) => (
                  <th key={role} className="p-2 text-center text-xs font-semibold text-slate-300">
                    {formatLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ADMIN_PERMISSIONS.map((permission) => (
                <tr key={permission} className="border-b border-slate-800/60">
                  <td className="p-2 text-xs text-slate-200">{formatLabel(permission)}</td>
                  {ADMIN_ROLES.map((role) => {
                    const allowed = getAdminPermissionsForRole(role).includes(permission);
                    return (
                      <td key={`${permission}-${role}`} className="p-2 text-center text-sm">
                        <span className={allowed ? 'text-emerald-400' : 'text-slate-500'}>
                          {allowed ? 'Yes' : 'No'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

