'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getAdminSession } from '@/lib/admin-auth';
import { hasAdminPermission, normalizeAdminRole } from '@/lib/admin-rbac';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Check, X, Eye, Download, Search } from 'lucide-react';
import { Receipt } from '@/lib/types';

interface ReceiptWithDetails extends Receipt {
  customer?: { first_name: string; last_name?: string; username?: string; phone_number?: string };
  tickets_count?: number;
}

interface ReceiptTicket {
  id: string;
  ticket_number: string;
  serial_number: string;
  ticket_status: string;
}

function isImageReceipt(url?: string | null) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].some((ext) => clean.endsWith(ext));
}

function formatPaymentMethodLabel(method?: string) {
  if (!method) return 'Unknown';
  if (method === 'telebirr_auto') return 'Telebirr (Auto)';
  if (method === 'telebirr') return 'Telebirr (Manual)';
  if (method === 'bank') return 'Bank Transfer';
  if (method === 'gnpl') return 'GNPL (Pay Later)';
  return method.replace(/_/g, ' ');
}

function dataUrlToBlob(dataUrl: string) {
  const match = String(dataUrl || '').match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || 'application/octet-stream').trim();
  const base64 = String(match[2] || '').replace(/\s+/g, '');
  if (!base64) return null;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

export default function TicketsPage() {
  const session = getAdminSession();
  const adminRole = normalizeAdminRole(session?.admin?.role);
  const canManualSell = hasAdminPermission(adminRole, 'tickets_manual_sale');

  const [receipts, setReceipts] = useState<ReceiptWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptWithDetails | null>(null);
  const [receiptTickets, setReceiptTickets] = useState<ReceiptTicket[]>([]);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [rollbackTicketNumber, setRollbackTicketNumber] = useState('');
  const [processing, setProcessing] = useState(false);

  const openReceiptAttachment = (url?: string | null, fileName?: string | null) => {
    const value = String(url || '').trim();
    if (!value) return;

    if (/^data:/i.test(value)) {
      const blob = dataUrlToBlob(value);
      if (!blob) {
        alert('Unable to open this receipt file');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      const opened = window.open(objectUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = String(fileName || 'receipt');
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      return;
    }

    window.open(value, '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    loadReceipts();
  }, [filter]);

  const loadReceipts = async () => {
    try {
      setLoading(true);
      const supabase = createClient();

      let query = supabase
        .from('receipts')
        .select(`
          *,
          customer:telegram_users (first_name, last_name, username, phone_number),
          tickets_count:tickets (count)
        `);

      if (filter !== 'all') {
        query = query.eq('approval_status', filter);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('[tickets] Error loading receipts:', error);
        return;
      }

      setReceipts(data || []);
    } catch (error) {
      console.error('[tickets] Unexpected error:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadReceiptTickets = async (receiptId: string) => {
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('tickets')
        .select('id, ticket_number, serial_number, ticket_status, created_at')
        .eq('receipt_id', receiptId)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[tickets] Error loading receipt tickets:', error);
        setReceiptTickets([]);
        return;
      }

      setReceiptTickets((data || []) as ReceiptTicket[]);
    } catch (error) {
      console.error('[tickets] Unexpected receipt ticket load error:', error);
      setReceiptTickets([]);
    }
  };

  const openReceiptModal = async (receipt: ReceiptWithDetails) => {
    setSelectedReceipt(receipt);
    setApprovalNotes('');
    setRejectionReason('');
    setRollbackTicketNumber('');
    await loadReceiptTickets(receipt.id);
  };

  const closeReceiptModal = () => {
    setSelectedReceipt(null);
    setReceiptTickets([]);
    setApprovalNotes('');
    setRejectionReason('');
    setRollbackTicketNumber('');
  };

  const handleApprove = async (receipt: ReceiptWithDetails) => {
    try {
      setProcessing(true);

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'approve',
          notes: approvalNotes,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to approve receipt');
      }

      closeReceiptModal();
      await loadReceipts();
    } catch (error) {
      console.error('[tickets] Approval error:', error);
      alert('Error approving receipt');
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async (receipt: ReceiptWithDetails) => {
    try {
      setProcessing(true);

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'reject',
          reason: rejectionReason,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to reject receipt');
      }

      closeReceiptModal();
      await loadReceipts();
    } catch (error) {
      console.error('[tickets] Rejection error:', error);
      alert('Error rejecting receipt');
    } finally {
      setProcessing(false);
    }
  };

  const handleRollback = async (receipt: ReceiptWithDetails) => {
    try {
      if (!rollbackTicketNumber.trim()) {
        alert('Enter a ticket number to confirm rollback');
        return;
      }

      setProcessing(true);

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'rollback',
          notes: approvalNotes,
          confirmationTicketNumber: rollbackTicketNumber.trim(),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to rollback approved ticket');
      }

      closeReceiptModal();
      await loadReceipts();
    } catch (error) {
      console.error('[tickets] Rollback error:', error);
      alert((error as Error)?.message || 'Error rolling back approved ticket');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading tickets...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-white">Ticket Approval</h1>
        <a
          href="/admin/checkin"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Search size={16} />
          QR Check-In Scanner
        </a>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5 mb-6">
        <h2 className="text-lg font-semibold text-white mb-2">Ticket Operations</h2>
        <p className="text-sm text-slate-400 mb-4">
          Ticket approval is managed on this page. Manual sale, manual check-in, and scanner check-in are separate.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {canManualSell ? (
            <a
              href="/admin/tickets/manual-sale"
              className="rounded-lg border border-slate-600 bg-slate-900/70 p-3 text-sm text-slate-100 hover:border-cyan-500"
            >
              <p className="font-semibold">Manual Ticket Sale</p>
              <p className="text-xs text-slate-400 mt-1">Issue tickets for walk-in and offline customers.</p>
            </a>
          ) : null}
          <a
            href="/admin/tickets/manual-checkin"
            className="rounded-lg border border-slate-600 bg-slate-900/70 p-3 text-sm text-slate-100 hover:border-cyan-500"
          >
            <p className="font-semibold">Manual Check-In</p>
            <p className="text-xs text-slate-400 mt-1">Search by phone and check in confirmed tickets.</p>
          </a>
          <a
            href="/admin/checkin"
            className="rounded-lg border border-slate-600 bg-slate-900/70 p-3 text-sm text-slate-100 hover:border-cyan-500"
          >
            <p className="font-semibold">Check-In Scanner</p>
            <p className="text-xs text-slate-400 mt-1">Scan QR tickets at boarding/checkpoint.</p>
          </a>
        </div>
      </Card>

      <div className="flex gap-2 mb-6">
        {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors capitalize ${filter === f
                ? 'bg-primary text-white'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
          >
            {f}
          </button>
        ))}
      </div>

      <Card className="bg-slate-800 border-slate-700 overflow-hidden">
        {receipts.length === 0 ? (
          <div className="p-6 text-center text-slate-400">
            No receipts found for this filter
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-900 border-b border-slate-700">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Qty</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Method</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-300">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {receipts.map((receipt) => (
                  <tr key={receipt.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-white">
                      {receipt.reference_number}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {receipt.customer?.first_name} {receipt.customer?.last_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {receipt.amount_paid} {receipt.currency}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">{receipt.quantity}</td>
                    <td className="px-6 py-4 text-sm text-slate-300 capitalize">
                      {formatPaymentMethodLabel(receipt.payment_method)}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${receipt.approval_status === 'approved'
                            ? 'bg-green-900/30 text-green-400'
                            : receipt.approval_status === 'rejected'
                              ? 'bg-red-900/30 text-red-400'
                              : 'bg-yellow-900/30 text-yellow-400'
                          }`}
                      >
                        {receipt.approval_status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm flex items-center gap-3">
                      <button
                        onClick={() => openReceiptModal(receipt)}
                        className="text-blue-400 hover:text-blue-300"
                        title="View details"
                      >
                        <Eye size={18} />
                      </button>
                      {receipt.receipt_file_url ? (
                        <button
                          type="button"
                          onClick={() => openReceiptAttachment(receipt.receipt_file_url, receipt.receipt_file_name)}
                          className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                          title="Open uploaded receipt file"
                        >
                          <Download size={16} />
                          View Receipt
                        </button>
                      ) : (
                        <span className="text-xs text-slate-500">No file</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selectedReceipt && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="bg-slate-800 border-slate-700 w-full max-w-2xl max-h-96 overflow-y-auto">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-4">
                Receipt: {selectedReceipt.reference_number}
              </h2>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <p className="text-slate-400 text-sm">Customer</p>
                  <p className="text-white font-semibold">
                    {selectedReceipt.customer?.first_name} {selectedReceipt.customer?.last_name}
                  </p>
                  <p className="text-slate-400 text-xs">
                    @{selectedReceipt.customer?.username || '-'} | {selectedReceipt.customer?.phone_number || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Amount</p>
                  <p className="text-white font-semibold">
                    {selectedReceipt.amount_paid} {selectedReceipt.currency}
                  </p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Tickets</p>
                  <p className="text-white font-semibold">{selectedReceipt.quantity}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Payment Method</p>
                  <p className="text-white font-semibold">
                    {formatPaymentMethodLabel(selectedReceipt.payment_method)}
                  </p>
                </div>
              </div>

              {(() => {
                const provider = String((selectedReceipt as any).receipt_provider || '').trim();
                const mode = String((selectedReceipt as any).receipt_validation_mode || '').trim();
                const scoreRaw = Number((selectedReceipt as any).receipt_validation_score || 0);
                const flagsValue = (selectedReceipt as any).receipt_validation_flags;
                const flags = Array.isArray(flagsValue)
                  ? flagsValue.map((v: unknown) => String(v || '')).filter(Boolean)
                  : [];
                if (!provider && !mode && !flags.length && !scoreRaw) return null;

                return (
                  <div className="mb-6 rounded-lg border border-slate-700 bg-slate-900 p-3">
                    <p className="text-slate-400 text-sm mb-2">Receipt Intelligence</p>
                    <p className="text-xs text-slate-300">
                      Provider: {provider || '-'} | Mode: {mode || '-'} | Score: {scoreRaw.toFixed(2)}
                    </p>
                    {flags.length ? (
                      <p className="text-xs text-amber-300 mt-1">Flags: {flags.join(', ')}</p>
                    ) : null}
                  </div>
                );
              })()}

              <div className="mb-6">
                <p className="text-slate-400 text-sm mb-2">Ticket Numbers</p>
                {receiptTickets.length === 0 ? (
                  <p className="text-slate-500 text-sm">No ticket rows found for this receipt.</p>
                ) : (
                  <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 space-y-2 max-h-40 overflow-y-auto">
                    {receiptTickets.map((ticket) => (
                      <div key={ticket.id} className="text-sm text-slate-200 flex items-center justify-between">
                        <span className="font-mono">{ticket.ticket_number}</span>
                        <span className="text-xs text-slate-400 uppercase">{ticket.ticket_status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {selectedReceipt.receipt_file_url && (
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() =>
                      openReceiptAttachment(selectedReceipt.receipt_file_url, selectedReceipt.receipt_file_name)
                    }
                    className="inline-flex items-center gap-2 text-blue-300 hover:text-blue-200"
                  >
                    <Download size={16} />
                    Open Uploaded Receipt File
                  </button>
                  {isImageReceipt(selectedReceipt.receipt_file_url) && (
                    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900 p-2">
                      <img
                        src={selectedReceipt.receipt_file_url}
                        alt={`Receipt ${selectedReceipt.reference_number}`}
                        className="max-h-72 w-full object-contain rounded"
                      />
                    </div>
                  )}
                </div>
              )}

              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Approval Notes
                </label>
                <textarea
                  value={approvalNotes}
                  onChange={(e) => setApprovalNotes(e.target.value)}
                  placeholder="Optional notes for approval..."
                  className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary"
                  rows={3}
                />
              </div>

              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Rejection Reason (if rejecting)
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Reason for rejection..."
                  className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary"
                  rows={3}
                />
              </div>

              {selectedReceipt.approval_status === 'pending' ? (
                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApprove(selectedReceipt)}
                    disabled={processing}
                    className="flex-1 bg-green-600 hover:bg-green-700 text-white flex items-center justify-center gap-2"
                  >
                    <Check size={18} />
                    Approve
                  </Button>
                  <Button
                    onClick={() => handleReject(selectedReceipt)}
                    disabled={processing}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white flex items-center justify-center gap-2"
                  >
                    <X size={18} />
                    Reject
                  </Button>
                  <Button
                    onClick={closeReceiptModal}
                    disabled={processing}
                    variant="outline"
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                  >
                    Close
                  </Button>
                </div>
              ) : selectedReceipt.approval_status === 'approved' ? (
                <div className="space-y-3">
                  <p className="text-sm text-amber-300">
                    Rollback requires ticket number confirmation.
                  </p>
                  <input
                    type="text"
                    value={rollbackTicketNumber}
                    onChange={(e) => setRollbackTicketNumber(e.target.value)}
                    placeholder="Enter one ticket number to confirm rollback"
                    className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary"
                  />
                  <div className="flex gap-3">
                    <Button
                      onClick={() => handleRollback(selectedReceipt)}
                      disabled={processing || !rollbackTicketNumber.trim()}
                      className="flex-1 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      Rollback Approval
                    </Button>
                    <Button
                      onClick={closeReceiptModal}
                      disabled={processing}
                      variant="outline"
                      className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                    >
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-400">
                    This receipt is already {selectedReceipt.approval_status}.
                  </p>
                  <Button
                    onClick={closeReceiptModal}
                    disabled={processing}
                    variant="outline"
                    className="bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                  >
                    Close
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
