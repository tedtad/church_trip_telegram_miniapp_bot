'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, Edit, Trash, X, Loader2, Search, LayoutGrid, List, ChevronDown, ChevronUp } from 'lucide-react';
import { Trip } from '@/lib/types';
import { serializeBankAccountsForTextInput } from '@/lib/payment-config';

type TripFormInput = {
  name: string;
  description: string;
  destination: string;
  image_url: string;
  bank_accounts_text: string;
  telebirr_manual_account_name: string;
  telebirr_manual_account_number: string;
  manual_payment_note: string;
  allow_gnpl: boolean;
  telegram_group_url: string;
  telegram_group_chat_id: string;
  departure_date: string;
  arrival_date: string;
  price_per_ticket: string;
  total_seats: string;
  available_seats: string;
  status: 'active' | 'cancelled' | 'completed';
};

const EMPTY_FORM: TripFormInput = {
  name: '',
  description: '',
  destination: '',
  image_url: '',
  bank_accounts_text: '',
  telebirr_manual_account_name: '',
  telebirr_manual_account_number: '',
  manual_payment_note: '',
  allow_gnpl: false,
  telegram_group_url: '',
  telegram_group_chat_id: '',
  departure_date: '',
  arrival_date: '',
  price_per_ticket: '',
  total_seats: '',
  available_seats: '',
  status: 'active',
};

function toDatetimeLocal(dateString?: string) {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

export default function TripsPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [deletingTrip, setDeletingTrip] = useState<Trip | null>(null);
  const [formError, setFormError] = useState('');
  const [formData, setFormData] = useState<TripFormInput>(EMPTY_FORM);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [sortMode, setSortMode] = useState<'departure_desc' | 'departure_asc' | 'price_desc' | 'price_asc' | 'name_asc'>('departure_desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedTripIds, setExpandedTripIds] = useState<Record<string, boolean>>({});
  const descriptionTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    loadTrips();
  }, []);

  const loadTrips = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/admin/trips', {
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || !payload?.ok) {
        console.error('[trips] Error:', payload?.error || 'Failed to load trips');
        return;
      }

      const normalizedTrips = (payload.trips || []).map((trip: any) => ({
        ...trip,
        status: trip.status ?? trip.trip_status ?? 'active',
        image_url: trip.image_url ?? trip.trip_image_url ?? trip.cover_image_url ?? '',
      }));
      setTrips(normalizedTrips);
    } catch (error) {
      console.error('[trips] Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingTrip(null);
    setFormData(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEditModal = (trip: Trip) => {
    setEditingTrip(trip);
    setFormData({
      name: trip.name || '',
      description: trip.description || '',
      destination: trip.destination || '',
      image_url: trip.image_url || trip.trip_image_url || trip.cover_image_url || '',
      bank_accounts_text: serializeBankAccountsForTextInput((trip as any).bank_accounts),
      telebirr_manual_account_name: ((trip as any).telebirr_manual_account_name || '').trim(),
      telebirr_manual_account_number: ((trip as any).telebirr_manual_account_number || '').trim(),
      manual_payment_note: ((trip as any).manual_payment_note || '').trim(),
      allow_gnpl: Boolean((trip as any).allow_gnpl),
      telegram_group_url: ((trip as any).telegram_group_url || '').trim(),
      telegram_group_chat_id: ((trip as any).telegram_group_chat_id || '').trim(),
      departure_date: toDatetimeLocal(trip.departure_date),
      arrival_date: toDatetimeLocal(trip.arrival_date),
      price_per_ticket: String(trip.price_per_ticket ?? ''),
      total_seats: String(trip.total_seats ?? ''),
      available_seats: String(trip.available_seats ?? ''),
      status: trip.status || 'active',
    });
    setFormError('');
    setShowForm(true);
  };

  const closeFormModal = () => {
    if (saving) return;
    setShowForm(false);
    setEditingTrip(null);
    setFormData(EMPTY_FORM);
    setFormError('');
  };

  const handleFormChange = <K extends keyof TripFormInput>(field: K, value: TripFormInput[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const applyDescriptionMarkup = (before: string, after: string, placeholder = 'text') => {
    const textarea = descriptionTextareaRef.current;
    const currentText = formData.description || '';

    if (!textarea) {
      handleFormChange('description', `${currentText}${before}${placeholder}${after}`);
      return;
    }

    const start = textarea.selectionStart ?? currentText.length;
    const end = textarea.selectionEnd ?? currentText.length;
    const selectedText = currentText.slice(start, end) || placeholder;
    const nextText = `${currentText.slice(0, start)}${before}${selectedText}${after}${currentText.slice(end)}`;

    handleFormChange('description', nextText);
    requestAnimationFrame(() => {
      textarea.focus();
      const selectionStart = start + before.length;
      const selectionEnd = selectionStart + selectedText.length;
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const applyDescriptionBlock = (startTag: string, endTag: string, placeholder = 'text') => {
    applyDescriptionMarkup(`${startTag}\n`, `\n${endTag}`, placeholder);
  };

  const applyDescriptionLink = () => {
    const url = window.prompt('Enter URL (https://...)', 'https://');
    if (!url) return;
    const sanitizedUrl = url.trim();
    if (!/^https?:\/\//i.test(sanitizedUrl)) return;
    applyDescriptionMarkup(`<a href="${sanitizedUrl}" target="_blank" rel="noopener noreferrer">`, '</a>', 'link text');
  };

  const validateForm = () => {
    const name = formData.name.trim();
    const destination = formData.destination.trim();
    const price = Number(formData.price_per_ticket);
    const totalSeats = Number(formData.total_seats);
    const availableSeats = Number(formData.available_seats);

    if (!name) return 'Trip name is required.';
    if (!destination) return 'Destination is required.';
    if (formData.image_url.trim() && !/^https?:\/\//i.test(formData.image_url.trim())) {
      return 'Trip image URL must start with http:// or https://';
    }
    if (!formData.departure_date) return 'Departure date is required.';
    if (!Number.isFinite(price) || price <= 0) return 'Price per ticket must be greater than 0.';
    if (!Number.isInteger(totalSeats) || totalSeats <= 0) return 'Total seats must be a positive integer.';
    if (!Number.isInteger(availableSeats) || availableSeats < 0) return 'Available seats must be a non-negative integer.';
    if (availableSeats > totalSeats) return 'Available seats cannot be greater than total seats.';
    if (formData.arrival_date && new Date(formData.arrival_date) < new Date(formData.departure_date)) {
      return 'Arrival date cannot be before departure date.';
    }

    return '';
  };

  const handleSaveTrip = async () => {
    try {
      setFormError('');
      const validationError = validateForm();
      if (validationError) {
        setFormError(validationError);
        return;
      }

      setSaving(true);
      const payload = {
        id: editingTrip?.id,
        name: formData.name.trim(),
        description: formData.description.trim() || null,
        destination: formData.destination.trim(),
        image_url: formData.image_url.trim() || null,
        bank_accounts: formData.bank_accounts_text.trim() || null,
        telebirr_manual_account_name: formData.telebirr_manual_account_name.trim() || null,
        telebirr_manual_account_number: formData.telebirr_manual_account_number.trim() || null,
        manual_payment_note: formData.manual_payment_note.trim() || null,
        allow_gnpl: Boolean(formData.allow_gnpl),
        telegram_group_url: formData.telegram_group_url.trim() || null,
        telegram_group_chat_id: formData.telegram_group_chat_id.trim() || null,
        departure_date: new Date(formData.departure_date).toISOString(),
        arrival_date: formData.arrival_date ? new Date(formData.arrival_date).toISOString() : null,
        price_per_ticket: Number(formData.price_per_ticket),
        total_seats: Number(formData.total_seats),
        available_seats: Number(formData.available_seats),
        status: formData.status,
      };

      const response = await fetch('/api/admin/trips', {
        method: editingTrip ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || 'Failed to save trip');
      }

      closeFormModal();
      await loadTrips();
    } catch (error) {
      console.error('[trips] Save error:', error);
      setFormError('Unable to save trip. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTrip = async () => {
    if (!deletingTrip) return;

    try {
      setDeleting(true);
      const response = await fetch(`/api/admin/trips?id=${encodeURIComponent(deletingTrip.id)}`, {
        method: 'DELETE',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result?.ok) throw new Error(result?.error || 'Failed to delete trip');

      setDeletingTrip(null);
      await loadTrips();
    } catch (error) {
      console.error('[trips] Delete error:', error);
      alert('Unable to delete trip. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const toggleExpanded = (tripId: string) => {
    setExpandedTripIds((prev) => ({
      ...prev,
      [tripId]: !prev[tripId],
    }));
  };

  const filteredTrips = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const next = trips.filter((trip) => {
      const status = String(trip.status || '').toLowerCase() as 'active' | 'completed' | 'cancelled';
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      if (!query) return true;
      const haystack = [
        trip.name || '',
        trip.destination || '',
        trip.description || '',
        String((trip as any).telegram_group_chat_id || ''),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    next.sort((a, b) => {
      if (sortMode === 'name_asc') {
        return String(a.name || '').localeCompare(String(b.name || ''));
      }
      if (sortMode === 'price_asc') {
        return Number(a.price_per_ticket || 0) - Number(b.price_per_ticket || 0);
      }
      if (sortMode === 'price_desc') {
        return Number(b.price_per_ticket || 0) - Number(a.price_per_ticket || 0);
      }

      const aDeparture = new Date(a.departure_date || 0).getTime();
      const bDeparture = new Date(b.departure_date || 0).getTime();
      if (sortMode === 'departure_asc') return aDeparture - bDeparture;
      return bDeparture - aDeparture;
    });

    return next;
  }, [searchQuery, sortMode, statusFilter, trips]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-300">Loading trips...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-white">Trips Management</h1>
        <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90 text-white flex items-center gap-2">
          <Plus size={18} />
          Add Trip
        </Button>
      </div>

      <Card className="bg-slate-800 border-slate-700 p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative md:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by trip, destination, description, group id"
              className="w-full pl-9 pr-3 py-2 bg-slate-700 border border-slate-600 text-white rounded"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as any)}
            className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded"
          >
            <option value="departure_desc">Departure: Latest</option>
            <option value="departure_asc">Departure: Earliest</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="name_asc">Name: A-Z</option>
          </select>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-300">
            Showing {filteredTrips.length} of {trips.length} trips
          </p>
          <div className="inline-flex rounded-md border border-slate-600 overflow-hidden">
            <button
              className={`px-3 py-2 text-sm flex items-center gap-2 ${viewMode === 'grid' ? 'bg-primary text-white' : 'bg-slate-700 text-slate-200'}`}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid size={14} />
              Grid
            </button>
            <button
              className={`px-3 py-2 text-sm flex items-center gap-2 ${viewMode === 'list' ? 'bg-primary text-white' : 'bg-slate-700 text-slate-200'}`}
              onClick={() => setViewMode('list')}
            >
              <List size={14} />
              List
            </button>
          </div>
        </div>
      </Card>

      <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' : 'space-y-4'}>
        {filteredTrips.map((trip) => {
          const isExpanded = Boolean(expandedTripIds[trip.id]);
          return (
            <Card key={trip.id} className="bg-slate-800 border-slate-700 hover:border-slate-600 transition-all">
              {trip.image_url ? (
                <img
                  src={trip.image_url}
                  alt={trip.name}
                  className={`${viewMode === 'grid' ? 'h-36' : 'h-28'} w-full object-cover rounded-t-xl border-b border-slate-700`}
                />
              ) : (
                <div className={`${viewMode === 'grid' ? 'h-36' : 'h-28'} w-full rounded-t-xl border-b border-slate-700 bg-slate-900 flex items-center justify-center text-slate-500 text-sm`}>
                  No destination image
                </div>
              )}
              <div className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{trip.name}</h3>
                    <p className="text-slate-400 text-sm mt-1">{trip.destination}</p>
                  </div>
                  <button
                    onClick={() => toggleExpanded(trip.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isExpanded ? 'Collapse' : 'Expand'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mt-4">
                  <div className="flex justify-between col-span-2">
                    <span className="text-slate-400">Departure</span>
                    <span className="text-white font-medium">{new Date(trip.departure_date).toLocaleDateString()}</span>
                  </div>
                  <div className="flex justify-between col-span-2">
                    <span className="text-slate-400">Price/Ticket</span>
                    <span className="text-white font-medium">{trip.price_per_ticket} ETB</span>
                  </div>
                  <div className="flex justify-between col-span-2">
                    <span className="text-slate-400">Seats Available</span>
                    <span className="text-white font-medium">{trip.available_seats}/{trip.total_seats}</span>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="space-y-2 text-sm mt-4 border-t border-slate-700 pt-4">
                    <p className="text-slate-300">{trip.description || 'No description'}</p>
                    <div className="flex justify-between">
                      <span className="text-slate-400">GNPL</span>
                      <span className="text-white font-medium">{(trip as any).allow_gnpl ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    {(trip as any).telegram_group_url ? (
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-400">Trip Group</span>
                        <a
                          href={String((trip as any).telegram_group_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-300 underline text-right"
                        >
                          Open Group
                        </a>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEditModal(trip)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                  >
                    <Edit size={16} />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeletingTrip(trip)}
                    className="flex-1 bg-red-900/20 hover:bg-red-900/30 text-red-400 border-red-800"
                  >
                    <Trash size={16} />
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {filteredTrips.length === 0 && (
        <Card className="bg-slate-800 border-slate-700 p-12 text-center">
          <p className="text-slate-400 mb-4">No trips matched the current filters</p>
          <Button onClick={openCreateModal} className="bg-primary hover:bg-primary/90 text-white">
            Add Trip
          </Button>
        </Card>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-2xl bg-slate-800 border-slate-700 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white">
                  {editingTrip ? 'Edit Trip' : 'Create Trip'}
                </h2>
                <button onClick={closeFormModal} className="text-slate-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Trip Name</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleFormChange('name', e.target.value)}
                    className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                    placeholder="Weekend Addis tour"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">Description</label>
                  <div className="mb-2 flex flex-wrap gap-2 rounded-md border border-slate-600 bg-slate-900/60 p-2">
                    <button
                      type="button"
                      onClick={() => applyDescriptionMarkup('<strong>', '</strong>', 'bold text')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Bold
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDescriptionMarkup('<em>', '</em>', 'italic text')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Italic
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDescriptionMarkup('<u>', '</u>', 'underlined text')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Underline
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDescriptionMarkup('<h2>', '</h2>', 'Heading')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      H2
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDescriptionBlock('<ul><li>', '</li></ul>', 'List item')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Bullet List
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDescriptionBlock('<ol><li>', '</li></ol>', 'List item')}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Numbered List
                    </button>
                    <button
                      type="button"
                      onClick={applyDescriptionLink}
                      className="rounded border border-slate-500 px-2 py-1 text-xs text-slate-200 hover:bg-slate-700"
                    >
                      Link
                    </button>
                  </div>
                  <textarea
                    ref={descriptionTextareaRef}
                    value={formData.description}
                    onChange={(e) => handleFormChange('description', e.target.value)}
                    className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                    rows={6}
                    placeholder="Trip details, meeting point, and notes."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Destination Image URL
                  </label>
                  <input
                    type="url"
                    value={formData.image_url}
                    onChange={(e) => handleFormChange('image_url', e.target.value)}
                    className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                    placeholder="https://example.com/lalibela.jpg"
                  />
                  {formData.image_url.trim() ? (
                    <img
                      src={formData.image_url}
                      alt="Trip background preview"
                      className="mt-3 h-36 w-full object-cover rounded border border-slate-700"
                    />
                  ) : null}
                </div>

                <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-100">Manual Payment Configuration</h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-200 mb-2">
                        Telebirr Account Name
                      </label>
                      <input
                        type="text"
                        value={formData.telebirr_manual_account_name}
                        onChange={(e) => handleFormChange('telebirr_manual_account_name', e.target.value)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                        placeholder="TicketHub PLC"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-200 mb-2">
                        Telebirr Account Number
                      </label>
                      <input
                        type="text"
                        value={formData.telebirr_manual_account_number}
                        onChange={(e) => handleFormChange('telebirr_manual_account_number', e.target.value)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                        placeholder="09XXXXXXXX or shortcode"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">
                      Bank Accounts (one per line)
                    </label>
                    <textarea
                      value={formData.bank_accounts_text}
                      onChange={(e) => handleFormChange('bank_accounts_text', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                      rows={4}
                      placeholder={'Commercial Bank | TicketHub PLC | 1000123456789\nAwash Bank | TicketHub PLC | 2000456789123'}
                    />
                    <p className="text-xs text-slate-400 mt-2">
                      Format: Bank Name | Account Name | Account Number
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">
                      Manual Payment Note (optional)
                    </label>
                    <textarea
                      value={formData.manual_payment_note}
                      onChange={(e) => handleFormChange('manual_payment_note', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                      rows={2}
                      placeholder="Example: Put trip name in transfer reason."
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={formData.allow_gnpl}
                      onChange={(e) => handleFormChange('allow_gnpl', e.target.checked)}
                    />
                    Allow GNPL for this trip
                  </label>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-200 mb-2">
                        Telegram Group URL (optional)
                      </label>
                      <input
                        type="url"
                        value={formData.telegram_group_url}
                        onChange={(e) => handleFormChange('telegram_group_url', e.target.value)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                        placeholder="https://t.me/+inviteLink"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-200 mb-2">
                        Telegram Group Chat ID (optional)
                      </label>
                      <input
                        type="text"
                        value={formData.telegram_group_chat_id}
                        onChange={(e) => handleFormChange('telegram_group_chat_id', e.target.value)}
                        className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                        placeholder="-1001234567890"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Destination</label>
                    <input
                      type="text"
                      value={formData.destination}
                      onChange={(e) => handleFormChange('destination', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded placeholder:text-slate-400 focus:outline-none focus:border-primary"
                      placeholder="Bahir Dar"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Status</label>
                    <select
                      value={formData.status}
                      onChange={(e) => handleFormChange('status', e.target.value as TripFormInput['status'])}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    >
                      <option value="active">Active</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Departure Date</label>
                    <input
                      type="datetime-local"
                      value={formData.departure_date}
                      onChange={(e) => handleFormChange('departure_date', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Arrival Date</label>
                    <input
                      type="datetime-local"
                      value={formData.arrival_date}
                      onChange={(e) => handleFormChange('arrival_date', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Price (ETB)</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.price_per_ticket}
                      onChange={(e) => handleFormChange('price_per_ticket', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Total Seats</label>
                    <input
                      type="number"
                      min="1"
                      value={formData.total_seats}
                      onChange={(e) => handleFormChange('total_seats', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-200 mb-2">Available Seats</label>
                    <input
                      type="number"
                      min="0"
                      value={formData.available_seats}
                      onChange={(e) => handleFormChange('available_seats', e.target.value)}
                      className="w-full p-2 bg-slate-700 border border-slate-600 text-white rounded focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              {formError && (
                <p className="text-sm text-red-400 mt-4">{formError}</p>
              )}

              <div className="flex gap-3 mt-6">
                <Button
                  onClick={handleSaveTrip}
                  disabled={saving}
                  className="flex-1 bg-primary hover:bg-primary/90 text-white"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Saving...
                    </span>
                  ) : editingTrip ? (
                    'Update Trip'
                  ) : (
                    'Create Trip'
                  )}
                </Button>
                <Button
                  onClick={closeFormModal}
                  disabled={saving}
                  variant="outline"
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}

      {deletingTrip && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <Card className="w-full max-w-md bg-slate-800 border-slate-700">
            <div className="p-6">
              <h2 className="text-xl font-bold text-white mb-3">Delete Trip</h2>
              <p className="text-slate-300 mb-6">
                Are you sure you want to delete <span className="font-semibold text-white">{deletingTrip.name}</span>?
              </p>
              <div className="flex gap-3">
                <Button
                  onClick={handleDeleteTrip}
                  disabled={deleting}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                >
                  {deleting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 size={16} className="animate-spin" />
                      Deleting...
                    </span>
                  ) : (
                    'Delete'
                  )}
                </Button>
                <Button
                  onClick={() => setDeletingTrip(null)}
                  disabled={deleting}
                  variant="outline"
                  className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
