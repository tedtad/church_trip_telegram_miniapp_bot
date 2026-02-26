'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';

type AnalyticsPayload = {
  ok: boolean;
  summary?: {
    totalUsers: number;
    totalTickets: number;
    activeTickets: number;
    soldTickets: number;
    pendingTickets: number;
    confirmedTickets: number;
    cancelledTickets: number;
    usedTickets: number;
    pendingApprovals: number;
    totalRevenue: number;
  };
  topTrips?: Array<{
    name: string;
    destination: string;
    count: number;
    revenue: number;
  }>;
  dailyRevenue?: Array<{
    date: string;
    revenue: number;
  }>;
};

export default function AnalyticsPage() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AnalyticsPayload | null>(null);

  useEffect(() => {
    loadAnalytics();
  }, []);

  async function loadAnalytics() {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/analytics', { cache: 'no-store' });
      const payload = (await response.json()) as AnalyticsPayload;
      setData(payload);
    } catch (error) {
      console.error('[analytics-page] Failed to load analytics:', error);
      setData({ ok: false });
    } finally {
      setLoading(false);
    }
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">Analytics</h1>
      </div>

      {loading ? (
        <Card className="bg-slate-800 border-slate-700 p-8 text-slate-300">Loading analytics...</Card>
      ) : !data?.ok || !summary ? (
        <Card className="bg-slate-800 border-slate-700 p-8 text-red-300">
          Analytics data could not be loaded.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            <Card className="bg-slate-800 border-slate-700 p-5">
              <p className="text-slate-400 text-sm">Total Users</p>
              <p className="text-2xl font-bold text-white">{summary.totalUsers}</p>
            </Card>
            <Card className="bg-slate-800 border-slate-700 p-5">
              <p className="text-slate-400 text-sm">Total Revenue</p>
              <p className="text-2xl font-bold text-white">{summary.totalRevenue.toLocaleString()} ETB</p>
            </Card>
            <Card className="bg-slate-800 border-slate-700 p-5">
              <p className="text-slate-400 text-sm">Sold Tickets</p>
              <p className="text-2xl font-bold text-white">{summary.soldTickets}</p>
            </Card>
            <Card className="bg-slate-800 border-slate-700 p-5">
              <p className="text-slate-400 text-sm">Pending Approvals</p>
              <p className="text-2xl font-bold text-white">{summary.pendingApprovals}</p>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card className="bg-slate-800 border-slate-700 p-5">
              <h3 className="text-white font-semibold mb-4">Ticket Status Overview</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-slate-300">
                  <span>Total</span>
                  <span>{summary.totalTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Active (excluding cancelled)</span>
                  <span>{summary.activeTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Sold (confirmed + used)</span>
                  <span>{summary.soldTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Pending</span>
                  <span>{summary.pendingTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Confirmed</span>
                  <span>{summary.confirmedTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Used</span>
                  <span>{summary.usedTickets}</span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Cancelled</span>
                  <span>{summary.cancelledTickets}</span>
                </div>
              </div>
            </Card>

            <Card className="bg-slate-800 border-slate-700 p-5">
              <h3 className="text-white font-semibold mb-4">Top Trips (Sold Tickets)</h3>
              {!data.topTrips?.length ? (
                <p className="text-slate-400 text-sm">No sold tickets yet.</p>
              ) : (
                <div className="space-y-3">
                  {data.topTrips.map((trip, idx) => (
                    <div key={`${trip.name}-${idx}`} className="flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm font-medium">{trip.name}</p>
                        <p className="text-slate-400 text-xs">{trip.destination}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-white text-sm">{trip.count} tickets</p>
                        <p className="text-slate-400 text-xs">{trip.revenue.toLocaleString()} ETB</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <Card className="bg-slate-800 border-slate-700 p-5">
            <h3 className="text-white font-semibold mb-4">Daily Approved Revenue</h3>
            {!data.dailyRevenue?.length ? (
              <p className="text-slate-400 text-sm">No approved revenue records yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {data.dailyRevenue.map((item) => (
                  <div key={item.date} className="rounded-md border border-slate-700 p-3">
                    <p className="text-slate-400 text-xs">{item.date}</p>
                    <p className="text-white text-sm font-semibold">{item.revenue.toLocaleString()} ETB</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
