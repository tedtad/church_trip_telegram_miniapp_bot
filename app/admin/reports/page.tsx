'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';

type ReportRow = Record<string, string | number | null>;

type ReportResponse = {
  ok: boolean;
  type?: string;
  headers?: string[];
  rows?: ReportRow[];
  error?: string;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function minusDaysYmd(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export default function AdminReportsPage() {
  const session = getAdminSession();
  const adminId = String(session?.admin?.id || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState(minusDaysYmd(30));
  const [dateTo, setDateTo] = useState(todayYmd());
  const [type, setType] = useState('sales_summary');
  const [data, setData] = useState<ReportResponse | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set('type', type);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    return params;
  }, [dateFrom, dateTo, type]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/admin/reports?${queryParams.toString()}`, {
        cache: 'no-store',
        headers: { 'x-admin-id': adminId },
      });
      const json = (await response.json().catch(() => ({}))) as ReportResponse;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load report');
      }
      setData(json);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load report');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [adminId, queryParams]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = useCallback(() => {
    const params = new URLSearchParams(queryParams);
    params.set('export', 'csv');
    if (adminId) params.set('adminId', adminId);
    window.open(`/api/admin/reports?${params.toString()}`, '_blank');
  }, [adminId, queryParams]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Admin Reports</h1>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="sales_summary">Sales by Trip</option>
            <option value="payment_methods">Payment Method Breakdown</option>
            <option value="ticket_status">Ticket Status Snapshot</option>
            <option value="daily_sales">Daily Approved Sales</option>
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <Button onClick={load} disabled={loading} className="bg-primary hover:bg-primary/90 text-white">
            {loading ? 'Loading...' : 'Generate'}
          </Button>
          <Button onClick={exportCsv} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            Export CSV
          </Button>
        </div>
      </Card>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                {(data?.headers || []).map((header) => (
                  <th key={header} className="px-4 py-3 text-left text-xs font-semibold text-slate-300">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {(data?.rows || []).map((row, index) => (
                <tr key={`${index}-${String(row[(data?.headers || [])[0] || ''])}`} className="hover:bg-slate-700/40">
                  {(data?.headers || []).map((header) => (
                    <td key={header} className="px-4 py-3 text-sm text-slate-200">
                      {String(row[header] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
