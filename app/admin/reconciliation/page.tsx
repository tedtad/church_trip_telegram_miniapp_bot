'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';

type MethodSummary = {
  method: string;
  totalCount: number;
  totalAmount: number;
  approvedCount: number;
  approvedAmount: number;
  pendingCount: number;
  pendingAmount: number;
};

type ReconciliationResponse = {
  ok: boolean;
  summary?: {
    totalRecords: number;
    grandTotal: number;
    approvedTotal: number;
    pendingTotal: number;
  };
  byMethod?: MethodSummary[];
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

export default function AdminReconciliationPage() {
  const session = getAdminSession();
  const adminId = String(session?.admin?.id || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dateFrom, setDateFrom] = useState(minusDaysYmd(30));
  const [dateTo, setDateTo] = useState(todayYmd());
  const [paymentMethod, setPaymentMethod] = useState('');
  const [data, setData] = useState<ReconciliationResponse | null>(null);
  const [statementCsv, setStatementCsv] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState('');
  const [matchSummary, setMatchSummary] = useState<{ entries: number; matched: number; missing: number; mismatched: number } | null>(null);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);
    return params;
  }, [dateFrom, dateTo, paymentMethod]);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/admin/reconciliation?${queryParams.toString()}`, {
        cache: 'no-store',
        headers: { 'x-admin-id': adminId },
      });
      const json = (await response.json().catch(() => ({}))) as ReconciliationResponse;
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load reconciliation');
      }
      setData(json);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load reconciliation');
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
    const url = `/api/admin/reconciliation?${params.toString()}`;
    window.open(url, '_blank');
  }, [adminId, queryParams]);

  const reconcileStatement = useCallback(async () => {
    try {
      setMatchLoading(true);
      setMatchError('');
      setMatchSummary(null);
      const response = await fetch('/api/admin/reconciliation/match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
        },
        body: JSON.stringify({ csvText: statementCsv }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to reconcile statement');
      }
      setMatchSummary(json.summary || null);
    } catch (err) {
      setMatchError((err as Error)?.message || 'Failed to reconcile statement');
    } finally {
      setMatchLoading(false);
    }
  }, [adminId, statementCsv]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Financial Reconciliation</h1>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="">All methods</option>
            <option value="bank">Bank</option>
            <option value="telebirr">Telebirr Manual</option>
            <option value="telebirr_auto">Telebirr Auto</option>
            <option value="gnpl">GNPL</option>
            <option value="cash">Cash</option>
          </select>
          <div className="flex gap-2">
            <Button onClick={load} disabled={loading} className="bg-primary hover:bg-primary/90 text-white">
              {loading ? 'Loading...' : 'Apply'}
            </Button>
            <Button onClick={exportCsv} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Export CSV
            </Button>
          </div>
        </div>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-2">Statement Match (Bank/Telebirr)</h2>
        <p className="text-sm text-slate-400 mb-3">
          Paste CSV rows as `reference,amount` to reconcile statement lines against receipts.
        </p>
        <textarea
          value={statementCsv}
          onChange={(e) => setStatementCsv(e.target.value)}
          rows={5}
          placeholder={'reference,amount\nTX12345,1500\nREF9999,750'}
          className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
        />
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={reconcileStatement} disabled={matchLoading} className="bg-amber-600 hover:bg-amber-700 text-white">
            {matchLoading ? 'Reconciling...' : 'Run Match'}
          </Button>
          {matchError ? <span className="text-sm text-red-400">{matchError}</span> : null}
          {matchSummary ? (
            <span className="text-sm text-slate-200">
              Entries: {matchSummary.entries} | matched: {matchSummary.matched} | missing: {matchSummary.missing} | mismatched: {matchSummary.mismatched}
            </span>
          ) : null}
        </div>
      </Card>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}

      {data?.summary ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Card className="bg-slate-800 border-slate-700 p-4">
            <p className="text-xs text-slate-400">Records</p>
            <p className="text-xl text-white font-semibold">{data.summary.totalRecords}</p>
          </Card>
          <Card className="bg-slate-800 border-slate-700 p-4">
            <p className="text-xs text-slate-400">Total</p>
            <p className="text-xl text-white font-semibold">ETB {data.summary.grandTotal.toFixed(2)}</p>
          </Card>
          <Card className="bg-slate-800 border-slate-700 p-4">
            <p className="text-xs text-slate-400">Approved</p>
            <p className="text-xl text-emerald-300 font-semibold">ETB {data.summary.approvedTotal.toFixed(2)}</p>
          </Card>
          <Card className="bg-slate-800 border-slate-700 p-4">
            <p className="text-xs text-slate-400">Pending</p>
            <p className="text-xl text-amber-300 font-semibold">ETB {data.summary.pendingTotal.toFixed(2)}</p>
          </Card>
        </div>
      ) : null}

      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-900 border-b border-slate-700">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Method</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Records</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Approved</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-300">Pending</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {(data?.byMethod || []).map((item) => (
                <tr key={item.method} className="hover:bg-slate-700/40">
                  <td className="px-4 py-3 text-sm text-white">{item.method}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">{item.totalCount}</td>
                  <td className="px-4 py-3 text-sm text-slate-300">ETB {item.totalAmount.toFixed(2)}</td>
                  <td className="px-4 py-3 text-sm text-emerald-300">
                    {item.approvedCount} / ETB {item.approvedAmount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-sm text-amber-300">
                    {item.pendingCount} / ETB {item.pendingAmount.toFixed(2)}
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
