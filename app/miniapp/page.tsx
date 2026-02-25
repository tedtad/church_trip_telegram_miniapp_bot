'use client';

import Script from 'next/script';
import { useCallback, useEffect, useMemo, useState } from 'react';
import miniAppI18n from '@/lib/i18n/miniapp.json';

type MiniAppUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  phoneNumber?: string;
  languageCode: 'en' | 'am';
};

type MiniAppSettings = {
  telegramChannelUrl?: string;
  telegramChannelName?: string;
  gnplEnabled?: boolean;
  gnplRequireAdminApproval?: boolean;
  gnplDefaultTermDays?: number;
  gnplPenaltyEnabled?: boolean;
  gnplPenaltyPercent?: number;
  gnplPenaltyPeriodDays?: number;
};

type Trip = {
  id: string;
  name?: string | null;
  description?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  arrival_date?: string | null;
  price_per_ticket?: number | null;
  available_seats?: number | null;
  total_seats?: number | null;
  image_url?: string | null;
  trip_image_url?: string | null;
  cover_image_url?: string | null;
  manual_payment_note?: string | null;
  allow_gnpl?: boolean | null;
  telegram_group_url?: string | null;
  telegram_group_chat_id?: string | null;
};

type Booking = {
  id: string;
  tripId?: string;
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

type PaymentMethod = 'telebirr_auto' | 'telebirr' | 'bank' | 'gnpl';

type GnplAccount = {
  id: string;
  status: string;
  tripId: string;
  tripName: string;
  destination: string;
  departureDate: string;
  quantity: number;
  dueDate: string | null;
  overdueDays: number;
  principalAmount: number;
  principalPaid: number;
  principalOutstanding: number;
  penaltyAccrued: number;
  penaltyPaid: number;
  penaltyOutstanding: number;
  totalDue: number;
  canPay: boolean;
  payments: Array<{
    id: string;
    amount: number;
    status: string;
    paymentDate: string;
    paymentReference: string;
    createdAt: string;
  }>;
};

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
  baseAmount: number;
  discountCode: string;
  discountPercent: number;
  discountAmount: number;
  finalAmount: number;
  bankAccounts: BankAccount[];
  selectedBankIndex: number;
  telebirrManualAccountName: string;
  telebirrManualAccountNumber: string;
  manualPaymentNote: string;
  amountPaid: string;
  referenceNumber: string;
  receiptLink: string;
  receiptDate: string;
  receiptFileName: string;
  receiptDataUrl: string;
};

type UiLang = 'en' | 'am';
type ReceiptValidationErrorKey =
  | 'receipt_validation_required'
  | 'receipt_validation_empty'
  | 'receipt_validation_size'
  | 'receipt_validation_type'
  | 'id_card_validation_required'
  | 'id_card_validation_empty'
  | 'id_card_validation_size'
  | 'id_card_validation_type';

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
  if (!value) return naText;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return naText;
  return date.toLocaleString(lang === 'am' ? 'am-ET' : 'en-US');
}

function normalizePhoneInput(value: string) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function isExpiredByDeparture(dateValue?: string | null) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() > date.getTime();
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

function validateGnplIdCardFile(file: File): ReceiptValidationErrorKey | null {
  if (!file) return 'id_card_validation_required';
  if (file.size <= 0) return 'id_card_validation_empty';
  if (file.size > MAX_RECEIPT_BYTES) return 'id_card_validation_size';

  const mimeType = String(file.type || '').toLowerCase();
  if (mimeType && ALLOWED_RECEIPT_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const name = String(file.name || '').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (ALLOWED_RECEIPT_EXTENSIONS.has(extension)) {
    return null;
  }

  return 'id_card_validation_type';
}

export default function MiniAppPage() {
  const [initData, setInitData] = useState('');
  const [user, setUser] = useState<MiniAppUser | null>(null);
  const [uiLang, setUiLang] = useState<UiLang>('am');
  const [customerName, setCustomerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gnplIdCardFileName, setGnplIdCardFileName] = useState('');
  const [gnplIdCardDataUrl, setGnplIdCardDataUrl] = useState('');
  const [trips, setTrips] = useState<Trip[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [gnplAccounts, setGnplAccounts] = useState<GnplAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyTripId, setBusyTripId] = useState('');
  const [languageSaving, setLanguageSaving] = useState(false);
  const [manualSubmitting, setManualSubmitting] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showExpiredBookings, setShowExpiredBookings] = useState(false);
  const [methodByTrip, setMethodByTrip] = useState<Record<string, PaymentMethod>>({});
  const [quantityByTrip, setQuantityByTrip] = useState<Record<string, number>>({});
  const [discountCodeByTrip, setDiscountCodeByTrip] = useState<Record<string, string>>({});
  const [manualFlow, setManualFlow] = useState<ManualFlow | null>(null);
  const [miniAppSettings, setMiniAppSettings] = useState<MiniAppSettings | null>(null);
  const [transferInputs, setTransferInputs] = useState<Record<string, { phone: string; name: string }>>({});
  const [transferBusyTicketId, setTransferBusyTicketId] = useState('');
  const [gnplPaymentForms, setGnplPaymentForms] = useState<Record<string, { amount: string; reference: string; receiptLink: string }>>({});
  const [gnplPayingAccountId, setGnplPayingAccountId] = useState('');

  const t = useCallback(
    (key: string) => I18N[uiLang]?.[key] || I18N.en[key] || key,
    [uiLang]
  );

  const selectedMethod = useCallback(
    (trip: Trip) => {
      const current = methodByTrip[trip.id] || 'telebirr';
      const gnplEnabledForTrip = Boolean(miniAppSettings?.gnplEnabled && trip.allow_gnpl);
      if (current === 'gnpl' && !gnplEnabledForTrip) return 'telebirr';
      return current;
    },
    [methodByTrip, miniAppSettings]
  );

  const selectedQuantity = useCallback(
    (tripId: string) => Math.max(1, Number(quantityByTrip[tripId] || 1)),
    [quantityByTrip]
  );

  const selectedDiscountCode = useCallback(
    (tripId: string) => String(discountCodeByTrip[tripId] || '').trim().toUpperCase(),
    [discountCodeByTrip]
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
      const [sessionRes, tripsRes, bookingsRes, gnplRes] = await Promise.all([
        apiFetch('/api/miniapp/session', { method: 'POST', body: JSON.stringify({ initData }) }),
        apiFetch('/api/miniapp/trips'),
        apiFetch('/api/miniapp/bookings'),
        apiFetch('/api/miniapp/gnpl'),
      ]);

      const sessionJson = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || !sessionJson?.ok) {
        throw new Error(sessionJson?.error || t('error_session_failed'));
      }
      const sessionUser = sessionJson.user as MiniAppUser;
      const sessionSettings = (sessionJson.appSettings || {}) as MiniAppSettings;
      setUser(sessionUser);
      setCustomerName(
        [String(sessionUser?.firstName || ''), String(sessionUser?.lastName || '')].filter(Boolean).join(' ').trim()
      );
      setPhoneNumber(String(sessionUser?.phoneNumber || ''));
      setUiLang(sessionUser?.languageCode === 'en' ? 'en' : 'am');
      setMiniAppSettings({
        telegramChannelUrl: String(sessionSettings?.telegramChannelUrl || '').trim(),
        telegramChannelName: String(sessionSettings?.telegramChannelName || '').trim(),
        gnplEnabled: Boolean(sessionSettings?.gnplEnabled),
        gnplRequireAdminApproval: sessionSettings?.gnplRequireAdminApproval !== false,
        gnplDefaultTermDays: Number(sessionSettings?.gnplDefaultTermDays || 14),
        gnplPenaltyEnabled: sessionSettings?.gnplPenaltyEnabled !== false,
        gnplPenaltyPercent: Number(sessionSettings?.gnplPenaltyPercent || 0),
        gnplPenaltyPeriodDays: Number(sessionSettings?.gnplPenaltyPeriodDays || 7),
      });

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

      const gnplJson = await gnplRes.json().catch(() => ({}));
      if (gnplRes.ok && gnplJson?.ok) {
        setGnplAccounts((gnplJson.accounts || []) as GnplAccount[]);
      } else {
        setGnplAccounts([]);
      }
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
      const paymentMethod = selectedMethod(trip);
      const quantity = selectedQuantity(tripId);
      const discountCode = selectedDiscountCode(tripId);
      const normalizedName = String(customerName || '').trim().replace(/\s+/g, ' ');
      const normalizedPhone = normalizePhoneInput(phoneNumber).trim();
      const gnplEnabledForTrip = Boolean(miniAppSettings?.gnplEnabled && trip.allow_gnpl);
      const telegramId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0) || undefined;
      setBusyTripId(tripId);
      setError('');
      setNotice('');
      try {
        if (!normalizedName) {
          setError(t('error_customer_name_required'));
          return;
        }
        if (!/^\+?[0-9]{7,20}$/.test(normalizedPhone)) {
          setError(t('error_phone_required'));
          return;
        }
        if (paymentMethod === 'gnpl' && !gnplEnabledForTrip) {
          setError(t('error_gnpl_not_available'));
          return;
        }
        if (paymentMethod === 'gnpl' && !gnplIdCardDataUrl) {
          setError(t('error_gnpl_id_scan_required'));
          return;
        }

        if (paymentMethod === 'telebirr_auto') {
          setNotice(t('notice_telebirr_auto_coming_soon'));
          return;
        }

        const endpoint = '/api/miniapp/book';
        const response = await apiFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({
            initData,
            telegramId,
            tripId,
            paymentMethod,
            quantity,
            customerName: normalizedName,
            customerPhone: normalizedPhone,
            gnplIdCardDataUrl: paymentMethod === 'gnpl' ? gnplIdCardDataUrl : undefined,
            gnplIdCardFileName: paymentMethod === 'gnpl' ? gnplIdCardFileName : undefined,
            discountCode: discountCode || undefined,
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

        if (paymentMethod === 'gnpl') {
          const baseNotice = String(json.message || t('notice_gnpl_started'));
          setNotice(baseNotice);
          await loadData();
          return;
        }

        const manualConfig = json?.manualConfig;
        if (manualConfig && (paymentMethod === 'bank' || paymentMethod === 'telebirr')) {
          const bookingGroupUrl = String(
            json?.tripGroupUrl || json?.trip?.telegramGroupUrl || trip.telegram_group_url || ''
          ).trim();
          const pricing = json?.pricing || {};
          const pricePerTicket = Number(pricing.unitPrice ?? trip.price_per_ticket ?? 0);
          const baseAmount = Number(pricing.baseAmount ?? pricePerTicket * quantity);
          const discountPercent = Number(pricing.discountPercent ?? 0);
          const discountAmount = Number(pricing.discountAmount ?? 0);
          const finalAmount = Number(pricing.finalAmount ?? baseAmount);
          const appliedDiscountCode = String(pricing.discountCode || discountCode || '').trim().toUpperCase();
          setManualFlow({
            tripId,
            tripName: trip.name || t('trip_fallback'),
            paymentMethod,
            quantity,
            pricePerTicket,
            baseAmount: Number(baseAmount.toFixed(2)),
            discountCode: appliedDiscountCode,
            discountPercent: Number(discountPercent.toFixed(2)),
            discountAmount: Number(discountAmount.toFixed(2)),
            finalAmount: Number(finalAmount.toFixed(2)),
            bankAccounts: Array.isArray(manualConfig.bankAccounts) ? manualConfig.bankAccounts : [],
            selectedBankIndex: 0,
            telebirrManualAccountName: String(manualConfig.telebirrManualAccountName || ''),
            telebirrManualAccountNumber: String(manualConfig.telebirrManualAccountNumber || ''),
            manualPaymentNote: String(manualConfig.manualPaymentNote || ''),
            amountPaid: Number(finalAmount.toFixed(2)).toFixed(2),
            referenceNumber: '',
            receiptLink: '',
            receiptDate: '',
            receiptFileName: '',
            receiptDataUrl: '',
          });
          const baseNotice = String(json.message || t('notice_manual_started'));
          setNotice(bookingGroupUrl ? `${baseNotice}\n${t('join_trip_group')}: ${bookingGroupUrl}` : baseNotice);
        } else {
          const bookingGroupUrl = String(
            json?.tripGroupUrl || json?.trip?.telegramGroupUrl || trip.telegram_group_url || ''
          ).trim();
          const baseNotice = String(json.message || t('notice_booking_started'));
          setNotice(bookingGroupUrl ? `${baseNotice}\n${t('join_trip_group')}: ${bookingGroupUrl}` : baseNotice);
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : t('error_booking_failed');
        setError(message);
      } finally {
        setBusyTripId('');
      }
    },
    [
      apiFetch,
      customerName,
      gnplIdCardDataUrl,
      gnplIdCardFileName,
      initData,
      loadData,
      miniAppSettings,
      phoneNumber,
      selectedDiscountCode,
      selectedMethod,
      selectedQuantity,
      t,
    ]
  );

  const updateManualQuantity = useCallback((quantity: number) => {
    setManualFlow((prev) => {
      if (!prev) return prev;
      const nextQty = Math.max(1, Number(quantity || 1));
      const baseAmount = Number((prev.pricePerTicket * nextQty).toFixed(2));
      const discountAmount = Number(((baseAmount * Number(prev.discountPercent || 0)) / 100).toFixed(2));
      const finalAmount = Number((baseAmount - discountAmount).toFixed(2));
      return {
        ...prev,
        quantity: nextQty,
        baseAmount,
        discountAmount,
        finalAmount,
        amountPaid: finalAmount.toFixed(2),
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

  const onGnplIdCardFile = useCallback(async (file?: File | null) => {
    if (!file) {
      setGnplIdCardFileName('');
      setGnplIdCardDataUrl('');
      return;
    }

    const validationError = validateGnplIdCardFile(file);
    if (validationError) {
      setError(t(validationError));
      setGnplIdCardFileName('');
      setGnplIdCardDataUrl('');
      return;
    }

    const dataUrl = await readFileAsDataURL(file);
    setGnplIdCardFileName(file.name || `id_card_${Date.now()}`);
    setGnplIdCardDataUrl(dataUrl);
  }, [t]);

  const submitManualPayment = useCallback(async () => {
    if (!manualFlow) return;

    setError('');
    setNotice('');

    const hasReferenceOrLink = Boolean(manualFlow.referenceNumber.trim() || manualFlow.receiptLink.trim());
    if (!hasReferenceOrLink) {
      setError(t('error_payment_reference_required'));
      return;
    }
    if (!manualFlow.receiptDataUrl && !manualFlow.receiptLink.trim()) {
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
          discountCode: manualFlow.discountCode || undefined,
          referenceNumber: manualFlow.referenceNumber.trim(),
          receiptLink: manualFlow.receiptLink.trim() || undefined,
          receiptDate: manualFlow.receiptDate || undefined,
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

  const submitGnplPayment = useCallback(
    async (account: GnplAccount) => {
      const form = gnplPaymentForms[account.id] || { amount: '', reference: '', receiptLink: '' };
      const amount = Number(form.amount || 0);
      const reference = String(form.reference || '').trim();
      const receiptLink = String(form.receiptLink || '').trim();

      setError('');
      setNotice('');
      if (!account?.id) return;
      if (!reference) {
        setError(t('error_payment_reference_required'));
        return;
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        setError(t('error_paid_amount_required'));
        return;
      }

      setGnplPayingAccountId(account.id);
      try {
        const response = await apiFetch('/api/miniapp/gnpl', {
          method: 'POST',
          body: JSON.stringify({
            accountId: account.id,
            amount,
            paymentReference: reference,
            receiptLink: receiptLink || undefined,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || t('error_submit_manual_failed'));
        }

        setNotice(String(json?.message || t('notice_gnpl_payment_submitted')));
        setGnplPaymentForms((prev) => ({
          ...prev,
          [account.id]: { amount: '', reference: '', receiptLink: '' },
        }));
        await loadData();
      } catch (e) {
        const message = e instanceof Error ? e.message : t('error_submit_manual_failed');
        setError(message);
      } finally {
        setGnplPayingAccountId('');
      }
    },
    [apiFetch, gnplPaymentForms, loadData, t]
  );

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
    return Number((manualFlow.finalAmount || 0).toFixed(2));
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

  const savePhone = useCallback(async () => {
    const normalized = normalizePhoneInput(phoneNumber).trim();
    if (!/^\+?[0-9]{7,20}$/.test(normalized)) {
      setError(t('error_phone_required'));
      return;
    }

    setPhoneSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/miniapp/profile/phone', {
        method: 'POST',
        body: JSON.stringify({ initData, phoneNumber: normalized }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || t('error_save_phone_failed'));
      }

      setPhoneNumber(String(json.phoneNumber || normalized));
      setUser((prev) => (prev ? { ...prev, phoneNumber: String(json.phoneNumber || normalized) } : prev));
      setNotice(t('notice_phone_saved'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('error_save_phone_failed');
      setError(message);
    } finally {
      setPhoneSaving(false);
    }
  }, [apiFetch, initData, phoneNumber, t]);

  const copyText = useCallback(async (value: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`${t('copied')}: ${text}`);
      setError('');
    } catch {
      setError('Clipboard copy failed');
    }
  }, [t]);

  const shareBookingTicket = useCallback(
    async (booking: Booking) => {
      const ticketUrl = String(booking.cardUrl || '').trim();
      if (!ticketUrl) {
        setError(t('open_digital_ticket'));
        return;
      }

      const text = `${booking.tripName} | ${booking.ticketNumber || booking.serialNumber}\n${ticketUrl}`;
      try {
        if (typeof navigator !== 'undefined' && (navigator as any).share) {
          await (navigator as any).share({
            title: booking.tripName || 'Ticket',
            text,
            url: ticketUrl,
          });
          return;
        }
      } catch {}

      try {
        await navigator.clipboard.writeText(text);
        setNotice(`${t('copied')}: ${ticketUrl}`);
      } catch {
        setError('Unable to share ticket');
      }
    },
    [t]
  );

  const transferBookingTicket = useCallback(
    async (booking: Booking) => {
      const payload = transferInputs[booking.id] || { phone: '', name: '' };
      const toPhone = normalizePhoneInput(payload.phone).trim();
      const toName = String(payload.name || '').trim();

      if (!toPhone || !/^\+?[0-9]{7,20}$/.test(toPhone)) {
        setError(t('error_phone_required'));
        return;
      }

      setTransferBusyTicketId(booking.id);
      setError('');
      setNotice('');
      try {
        const response = await apiFetch('/api/miniapp/tickets/transfer', {
          method: 'POST',
          body: JSON.stringify({
            initData,
            ticketId: booking.id,
            toPhone,
            toName: toName || undefined,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to transfer ticket');
        }

        setNotice(
          `Ticket transferred to ${toPhone}\n${t('reference')}: ${String(
            json?.newReferenceNumber || booking.referenceNumber || '-'
          )}`
        );
        setTransferInputs((prev) => {
          const next = { ...prev };
          delete next[booking.id];
          return next;
        });
        await loadData();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to transfer ticket');
      } finally {
        setTransferBusyTicketId('');
      }
    },
    [apiFetch, initData, loadData, t, transferInputs]
  );

  const visibleBookings = bookings.filter((booking) =>
    showExpiredBookings ? true : !isExpiredByDeparture(booking.departureDate)
  );

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937,#020617)] text-slate-100 px-4 py-5"
      style={uiLang === 'am' ? { fontFamily: AMHARIC_FONT_STACK } : undefined}
    >
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />

      <section className="max-w-3xl mx-auto space-y-4">
        <header className="rounded-2xl border border-cyan-700/40 bg-slate-900/70 p-4 shadow-xl">
          <p className="text-xs tracking-[0.18em] uppercase text-cyan-300">🎫 {t('app_title')}</p>
          <h1 className="text-2xl font-semibold mt-1">✈️ {t('page_title')}</h1>
          <div className="mt-4 flex gap-2">
            <a
              href="/miniapp/charity"
              className="flex-1 rounded-lg bg-gradient-to-r from-red-600 to-red-700 px-4 py-2 text-center text-sm font-medium hover:from-red-700 hover:to-red-800 transition-all"
            >
              ❤️ {t('make_a_donation')}
            </a>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-300">👤 {username || t('telegram_customer')}</p>
            <div className="flex flex-col gap-2 sm:items-end">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <span>🌐 {t('language')}</span>
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

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-slate-300 whitespace-nowrap">📝 {t('customer_name')}</span>
                <input
                  type="text"
                  value={customerName}
                  onChange={(e) => setCustomerName(String(e.target.value || '').replace(/\s+/g, ' ').trimStart())}
                  placeholder={t('customer_name_placeholder')}
                  className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100 w-full sm:w-52"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-slate-300 whitespace-nowrap">☎️ {t('phone_number')}</span>
                <input
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(normalizePhoneInput(e.target.value))}
                  placeholder={t('phone_placeholder')}
                  className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100 w-full sm:w-48"
                />
                <button
                  type="button"
                  onClick={savePhone}
                  disabled={phoneSaving}
                  className="rounded-md border border-cyan-700/50 bg-cyan-900/30 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-900/40 disabled:opacity-60"
                >
                  {phoneSaving ? t('saving_phone') : t('save_phone')}
                </button>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-slate-300 whitespace-nowrap">{t('id_card_scan')}</span>
                <input
                  type="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  onChange={async (e) => {
                    try {
                      await onGnplIdCardFile(e.target.files?.[0] || null);
                    } catch {
                      setError(t('error_read_receipt_failed'));
                    }
                  }}
                  className="rounded-md border border-slate-700 bg-slate-950/70 px-2 py-1 text-xs text-slate-100 w-full sm:w-64"
                />
              </div>
              {gnplIdCardFileName ? (
                <p className="text-[11px] text-cyan-300 w-full text-left sm:text-right">
                  {t('id_card_selected')}: {gnplIdCardFileName}
                </p>
              ) : null}
              {miniAppSettings?.gnplEnabled ? (
                <p className="text-[11px] text-amber-300 w-full text-left sm:text-right">
                  {t('gnpl_hint')}
                </p>
              ) : null}
            </div>
          </div>
          {miniAppSettings?.telegramChannelUrl ? (
            <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-300">
                {miniAppSettings.telegramChannelName || t('community_channel')}
              </p>
              <a
                href={miniAppSettings.telegramChannelUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-cyan-700/50 bg-cyan-900/30 px-3 py-1 text-xs text-cyan-100 hover:bg-cyan-900/40"
              >
                {t('join_channel')}
              </a>
            </div>
          ) : null}
          <div className="mt-2">
            <a
              href="/miniapp/charity"
              className="inline-flex items-center rounded-md border border-rose-700/50 bg-rose-900/30 px-3 py-1 text-xs text-rose-100 hover:bg-rose-900/40"
            >
              {t('make_a_donation')}
            </a>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-300 bg-red-100 p-3 text-sm text-red-900 font-medium">
            ❌ {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-100 p-3 text-sm text-emerald-900 font-medium whitespace-pre-line">
            ✅ {notice}
          </div>
        ) : null}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">🚌 {t('available_trips')}</h2>
          <button
            type="button"
            onClick={loadData}
            className="rounded-lg border border-cyan-700/40 px-3 py-1 text-sm hover:bg-cyan-900/30"
          >
            🔄 {t('refresh')}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          {t('initial_step_required')}
        </p>

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
              const method = selectedMethod(trip);
              const quantity = selectedQuantity(trip.id);
              const isBusy = busyTripId === trip.id;
              return (
                <article key={trip.id} className="rounded-2xl border border-slate-700/70 bg-slate-900/65 overflow-hidden">
                  {image ? <img src={image} alt={trip.name || t('trip_fallback')} className="h-36 w-full object-cover" /> : null}
                  <div className="p-4 space-y-2">
                    <h3 className="text-lg font-semibold">🎯 {trip.name || t('trip_fallback')}</h3>
                    <p className="text-sm text-slate-300">
                      📍 {trip.destination || t('na')} | 📅 {formatDate(trip.departure_date, uiLang, t('na'))}
                    </p>
                    {trip.arrival_date ? (
                      <p className="text-xs text-slate-400">
                        🏁 Arrival: {formatDate(trip.arrival_date, uiLang, t('na'))}
                      </p>
                    ) : null}
                    <p className="text-sm text-slate-200">
                      💰 ETB {Number(trip.price_per_ticket || 0).toFixed(2)} | 💺 {t('seats')} {trip.available_seats ?? 0}/
                      {trip.total_seats ?? 0}
                    </p>
                    {trip.description ? (
                      <p className="text-xs text-slate-300 leading-relaxed">{trip.description}</p>
                    ) : null}
                    {trip.telegram_group_url ? (
                      <div>
                        <a
                          href={String(trip.telegram_group_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-cyan-300 underline"
                        >
                          {t('join_trip_group')}
                        </a>
                      </div>
                    ) : null}

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-300 whitespace-nowrap">🎫{t('number_of_tickets')}</label>
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
                      </div>
                      <input
                        type="text"
                        value={selectedDiscountCode(trip.id)}
                        onChange={(e) =>
                          setDiscountCodeByTrip((prev) => ({
                            ...prev,
                            [trip.id]: String(e.target.value || '').toUpperCase(),
                          }))
                        }
                        className="rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                        placeholder={t('discount_code_optional')}
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
                        {miniAppSettings?.gnplEnabled && trip.allow_gnpl ? (
                          <option value="gnpl">{t('gnpl_method')}</option>
                        ) : null}
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
              💳 {t('manual_payment')} - {manualFlow.tripName}
            </h2>
            <p className="text-sm text-slate-300">📋 {t('manual_step_desc')}</p>

            {manualFlow.paymentMethod === 'bank' ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-2">
                <p className="text-sm font-medium">🏦 {t('bank_transfer_details')}</p>
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
                    <p className="flex items-center justify-between gap-2">
                      <span>{t('account_name')}: {selectedBank.account_name}</span>
                      <button
                        type="button"
                        onClick={() => copyText(selectedBank.account_name)}
                        className="text-xs text-cyan-300 underline"
                      >
                        {t('copy')}
                      </button>
                    </p>
                    <p className="flex items-center justify-between gap-2">
                      <span>{t('account_number')}: {selectedBank.account_number}</span>
                      <button
                        type="button"
                        onClick={() => copyText(selectedBank.account_number)}
                        className="text-xs text-cyan-300 underline"
                      >
                        {t('copy')}
                      </button>
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-amber-300">
                    {t('bank_not_configured')}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 text-sm text-slate-200 space-y-1">
                <p className="font-medium">📱 {t('telebirr_manual_details')}</p>
                <p className="flex items-center justify-between gap-2">
                  <span>{t('account_name')}: {manualFlow.telebirrManualAccountName || t('not_configured')}</span>
                  {manualFlow.telebirrManualAccountName ? (
                    <button
                      type="button"
                      onClick={() => copyText(manualFlow.telebirrManualAccountName)}
                      className="text-xs text-cyan-300 underline"
                    >
                      {t('copy')}
                    </button>
                  ) : null}
                </p>
                <p className="flex items-center justify-between gap-2">
                  <span>{t('account_number')}: {manualFlow.telebirrManualAccountNumber || t('not_configured')}</span>
                  {manualFlow.telebirrManualAccountNumber ? (
                    <button
                      type="button"
                      onClick={() => copyText(manualFlow.telebirrManualAccountNumber)}
                      className="text-xs text-cyan-300 underline"
                    >
                      {t('copy')}
                    </button>
                  ) : null}
                </p>
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
                <span className="text-slate-300">Receipt Link (optional)</span>
                <input
                  type="url"
                  value={manualFlow.receiptLink}
                  onChange={(e) =>
                    setManualFlow((prev) => (prev ? { ...prev, receiptLink: e.target.value } : prev))
                  }
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                  placeholder="https://.../receipt?ref=TX123&date=2026-02-25"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">Receipt Date (optional)</span>
                <input
                  type="date"
                  value={manualFlow.receiptDate}
                  onChange={(e) =>
                    setManualFlow((prev) => (prev ? { ...prev, receiptDate: e.target.value } : prev))
                  }
                  className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
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

            <div className="text-xs text-slate-300 space-y-1">
              <p>
                💵 {t('base_total')}: ETB {Number(manualFlow.baseAmount || 0).toFixed(2)}
              </p>
              {manualFlow.discountPercent > 0 ? (
                <p>
                  🎁 {t('discount')} ({manualFlow.discountCode || '-'}, {manualFlow.discountPercent}%): -ETB{' '}
                  {Number(manualFlow.discountAmount || 0).toFixed(2)}
                </p>
              ) : null}
              <p>
                💰 {t('expected_total')}: ETB {manualExpectedAmount.toFixed(2)} {t('for')} {manualFlow.quantity}{' '}
                {t('tickets')}
              </p>
            </div>

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

        {gnplAccounts.length > 0 ? (
          <section className="rounded-2xl border border-amber-600/40 bg-slate-900/70 p-4 space-y-3">
            <h2 className="text-lg font-semibold">GNPL Accounts</h2>
            <div className="grid gap-3">
              {gnplAccounts.map((account) => {
                const form = gnplPaymentForms[account.id] || { amount: '', reference: '', receiptLink: '' };
                const isPaying = gnplPayingAccountId === account.id;
                return (
                  <div key={account.id} className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        {account.tripName} ({account.destination})
                      </p>
                      <span className="text-xs rounded px-2 py-1 bg-slate-800 border border-slate-700 uppercase">
                        {account.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">
                      Due: {account.dueDate || '-'} | Outstanding: ETB {Number(account.totalDue || 0).toFixed(2)} |
                      Penalty: ETB {Number(account.penaltyOutstanding || 0).toFixed(2)}
                    </p>
                    {account.canPay ? (
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={form.amount}
                          onChange={(e) =>
                            setGnplPaymentForms((prev) => ({
                              ...prev,
                              [account.id]: { ...form, amount: e.target.value },
                            }))
                          }
                          placeholder="Amount (ETB)"
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                        <input
                          type="text"
                          value={form.reference}
                          onChange={(e) =>
                            setGnplPaymentForms((prev) => ({
                              ...prev,
                              [account.id]: { ...form, reference: e.target.value },
                            }))
                          }
                          placeholder="Payment reference"
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                        <input
                          type="url"
                          value={form.receiptLink}
                          onChange={(e) =>
                            setGnplPaymentForms((prev) => ({
                              ...prev,
                              [account.id]: { ...form, receiptLink: e.target.value },
                            }))
                          }
                          placeholder="Receipt link (optional)"
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => submitGnplPayment(account)}
                          disabled={isPaying}
                          className="rounded-md bg-amber-500 text-slate-950 px-3 py-2 text-xs font-semibold disabled:opacity-60 sm:col-span-3"
                        >
                          {isPaying ? 'Submitting payment...' : 'Submit GNPL Payment'}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        Payments are enabled only after admin approval.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-medium">📋 {t('my_bookings')}</h2>
            <button
              type="button"
              onClick={() => setShowExpiredBookings((prev) => !prev)}
              className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
            >
              {showExpiredBookings ? `👁️ ${t('hide_expired_tickets')}` : `🔍 ${t('show_expired_tickets')}`}
            </button>
          </div>
          <div className="grid gap-2">
            {visibleBookings.length === 0 ? (
              <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-4 text-sm">
                {t('no_bookings')}
              </div>
            ) : null}

            {visibleBookings.map((booking) => {
              const transferInput = transferInputs[booking.id] || { phone: '', name: '' };
              const normalizedStatus = String(booking.status || '').toLowerCase();
              const canTransfer =
                normalizedStatus === 'confirmed' && !isExpiredByDeparture(booking.departureDate);

              return (
                <div key={booking.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                  <p className="font-medium">Trip: {booking.tripName}</p>
                  <p className="text-sm text-slate-300">
                    Destination: {booking.destination} | Ticket: {booking.serialNumber}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t('status')}: {booking.status} | {t('ref_short')}: {booking.referenceNumber || t('na')}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {booking.cardUrl ? (
                      <a className="text-xs text-cyan-300 underline" href={booking.cardUrl} target="_blank" rel="noreferrer">
                        {t('open_digital_ticket')}
                      </a>
                    ) : null}
                    {booking.cardUrl ? (
                      <button
                        type="button"
                        onClick={() => shareBookingTicket(booking)}
                        className="text-xs text-emerald-300 underline"
                      >
                        Share Ticket
                      </button>
                    ) : null}
                  </div>

                  {canTransfer ? (
                    <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-2 space-y-2">
                      <p className="text-xs text-slate-300">Transfer this ticket to another phone</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={transferInput.phone}
                          onChange={(e) =>
                            setTransferInputs((prev) => ({
                              ...prev,
                              [booking.id]: {
                                ...transferInput,
                                phone: e.target.value,
                              },
                            }))
                          }
                          placeholder="Recipient phone"
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                        <input
                          type="text"
                          value={transferInput.name}
                          onChange={(e) =>
                            setTransferInputs((prev) => ({
                              ...prev,
                              [booking.id]: {
                                ...transferInput,
                                name: e.target.value,
                              },
                            }))
                          }
                          placeholder="Recipient name (optional)"
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => transferBookingTicket(booking)}
                        disabled={transferBusyTicketId === booking.id}
                        className="rounded-md bg-amber-500 text-slate-950 px-3 py-1 text-xs font-semibold disabled:opacity-60"
                      >
                        {transferBusyTicketId === booking.id ? 'Transferring...' : 'Transfer Ticket'}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
