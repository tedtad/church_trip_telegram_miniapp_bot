'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { getAdminSession, adminLogout } from '@/lib/admin-auth';
import { AdminPermission, hasAdminPermission, normalizeAdminRole } from '@/lib/admin-rbac';
import { Button } from '@/components/ui/button';
import { LayoutDashboard, Users, Ticket, MapPin, LogOut, Menu, X, BarChart3, Database, Link as LinkIcon, Zap, Bot, QrCode, Tag, Settings, Heart, Wallet } from 'lucide-react';

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [adminName, setAdminName] = useState('');
  const [adminRole, setAdminRole] = useState('admin');

  useEffect(() => {
    const session = getAdminSession();
    if (!session) {
      // Only redirect if not on login page
      if (!pathname?.includes('/login')) {
        router.push('/admin/login');
      }
    } else {
      setAuthenticated(true);
      setAdminName(session.admin.name || session.admin.email);
      setAdminRole(normalizeAdminRole(session.admin.role));
    }
    setLoading(false);
  }, [pathname, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  if (!authenticated && !pathname?.includes('/login')) {
    return null;
  }

  if (pathname?.includes('/login')) {
    return children;
  }

  const navItems: Array<{ icon: any; label: string; href: string; permission: AdminPermission }> = [
    { icon: LayoutDashboard, label: 'Dashboard', href: '/admin/dashboard', permission: 'dashboard_view' },
    { icon: Ticket, label: 'Tickets', href: '/admin/tickets', permission: 'tickets_review' },
    { icon: QrCode, label: 'Check-In Scanner', href: '/admin/checkin', permission: 'tickets_checkin' },
    { icon: Users, label: 'Customers', href: '/admin/customers', permission: 'customers_view' },
    { icon: MapPin, label: 'Trips', href: '/admin/trips', permission: 'trips_manage' },
    { icon: BarChart3, label: 'Analytics', href: '/admin/analytics', permission: 'analytics_view' },
    { icon: Wallet, label: 'GNPL', href: '/admin/gnpl', permission: 'tickets_review' },
    { icon: Tag, label: 'Discounts', href: '/admin/discount-codes', permission: 'discounts_manage' },
    { icon: Heart, label: 'Charity', href: '/admin/charity', permission: 'charity_manage' },
    { icon: LinkIcon, label: 'Invitations', href: '/admin/invitations', permission: 'invitations_manage' },
    { icon: Zap, label: 'Bulk Ops', href: '/admin/bulk-operations', permission: 'bulk_ops_manage' },
    { icon: Bot, label: 'Bot Control', href: '/admin/bot', permission: 'bot_manage' },
    { icon: Database, label: 'Backups', href: '/admin/backups', permission: 'backups_manage' },
    { icon: Database, label: 'Reconciliation', href: '/admin/reconciliation', permission: 'reconciliation_view' },
    { icon: Database, label: 'Reports', href: '/admin/reports', permission: 'reports_view' },
    { icon: Users, label: 'Admin Users', href: '/admin/users', permission: 'admin_users_manage' },
    { icon: Settings, label: 'Settings', href: '/admin/settings', permission: 'settings_manage' },
  ];
  const visibleNavItems = navItems.filter((item) => hasAdminPermission(adminRole, item.permission));
  const routePermissions: Array<{ prefix: string; permission: AdminPermission }> = [
    { prefix: '/admin/dashboard', permission: 'dashboard_view' },
    { prefix: '/admin/tickets', permission: 'tickets_review' },
    { prefix: '/admin/checkin', permission: 'tickets_checkin' },
    { prefix: '/admin/customers', permission: 'customers_view' },
    { prefix: '/admin/trips', permission: 'trips_manage' },
    { prefix: '/admin/analytics', permission: 'analytics_view' },
    { prefix: '/admin/gnpl', permission: 'tickets_review' },
    { prefix: '/admin/discount-codes', permission: 'discounts_manage' },
    { prefix: '/admin/charity', permission: 'charity_manage' },
    { prefix: '/admin/invitations', permission: 'invitations_manage' },
    { prefix: '/admin/bulk-operations', permission: 'bulk_ops_manage' },
    { prefix: '/admin/bot', permission: 'bot_manage' },
    { prefix: '/admin/backups', permission: 'backups_manage' },
    { prefix: '/admin/reconciliation', permission: 'reconciliation_view' },
    { prefix: '/admin/reports', permission: 'reports_view' },
    { prefix: '/admin/users', permission: 'admin_users_manage' },
    { prefix: '/admin/settings', permission: 'settings_manage' },
  ];
  const currentRoutePermission =
    routePermissions.find((item) => pathname?.startsWith(item.prefix))?.permission || null;
  const canAccessCurrentRoute = !currentRoutePermission || hasAdminPermission(adminRole, currentRoutePermission);
  const fallbackRoute = visibleNavItems[0]?.href || '/admin/login';

  const handleLogout = async () => {
    await adminLogout();
    router.push('/admin/login');
  };

  return (
    <div className="min-h-screen flex bg-slate-900">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? 'w-64' : 'w-20'
          } bg-slate-800 border-r border-slate-700 transition-all duration-300 flex flex-col fixed h-screen lg:relative`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-slate-700 flex items-center justify-between">
          {sidebarOpen && <h1 className="font-bold text-white text-lg">TicketHub</h1>}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-slate-400 hover:text-white lg:hidden"
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-2">
          {visibleNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${isActive
                    ? 'bg-primary text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                  }`}
              >
                <item.icon size={20} />
                {sidebarOpen && <span>{item.label}</span>}
              </a>
            );
          })}
        </nav>

        {/* Admin Info & Logout */}
        <div className="p-4 border-t border-slate-700">
          {sidebarOpen && (
            <div className="mb-4 p-3 bg-slate-700/50 rounded-lg">
              <p className="text-xs text-slate-400">Logged in as</p>
              <p className="text-sm font-medium text-white truncate">{adminName}</p>
              <p className="text-xs text-slate-400 mt-1">Role: {adminRole.replace(/_/g, ' ')}</p>
            </div>
          )}
          {sidebarOpen ? (
            <a
              href="https://t.me/tedtad"
              target="_blank"
              rel="noreferrer"
              className="mb-2 block text-xs text-cyan-300 hover:text-cyan-200"
            >
              Developed by @Teddy
            </a>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
          >
            <LogOut size={16} />
            {sidebarOpen && 'Logout'}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden lg:ml-0">
        {/* Top Header */}
        <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="text-slate-400 hover:text-white hidden lg:block"
            >
              {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
            <h2 className="text-white font-semibold text-lg">Admin Dashboard</h2>
            <div className="text-sm text-slate-400">
              {new Date().toLocaleDateString()}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto bg-slate-900 p-6">
          {canAccessCurrentRoute ? (
            children
          ) : (
            <div className="mx-auto max-w-xl rounded-lg border border-slate-700 bg-slate-800 p-6 text-slate-100">
              <h3 className="text-lg font-semibold">Access denied</h3>
              <p className="mt-2 text-sm text-slate-300">
                Your role does not have permission to open this page.
              </p>
              <a
                href={fallbackRoute}
                className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
              >
                Go to allowed page
              </a>
            </div>
          )}
        </main>
      </div>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
