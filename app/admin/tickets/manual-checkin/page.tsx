'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { getAdminSession } from '@/lib/admin-auth';
import { hasAdminPermission, normalizeAdminRole } from '@/lib/admin-rbac-client';

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

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

export default function ManualCheckInPage() {
  const session = getAdminSession();
  const adminRole = normalizeAdminRole(session?.admin?.role);
  const canCheckIn = hasAdminPermission(adminRole, 'tickets_checkin');

  const [checkInPhone, setCheckInPhone] = useState('');
  const [checkInDate, setCheckInDate] = useState(todayYmd());
  const [checkInResults, setCheckInResults] = useState<CheckInCandidate[]>([]);
  const [checkInSearching, setCheckInSearching] = useState(false);
  const [checkInUpdatingTicketId, setCheckInUpdatingTicketId] = useState('');
  const [checkInError, setCheckInError] = useState('');
  const [notice, setNotice] = useState('');

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
      setNotice('');

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
      const adminId = String(session?.admin?.id || '');
      if (!adminId) {
        setCheckInError('Admin session not found.');
        return;
      }

      setCheckInUpdatingTicketId(ticketId);
      setCheckInError('');
      setNotice('');

      const response = await fetch('/api/admin/tickets/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketId,
          tripDate: checkInDate || undefined,
          adminId,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to check in ticket');
      }

      setNotice('Customer checked in successfully.');
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

  if (!canCheckIn) {
    return (
      <Card className="bg-slate-800 border-slate-700 p-6 text-slate-100">
        Your role does not have permission for ticket check-in.
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Manual Check-In</h1>

      <Card className="bg-slate-800 border-slate-700 p-5">
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
        {notice ? <p className="text-sm text-emerald-400 mb-3">{notice}</p> : null}

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
                  const canCheckInRow = normalizedStatus === 'confirmed';
                  const isUpdating = checkInUpdatingTicketId === item.ticketId;
                  return (
                    <tr key={item.ticketId} className="hover:bg-slate-700/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-white">{item.customerName || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{item.phoneNumber || '-'}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        <div>{item.tripName}</div>
                        <div className="text-xs text-slate-400">
                          {item.destination} | {item.departureDate ? new Date(item.departureDate).toLocaleString() : '-'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        <div className="font-mono text-xs">{item.ticketNumber || item.serialNumber}</div>
                        <div className="text-xs text-slate-400">{item.referenceNumber || '-'}</div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            isUsed ? 'bg-emerald-900/30 text-emerald-400' : 'bg-blue-900/30 text-blue-300'
                          }`}
                        >
                          {isUsed ? 'used' : item.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <Button
                          onClick={() => checkInTicket(item.ticketId)}
                          disabled={!canCheckInRow || isUpdating}
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
    </div>
  );
}
