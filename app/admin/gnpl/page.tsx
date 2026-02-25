'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';

type GnplAccount = {
  id: string;
  status: string;
  tripName: string;
  destination: string;
  customerName: string;
  customerPhone: string;
  idNumber: string;
  idCardFileUrl: string;
  idCardFileName: string;
  idCardMimeType: string;
  idCardUploadedAt: string;
  quantity: number;
  dueDate: string | null;
  totalDue: number;
  penaltyOutstanding: number;
  createdAt: string;
};

type GnplPayment = {
  id: string;
  gnplAccountId: string;
  amount: number;
  paymentReference: string;
  paymentDate: string;
  createdAt: string;
  receiptLink?: string;
  customerName: string;
  customerPhone: string;
  accountStatus: string;
};

export default function AdminGnplPage() {
  const session = getAdminSession();
  const adminId = String(session?.admin?.id || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [accounts, setAccounts] = useState<GnplAccount[]>([]);
  const [pendingPayments, setPendingPayments] = useState<GnplPayment[]>([]);
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [paymentRejectionReason, setPaymentRejectionReason] = useState<Record<string, string>>({});
  const [applicationRejectionReason, setApplicationRejectionReason] = useState<Record<string, string>>({});

  const pendingApplications = useMemo(
    () => accounts.filter((row) => String(row.status || '').toLowerCase() === 'pending_approval'),
    [accounts]
  );

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('search', search.trim());
      const response = await fetch(`/api/admin/gnpl?${params.toString()}`, {
        cache: 'no-store',
        headers: adminId ? { 'x-admin-id': adminId } : undefined,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to load GNPL data');
      }
      setAccounts((json.accounts || []) as GnplAccount[]);
      setPendingPayments((json.pendingPayments || []) as GnplPayment[]);
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load GNPL data');
      setAccounts([]);
      setPendingPayments([]);
    } finally {
      setLoading(false);
    }
  }, [adminId, search, statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const runAction = useCallback(
    async (payload: Record<string, unknown>, successMessage: string) => {
      try {
        setSaving(true);
        setError('');
        setNotice('');
        const response = await fetch('/api/admin/gnpl', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(adminId ? { 'x-admin-id': adminId } : {}),
          },
          body: JSON.stringify({
            ...payload,
            adminId,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Operation failed');
        }
        setNotice(successMessage);
        await loadData();
      } catch (err) {
        setError((err as Error)?.message || 'Operation failed');
      } finally {
        setSaving(false);
      }
    },
    [adminId, loadData]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading GNPL module...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-white">GNPL Management</h1>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="">All statuses</option>
            <option value="pending_approval">Pending approval</option>
            <option value="approved">Approved</option>
            <option value="overdue">Overdue</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by phone, name, or ID number"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <Button onClick={loadData} className="bg-primary hover:bg-primary/90 text-white">
            Refresh
          </Button>
        </div>
      </Card>

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-400">{notice}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-xs text-slate-400">Pending Applications</p>
          <p className="text-2xl font-semibold text-white">{pendingApplications.length}</p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-xs text-slate-400">Pending Payments</p>
          <p className="text-2xl font-semibold text-white">{pendingPayments.length}</p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-xs text-slate-400">Active / Overdue</p>
          <p className="text-2xl font-semibold text-white">
            {accounts.filter((row) => ['approved', 'overdue'].includes(String(row.status || '').toLowerCase())).length}
          </p>
        </Card>
        <Card className="bg-slate-800 border-slate-700 p-4">
          <p className="text-xs text-slate-400">Outstanding Total</p>
          <p className="text-2xl font-semibold text-amber-300">
            ETB {accounts.reduce((sum, row) => sum + Number(row.totalDue || 0), 0).toFixed(2)}
          </p>
        </Card>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Applications</h2>
        <div className="space-y-3">
          {accounts.length === 0 ? (
            <p className="text-sm text-slate-400">No GNPL records found.</p>
          ) : null}
          {accounts.map((account) => {
            const isPending = String(account.status || '').toLowerCase() === 'pending_approval';
            return (
              <div key={account.id} className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-white font-medium">
                    {account.customerName} ({account.customerPhone || '-'})
                  </p>
                  <span className="text-xs px-2 py-1 rounded border border-slate-600 bg-slate-800 uppercase text-slate-200">
                    {account.status}
                  </span>
                </div>
                <p className="text-xs text-slate-300">
                  Trip: {account.tripName} ({account.destination}) | Qty: {account.quantity}
                </p>
                <p className="text-xs text-slate-300">
                  ID Evidence:{' '}
                  {account.idCardFileUrl ? (
                    <a
                      href={account.idCardFileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-300 underline"
                    >
                      {account.idCardFileName || 'Open uploaded ID scan'}
                    </a>
                  ) : account.idNumber ? (
                    `Legacy ID: ${account.idNumber}`
                  ) : (
                    'Missing'
                  )}
                </p>
                <p className="text-xs text-slate-300">
                  Due: {account.dueDate || '-'} | Total due: ETB {Number(account.totalDue || 0).toFixed(2)} | Penalty due:
                  ETB {Number(account.penaltyOutstanding || 0).toFixed(2)}
                </p>
                {isPending ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <input
                      type="text"
                      value={approvalNotes[account.id] || ''}
                      onChange={(e) =>
                        setApprovalNotes((prev) => ({
                          ...prev,
                          [account.id]: e.target.value,
                        }))
                      }
                      placeholder="Approval note (optional)"
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm"
                    />
                    <input
                      type="text"
                      value={applicationRejectionReason[account.id] || ''}
                      onChange={(e) =>
                        setApplicationRejectionReason((prev) => ({
                          ...prev,
                          [account.id]: e.target.value,
                        }))
                      }
                      placeholder="Rejection reason"
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm"
                    />
                    <div className="flex gap-2">
                      <Button
                        disabled={saving}
                        onClick={() =>
                          runAction(
                            {
                              action: 'approve_application',
                              accountId: account.id,
                              notes: approvalNotes[account.id] || undefined,
                            },
                            'GNPL application approved'
                          )
                        }
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        Approve
                      </Button>
                      <Button
                        disabled={saving}
                        onClick={() =>
                          runAction(
                            {
                              action: 'reject_application',
                              accountId: account.id,
                              reason: applicationRejectionReason[account.id] || 'GNPL request rejected',
                            },
                            'GNPL application rejected'
                          )
                        }
                        className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <h2 className="text-lg font-semibold text-white mb-4">Pending Repayment Proofs</h2>
        <div className="space-y-3">
          {pendingPayments.length === 0 ? (
            <p className="text-sm text-slate-400">No pending GNPL payment submissions.</p>
          ) : null}
          {pendingPayments.map((payment) => (
            <div key={payment.id} className="rounded-lg border border-slate-700 bg-slate-900/70 p-3 space-y-2">
              <p className="text-sm text-white font-medium">
                {payment.customerName} ({payment.customerPhone || '-'})
              </p>
              <p className="text-xs text-slate-300">
                Amount: ETB {Number(payment.amount || 0).toFixed(2)} | Ref: {payment.paymentReference} | Date:{' '}
                {payment.paymentDate || '-'}
              </p>
              <p className="text-xs text-slate-400">
                Account status: {payment.accountStatus}
                {payment.receiptLink ? (
                  <>
                    {' | '}
                    <a
                      href={payment.receiptLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-300 underline"
                    >
                      Open receipt link
                    </a>
                  </>
                ) : null}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  value={paymentRejectionReason[payment.id] || ''}
                  onChange={(e) =>
                    setPaymentRejectionReason((prev) => ({
                      ...prev,
                      [payment.id]: e.target.value,
                    }))
                  }
                  placeholder="Rejection reason"
                  className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm md:col-span-2"
                />
                <div className="flex gap-2">
                  <Button
                    disabled={saving}
                    onClick={() =>
                      runAction(
                        {
                          action: 'approve_payment',
                          paymentId: payment.id,
                        },
                        'GNPL payment approved'
                      )
                    }
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    Approve
                  </Button>
                  <Button
                    disabled={saving}
                    onClick={() =>
                      runAction(
                        {
                          action: 'reject_payment',
                          paymentId: payment.id,
                          reason: paymentRejectionReason[payment.id] || 'Payment evidence rejected',
                        },
                        'GNPL payment rejected'
                      )
                    }
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
