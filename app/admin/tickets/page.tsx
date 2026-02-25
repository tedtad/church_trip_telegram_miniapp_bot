'use client';

import { useEffect, useMemo, useState } from 'react';
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

interface CheckInCandidate {
  ticketId: string;
  ticketNumber: string;
  serialNumber: string;
  status: string;
  tripId: string;
  tripName: string;
  destination: string;
  departureDate: string;
  telegramUserId: string;
  customerName: string;
  phoneNumber: string;
  referenceNumber: string;
}

interface TripOption {
  id: string;
  name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  available_seats?: number | null;
  price_per_ticket?: number | null;
}

function isImageReceipt(url?: string | null) {
  if (!url) return false;
  const clean = url.split('?')[0].toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].some((ext) => clean.endsWith(ext));
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
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
  const adminId = String(session?.admin?.id || '');
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
  const [checkInPhone, setCheckInPhone] = useState('');
  const [checkInDate, setCheckInDate] = useState(todayYmd());
  const [checkInResults, setCheckInResults] = useState<CheckInCandidate[]>([]);
  const [checkInSearching, setCheckInSearching] = useState(false);
  const [checkInUpdatingTicketId, setCheckInUpdatingTicketId] = useState('');
  const [checkInError, setCheckInError] = useState('');
  const [manualSaleTrips, setManualSaleTrips] = useState<TripOption[]>([]);
  const [manualSaleTripId, setManualSaleTripId] = useState('');
  const [manualSaleQuantity, setManualSaleQuantity] = useState(1);
  const [manualSaleCustomerName, setManualSaleCustomerName] = useState('');
  const [manualSaleCustomerPhone, setManualSaleCustomerPhone] = useState('');
  const [manualSaleReference, setManualSaleReference] = useState('');
  const [manualSalePaymentMethod, setManualSalePaymentMethod] = useState('cash');
  const [manualSaleAmount, setManualSaleAmount] = useState('');
  const [manualSaleNotes, setManualSaleNotes] = useState('');
  const [manualSaleLoading, setManualSaleLoading] = useState(false);
  const [manualSaleNotice, setManualSaleNotice] = useState('');
  const [manualSaleError, setManualSaleError] = useState('');

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

  useEffect(() => {
    if (!canManualSell) return;
    loadManualSaleTrips();
  }, [canManualSell]);

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

  const loadManualSaleTrips = async () => {
    try {
      const response = await fetch('/api/admin/trips', { cache: 'no-store' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) return;
      const tripRows = (json.trips || []) as TripOption[];
      const active = tripRows.filter((trip) => {
        const availableSeats = Number(trip.available_seats || 0);
        return availableSeats > 0;
      });
      setManualSaleTrips(active);
      if (!manualSaleTripId && active[0]?.id) {
        setManualSaleTripId(active[0].id);
      }
    } catch (error) {
      console.error('[tickets] Failed to load trip options for manual sale:', error);
    }
  };

  const selectedManualSaleTrip = useMemo(
    () => manualSaleTrips.find((trip) => trip.id === manualSaleTripId) || null,
    [manualSaleTripId, manualSaleTrips]
  );

  useEffect(() => {
    if (!selectedManualSaleTrip) return;
    const unitPrice = Number(selectedManualSaleTrip.price_per_ticket || 0);
    const qty = Math.max(1, Number(manualSaleQuantity || 1));
    const expected = Number((unitPrice * qty).toFixed(2));
    setManualSaleAmount(expected > 0 ? expected.toFixed(2) : '');
  }, [manualSaleQuantity, selectedManualSaleTrip]);

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
      const session = getAdminSession();

      if (!session) return;

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'approve',
          adminId: session.admin.id,
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
      const session = getAdminSession();

      if (!session) return;

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'reject',
          adminId: session.admin.id,
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
      const session = getAdminSession();
      if (!session) return;

      const response = await fetch('/api/admin/tickets/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receiptId: receipt.id,
          action: 'rollback',
          adminId: session.admin.id,
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

  const searchCheckInCandidates = async () => {
    try {
      const phone = checkInPhone.trim();
      if (!phone) {
        setCheckInError('Phone number is required.');
        setCheckInResults([]);
        return;
      }

      setCheckInSearching(true);
      setCheckInError('');

      const params = new URLSearchParams();
      params.set('phone', phone);
      if (checkInDate) params.set('tripDate', checkInDate);

      const response = await fetch(`/api/admin/tickets/checkin?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to search tickets');
      }

      setCheckInResults((data?.results || []) as CheckInCandidate[]);
    } catch (error) {
      setCheckInError((error as Error)?.message || 'Failed to search tickets');
      setCheckInResults([]);
    } finally {
      setCheckInSearching(false);
    }
  };

  const checkInTicket = async (ticketId: string) => {
    try {
      const session = getAdminSession();
      if (!session) {
        setCheckInError('Admin session not found.');
        return;
      }

      setCheckInUpdatingTicketId(ticketId);
      setCheckInError('');

      const response = await fetch('/api/admin/tickets/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          tripDate: checkInDate || undefined,
          adminId: session.admin.id,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to check in ticket');
      }

      setCheckInResults((prev) =>
        prev.map((row) =>
          row.ticketId === ticketId
            ? {
              ...row,
              status: 'used',
            }
            : row
        )
      );
    } catch (error) {
      setCheckInError((error as Error)?.message || 'Failed to check in ticket');
    } finally {
      setCheckInUpdatingTicketId('');
    }
  };

  const submitManualSale = async () => {
    try {
      if (!canManualSell) {
        setManualSaleError('Your role does not allow manual sales.');
        return;
      }
      if (!adminId) {
        setManualSaleError('Admin session not found.');
        return;
      }
      if (!manualSaleTripId) {
        setManualSaleError('Please select a trip.');
        return;
      }
      if (!manualSaleCustomerName.trim() || !manualSaleCustomerPhone.trim()) {
        setManualSaleError('Customer name and phone number are required.');
        return;
      }
      if (!manualSaleReference.trim()) {
        setManualSaleError('Payment reference is required.');
        return;
      }

      setManualSaleLoading(true);
      setManualSaleError('');
      setManualSaleNotice('');

      const response = await fetch('/api/admin/tickets/manual-sale', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-id': adminId,
        },
        body: JSON.stringify({
          tripId: manualSaleTripId,
          quantity: Math.max(1, Number(manualSaleQuantity || 1)),
          customerName: manualSaleCustomerName.trim(),
          customerPhone: manualSaleCustomerPhone.trim(),
          paymentMethod: manualSalePaymentMethod,
          referenceNumber: manualSaleReference.trim(),
          amountPaid: Number(manualSaleAmount || 0),
          notes: manualSaleNotes.trim() || undefined,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Failed to complete manual sale');
      }

      setManualSaleNotice(
        `Manual sale completed. Reference: ${String(
          json?.receipt?.referenceNumber || '-'
        )} | Tickets: ${Array.isArray(json?.tickets) ? json.tickets.length : 0}`
      );
      setManualSaleCustomerName('');
      setManualSaleCustomerPhone('');
      setManualSaleReference('');
      setManualSaleNotes('');
      await loadReceipts();
    } catch (error) {
      setManualSaleError((error as Error)?.message || 'Failed to complete manual sale');
    } finally {
      setManualSaleLoading(false);
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
        <h1 className="text-3xl font-bold text-white">Ticket Approvals</h1>
        <a
          href="/admin/checkin"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
        >
          <Search size={16} />
          QR Check-In Scanner
        </a>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-5 mb-6">
        <h2 className="text-lg font-semibold text-white mb-3">Manual Check-In By Phone</h2>
        <p className="text-sm text-slate-400 mb-4">
          Search confirmed tickets by customer phone and check in manually on trip day.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input
            type="text"
            value={checkInPhone}
            onChange={(e) => setCheckInPhone(e.target.value)}
            placeholder="Phone number"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
          />
          <input
            type="date"
            value={checkInDate}
            onChange={(e) => setCheckInDate(e.target.value)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
          />
          <Button
            onClick={searchCheckInCandidates}
            disabled={checkInSearching}
            className="bg-primary hover:bg-primary/90 text-white flex items-center justify-center gap-2"
          >
            <Search size={16} />
            {checkInSearching ? 'Searching...' : 'Search Tickets'}
          </Button>
        </div>

        {checkInError ? <p className="text-sm text-red-400 mb-3">{checkInError}</p> : null}

        {checkInResults.length > 0 ? (
          <div className="overflow-x-auto border border-slate-700 rounded-lg">
            <table className="w-full">
              <thead className="bg-slate-900 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Customer</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Phone</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Trip</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Ticket</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-slate-300">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {checkInResults.map((item) => {
                  const normalizedStatus = String(item.status || '').toLowerCase();
                  const isUsed = normalizedStatus === 'used';
                  const canCheckIn = normalizedStatus === 'confirmed';
                  const isUpdating = checkInUpdatingTicketId === item.ticketId;
                  return (
                    <tr key={item.ticketId} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-white">{item.customerName}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{item.phoneNumber || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        <div>{item.tripName}</div>
                        <div className="text-xs text-slate-400">{item.destination} | {item.departureDate ? new Date(item.departureDate).toLocaleDateString() : '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        <div className="font-mono text-xs">{item.ticketNumber || item.serialNumber}</div>
                        <div className="text-xs text-slate-500">{item.referenceNumber || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${isUsed ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-900/30 text-blue-300'
                            }`}
                        >
                          {isUsed ? 'used' : item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Button
                          onClick={() => checkInTicket(item.ticketId)}
                          disabled={!canCheckIn || isUpdating}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {isUpdating ? 'Checking...' : isUsed ? 'Checked In' : 'Check In'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      {canManualSell ? (
        <Card className="bg-slate-800 border-slate-700 p-5 mb-6">
          <h2 className="text-lg font-semibold text-white mb-3">Manual Ticket Sale (Non-Telegram Customers)</h2>
          <p className="text-sm text-slate-400 mb-4">
            Use this for walk-in or offline customers. The ticket is issued instantly and seat inventory is updated.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <select
              value={manualSaleTripId}
              onChange={(e) => setManualSaleTripId(e.target.value)}
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            >
              <option value="">Select trip</option>
              {manualSaleTrips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name || 'Trip'} | {trip.destination || 'N/A'} | seats {Number(trip.available_seats || 0)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={manualSaleCustomerName}
              onChange={(e) => setManualSaleCustomerName(e.target.value)}
              placeholder="Customer full name"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
            <input
              type="text"
              value={manualSaleCustomerPhone}
              onChange={(e) => setManualSaleCustomerPhone(e.target.value)}
              placeholder="Customer phone number"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-3">
            <input
              type="number"
              min={1}
              value={manualSaleQuantity}
              onChange={(e) => setManualSaleQuantity(Math.max(1, Number(e.target.value || 1)))}
              placeholder="Quantity"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
            <select
              value={manualSalePaymentMethod}
              onChange={(e) => setManualSalePaymentMethod(e.target.value)}
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
              value={manualSaleAmount}
              onChange={(e) => setManualSaleAmount(e.target.value)}
              placeholder="Amount paid"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
            <input
              type="text"
              value={manualSaleReference}
              onChange={(e) => setManualSaleReference(e.target.value)}
              placeholder="Payment reference"
              className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
            <Button
              onClick={submitManualSale}
              disabled={manualSaleLoading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {manualSaleLoading ? 'Processing...' : 'Issue Ticket'}
            </Button>
          </div>

          <textarea
            value={manualSaleNotes}
            onChange={(e) => setManualSaleNotes(e.target.value)}
            rows={2}
            placeholder="Notes (optional)"
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          />

          {selectedManualSaleTrip ? (
            <p className="text-xs text-slate-400 mt-2">
              Selected trip price: ETB {Number(selectedManualSaleTrip.price_per_ticket || 0).toFixed(2)} | available
              seats: {Number(selectedManualSaleTrip.available_seats || 0)}
            </p>
          ) : null}
          {manualSaleError ? <p className="text-sm text-red-400 mt-2">{manualSaleError}</p> : null}
          {manualSaleNotice ? <p className="text-sm text-emerald-400 mt-2">{manualSaleNotice}</p> : null}
        </Card>
      ) : null}

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
