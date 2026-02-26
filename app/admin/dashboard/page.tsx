'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card } from '@/components/ui/card';
import { Ticket, Users, MapPin, TrendingUp } from 'lucide-react';

interface DashboardStats {
  activeTickets: number;
  totalTickets: number;
  cancelledTickets: number;
  pendingApprovals: number;
  approvedTickets: number;
  totalCustomers: number;
  totalRevenue: number;
  activeTrips: number;
  gnplPendingApplications: number;
  gnplActiveAccounts: number;
  gnplPendingPayments: number;
  gnplOutstandingTotal: number;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeTickets: 0,
    totalTickets: 0,
    cancelledTickets: 0,
    pendingApprovals: 0,
    approvedTickets: 0,
    totalCustomers: 0,
    totalRevenue: 0,
    activeTrips: 0,
    gnplPendingApplications: 0,
    gnplActiveAccounts: 0,
    gnplPendingPayments: 0,
    gnplOutstandingTotal: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const supabase = createClient();

      // Get total tickets
      const { count: totalTickets } = await supabase
        .from('tickets')
        .select('*', { count: 'exact' });
      const { count: cancelledTickets } = await supabase
        .from('tickets')
        .select('*', { count: 'exact' })
        .in('ticket_status', ['cancelled', 'canceled']);

      // Get pending receipts
      const { count: pendingApprovals } = await supabase
        .from('receipts')
        .select('*', { count: 'exact' })
        .eq('approval_status', 'pending');

      // Get approved receipts
      const { count: approvedTickets } = await supabase
        .from('receipts')
        .select('*', { count: 'exact' })
        .eq('approval_status', 'approved');

      // Get total customers
      const { count: totalCustomers } = await supabase
        .from('telegram_users')
        .select('*', { count: 'exact' });

      // Get total revenue
      const { data: receipts } = await supabase
        .from('receipts')
        .select('amount_paid')
        .eq('approval_status', 'approved');

      const totalRevenue = receipts?.reduce((sum, r) => sum + (r.amount_paid || 0), 0) || 0;

      // Get active trips
      const { count: activeTrips } = await supabase
        .from('trips')
        .select('*', { count: 'exact' })
        .eq('status', 'active');

      let gnplPendingApplications = 0;
      let gnplActiveAccounts = 0;
      let gnplPendingPayments = 0;
      let gnplOutstandingTotal = 0;
      {
        const [accountsResult, paymentsResult] = await Promise.all([
          supabase
            .from('gnpl_accounts')
            .select('status, outstanding_amount'),
          supabase
            .from('gnpl_payments')
            .select('status', { count: 'exact' })
            .eq('status', 'pending'),
        ]);

        const accountRows = (accountsResult.data || []) as Array<{ status?: string | null; outstanding_amount?: number | null }>;
        for (const row of accountRows) {
          const normalized = String(row.status || '').toLowerCase();
          if (normalized === 'pending_approval') gnplPendingApplications += 1;
          if (normalized === 'approved' || normalized === 'overdue') {
            gnplActiveAccounts += 1;
            gnplOutstandingTotal += Number(row.outstanding_amount || 0);
          }
        }
        gnplOutstandingTotal = Number(gnplOutstandingTotal.toFixed(2));
        gnplPendingPayments = Number(paymentsResult.count || 0);
      }

      setStats({
        activeTickets: Math.max(0, Number(totalTickets || 0) - Number(cancelledTickets || 0)),
        totalTickets: totalTickets || 0,
        cancelledTickets: cancelledTickets || 0,
        pendingApprovals: pendingApprovals || 0,
        approvedTickets: approvedTickets || 0,
        totalCustomers: totalCustomers || 0,
        totalRevenue,
        activeTrips: activeTrips || 0,
        gnplPendingApplications,
        gnplActiveAccounts,
        gnplPendingPayments,
        gnplOutstandingTotal,
      });
    } catch (error) {
      console.error('[dashboard] Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading dashboard...</div>
      </div>
    );
  }

  const statCards = [
    {
      title: 'Active Tickets',
      value: stats.activeTickets,
      icon: Ticket,
      bgColor: 'bg-blue-900/20',
      iconColor: 'text-blue-400',
      borderColor: 'border-blue-800',
    },
    {
      title: 'Cancelled Tickets',
      value: stats.cancelledTickets,
      icon: Ticket,
      bgColor: 'bg-slate-900/20',
      iconColor: 'text-slate-300',
      borderColor: 'border-slate-700',
    },
    {
      title: 'Pending Approvals',
      value: stats.pendingApprovals,
      icon: TrendingUp,
      bgColor: 'bg-yellow-900/20',
      iconColor: 'text-yellow-400',
      borderColor: 'border-yellow-800',
    },
    {
      title: 'Approved Tickets',
      value: stats.approvedTickets,
      icon: Ticket,
      bgColor: 'bg-green-900/20',
      iconColor: 'text-green-400',
      borderColor: 'border-green-800',
    },
    {
      title: 'Total Customers',
      value: stats.totalCustomers,
      icon: Users,
      bgColor: 'bg-purple-900/20',
      iconColor: 'text-purple-400',
      borderColor: 'border-purple-800',
    },
    {
      title: 'Total Revenue',
      value: `${stats.totalRevenue.toFixed(2)} ETB`,
      icon: TrendingUp,
      bgColor: 'bg-emerald-900/20',
      iconColor: 'text-emerald-400',
      borderColor: 'border-emerald-800',
    },
    {
      title: 'Active Trips',
      value: stats.activeTrips,
      icon: MapPin,
      bgColor: 'bg-orange-900/20',
      iconColor: 'text-orange-400',
      borderColor: 'border-orange-800',
    },
    {
      title: 'GNPL Pending Apps',
      value: stats.gnplPendingApplications,
      icon: TrendingUp,
      bgColor: 'bg-indigo-900/20',
      iconColor: 'text-indigo-300',
      borderColor: 'border-indigo-800',
    },
    {
      title: 'GNPL Active',
      value: stats.gnplActiveAccounts,
      icon: Users,
      bgColor: 'bg-cyan-900/20',
      iconColor: 'text-cyan-300',
      borderColor: 'border-cyan-800',
    },
    {
      title: 'GNPL Pending Payments',
      value: stats.gnplPendingPayments,
      icon: Ticket,
      bgColor: 'bg-amber-900/20',
      iconColor: 'text-amber-300',
      borderColor: 'border-amber-800',
    },
    {
      title: 'GNPL Outstanding',
      value: `${stats.gnplOutstandingTotal.toFixed(2)} ETB`,
      icon: TrendingUp,
      bgColor: 'bg-rose-900/20',
      iconColor: 'text-rose-300',
      borderColor: 'border-rose-800',
    },
  ];

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-8">Dashboard Overview</h1>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Card
              key={idx}
              className={`${card.bgColor} border ${card.borderColor} bg-slate-800/30`}
            >
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-slate-200 text-sm font-medium">{card.title}</h3>
                  <Icon className={`${card.iconColor} w-6 h-6`} />
                </div>
                <p className="text-3xl font-bold text-white">{card.value}</p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card className="bg-slate-800 border-slate-700">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <a
              href="/admin/tickets?filter=pending"
              className="p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-200 hover:text-white text-center font-medium"
            >
              Review Pending Tickets
            </a>
            <a
              href="/admin/customers"
              className="p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-200 hover:text-white text-center font-medium"
            >
              Manage Customers
            </a>
            <a
              href="/admin/trips"
              className="p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-200 hover:text-white text-center font-medium"
            >
              Manage Trips
            </a>
            <a
              href="/admin/gnpl"
              className="p-4 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors text-slate-200 hover:text-white text-center font-medium"
            >
              Review GNPL
            </a>
          </div>
        </div>
      </Card>

      {/* Info Panel */}
      <Card className="bg-slate-800 border-slate-700 mt-6">
        <div className="p-6">
          <h3 className="text-white font-semibold mb-2">System Status</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-400">Last Updated</p>
              <p className="text-green-400 font-medium">{new Date().toLocaleTimeString()}</p>
            </div>
            <div>
              <p className="text-slate-400">Database Status</p>
              <p className="text-green-400 font-medium">Connected</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
