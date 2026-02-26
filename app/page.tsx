'use client';

import Script from 'next/script';
import { useCallback, useEffect, useMemo, useState } from 'react';
import miniAppI18n from '@/lib/i18n/miniapp.json';
import { formatLocalizedDateTime } from '@/lib/date-localization';

type MiniAppUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  languageCode: 'en' | 'am';
};

type Trip = {
  id: string;
  name?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  price_per_ticket?: number | null;
  available_seats?: number | null;
  total_seats?: number | null;
  image_url?: string | null;
  trip_image_url?: string | null;
  cover_image_url?: string | null;
};

type Booking = {
  id: string;
  serialNumber: string;
  ticketNumber: string;
  status: string;
  tripName: string;
  destination: string;
  departureDate: string | null;
  referenceNumber: string | null;
  approvalStatus: string | null;
  cardUrl: string | null;
};

type PaymentMethod = 'telebirr_auto' | 'telebirr' | 'bank';

type BankAccount = {
  bank_name: string;
  account_name: string;
  account_number: string;
};

type ManualFlow = {
  tripId: string;
  tripName: string;
  paymentMethod: 'bank' | 'telebirr';
  quantity: number;
  pricePerTicket: number;
  bankAccounts: BankAccount[];
  selectedBankIndex: number;
  telebirrManualAccountName: string;
  telebirrManualAccountNumber: string;
  manualPaymentNote: string;
  amountPaid: string;
  referenceNumber: string;
  receiptFileName: string;
  receiptDataUrl: string;
};

type UiLang = 'en' | 'am';
type ReceiptValidationErrorKey =
  | 'receipt_validation_required'
  | 'receipt_validation_empty'
  | 'receipt_validation_size'
  | 'receipt_validation_type';

const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'application/pdf']);
const ALLOWED_RECEIPT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const I18N = miniAppI18n as Record<UiLang, Record<string, string>>;
const AMHARIC_FONT_STACK = "'Noto Sans Ethiopic','Abyssinica SIL','Nyala','Segoe UI',sans-serif";

declare global {
  interface Window {
    Telegram?: any;
  }
}

function formatDate(value?: string | null, lang: UiLang = 'en', naText = 'N/A') {
  return formatLocalizedDateTime(value, lang, naText);
}

function readFileAsDataURL(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('receipt_read_failed'));
    reader.readAsDataURL(file);
  });
}

function validateReceiptFile(file: File): ReceiptValidationErrorKey | null {
  if (!file) return 'receipt_validation_required';
  if (file.size <= 0) return 'receipt_validation_empty';
  if (file.size > MAX_RECEIPT_BYTES) return 'receipt_validation_size';

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType && ALLOWED_RECEIPT_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const name = String(file.name || '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (ALLOWED_RECEIPT_EXTENSIONS.has(extension)) {
    return null;
  }

  return 'receipt_validation_type';
}

export default function MiniAppPage() {
  const [initData, setInitData] = useState('');
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>('am');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTripId, setBusyTripId] = useState('');
  const [languageSaving, setLanguageSaving] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [methodByTrip, setMethodByTrip] = useState<Record<string, PaymentMethod>>({});
  const [quantityByTrip, setQuantityByTrip] = useState<Record<string, number>>({});
  const [manualFlow, setManualFlow] = useState<ManualFlow | null>(null);

  const t = useCallback(
    (key: string) => I18N[uiLang]?.[key] || I18N.en[key] || key,
    [uiLang]
  );

  const selectedMethod = useCallback(
    (tripId: string) => methodByTrip[tripId] || 'telebirr_auto',
    [methodByTrip]
  );

  const selectedQuantity = useCallback(
    (tripId: string) => Math.max(1, Number(quantityByTrip[tripId] || 1)),
    [quantityByTrip]
  );

  const apiFetch = useCallback(
    async (input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers || {});
      headers.set('x-telegram-init-data', initData);
      headers.set('content-type', headers.get('content-type') || 'application/json');
      return fetch(input, { ...init, headers, cache: 'no-store' });
    },
    [initData]
  );

  const loadData = useCallback(async () => {
    if (!initData) return;

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const [sessionRes, tripsRes, bookingsRes] = await Promise.all([
        apiFetch('/api/miniapp/session', { method: 'POST', body: JSON.stringify({ initData }) }),
        apiFetch('/api/miniapp/trips'),
        apiFetch('/api/miniapp/bookings'),
      ]);

      const sessionJson = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || !sessionJson?.ok) {
        throw new Error(sessionJson?.error || t('error_session_failed'));
      }
      const sessionUser = sessionJson.user as MiniAppUser;
      setUser(sessionUser);
      setUiLang(sessionUser?.languageCode === 'en' ? 'en' : 'am');

      const tripsJson = await tripsRes.json().catch(() => ({}));
      if (!tripsRes.ok || !tripsJson?.ok) {
        throw new Error(tripsJson?.error || t('error_trips_failed'));
      }
      setTrips((tripsJson.trips || []) as Trip[]);

      const bookingsJson = await bookingsRes.json().catch(() => ({}));
      if (!bookingsRes.ok || !bookingsJson?.ok) {
        throw new Error(bookingsJson?.error || t('error_bookings_failed'));
      }
      setBookings((bookingsJson.bookings || []) as Booking[]);
    } catch (e) {
      const message = e instanceof Error ? e.message : t('error_load_data');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [apiFetch, initData, t]);

  const startBooking = useCallback(
    async (trip: Trip) => {
      const tripId = trip.id;
      const paymentMethod = selectedMethod(tripId);
      const quantity = selectedQuantity(tripId);
      const telegramId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0) || undefined;
      setBusyTripId(tripId);
      setError('');
      setNotice('');
      try {
        const endpoint = paymentMethod === 'telebirr_auto' ? '/api/pay' : '/api/miniapp/book';
        const response = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            initData,
            telegramId,
            tripId,
            paymentMethod,
            quantity,
          }),
        });

        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || t('error_start_booking_failed'));
        }

        const paymentUrl = String(json.payment_url || json.checkoutUrl || '').trim();
        if (paymentUrl) {
          const tg = window.Telegram?.WebApp;
          if (tg?.openLink) {
            tg.openLink(paymentUrl);
          } else {
            window.open(paymentUrl, '_blank');
          }
          setNotice(t('notice_checkout_opened'));
          await loadData();
          return;
        }

        const manualConfig = json?.manualConfig;
        if (manualConfig && (paymentMethod === 'bank' || paymentMethod === 'telebirr')) {
          const pricePerTicket = Number(trip.price_per_ticket || 0);
          const expected = Number((pricePerTicket * quantity).toFixed(2));
          setManualFlow({
            tripId,
            tripName: trip.name || t('trip_fallback'),
            paymentMethod,
            quantity,
            pricePerTicket,
            bankAccounts: Array.isArray(manualConfig.bankAccounts) ? manualConfig.bankAccounts : [],
            selectedBankIndex: 0,
            telebirrManualAccountName: String(manualConfig.telebirrManualAccountName || ''),
            telebirrManualAccountNumber: String(manualConfig.telebirrManualAccountNumber || ''),
            manualPaymentNote: String(manualConfig.manualPaymentNote || ''),
            amountPaid: expected.toFixed(2),
            referenceNumber: '',
            receiptFileName: '',
            receiptDataUrl: '',
          });
          setNotice(
            String(
              json.message || t('notice_manual_started')
            )
          );
        } else {
          setNotice(String(json.message || t('notice_booking_started')));
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : t('error_booking_failed');
        setError(message);
      } finally {
        setBusyTripId('');
      }
    },
    [apiFetch, initData, loadData, selectedMethod, selectedQuantity, t]
  );

  const updateManualQuantity = useCallback((quantity: number) => {
    setManualFlow((prev) => {
      if (!prev) return prev;
      const nextQty = Math.max(1, Number(quantity || 1));
      const expected = Number((prev.pricePerTicket * nextQty).toFixed(2));
      return {
        ...prev,
        quantity: nextQty,
        amountPaid: expected.toFixed(2),
      };
    });
  }, []);

  const onManualReceiptFile = useCallback(async (file?: File | null) => {
    if (!file) {
      setManualFlow((prev) => (prev ? { ...prev, receiptFileName: '', receiptDataUrl: '' } : prev));
      return;
    }
    const validationError = validateReceiptFile(file);
    if (validationError) {
      setError(t(validationError));
      setManualFlow((prev) => (prev ? { ...prev, receiptFileName: '', receiptDataUrl: '' } : prev));
      return;
    }

    const dataUrl = await readFileAsDataURL(file);
    setManualFlow((prev) =>
      prev
        ? {
          ...prev,
          receiptFileName: file.name || `receipt_${Date.now()}`,
          receiptDataUrl: dataUrl,
        }
        : prev
    );
  }, [t]);

  const submitManualPayment = useCallback(async () => {
    if (!manualFlow) return;

    setError('');
    setNotice('');

    if (!manualFlow.referenceNumber.trim()) {
      setError(t('error_payment_reference_required'));
      return;
    }
    if (!manualFlow.receiptDataUrl) {
      setError(t('error_receipt_required'));
      return;
    }

    setManualSubmitting(true);
    try {
      const response = await apiFetch('/api/miniapp/manual/complete', {
        method: 'POST',
        body: JSON.stringify({
          initData,
          tripId: manualFlow.tripId,
          paymentMethod: manualFlow.paymentMethod,
          quantity: manualFlow.quantity,
          amountPaid: Number(manualFlow.amountPaid || 0),
          referenceNumber: manualFlow.referenceNumber.trim(),
          bankIndex: manualFlow.selectedBankIndex,
          receiptFileName: manualFlow.receiptFileName,
          receiptDataUrl: manualFlow.receiptDataUrl,
        }),
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || t('error_manual_complete_failed'));
      }

      setManualFlow(null);
      setNotice(
        `${String(json.message || t('manual_payment_submitted'))}\n${t('reference')}: ${String(
          json.referenceNumber || t('na')
        )}`
      );
      await loadData();
    } catch (e) {
      const message = e instanceof Error ? e.message : t('error_submit_manual_failed');
      setError(message);
    } finally {
      setManualSubmitting(false);
    }
  }, [apiFetch, initData, loadData, manualFlow, t]);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const params = new URLSearchParams(window.location.search);
    const fromQuery = String(params.get('initData') || params.get('tgWebAppData') || '').trim();

    const resolveFromTelegram = () => {
      const tg = window.Telegram?.WebApp;
      if (!tg) return '';
      tg.ready?.();
      tg.expand?.();
      return String(tg.initData || '').trim();
    };

    const tryResolve = (attempt: number) => {
      if (disposed) return;

      const fromTg = resolveFromTelegram();
      if (fromTg) {
        setError('');
        setInitData(fromTg);
        return;
      }

      if (fromQuery) {
        setError('');
        setInitData(fromQuery);
        return;
      }

      if (attempt < 20) {
        timer = setTimeout(() => tryResolve(attempt + 1), 150);
        return;
      }

      setError(t('error_open_from_telegram'));
      setLoading(false);
    };

    tryResolve(0);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [t]);

  useEffect(() => {
    if (!initData) return;
    loadData();
  }, [initData, loadData]);

  const username = useMemo(() => {
    if (!user) return '';
    if (user.username) return `@${user.username}`;
    return [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  }, [user]);

  const manualExpectedAmount = useMemo(() => {
    if (!manualFlow) return 0;
    return Number((manualFlow.pricePerTicket * manualFlow.quantity).toFixed(2));
  }, [manualFlow]);

  const selectedBank = useMemo(() => {
    if (!manualFlow || manualFlow.paymentMethod !== 'bank') return null;
    if (!manualFlow.bankAccounts.length) return null;
    const idx = Math.min(Math.max(0, manualFlow.selectedBankIndex), manualFlow.bankAccounts.length - 1);
    return manualFlow.bankAccounts[idx] || null;
  }, [manualFlow]);

  const changeLanguage = useCallback(
    async (nextLang: UiLang) => {
      if (!initData || languageSaving || nextLang === uiLang) return;

      setLanguageSaving(true);
      setError('');
      setNotice('');
      try {
        const response = await apiFetch('/api/miniapp/language', {
          method: 'POST',
          body: JSON.stringify({ initData, languageCode: nextLang }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || t('error_change_language_failed'));
        }

        setUiLang(nextLang);
        setUser((prev) => (prev ? { ...prev, languageCode: nextLang } : prev));
        setNotice(
          nextLang === 'am'
            ? I18N.am.notice_lang_am
            : I18N.en.notice_lang_en
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : t('error_change_language_failed');
        setError(message);
      } finally {
        setLanguageSaving(false);
      }
    },
    [apiFetch, initData, languageSaving, t, uiLang]
  );

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937,#020617)] text-slate-100 px-4 py-5"
      style={uiLang === 'am' ? { fontFamily: AMHARIC_FONT_STACK } : undefined}
    >
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />

      <section className="max-w-3xl mx-auto space-y-4">
        <header className="rounded-2xl border border-cyan-700/40 bg-slate-900/70 p-4 shadow-xl">
          <p className="text-xs tracking-[0.18em] uppercase text-cyan-300">{t('app_title')}</p>
          <h1 className="text-2xl font-semibold mt-1">{t('page_title')}</h1>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-300">{username || t('telegram_customer')}</p>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300">
              <span>{t('language')}</span>
              <select
                value={uiLang}
                disabled={languageSaving}
                onChange={(e) => changeLanguage((e.target.value as UiLang) || 'am')}
                className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100"
              >
                <option value="am">{t('lang_am')}</option>
                <option value="en">{t('lang_en')}</option>
              </select>
            </label>
          </div>
        </header>

        {error ? <div className="rounded-xl border border-red-700/50 bg-red-950/40 p-3 text-sm">{error}</div> : null}
        {notice ? <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/40 p-3 text-sm whitespace-pre-line">{notice}</div> : null}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('available_trips')}</h2>
          <button
            type="button"
            onClick={loadData}
            className="rounded-lg border border-cyan-700/40 px-3 py-1 text-sm hover:bg-cyan-900/30"
          >
            {t('refresh')}
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-sm">
            {t('loading')}
          </div>
        ) : (
          <div className="grid gap-3">
            {trips.length === 0 ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-sm">
                {t('no_active_trips')}
              </div>
            ) : null}

            {trips.map((trip) => {
              const image = trip.cover_image_url || trip.trip_image_url || trip.image_url;
              const method = selectedMethod(trip.id);
              const quantity = selectedQuantity(trip.id);
              const isBusy = busyTripId === trip.id;
              return (
                <article key={trip.id} className="rounded-2xl border border-slate-700/70 bg-slate-900/65 overflow-hidden">
                  {image ? <img src={image} alt={trip.name || t('trip_fallback')} className="h-36 w-full object-cover" /> : null}
                  <div className="p-4 space-y-2">
                    <h3 className="text-lg font-semibold">{trip.name || t('trip_fallback')}</h3>
                    <p className="text-sm text-slate-300">
                      {trip.destination || t('na')} | {formatDate(trip.departure_date, uiLang, t('na'))}
                    </p>
                    <p className="text-sm text-slate-200">
                      ETB {Number(trip.price_per_ticket || 0).toFixed(2)} | {t('seats')} {trip.available_seats ?? 0}/
                      {trip.total_seats ?? 0}
                    </p>

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <input
                        min={1}
                        type="number"
                        className="rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm w-24"
                        value={quantity}
                        onChange={(e) =>
                          setQuantityByTrip((prev) => ({
                            ...prev,
                            [trip.id]: Math.max(1, Number(e.target.value || 1)),
                          }))
                        }
                      />
                      <select
                        className="rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                        value={method}
                        onChange={(e) =>
                          setMethodByTrip((prev) => ({
                            ...prev,
                            [trip.id]: e.target.value as PaymentMethod,
                          }))
                        }
                      >
                        <option value="telebirr">{t('telebirr_manual')}</option>
                        <option value="bank">{t('bank_transfer')}</option>
                        <option value="telebirr_auto">{t('telebirr_auto')}</option>
                      </select>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startBooking(trip)}
                        className="rounded-lg bg-cyan-500 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-60"
                      >
                        {isBusy ? t('starting') : t('book')}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {manualFlow ? (
          <section className="rounded-2xl border border-cyan-700/50 bg-slate-900/70 p-4 space-y-3">
            <h2 className="text-lg font-semibold">
              {t('manual_payment')} - {manualFlow.tripName}
            </h2>
            <p className="text-sm text-slate-300">{t('manual_step_desc')}</p>

            {manualFlow.paymentMethod === 'bank' ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-2">
                <p className="text-sm font-medium">{t('bank_transfer_details')}</p>
                {manualFlow.bankAccounts.length > 1 ? (
                  <select
                    value={manualFlow.selectedBankIndex}
                    onChange={(e) =>
                      setManualFlow((prev) =>
                        prev
                          ? {
                            ...prev,
                            selectedBankIndex: Math.max(0, Number(e.target.value || 0)),
                          }
                          : prev
                      )
                    }
                    className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm w-full"
                  >
                    {manualFlow.bankAccounts.map((bank, idx) => (
                      <option key={`${bank.bank_name}-${idx}`} value={idx}>
                        {idx + 1}. {bank.bank_name}
                      </option>
                    ))}
                  </select>
                ) : null}
                {selectedBank ? (
                  <div className="text-sm text-slate-200 space-y-1">
                    <p>{t('bank')}: {selectedBank.bank_name}</p>
                    <p>{t('account_name')}: {selectedBank.account_name}</p>
                    <p>{t('account_number')}: {selectedBank.account_number}</p>
                  </div>
                ) : (
                  <p className="text-sm text-amber-300">
                    {t('bank_not_configured')}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 text-sm text-slate-200 space-y-1">
                <p className="font-medium">{t('telebirr_manual_details')}</p>
                <p>{t('account_name')}: {manualFlow.telebirrManualAccountName || t('not_configured')}</p>
                <p>{t('account_number')}: {manualFlow.telebirrManualAccountNumber || t('not_configured')}</p>
              </div>
            )}

            {manualFlow.manualPaymentNote ? (
              <p className="text-xs text-slate-300">{t('note')}: {manualFlow.manualPaymentNote}</p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">
                <span className="text-slate-300">{t('quantity')}</span>
                <input
                  min={1}
                  type="number"
                  value={manualFlow.quantity}
                  onChange={(e) => updateManualQuantity(Number(e.target.value || 1))}
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm">
                <span className="text-slate-300">{t('paid_amount')}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manualFlow.amountPaid}
                  onChange={(e) =>
                    setManualFlow((prev) => (prev ? { ...prev, amountPaid: e.target.value } : prev))
                  }
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">{t('bill_reference')}</span>
                <input
                  type="text"
                  value={manualFlow.referenceNumber}
                  onChange={(e) =>
                    setManualFlow((prev) => (prev ? { ...prev, referenceNumber: e.target.value } : prev))
                  }
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                  placeholder={t('ref_placeholder')}
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">{t('receipt_file')}</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  onChange={async (e) => {
                    try {
                      await onManualReceiptFile(e.target.files?.[0] || null);
                    } catch {
                      setError(t('error_read_receipt_failed'));
                    }
                  }}
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                />
              </label>
            </div>

            <p className="text-xs text-slate-300">
              {t('expected_total')}: ETB {manualExpectedAmount.toFixed(2)} {t('for')} {manualFlow.quantity} {t('tickets')}
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitManualPayment}
                disabled={manualSubmitting}
                className="rounded-lg bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                {manualSubmitting ? t('submitting') : t('complete_manual_payment')}
              </button>
              <button
                type="button"
                onClick={() => setManualFlow(null)}
                disabled={manualSubmitting}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm"
              >
                {t('cancel')}
              </button>
            </div>
          </section>
        ) : null}

        <div className="pt-2">
          <h2 className="text-lg font-medium mb-2">{t('my_bookings')}</h2>
          <div className="grid gap-2">
            {bookings.length === 0 ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-sm">
                {t('no_bookings')}
              </div>
            ) : null}

            {bookings.map((booking) => (
              <div key={booking.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                <p className="font-medium">{booking.tripName}</p>
                <p className="text-sm text-slate-300">
                  {booking.destination} | {booking.serialNumber}
                </p>
                <p className="text-xs text-slate-400">
                  {t('status')}: {booking.status} | {t('ref_short')}: {booking.referenceNumber || t('na')}
                </p>
                {booking.cardUrl ? (
                  <a className="text-xs text-cyan-300 underline" href={booking.cardUrl} target="_blank" rel="noreferrer">
                    {t('open_digital_ticket')}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
