'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';
import { hasAdminPermission, normalizeAdminRole } from '@/lib/admin-rbac-client';

interface TripOption {
  id: string;
  name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  available_seats?: number | null;
  price_per_ticket?: number | null;
}

interface ManualCashSummary {
  adminId: string;
  totalCashSold: number;
  cashSaleCount: number;
  approvedRemittedAmount: number;
  pendingRemittedAmount: number;
  totalSubmittedAmount: number;
  outstandingAmount: number;
}

interface ManualCashRemittance {
  id: string;
  submitted_by_admin_id?: string;
  remitted_amount?: number;
  remittance_method?: string;
  approval_status?: string;
  created_at?: string;
  approved_at?: string | null;
  approval_notes?: string | null;
  rejection_reason?: string | null;
  bank_receipt_url?: string | null;
}

export default function ManualTicketSalePage() {
  const session = getAdminSession();
  const adminId = String(session?.admin?.id || '');
  const adminRole = normalizeAdminRole(session?.admin?.role);
  const canManualSell = hasAdminPermission(adminRole, 'tickets_manual_sale');

  const [loadingTrips, setLoadingTrips] = useState(true);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [tripId, setTripId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [amountPaid, setAmountPaid] = useState('');
  const [referenceNumber, setReferenceNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [loadingRemittance, setLoadingRemittance] = useState(false);
  const [manualCashSummary, setManualCashSummary] = useState<ManualCashSummary | null>(null);
  const [remittances, setRemittances] = useState<ManualCashRemittance[]>([]);
  const [canApproveRemittance, setCanApproveRemittance] = useState(false);
  const [submittingRemittance, setSubmittingRemittance] = useState(false);
  const [decisionBusyId, setDecisionBusyId] = useState('');
  const [remittanceMethod, setRemittanceMethod] = useState<'cash_handover' | 'bank_deposit'>('cash_handover');
  const [remittedAmount, setRemittedAmount] = useState('');
  const [remittanceNotes, setRemittanceNotes] = useState('');
  const [bankReceiptUrl, setBankReceiptUrl] = useState('');

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === tripId) || null,
    [tripId, trips]
  );

  const loadManualCashData = useCallback(async () => {
    if (!adminId) return;
    try {
      setLoadingRemittance(true);

      const [summaryResponse, remittancesResponse] = await Promise.all([
        fetch('/api/admin/manual-cash/summary', {
          cache: 'no-store',
          headers: { 'x-admin-id': adminId },
        }),
        fetch('/api/admin/manual-cash/remittances', {
          cache: 'no-store',
          headers: { 'x-admin-id': adminId },
        }),
      ]);

      const summaryJson = await summaryResponse.json().catch(() => ({}));
      if (summaryResponse.ok && summaryJson?.ok && summaryJson?.summary) {
        const summary = summaryJson.summary as ManualCashSummary;
        setManualCashSummary(summary);
        setRemittedAmount(
          Number(summary.outstandingAmount || 0) > 0
            ? Number(summary.outstandingAmount).toFixed(2)
            : ''
        );
        if (Array.isArray(summaryJson?.remittances)) {
          setRemittances(summaryJson.remittances as ManualCashRemittance[]);
        }
      }

      const remittancesJson = await remittancesResponse.json().catch(() => ({}));
      if (remittancesResponse.ok && remittancesJson?.ok) {
        setCanApproveRemittance(Boolean(remittancesJson?.canApprove));
        setRemittances((remittancesJson?.remittances || []) as ManualCashRemittance[]);
      }
    } catch (err) {
      setError((err as Error)?.message || 'Failed to load manual cash data');
    } finally {
      setLoadingRemittance(false);
    }
  }, [adminId]);

  useEffect(() => {
    if (!canManualSell) {
      setLoadingTrips(false);
      return;
    }

    const loadTrips = async () => {
      try {
        setLoadingTrips(true);
        const response = await fetch('/api/admin/trips', { cache: 'no-store' });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to load trips');
        }
        const active = ((json.trips || []) as TripOption[]).filter(
          (trip) => Number(trip.available_seats || 0) > 0
        );
        setTrips(active);
        setTripId((prev) => prev || String(active[0]?.id || ''));
      } catch (err) {
        setError((err as Error)?.message || 'Failed to load trips');
      } finally {
        setLoadingTrips(false);
      }
    };

    loadTrips();
    loadManualCashData();
  }, [canManualSell, loadManualCashData]);

  useEffect(() => {
    if (!selectedTrip) return;
    const unitPrice = Number(selectedTrip.price_per_ticket || 0);
    const expected = Number((unitPrice * Math.max(1, quantity)).toFixed(2));
    setAmountPaid(expected > 0 ? expected.toFixed(2) : '');
  }, [quantity, selectedTrip]);

  const submitManualSale = async () => {
    try {
      if (!canManualSell) {
        setError('Your role does not allow manual sales.');
        return;
      }
      if (!adminId) {
        setError('Admin session not found.');
        return;
      }
      if (!tripId) {
        setError('Please select a trip.');
        return;
      }
      if (!customerName.trim() || !customerPhone.trim()) {
        setError('Customer name and phone number are required.');
        return;
      }

      setSubmitting(true);
      setError('');
      setNotice('');

      const response = await fetch('/api/admin/tickets/manual-sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
        },
        body: JSON.stringify({
          tripId,
          quantity: Math.max(1, Number(quantity || 1)),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          paymentMethod,
          referenceNumber: referenceNumber.trim() || undefined,
          amountPaid: Number(amountPaid || 0),
          notes: notes.trim() || undefined,
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to complete manual sale');
      }

      setNotice(
        `Manual sale completed. Reference: ${String(
          json?.receipt?.referenceNumber || '-'
        )} | Tickets: ${Array.isArray(json?.tickets) ? json.tickets.length : 0}`
      );
      setCustomerName('');
      setCustomerPhone('');
      setReferenceNumber('');
      setNotes('');
      await loadManualCashData();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to complete manual sale');
    } finally {
      setSubmitting(false);
    }
  };

  const submitRemittance = async () => {
    try {
      if (!adminId) {
        setError('Admin session not found.');
        return;
      }
      const amount = Number(remittedAmount || 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('Remitted amount must be greater than zero.');
        return;
      }
      if (remittanceMethod === 'bank_deposit' && !bankReceiptUrl.trim()) {
        setError('Bank receipt URL is required for bank deposit remittance.');
        return;
      }

      setSubmittingRemittance(true);
      setError('');
      setNotice('');

      const response = await fetch('/api/admin/manual-cash/remittances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
        },
        body: JSON.stringify({
          remittanceMethod,
          remittedAmount: amount,
          notes: remittanceNotes.trim() || undefined,
          bankReceiptUrl: bankReceiptUrl.trim() || undefined,
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to submit remittance');
      }

      setNotice('Remittance request submitted and waiting for approval.');
      setRemittanceNotes('');
      setBankReceiptUrl('');
      await loadManualCashData();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to submit remittance');
    } finally {
      setSubmittingRemittance(false);
    }
  };

  const decideRemittance = async (remittanceId: string, action: 'approve' | 'reject') => {
    try {
      if (!adminId) {
        setError('Admin session not found.');
        return;
      }

      const promptLabel = action === 'approve' ? 'Approval notes (optional)' : 'Rejection reason';
      const value = window.prompt(promptLabel, '');
      if (value === null) return;

      setDecisionBusyId(remittanceId);
      setError('');
      setNotice('');

      const response = await fetch(`/api/admin/manual-cash/remittances/${encodeURIComponent(remittanceId)}/decision`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
        },
        body: JSON.stringify(
          action === 'approve'
            ? { action: 'approve', notes: value.trim() || undefined }
            : { action: 'reject', reason: value.trim() || undefined }
        ),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to process remittance decision');
      }

      setNotice(`Remittance ${action}d successfully.`);
      await loadManualCashData();
    } catch (err) {
      setError((err as Error)?.message || 'Failed to process remittance decision');
    } finally {
      setDecisionBusyId('');
    }
  };

  if (!canManualSell) {
    return (
      <Card className="bg-slate-800 border-slate-700 p-6 text-slate-100">
        Your role does not have permission for manual ticket sale.
      </Card>
    );
  }

  if (loadingTrips) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading trip options...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Manual Ticket Sale</h1>

      <Card className="bg-slate-800 border-slate-700 p-5">
        <p className="text-sm text-slate-400 mb-4">
          Use this for walk-in or offline customers. Ticket(s) are issued immediately.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <select
            value={tripId}
            onChange={(e) => setTripId(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="">Select trip</option>
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name || 'Trip'} | {trip.destination || 'N/A'} | seats {Number(trip.available_seats || 0)}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer full name"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <input
            type="text"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            placeholder="Customer phone number"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, Number(e.target.value || 1)))}
            placeholder="Quantity"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="telebirr">Telebirr Manual</option>
          </select>
          <input
            type="number"
            step="0.01"
            min={0}
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            placeholder="Amount paid"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <input
            type="text"
            value={referenceNumber}
            onChange={(e) => setReferenceNumber(e.target.value)}
            placeholder="Payment reference (optional)"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <Button
            onClick={submitManualSale}
            disabled={submitting}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {submitting ? 'Processing...' : 'Issue Ticket'}
          </Button>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notes (optional)"
          className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
        />

        {selectedTrip ? (
          <p className="text-xs text-slate-400 mt-2">
            Selected trip price: ETB {Number(selectedTrip.price_per_ticket || 0).toFixed(2)} | available seats:{' '}
            {Number(selectedTrip.available_seats || 0)}
          </p>
        ) : null}
      </Card>

      <Card className="bg-slate-800 border-slate-700 p-5 space-y-4">
        <h2 className="text-xl font-semibold text-white">Manual Cash Reconciliation</h2>

        {loadingRemittance ? (
          <p className="text-sm text-slate-300">Loading reconciliation summary...</p>
        ) : null}

        {manualCashSummary ? (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-400">Total Cash Sold</p>
              <p className="text-lg font-semibold text-white">ETB {Number(manualCashSummary.totalCashSold || 0).toFixed(2)}</p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-400">Approved Remitted</p>
              <p className="text-lg font-semibold text-emerald-300">ETB {Number(manualCashSummary.approvedRemittedAmount || 0).toFixed(2)}</p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-400">Pending Remitted</p>
              <p className="text-lg font-semibold text-amber-300">ETB {Number(manualCashSummary.pendingRemittedAmount || 0).toFixed(2)}</p>
            </div>
            <div className="rounded border border-slate-700 bg-slate-900/60 p-3">
              <p className="text-xs text-slate-400">Outstanding</p>
              <p className="text-lg font-semibold text-red-300">ETB {Number(manualCashSummary.outstandingAmount || 0).toFixed(2)}</p>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <select
            value={remittanceMethod}
            onChange={(e) => setRemittanceMethod(e.target.value === 'bank_deposit' ? 'bank_deposit' : 'cash_handover')}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="cash_handover">Cash handover</option>
            <option value="bank_deposit">Bank deposit</option>
          </select>
          <input
            type="number"
            step="0.01"
            min={0}
            value={remittedAmount}
            onChange={(e) => setRemittedAmount(e.target.value)}
            placeholder="Remitted amount"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />
          <input
            type="url"
            value={bankReceiptUrl}
            onChange={(e) => setBankReceiptUrl(e.target.value)}
            placeholder="Bank receipt URL (if bank deposit)"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded md:col-span-2"
          />
          <Button
            onClick={submitRemittance}
            disabled={submittingRemittance}
            className="bg-cyan-600 hover:bg-cyan-700 text-white"
          >
            {submittingRemittance ? 'Submitting...' : 'Submit Remittance'}
          </Button>
        </div>

        <textarea
          value={remittanceNotes}
          onChange={(e) => setRemittanceNotes(e.target.value)}
          rows={2}
          placeholder="Remittance notes (optional)"
          className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-700">
              <tr>
                <th className="text-left py-2 px-2 text-slate-300">Date</th>
                <th className="text-left py-2 px-2 text-slate-300">Method</th>
                <th className="text-left py-2 px-2 text-slate-300">Amount</th>
                <th className="text-left py-2 px-2 text-slate-300">Status</th>
                <th className="text-left py-2 px-2 text-slate-300">Receipt</th>
                <th className="text-right py-2 px-2 text-slate-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {remittances.map((row) => {
                const status = String(row.approval_status || 'pending').toLowerCase();
                return (
                  <tr key={row.id} className="border-b border-slate-700/60">
                    <td className="py-2 px-2 text-slate-200">{row.created_at ? new Date(row.created_at).toLocaleString() : '-'}</td>
                    <td className="py-2 px-2 text-slate-200">{String(row.remittance_method || '-')}</td>
                    <td className="py-2 px-2 text-slate-200">ETB {Number(row.remitted_amount || 0).toFixed(2)}</td>
                    <td className="py-2 px-2 text-slate-200">{status}</td>
                    <td className="py-2 px-2">
                      {row.bank_receipt_url ? (
                        <a href={row.bank_receipt_url} target="_blank" rel="noreferrer" className="text-cyan-300 underline">
                          Open
                        </a>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
                    </td>
                    <td className="py-2 px-2 text-right">
                      {canApproveRemittance && status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            onClick={() => decideRemittance(row.id, 'approve')}
                            disabled={decisionBusyId === row.id}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          >
                            Approve
                          </Button>
                          <Button
                            onClick={() => decideRemittance(row.id, 'reject')}
                            disabled={decisionBusyId === row.id}
                            className="bg-amber-600 hover:bg-amber-700 text-white"
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {remittances.length === 0 ? (
                <tr>
                  <td className="py-3 px-2 text-slate-400" colSpan={6}>
                    No remittance records yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      {error ? <p className="text-sm text-red-400 mt-2">{error}</p> : null}
      {notice ? <p className="text-sm text-emerald-400 mt-2">{notice}</p> : null}
    </div>
  );
}
