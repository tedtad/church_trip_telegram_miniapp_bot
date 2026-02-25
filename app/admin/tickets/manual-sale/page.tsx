'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getAdminSession } from '@/lib/admin-auth';
import { hasAdminPermission, normalizeAdminRole } from '@/lib/admin-rbac';

interface TripOption {
  id: string;
  name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  available_seats?: number | null;
  price_per_ticket?: number | null;
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

  useEffect(() => {
    if (!canManualSell) {
      setLoadingTrips(false);
      return;
    }

    const load = async () => {
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
        if (!tripId && active[0]?.id) {
          setTripId(active[0].id);
        }
      } catch (err) {
        setError((err as Error)?.message || 'Failed to load trips');
      } finally {
        setLoadingTrips(false);
      }
    };

    load();
  }, [canManualSell, tripId]);

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === tripId) || null,
    [tripId, trips]
  );

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
    } catch (err) {
      setError((err as Error)?.message || 'Failed to complete manual sale');
    } finally {
      setSubmitting(false);
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
        {error ? <p className="text-sm text-red-400 mt-2">{error}</p> : null}
        {notice ? <p className="text-sm text-emerald-400 mt-2">{notice}</p> : null}
      </Card>
    </div>
  );
}

