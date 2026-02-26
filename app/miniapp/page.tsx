'use client';

import Script from 'next/script';
import { useCallback, useEffect, useMemo, useState } from 'react';
import miniAppI18n from '@/lib/i18n/miniapp.json';
import {
  ethiopianToGregorianYmd,
  formatLocalizedDateTime,
  gregorianToEthiopianYmd,
} from '@/lib/date-localization';

type MiniAppUser = {
  id: number;
  firstName: string;
  lastName: string;
  username: string;
  phoneNumber?: string;
  languageCode: 'en' | 'am';
};

type MiniAppSettings = {
  appName?: string;
  appColor?: string;
  logoUrl?: string;
  logoFilename?: string;
  maintenanceMode?: boolean;
  maintenanceMessage?: string;
  charityEnabled?: boolean;
  discountEnabled?: boolean;
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
  allow_discount?: boolean | null;
  discount_enabled?: boolean | null;
  enable_discount?: boolean | null;
  has_discount?: boolean | null;
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
  canRate?: boolean;
  rating?: {
    rating: number;
    comment: string | null;
    updatedAt: string | null;
  } | null;
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
const MINIAPP_TRIP_DESCRIPTION_PREVIEW_LIMIT = 250;
const ALLOWED_TRIP_DESCRIPTION_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'p',
  'br',
  'strong',
  'em',
  'u',
  'ul',
  'ol',
  'li',
  'a',
]);
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

function normalizePhoneInput(value: string) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function normalizeDiscountCodeInput(value: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function stripHtmlToText(value: string) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTripDescriptionHtml(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (typeof window === 'undefined') {
    return stripHtmlToText(raw);
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement | null;
    if (!root) return stripHtmlToText(raw);

    const sanitizeNode = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.parentNode?.removeChild(node);
        return;
      }

      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();

      if (!ALLOWED_TRIP_DESCRIPTION_TAGS.has(tagName)) {
        const parent = element.parentNode;
        if (!parent) {
          element.replaceWith(doc.createTextNode(element.textContent || ''));
          return;
        }
        while (element.firstChild) {
          parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
        return;
      }

      for (const attr of Array.from(element.attributes)) {
        const attrName = attr.name.toLowerCase();
        if (tagName === 'a' && attrName === 'href') continue;
        element.removeAttribute(attr.name);
      }

      if (tagName === 'a') {
        const href = String(element.getAttribute('href') || '').trim();
        if (!/^https?:\/\//i.test(href)) {
          element.removeAttribute('href');
        } else {
          element.setAttribute('target', '_blank');
          element.setAttribute('rel', 'noopener noreferrer');
        }
      }

      for (const child of Array.from(element.childNodes)) {
        sanitizeNode(child);
      }
    };

    for (const child of Array.from(root.childNodes)) {
      sanitizeNode(child);
    }

    return String(root.innerHTML || '').trim();
  } catch {
    return stripHtmlToText(raw);
  }
}

function splitNameParts(fullName: string) {
  const normalized = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized) return { firstName: '', lastName: '' };
  const parts = normalized.split(' ');
  const firstName = parts.shift() || '';
  return { firstName, lastName: parts.join(' ') };
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

function normalizeHexColor(value: string) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#06b6d4';
}

function hexToRgb(hexColor: string) {
  const color = normalizeHexColor(hexColor).slice(1);
  return {
    r: Number.parseInt(color.slice(0, 2), 16),
    g: Number.parseInt(color.slice(2, 4), 16),
    b: Number.parseInt(color.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(baseHex: string, targetHex: string, ratio: number) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);
  const weight = Math.min(1, Math.max(0, ratio));
  return rgbToHex(
    base.r + (target.r - base.r) * weight,
    base.g + (target.g - base.g) * weight,
    base.b + (target.b - base.b) * weight
  );
}

function getContrastTextColor(hexColor: string) {
  const { r, g, b } = hexToRgb(hexColor);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

function isTripGnplEnabled(trip: Trip, settings: MiniAppSettings | null) {
  return Boolean(settings?.gnplEnabled && trip.allow_gnpl);
}

function isTripDiscountEnabled(trip: Trip, settings: MiniAppSettings | null) {
  if (settings?.discountEnabled === false) return false;
  const flags = [trip.allow_discount, trip.discount_enabled, trip.enable_discount, trip.has_discount];
  const hasExplicitTrue = flags.some((value) => value === true);
  const hasExplicitFalse = flags.some((value) => value === false);
  if (hasExplicitTrue) return true;
  if (hasExplicitFalse) return false;
  return true;
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
  const [profileSaving, setProfileSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [maintenanceMessage, setMaintenanceMessage] = useState('');
  const [showExpiredBookings, setShowExpiredBookings] = useState(false);
  const [basicInfoCollapsed, setBasicInfoCollapsed] = useState(false);
  const [tripsSectionCollapsed, setTripsSectionCollapsed] = useState(false);
  const [bookingsSectionCollapsed, setBookingsSectionCollapsed] = useState(false);
  const [methodByTrip, setMethodByTrip] = useState<Record<string, PaymentMethod>>({});
  const [quantityByTrip, setQuantityByTrip] = useState<Record<string, number>>({});
  const [expandedTripDescriptions, setExpandedTripDescriptions] = useState<Record<string, boolean>>({});
  const [expandedBookingIds, setExpandedBookingIds] = useState<Record<string, boolean>>({});
  const [discountCodeByTrip, setDiscountCodeByTrip] = useState<Record<string, string>>({});
  const [pendingInviteCode, setPendingInviteCode] = useState('');
  const [pendingInviteTripId, setPendingInviteTripId] = useState('');
  const [manualFlow, setManualFlow] = useState<ManualFlow | null>(null);
  const [manualReceiptDateEthInput, setManualReceiptDateEthInput] = useState('');
  const [manualSummaryOpen, setManualSummaryOpen] = useState(false);
  const [miniAppSettings, setMiniAppSettings] = useState<MiniAppSettings | null>(null);
  const [transferInputs, setTransferInputs] = useState<Record<string, { phone: string; name: string }>>({});
  const [transferBusyTicketId, setTransferBusyTicketId] = useState('');
  const [ratingForms, setRatingForms] = useState<Record<string, { rating: number; comment: string }>>({});
  const [ratingBusyBookingId, setRatingBusyBookingId] = useState('');
  const [gnplPaymentForms, setGnplPaymentForms] = useState<Record<string, { amount: string; reference: string; receiptLink: string }>>({});
  const [gnplPayingAccountId, setGnplPayingAccountId] = useState('');
  const developerContactUrl = 'https://t.me/tedtad';

  const t = useCallback(
    (key: string) => I18N[uiLang]?.[key] || I18N.en[key] || key,
    [uiLang]
  );
  const displayAppName = useMemo(
    () => String(miniAppSettings?.appName || '').trim() || t('app_title'),
    [miniAppSettings?.appName, t]
  );
  const brandColor = useMemo(() => normalizeHexColor(String(miniAppSettings?.appColor || '')), [miniAppSettings?.appColor]);
  const brandColorStrong = useMemo(() => mixHex(brandColor, '#0b1220', 0.2), [brandColor]);
  const brandColorSoft = useMemo(() => mixHex(brandColor, '#ffffff', 0.7), [brandColor]);
  const brandColorMuted = useMemo(() => mixHex(brandColor, '#0f172a', 0.65), [brandColor]);
  const brandTextColor = useMemo(() => getContrastTextColor(brandColor), [brandColor]);
  const logoImageUrl = useMemo(() => String(miniAppSettings?.logoUrl || '').trim(), [miniAppSettings?.logoUrl]);
  const logoLabel = useMemo(
    () => String(miniAppSettings?.logoFilename || '').trim() || '',
    [miniAppSettings?.logoFilename]
  );
  const appInitial = useMemo(() => {
    const text = displayAppName.replace(/\s+/g, '').trim();
    return text ? text[0]!.toUpperCase() : 'T';
  }, [displayAppName]);
  const charityHref = useMemo(() => {
    if (!initData) return '/miniapp/charity';
    return `/miniapp/charity?initData=${encodeURIComponent(initData)}`;
  }, [initData]);
  const charityEnabled = miniAppSettings?.charityEnabled !== false;
  const tripsCount = trips.length;
  const bookingsCount = bookings.length;
  const activeBookingsCount = useMemo(
    () => bookings.filter((booking) => !isExpiredByDeparture(booking.departureDate)).length,
    [bookings]
  );
  const mainStyle = useMemo(
    () =>
      ({
        ...(uiLang === 'am' ? { fontFamily: AMHARIC_FONT_STACK } : {}),
        '--brand-color': brandColor,
        '--brand-color-strong': brandColorStrong,
        '--brand-color-soft': brandColorSoft,
        '--brand-color-muted': brandColorMuted,
        '--brand-color-text': brandTextColor,
      }) as React.CSSProperties,
    [brandColor, brandColorMuted, brandColorSoft, brandColorStrong, brandTextColor, uiLang]
  );
  const openDeveloperContact = useCallback(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(developerContactUrl);
      return;
    }
    if (tg?.openLink) {
      tg.openLink(developerContactUrl);
      return;
    }
    window.open(developerContactUrl, '_blank', 'noopener,noreferrer');
  }, [developerContactUrl]);
  const hasFieldError = useCallback((key: string) => Boolean(fieldErrors[key]), [fieldErrors]);

  const clearFieldError = useCallback((key: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      return { ...prev, [key]: false };
    });
  }, []);

  const setValidationError = useCallback((message: string, keys: string[] = []) => {
    setNotice('');
    setError(message);
    if (!keys.length) return;
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of keys) next[key] = true;
      return next;
    });
  }, []);

  const selectedMethod = useCallback(
    (trip: Trip) => {
      const current = methodByTrip[trip.id] || 'telebirr';
      const gnplEnabledForTrip = isTripGnplEnabled(trip, miniAppSettings);
      if (current === 'gnpl' && !gnplEnabledForTrip) return 'telebirr';
      return current;
    },
    [methodByTrip, miniAppSettings]
  );

  useEffect(() => {
    if (!manualFlow?.receiptDate) {
      setManualReceiptDateEthInput('');
      return;
    }
    setManualReceiptDateEthInput(gregorianToEthiopianYmd(manualFlow.receiptDate));
  }, [manualFlow?.receiptDate]);

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
    setMaintenanceMessage('');
    try {
      const sessionRes = await apiFetch('/api/miniapp/session', {
        method: 'POST',
        body: JSON.stringify({ initData }),
      });

      const sessionJson = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || !sessionJson?.ok) {
        if (String(sessionJson?.error || '') === 'MINIAPP_MAINTENANCE') {
          const sessionSettings = (sessionJson?.appSettings || {}) as MiniAppSettings;
          setMiniAppSettings({
            appName: String(sessionSettings?.appName || '').trim(),
            appColor: normalizeHexColor(String(sessionSettings?.appColor || '')),
            logoUrl: String(sessionSettings?.logoUrl || '').trim(),
            logoFilename: String(sessionSettings?.logoFilename || '').trim(),
            maintenanceMode: true,
            maintenanceMessage: String(sessionJson?.message || sessionSettings?.maintenanceMessage || '').trim(),
            charityEnabled: sessionSettings?.charityEnabled !== false,
            discountEnabled: sessionSettings?.discountEnabled !== false,
            telegramChannelUrl: String(sessionSettings?.telegramChannelUrl || '').trim(),
            telegramChannelName: String(sessionSettings?.telegramChannelName || '').trim(),
            gnplEnabled: Boolean(sessionSettings?.gnplEnabled),
            gnplRequireAdminApproval: sessionSettings?.gnplRequireAdminApproval !== false,
            gnplDefaultTermDays: Number(sessionSettings?.gnplDefaultTermDays || 14),
            gnplPenaltyEnabled: sessionSettings?.gnplPenaltyEnabled !== false,
            gnplPenaltyPercent: Number(sessionSettings?.gnplPenaltyPercent || 0),
            gnplPenaltyPeriodDays: Number(sessionSettings?.gnplPenaltyPeriodDays || 7),
          });
          setTrips([]);
          setBookings([]);
          setGnplAccounts([]);
          setMaintenanceMessage(
            String(sessionJson?.message || sessionSettings?.maintenanceMessage || 'Mini App is under maintenance.')
          );
          return;
        }
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
        appName: String(sessionSettings?.appName || '').trim(),
        appColor: normalizeHexColor(String(sessionSettings?.appColor || '')),
        logoUrl: String(sessionSettings?.logoUrl || '').trim(),
        logoFilename: String(sessionSettings?.logoFilename || '').trim(),
        maintenanceMode: Boolean(sessionSettings?.maintenanceMode),
        maintenanceMessage: String(sessionSettings?.maintenanceMessage || '').trim(),
        charityEnabled: sessionSettings?.charityEnabled !== false,
        discountEnabled: sessionSettings?.discountEnabled !== false,
        telegramChannelUrl: String(sessionSettings?.telegramChannelUrl || '').trim(),
        telegramChannelName: String(sessionSettings?.telegramChannelName || '').trim(),
        gnplEnabled: Boolean(sessionSettings?.gnplEnabled),
        gnplRequireAdminApproval: sessionSettings?.gnplRequireAdminApproval !== false,
        gnplDefaultTermDays: Number(sessionSettings?.gnplDefaultTermDays || 14),
        gnplPenaltyEnabled: sessionSettings?.gnplPenaltyEnabled !== false,
        gnplPenaltyPercent: Number(sessionSettings?.gnplPenaltyPercent || 0),
        gnplPenaltyPeriodDays: Number(sessionSettings?.gnplPenaltyPeriodDays || 7),
      });

      const requests: Array<Promise<Response>> = [apiFetch('/api/miniapp/trips'), apiFetch('/api/miniapp/bookings')];
      const shouldFetchGnpl = Boolean(sessionSettings?.gnplEnabled);
      if (shouldFetchGnpl) {
        requests.push(apiFetch('/api/miniapp/gnpl'));
      }
      const responses = await Promise.all(requests);
      const [tripsRes, bookingsRes, gnplRes] = responses;

      const tripsJson = await tripsRes.json().catch(() => ({}));
      if (!tripsRes.ok || !tripsJson?.ok) {
        if (String(tripsJson?.error || '') === 'MINIAPP_MAINTENANCE') {
          setMaintenanceMessage(String(tripsJson?.message || 'Mini App is under maintenance.'));
          setTrips([]);
          setBookings([]);
          setGnplAccounts([]);
          return;
        }
        throw new Error(tripsJson?.error || t('error_trips_failed'));
      }
      setTrips((tripsJson.trips || []) as Trip[]);

      const bookingsJson = await bookingsRes.json().catch(() => ({}));
      if (!bookingsRes.ok || !bookingsJson?.ok) {
        if (String(bookingsJson?.error || '') === 'MINIAPP_MAINTENANCE') {
          setMaintenanceMessage(String(bookingsJson?.message || 'Mini App is under maintenance.'));
          setTrips([]);
          setBookings([]);
          setGnplAccounts([]);
          return;
        }
        throw new Error(bookingsJson?.error || t('error_bookings_failed'));
      }
      setBookings((bookingsJson.bookings || []) as Booking[]);

      if (shouldFetchGnpl && gnplRes) {
        const gnplJson = await gnplRes.json().catch(() => ({}));
        if (gnplRes.ok && gnplJson?.ok) {
          setGnplAccounts((gnplJson.accounts || []) as GnplAccount[]);
        } else if (String(gnplJson?.error || '') === 'MINIAPP_MAINTENANCE') {
          setMaintenanceMessage(String(gnplJson?.message || 'Mini App is under maintenance.'));
          setTrips([]);
          setBookings([]);
          setGnplAccounts([]);
          return;
        } else {
          setGnplAccounts([]);
        }
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
      const discountCode = isTripDiscountEnabled(trip, miniAppSettings) ? selectedDiscountCode(tripId) : '';
      const normalizedName = String(customerName || '').trim().replace(/\s+/g, ' ');
      const normalizedPhone = normalizePhoneInput(phoneNumber).trim();
      const gnplEnabledForTrip = isTripGnplEnabled(trip, miniAppSettings);
      const telegramId = Number(window.Telegram?.WebApp?.initDataUnsafe?.user?.id || 0) || undefined;
      setBusyTripId(tripId);
      setError('');
      setNotice('');
      setFieldErrors({});
      try {
        if (!normalizedName) {
          setValidationError(t('error_customer_name_required'), ['customerName']);
          return;
        }
        if (!/^\+?[0-9]{7,20}$/.test(normalizedPhone)) {
          setValidationError(t('error_phone_required'), ['phoneNumber']);
          return;
        }
        if (paymentMethod === 'gnpl' && !gnplEnabledForTrip) {
          setError(t('error_gnpl_not_available'));
          return;
        }
        if (paymentMethod === 'gnpl' && !gnplIdCardDataUrl) {
          setValidationError(t('error_gnpl_id_scan_required'), ['gnplIdCard']);
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
          setManualSummaryOpen(false);
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
      clearFieldError('manualReceipt');
      return;
    }
    const validationError = validateReceiptFile(file);
    if (validationError) {
      setValidationError(t(validationError), ['manualReceipt']);
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
    clearFieldError('manualReceipt');
  }, [clearFieldError, setValidationError, t]);

  const onGnplIdCardFile = useCallback(async (file?: File | null) => {
    if (!file) {
      setGnplIdCardFileName('');
      setGnplIdCardDataUrl('');
      clearFieldError('gnplIdCard');
      return;
    }

    const validationError = validateGnplIdCardFile(file);
    if (validationError) {
      setValidationError(t(validationError), ['gnplIdCard']);
      setGnplIdCardFileName('');
      setGnplIdCardDataUrl('');
      return;
    }

    const dataUrl = await readFileAsDataURL(file);
    setGnplIdCardFileName(file.name || `id_card_${Date.now()}`);
    setGnplIdCardDataUrl(dataUrl);
    clearFieldError('gnplIdCard');
  }, [clearFieldError, setValidationError, t]);

  const onManualReceiptDateInput = useCallback(
    (value: string) => {
      if (uiLang === 'am') {
        setManualReceiptDateEthInput(value);
        const converted = ethiopianToGregorianYmd(value);
        if (converted) {
          setManualFlow((prev) => (prev ? { ...prev, receiptDate: converted } : prev));
        } else if (!String(value || '').trim()) {
          setManualFlow((prev) => (prev ? { ...prev, receiptDate: '' } : prev));
        }
        return;
      }

      setManualFlow((prev) => (prev ? { ...prev, receiptDate: value } : prev));
    },
    [uiLang]
  );

  const submitManualPayment = useCallback(async () => {
    if (!manualFlow) return;

    setError('');
    setNotice('');
    setFieldErrors((prev) => ({
      ...prev,
      manualReference: false,
      manualReceiptLink: false,
      manualReceipt: false,
      manualAmountPaid: false,
    }));

    const amountPaidValue = Number(manualFlow.amountPaid || 0);
    if (!Number.isFinite(amountPaidValue) || amountPaidValue <= 0) {
      setValidationError(t('error_paid_amount_required'), ['manualAmountPaid']);
      return;
    }
    const expectedAmount = Number((manualFlow.finalAmount || 0).toFixed(2));
    if (amountPaidValue < expectedAmount) {
      setValidationError('Paid amount cannot be lower than expected total.', ['manualAmountPaid']);
      return;
    }

    const hasReferenceOrLink = Boolean(manualFlow.referenceNumber.trim() || manualFlow.receiptLink.trim());
    if (!hasReferenceOrLink) {
      setValidationError(t('error_payment_reference_required'), ['manualReference', 'manualReceiptLink']);
      return;
    }
    if (!manualFlow.receiptDataUrl && !manualFlow.receiptLink.trim()) {
      setValidationError(t('error_receipt_required'), ['manualReceipt']);
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
  }, [apiFetch, initData, loadData, manualFlow, setValidationError, t]);

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
    const inviteCode = normalizeDiscountCodeInput(
      String(params.get('discountCode') || params.get('inviteCode') || params.get('invitationCode') || '')
    );
    const inviteTripId = String(params.get('tripId') || '').trim();

    if (inviteCode) {
      setPendingInviteCode(inviteCode);
      setPendingInviteTripId(inviteTripId);
    }

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

  useEffect(() => {
    if (!pendingInviteCode || trips.length === 0) return;
    if (miniAppSettings?.discountEnabled === false) {
      setPendingInviteCode('');
      setPendingInviteTripId('');
      return;
    }

    setDiscountCodeByTrip((prev) => {
      const next = { ...prev };
      const tripMatched = pendingInviteTripId && trips.some((trip) => trip.id === pendingInviteTripId);
      if (tripMatched) {
        const matchedTrip = trips.find((trip) => trip.id === pendingInviteTripId);
        if (matchedTrip && isTripDiscountEnabled(matchedTrip, miniAppSettings)) {
          next[pendingInviteTripId] = pendingInviteCode;
        }
        return next;
      }
      if (pendingInviteTripId) {
        return next;
      }

      for (const trip of trips) {
        if (isTripDiscountEnabled(trip, miniAppSettings) && !next[trip.id]) {
          next[trip.id] = pendingInviteCode;
        }
      }
      return next;
    });

    setPendingInviteCode('');
    setPendingInviteTripId('');
  }, [miniAppSettings, pendingInviteCode, pendingInviteTripId, trips]);

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

  const selectedManualTrip = useMemo(() => {
    if (!manualFlow) return null;
    return trips.find((trip) => trip.id === manualFlow.tripId) || null;
  }, [manualFlow, trips]);

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

  const saveProfile = useCallback(async () => {
    const normalizedName = String(customerName || '')
      .trim()
      .replace(/\s+/g, ' ');
    const normalized = normalizePhoneInput(phoneNumber).trim();
    setFieldErrors((prev) => ({ ...prev, customerName: false, phoneNumber: false }));
    if (!normalizedName) {
      setValidationError(t('error_customer_name_required'), ['customerName']);
      return;
    }
    if (!/^\+?[0-9]{7,20}$/.test(normalized)) {
      setValidationError(t('error_phone_required'), ['phoneNumber']);
      return;
    }

    setProfileSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch('/api/miniapp/profile/phone', {
        method: 'POST',
        body: JSON.stringify({ initData, phoneNumber: normalized, customerName: normalizedName }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        if (String(json?.error || '') === 'MINIAPP_MAINTENANCE') {
          setMaintenanceMessage(String(json?.message || 'Mini App is under maintenance.'));
          return;
        }
        throw new Error(json?.error || t('error_save_phone_failed'));
      }

      const { firstName, lastName } = splitNameParts(String(json.customerName || normalizedName));
      setCustomerName(String(json.customerName || normalizedName));
      setPhoneNumber(String(json.phoneNumber || normalized));
      setUser((prev) =>
        prev
          ? {
            ...prev,
            firstName: firstName || prev.firstName,
            lastName: lastName || '',
            phoneNumber: String(json.phoneNumber || normalized),
          }
          : prev
      );
      setNotice(t('notice_phone_saved'));
    } catch (e) {
      const message = e instanceof Error ? e.message : t('error_save_phone_failed');
      setError(message);
    } finally {
      setProfileSaving(false);
    }
  }, [apiFetch, customerName, initData, phoneNumber, setValidationError, t]);

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
      const baseTicketUrl = String(booking.cardUrl || '').trim();
      const ticketUrl = baseTicketUrl
        ? `${baseTicketUrl}${baseTicketUrl.includes('?') ? '&' : '?'}lang=${encodeURIComponent(uiLang)}`
        : '';
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
      } catch { }

      try {
        await navigator.clipboard.writeText(text);
        setNotice(`${t('copied')}: ${ticketUrl}`);
      } catch {
        setError('Unable to share ticket');
      }
    },
    [t, uiLang]
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

  const submitTripRating = useCallback(
    async (booking: Booking) => {
      if (!booking?.id) return;
      if (!booking.canRate) {
        setError(t('rating_only_after_checkin'));
        return;
      }

      const form = ratingForms[booking.id] || {
        rating: Number(booking.rating?.rating || 0),
        comment: String(booking.rating?.comment || ''),
      };
      if (!Number.isInteger(form.rating) || form.rating < 1 || form.rating > 5) {
        setError(t('rating_validation_required'));
        return;
      }

      setRatingBusyBookingId(booking.id);
      setError('');
      setNotice('');
      try {
        const response = await apiFetch('/api/miniapp/trips/rating', {
          method: 'POST',
          body: JSON.stringify({
            initData,
            ticketId: booking.id,
            rating: form.rating,
            comment: String(form.comment || '').trim() || undefined,
          }),
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json?.ok) {
          throw new Error(json?.error || 'Failed to save rating');
        }

        const savedRating = {
          rating: Number(json?.rating?.rating || form.rating),
          comment: json?.rating?.comment ? String(json.rating.comment) : String(form.comment || '').trim() || null,
          updatedAt: json?.rating?.updated_at ? String(json.rating.updated_at) : new Date().toISOString(),
        };
        setBookings((prev) =>
          prev.map((row) =>
            row.id === booking.id
              ? {
                  ...row,
                  canRate: true,
                  rating: savedRating,
                }
              : row
          )
        );
        setNotice(t('rating_saved'));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save rating');
      } finally {
        setRatingBusyBookingId('');
      }
    },
    [apiFetch, initData, ratingForms, t]
  );

  const visibleBookings = bookings.filter((booking) =>
    showExpiredBookings ? true : !isExpiredByDeparture(booking.departureDate)
  );

  if (maintenanceMessage) {
    return (
      <main
        className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937,#020617)] text-slate-100 px-4 py-5"
        style={mainStyle}
      >
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
        <section className="max-w-xl mx-auto rounded-2xl border border-amber-500/40 bg-slate-900/80 p-6 text-center space-y-3">
          <p className="text-xs tracking-[0.18em] uppercase text-amber-300">{displayAppName}</p>
          <h1 className="text-xl font-semibold">{t('page_title')}</h1>
          <p className="text-sm text-amber-100">{maintenanceMessage}</p>
          <button
            type="button"
            onClick={openDeveloperContact}
            className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200"
          >
            Developed by @tedtad
          </button>
        </section>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen bg-[radial-gradient(circle_at_top,#1f2937,#020617)] text-slate-100 px-4 py-5"
      style={mainStyle}
    >
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-4">
        {error ? (
          <div className="pointer-events-auto w-full max-w-2xl rounded-xl border border-red-400 bg-red-500/90 px-4 py-3 text-sm font-medium text-white shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError('')}
                className="rounded border border-white/30 px-2 py-0.5 text-xs hover:bg-white/10"
              >
                x
              </button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <div className="pointer-events-auto w-full max-w-2xl rounded-xl border border-emerald-400 bg-emerald-500/90 px-4 py-3 text-sm font-medium text-white shadow-xl whitespace-pre-line">
            <div className="flex items-start justify-between gap-3">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice('')}
                className="rounded border border-white/30 px-2 py-0.5 text-xs hover:bg-white/10"
              >
                x
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <section className="max-w-3xl mx-auto space-y-4">
        <header className="rounded-2xl border border-[color:var(--brand-color-soft)] bg-slate-900/70 p-4 shadow-xl">
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-700/70 bg-slate-950/40 p-2">
            <div className="h-11 w-11 overflow-hidden rounded-lg border border-slate-700/80 bg-slate-900/80">
              {logoImageUrl ? (
                <img src={logoImageUrl} alt={logoLabel} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-[var(--brand-color)]">
                  {appInitial}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-100">{displayAppName}</p>
              <p className="truncate text-xs text-slate-400">{logoLabel}</p>
            </div>
          </div>

          <h1 className="text-2xl font-semibold mt-1">{t('page_title')}</h1>
          {charityEnabled ? (
            <div className="mt-3">
              <a
                href={charityHref}
                className="inline-flex rounded-lg bg-gradient-to-r from-red-600 to-red-700 px-3 py-1.5 text-center text-xs font-medium hover:from-red-700 hover:to-red-800 transition-all"
              >
                {t('make_a_donation')}
              </a>
            </div>
          ) : null}
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-300">{username || t('telegram_customer')}</p>
              <button
                type="button"
                onClick={() => setBasicInfoCollapsed((prev) => !prev)}
                className="rounded-md border border-[color:var(--brand-color-soft)] bg-slate-900/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                {basicInfoCollapsed ? t('expand_basic_info') : t('collapse_basic_info')}
              </button>
            </div>
            {!basicInfoCollapsed ? (
              <div className="flex flex-col gap-2 sm:items-end">
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

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-slate-300 whitespace-nowrap">{t('customer_name')}</span>
                  <input
                    type="text"
                    value={customerName}
                    onChange={(e) => {
                      clearFieldError('customerName');
                      setCustomerName(String(e.target.value || '').replace(/\s+/g, ' ').trimStart());
                    }}
                    placeholder={t('customer_name_placeholder')}
                    className={`rounded-md border bg-slate-950/70 px-2 py-1 text-xs text-slate-100 w-full sm:w-52 ${hasFieldError('customerName') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                      }`}
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <span className="text-xs text-slate-300 whitespace-nowrap">{t('phone_number')}</span>
                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => {
                      clearFieldError('phoneNumber');
                      setPhoneNumber(normalizePhoneInput(e.target.value));
                    }}
                    placeholder={t('phone_placeholder')}
                    className={`rounded-md border bg-slate-950/70 px-2 py-1 text-xs text-slate-100 w-full sm:w-48 ${hasFieldError('phoneNumber') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                      }`}
                  />
                </div>
                <div className="w-full flex justify-end">
                  <button
                    type="button"
                    onClick={saveProfile}
                    disabled={profileSaving}
                    className="rounded-md border border-[color:var(--brand-color-soft)] bg-[color:var(--brand-color-muted)] px-3 py-1 text-xs text-white hover:opacity-90 disabled:opacity-60"
                  >
                    {profileSaving ? t('saving_profile') : t('save_profile')}
                  </button>
                </div>
              </div>
            ) : null}
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
                className="rounded-md border border-[color:var(--brand-color-soft)] bg-[color:var(--brand-color-muted)] px-3 py-1 text-xs text-white hover:opacity-90"
              >
                {t('join_channel')}
              </a>
            </div>
          ) : null}
        </header>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2">
            <p className="text-[11px] text-slate-400">{t('trips_label')}</p>
            <p className="text-lg font-semibold text-[var(--brand-color)]">{tripsCount}</p>
          </div>
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2">
            <p className="text-[11px] text-slate-400">{t('bookings_label')}</p>
            <p className="text-lg font-semibold text-slate-100">{bookingsCount}</p>
          </div>
          <div className="rounded-xl border border-slate-700/70 bg-slate-900/60 px-3 py-2">
            <p className="text-[11px] text-slate-400">{t('active_label')}</p>
            <p className="text-lg font-semibold text-emerald-300">{activeBookingsCount}</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">{t('available_trips')}</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTripsSectionCollapsed((prev) => !prev)}
              className="rounded-lg border border-slate-700 px-3 py-1 text-xs hover:bg-slate-800"
            >
              {tripsSectionCollapsed ? t('expand') : t('collapse')}
            </button>
            <button
              type="button"
              onClick={loadData}
              className="rounded-lg border border-[color:var(--brand-color-soft)] px-3 py-1 text-sm text-[var(--brand-color)] hover:bg-[color:var(--brand-color-muted)] hover:text-white"
            >
              {t('refresh')}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-400">
          {t('initial_step_required')}
        </p>

        {tripsSectionCollapsed ? null : loading ? (
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
              const gnplEnabledForTrip = isTripGnplEnabled(trip, miniAppSettings);
              const discountEnabledForTrip = isTripDiscountEnabled(trip, miniAppSettings);
              const sanitizedDescriptionHtml = sanitizeTripDescriptionHtml(trip.description || '');
              const descriptionText = stripHtmlToText(sanitizedDescriptionHtml || trip.description || '');
              const isDescriptionLong = descriptionText.length > MINIAPP_TRIP_DESCRIPTION_PREVIEW_LIMIT;
              const isDescriptionExpanded = Boolean(expandedTripDescriptions[trip.id]);
              const visibleDescription =
                isDescriptionLong && !isDescriptionExpanded
                  ? `${descriptionText.slice(0, MINIAPP_TRIP_DESCRIPTION_PREVIEW_LIMIT).trimEnd()}...`
                  : descriptionText;
              return (
                <article key={trip.id} className="rounded-2xl border border-slate-700/70 bg-slate-900/65 overflow-hidden">
                  {image ? <img src={image} alt={trip.name || t('trip_fallback')} className="h-36 w-full object-cover" /> : null}
                  <div className="p-4 space-y-2">
                    <h3 className="text-lg font-semibold">{trip.name || t('trip_fallback')}</h3>
                    <p className="text-sm text-slate-300">
                      {trip.destination || t('na')} | {formatDate(trip.departure_date, uiLang, t('na'))}
                    </p>
                    {trip.arrival_date ? (
                      <p className="text-xs text-slate-400">
                        {t('arrival')}: {formatDate(trip.arrival_date, uiLang, t('na'))}
                      </p>
                    ) : null}
                    <p className="text-sm text-slate-200">
                      ETB {Number(trip.price_per_ticket || 0).toFixed(2)} | {t('seats')} {trip.available_seats ?? 0}/
                      {trip.total_seats ?? 0}
                    </p>
                    {descriptionText ? (
                      <div className="space-y-1">
                        {isDescriptionExpanded ? (
                          <div
                            className="text-xs text-slate-300 leading-relaxed space-y-1 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium [&_p]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-[var(--brand-color)] [&_a]:underline"
                            dangerouslySetInnerHTML={{ __html: sanitizedDescriptionHtml || visibleDescription }}
                          />
                        ) : (
                          <p className="text-xs text-slate-300 leading-relaxed">{visibleDescription}</p>
                        )}
                        {isDescriptionLong ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedTripDescriptions((prev) => ({
                                ...prev,
                                [trip.id]: !prev[trip.id],
                              }))
                            }
                            className="text-[11px] text-[var(--brand-color)] hover:opacity-80 underline"
                          >
                            {isDescriptionExpanded ? t('less') : t('more')}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {trip.telegram_group_url ? (
                      <div>
                        <a
                          href={String(trip.telegram_group_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[var(--brand-color)] underline"
                        >
                          {t('join_trip_group')}
                        </a>
                      </div>
                    ) : null}

                    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-300 whitespace-nowrap">{t('number_of_tickets')}</label>
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
                      {discountEnabledForTrip ? (
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
                      ) : null}
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
                        {gnplEnabledForTrip ? (
                          <option value="gnpl">{t('gnpl_method')}</option>
                        ) : null}
                        <option value="telebirr_auto">{t('telebirr_auto')}</option>
                      </select>
                      {gnplEnabledForTrip && method === 'gnpl' ? (
                        <label className="flex-1 text-xs text-slate-300">
                          <span className="mb-1 block">{t('id_card_scan')}</span>
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
                            className={`w-full rounded-lg bg-slate-950/70 border px-3 py-2 text-xs text-slate-100 ${hasFieldError('gnplIdCard') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                              }`}
                          />
                        </label>
                      ) : null}
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => startBooking(trip)}
                        className="rounded-lg bg-[var(--brand-color)] text-[var(--brand-color-text)] px-4 py-2 text-sm font-semibold hover:bg-[var(--brand-color-strong)] disabled:opacity-60"
                      >
                        {isBusy ? t('starting') : t('book')}
                      </button>
                    </div>
                    {gnplEnabledForTrip && method === 'gnpl' && gnplIdCardFileName ? (
                      <p className="text-[11px] text-[var(--brand-color)]">
                        {t('id_card_selected')}: {gnplIdCardFileName}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {manualFlow ? (
          <section className="rounded-2xl border border-[color:var(--brand-color-soft)] bg-slate-900/70 p-4 space-y-3">
            <h2 className="text-lg font-semibold">
              {t('manual_payment')} - {manualFlow.tripName}
            </h2>
            <p className="text-sm text-slate-300">{t('manual_step_desc')}</p>
            <button
              type="button"
              onClick={() => setManualSummaryOpen((prev) => !prev)}
              className="rounded-lg border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800/60"
            >
              {manualSummaryOpen ? t('hide_booking_summary') : t('show_booking_summary')}
            </button>
            {manualSummaryOpen ? (
              <div className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 text-xs text-slate-300 space-y-1">
                <p>{t('trip_label')}: {manualFlow.tripName}</p>
                <p>{t('customer_label')}: {String(customerName || '-')}</p>
                <p>{t('phone_label')}: {String(phoneNumber || '-')}</p>
                {selectedManualTrip?.description ? (
                  <p className="text-slate-400">{selectedManualTrip.description}</p>
                ) : null}
              </div>
            ) : null}

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
                    <p className="flex items-center justify-between gap-2">
                      <span>{t('account_name')}: {selectedBank.account_name}</span>
                      <button
                        type="button"
                        onClick={() => copyText(selectedBank.account_name)}
                        className="text-xs text-[var(--brand-color)] underline"
                      >
                        {t('copy')}
                      </button>
                    </p>
                    <p className="flex items-center justify-between gap-2">
                      <span>{t('account_number')}: {selectedBank.account_number}</span>
                      <button
                        type="button"
                        onClick={() => copyText(selectedBank.account_number)}
                        className="text-xs text-[var(--brand-color)] underline"
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
                <p className="font-medium">{t('telebirr_manual_details')}</p>
                <p className="flex items-center justify-between gap-2">
                  <span>{t('account_name')}: {manualFlow.telebirrManualAccountName || t('not_configured')}</span>
                  {manualFlow.telebirrManualAccountName ? (
                    <button
                      type="button"
                      onClick={() => copyText(manualFlow.telebirrManualAccountName)}
                      className="text-xs text-[var(--brand-color)] underline"
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
                      className="text-xs text-[var(--brand-color)] underline"
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
                  onChange={(e) => {
                    clearFieldError('manualAmountPaid');
                    setManualFlow((prev) => (prev ? { ...prev, amountPaid: e.target.value } : prev));
                  }}
                  className={`mt-1 w-full rounded-lg bg-slate-950/70 border px-3 py-2 text-sm ${hasFieldError('manualAmountPaid') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                    }`}
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">{t('bill_reference')}</span>
                <input
                  type="text"
                  value={manualFlow.referenceNumber}
                  onChange={(e) => {
                    clearFieldError('manualReference');
                    setManualFlow((prev) => (prev ? { ...prev, referenceNumber: e.target.value } : prev));
                  }}
                  className={`mt-1 w-full rounded-lg bg-slate-950/70 border px-3 py-2 text-sm ${hasFieldError('manualReference') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                    }`}
                  placeholder={t('ref_placeholder')}
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">{t('receipt_link_optional')}</span>
                <input
                  type="url"
                  value={manualFlow.receiptLink}
                  onChange={(e) => {
                    clearFieldError('manualReceiptLink');
                    clearFieldError('manualReceipt');
                    setManualFlow((prev) => (prev ? { ...prev, receiptLink: e.target.value } : prev));
                  }}
                  className={`mt-1 w-full rounded-lg bg-slate-950/70 border px-3 py-2 text-sm ${hasFieldError('manualReceiptLink') || hasFieldError('manualReceipt')
                    ? 'border-red-500 ring-1 ring-red-500'
                    : 'border-slate-700'
                    }`}
                  placeholder="https://.../receipt?ref=TX123&date=2026-02-25"
                />
              </label>

              <label className="text-sm sm:col-span-2">
                <span className="text-slate-300">{t('receipt_date_optional')}</span>
                {uiLang === 'am' ? (
                  <>
                    <input
                      type="text"
                      value={manualReceiptDateEthInput}
                      onChange={(e) => onManualReceiptDateInput(e.target.value)}
                      className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                      placeholder={t('ethiopian_date_placeholder')}
                    />
                    <p className="mt-1 text-[11px] text-slate-400">
                      {t('ethiopian_date_hint')}
                      {manualFlow.receiptDate ? ` (${t('gregorian_label')}: ${manualFlow.receiptDate})` : ''}
                    </p>
                  </>
                ) : (
                  <input
                    type="date"
                    value={manualFlow.receiptDate}
                    onChange={(e) => onManualReceiptDateInput(e.target.value)}
                    className="mt-1 w-full rounded-lg bg-slate-950/70 border border-slate-700 px-3 py-2 text-sm"
                  />
                )}
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
                  className={`mt-1 w-full rounded-lg bg-slate-950/70 border px-3 py-2 text-sm ${hasFieldError('manualReceipt') ? 'border-red-500 ring-1 ring-red-500' : 'border-slate-700'
                    }`}
                />
              </label>
            </div>

            <div className="text-xs text-slate-300 space-y-1">
              <p>
                {t('base_total')}: ETB {Number(manualFlow.baseAmount || 0).toFixed(2)}
              </p>
              {manualFlow.discountPercent > 0 ? (
                <p>
                  {t('discount')} ({manualFlow.discountCode || '-'}, {manualFlow.discountPercent}%): -ETB{' '}
                  {Number(manualFlow.discountAmount || 0).toFixed(2)}
                </p>
              ) : null}
              <p>
                {t('expected_total')}: ETB {manualExpectedAmount.toFixed(2)} {t('for')} {manualFlow.quantity}{' '}
                {t('tickets')}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitManualPayment}
                disabled={manualSubmitting}
                className="rounded-lg bg-[var(--brand-color)] text-[var(--brand-color-text)] px-4 py-2 text-sm font-semibold hover:bg-[var(--brand-color-strong)] disabled:opacity-60"
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
                      Due: {formatDate(account.dueDate, uiLang, '-')} | Outstanding: ETB {Number(account.totalDue || 0).toFixed(2)} |
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
                          placeholder={t('gnpl_amount_placeholder')}
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
                          placeholder={t('gnpl_reference_placeholder')}
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
                          placeholder={t('gnpl_receipt_link_optional')}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => submitGnplPayment(account)}
                          disabled={isPaying}
                          className="rounded-md bg-amber-500 text-slate-950 px-3 py-2 text-xs font-semibold disabled:opacity-60 sm:col-span-3"
                        >
                          {isPaying ? t('gnpl_submitting_payment') : t('gnpl_submit_payment')}
                        </button>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400">
                        {t('gnpl_payment_waiting_approval')}
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
            <h2 className="text-lg font-medium">{t('my_bookings')}</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBookingsSectionCollapsed((prev) => !prev)}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                {bookingsSectionCollapsed ? t('expand') : t('collapse')}
              </button>
              <button
                type="button"
                onClick={() => setShowExpiredBookings((prev) => !prev)}
                className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
              >
                {showExpiredBookings ? t('hide_expired_tickets') : t('show_expired_tickets')}
              </button>
            </div>
          </div>
          <div className={`grid gap-2 ${bookingsSectionCollapsed ? 'hidden' : ''}`}>
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
              const localizedCardUrl = booking.cardUrl
                ? `${booking.cardUrl}${String(booking.cardUrl).includes('?') ? '&' : '?'}lang=${encodeURIComponent(
                    uiLang
                  )}`
                : null;
              const canRate = Boolean(booking.canRate || normalizedStatus === 'used');
              const ratingForm = ratingForms[booking.id] || {
                rating: Number(booking.rating?.rating || 0),
                comment: String(booking.rating?.comment || ''),
              };
              const isBookingExpanded = Boolean(expandedBookingIds[booking.id]);

              return (
                <div key={booking.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{t('trip_label')}: {booking.tripName}</p>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedBookingIds((prev) => ({
                          ...prev,
                          [booking.id]: !prev[booking.id],
                        }))
                      }
                      className="rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                    >
                      {isBookingExpanded ? t('collapse') : t('expand')}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {t('status')}: {booking.status} | {t('ref_short')}: {booking.referenceNumber || t('na')}
                  </p>

                  {isBookingExpanded ? (
                    <>
                      <p className="text-sm text-slate-300 mt-2">
                        Destination: {booking.destination} | Ticket: {booking.serialNumber}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {localizedCardUrl ? (
                          <a className="text-xs text-[var(--brand-color)] underline" href={localizedCardUrl} target="_blank" rel="noreferrer">
                            {t('open_digital_ticket')}
                          </a>
                        ) : null}
                        {localizedCardUrl ? (
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

                      {canRate ? (
                        <div className="mt-3 rounded-lg border border-slate-700 bg-slate-950/50 p-2 space-y-2">
                          <p className="text-xs text-slate-300">{t('rate_this_trip')}</p>
                          {booking.rating ? (
                            <p className="text-xs text-emerald-300">
                              {t('your_rating')}: {booking.rating.rating}/5
                              {booking.rating.updatedAt
                                ? ` (${formatDate(booking.rating.updatedAt, uiLang, t('na'))})`
                                : ''}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-1">
                            {[1, 2, 3, 4, 5].map((value) => {
                              const selected = Number(ratingForm.rating || 0) === value;
                              return (
                                <button
                                  key={`${booking.id}-rate-${value}`}
                                  type="button"
                                  onClick={() =>
                                    setRatingForms((prev) => ({
                                      ...prev,
                                      [booking.id]: {
                                        ...ratingForm,
                                        rating: value,
                                      },
                                    }))
                                  }
                                  className={`rounded-md border px-2 py-1 text-xs ${
                                    selected
                                      ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                                      : 'border-slate-600 bg-slate-900 text-slate-300'
                                  }`}
                                >
                                  {value}
                                </button>
                              );
                            })}
                          </div>
                          <textarea
                            rows={2}
                            value={ratingForm.comment}
                            onChange={(e) =>
                              setRatingForms((prev) => ({
                                ...prev,
                                [booking.id]: {
                                  ...ratingForm,
                                  comment: String(e.target.value || ''),
                                },
                              }))
                            }
                            placeholder={t('rating_comment_optional')}
                            className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                          />
                          <button
                            type="button"
                            onClick={() => submitTripRating(booking)}
                            disabled={ratingBusyBookingId === booking.id}
                            className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-slate-950 disabled:opacity-60"
                          >
                            {ratingBusyBookingId === booking.id ? t('submitting_rating') : t('submit_rating')}
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-slate-400">
          Developed by{" "}
          <button type="button" onClick={openDeveloperContact} className="underline hover:text-white">
            @tedtad
          </button>
        </p>
      </section>
    </main>
  );
}


