import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import {
  TelegramMessage,
  sendTelegramMessage,
  sendTelegramPhoto,
  answerCallbackQuery,
  editMessageText,
  getFile,
  generateTripSerialNumber,
  generateTicketNumber,
} from '@/lib/telegram';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { formatBankAccounts, getTripManualPaymentConfig } from '@/lib/payment-config';
import {
  ONBOARDING_MAX_ATTEMPTS,
  verifyOnboardingOtp,
} from '@/lib/admin-onboarding';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

function resolvePublicAppBaseURL() {
  const value = String(APP_URL || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

type Lang = 'en' | 'am';
type PaymentMethod = 'bank' | 'telebirr' | 'telebirr_auto';
type BookingSessionStatus = 'awaiting_receipt' | 'awaiting_auto_payment' | 'completed' | 'cancelled';

type TripRow = {
  id: string;
  name?: string | null;
  description?: string | null;
  destination?: string | null;
  departure_date?: string | null;
  arrival_date?: string | null;
  price_per_ticket?: number | null;
  total_seats?: number | null;
  available_seats?: number | null;
  status?: string | null;
  trip_status?: string | null;
  bank_accounts?: unknown;
  telebirr_manual_account_name?: string | null;
  telebirr_manual_account_number?: string | null;
  manual_payment_note?: string | null;
};

type BookingSessionRow = {
  id: string;
  telegram_user_id: number | string;
  trip_id: string;
  payment_method: PaymentMethod;
  quantity: number;
  status: BookingSessionStatus;
};

type TelegramAttachment = {
  fileId: string;
  fileName: string;
  fileUrl: string | null;
};

const copy = {
  en: {
    welcome: (name: string) =>
      `Welcome ${name}.\n\nBook trips, upload receipts, and track ticket approval from the menu.`,
    help: [
      'How to book (Mini App):',
      '1) Open Mini App',
      '2) Select a trip',
      '3) Choose payment method',
      '4) If manual payment, submit receipt in Mini App',
      '5) Wait for admin approval',
      '',
      'Commands: /start /app /help',
    ].join('\n'),
    menuPrompt: 'Use /app to open the Mini App and continue booking.',
    tripsTitle: 'Step 1/3: Choose a trip:',
    noTrips: 'No bookable trips are available right now. Please check again later.',
    tripNotFound: 'Trip not found.',
    tripLoaded: 'Trip loaded.',
    backToTrips: 'Back to Trips',
    choosePayment: 'Step 2/3: Choose payment method:',
    payTelebirrAuto: 'Telebirr Auto',
    payTelebirr: 'Telebirr Manual',
    payBank: 'Bank Transfer',
    paySelected: 'Payment method selected.',
    telebirrAutoInstruction:
      'Step 3/3: Open Telebirr checkout and complete payment. Confirmation is automatic.',
    telebirrAutoMissing:
      'Telebirr auto checkout URL is not configured yet. Please use manual payment and upload receipt.',
    telebirrAutoComingSoon:
      'Telebirr Auto is coming soon. Please use Telebirr Manual or Bank Transfer for now.',
    uploadReceiptPrompt:
      'Step 3/3: Upload receipt image/document now. Include payment reference in caption (e.g. REF-123456).',
    receiptNeedsReference:
      'Receipt received, but no payment reference was detected. Re-send with reference in caption.',
    receiptSaved:
      'Receipt submitted successfully. Your ticket request is now pending admin approval.',
    receiptSaveFailed: 'Could not save receipt now. Please try again.',
    bookingsNone: 'You have no bookings yet.',
    bookingsTitle: 'My bookings:\n',
    contactAdmin: 'Contact admin: support@tickethub.com',
    unsupportedAction: 'Unsupported action.',
    languageChanged: 'Language changed to English.',
    refreshTrips: 'Refreshing trips...',
    bookingCaptured:
      'Booking started. Choose payment method, then upload your receipt with payment reference.',
    autoPaymentNeedRef: 'If callback fails, use fallback command: /paid TX123456.',
    autoPaymentNoSession: 'No pending auto-payment booking found. Please choose a trip again.',
    autoPaymentSaved: 'Auto payment reference captured. Your ticket request is now pending admin approval.',
    autoPaymentRefMissing: 'Transaction reference missing. Use format: /paid TX123456',
    cancelBooking: 'Cancel Booking',
    bookingCancelled: 'Your current booking flow has been cancelled.',
    bookingAlreadyClosed: 'No open booking flow was found.',
    manualPaymentBankPrompt: 'Payment channel: Bank transfer.',
    manualPaymentTelebirrPrompt: 'Payment channel: Telebirr manual.',
    referenceLabel: 'Reference',
    ticketLabel: 'Ticket',
    expiredStatusLabel: 'EXPIRED',
    openTicketCard: (url: string) => `Open ticket card: ${url}`,
    visualTicketsSummary: (shown: number, total: number) =>
      `Showing ${shown} of ${total} approved visual tickets.`,
    tripFallbackName: 'Trip',
    notAvailable: 'N/A',
    statusLabel: 'Status',
    refShortLabel: 'Ref',
    tripDetailsDestination: 'Destination',
    tripDetailsDeparture: 'Departure',
    tripDetailsPrice: 'Price',
    tripDetailsSeats: 'Seats',
    tripDetailsNotes: 'Notes',
    seatUnit: 'seats',
    migrationRequired: 'System setup is incomplete. Ask admin to run Phase 1 migration.',
  },
  am: {
    welcome: (name: string) =>
      `ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã…Â Ã‚Â³ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¦ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â¡ ${name}ÃƒÂ¡Ã‚ÂÃ‚Â¢\n\nÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡ÃƒÂ¡Ã‚ÂÃ‚Â£ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â£ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â³ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â°ÃƒÂ¡Ã‚ÂÃ‚Â¢`,
    help: [
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Å¡ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ:',
      '1) ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â±',
      '2) ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡',
      '3) ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â´ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡',
      '4) ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ ÃƒÂ¡Ã…â€™Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã‚Â­ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©',
      '5) ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚Âª ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã†â€™ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â',
      '',
      'ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬ÂºÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½: /trips /bookings /help /lang /contact_admin /paid <tx_ref>',
    ].join('\n'),
    menuPrompt: 'ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã…â€™Ã‚Â£ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Å¡ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‚Â®ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã¢â€žÂ¢ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    tripsTitle: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã†â€™ 1/3: ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡:',
    noTrips: 'ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¥ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã…Â¡ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â»ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã…Â¾ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    tripNotFound: 'ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    tripLoaded: 'ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â·ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    backToTrips: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â° ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½',
    choosePayment: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã†â€™ 2/3: ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â´ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡:',
    payTelebirrAuto: 'Telebirr ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¶',
    payTelebirr: 'Telebirr ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã‚Â',
    payBank: 'ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã…Â Ã‚Â­',
    paySelected: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â´ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â§ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    telebirrAutoInstruction:
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã†â€™ 3/3: ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨Telebirr ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã‹â€ Ã…Â ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â± ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¡ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« /paid <transaction_reference> ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    telebirrAutoMissing:
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨Telebirr auto URL ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã…â€™Ã¢â‚¬Â¹ÃƒÂ¡Ã…â€™Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã¢â€žÂ¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    telebirrAutoComingSoon:
      'Telebirr Auto is coming soon. Please use Telebirr Manual or Bank Transfer for now.',
    uploadReceiptPrompt:
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã†â€™ 3/3: ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã‹â€ Ã‚Â/ÃƒÂ¡Ã‚ÂÃ¢â‚¬Â¹ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â caption ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã…â€™Ã‚Â¥ ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¡ (ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â³ÃƒÂ¡Ã‹â€ Ã…â€™ REF-123456)ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    receiptNeedsReference:
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚Â·ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã…Â Ã‚ÂÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â­ ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ caption ÃƒÂ¡Ã…â€™Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã‚Â­ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    receiptSaved:
      'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã…â€™Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Å¾ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚Âª ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã†â€™ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¦ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ ÃƒÂ¡Ã…Â Ã‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    receiptSaveFailed: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â¥ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â»ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã…Â¾ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    bookingsNone: 'ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    bookingsTitle: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¶ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½:\n',
    contactAdmin: 'ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚Âª: support@tickethub.com',
    unsupportedAction: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã‚ÂÃ‹â€  ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    languageChanged: 'ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¹ ÃƒÂ¡Ã¢â‚¬Â¹Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â° ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã…Â Ã¢â‚¬Âº ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚Â¯ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    refreshTrips: 'ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â½ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­...',
    bookingCaptured: 'ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â£ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¯ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â¹Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â´ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    autoPaymentNeedRef: 'ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã…Â Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â± ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã…Â Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ /paid <transaction_reference> ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã…Â Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    autoPaymentNoSession: 'ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¶ ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¦ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‹â€  ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â£ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…â€™Ã‚Â¡ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    autoPaymentSaved: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¶ ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â§ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚ÂµÃƒÂ¡Ã…Â Ã‚Â¬ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã…â€™Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Å¾ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚Âª ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã†â€™ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Âµ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¹ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ ÃƒÂ¡Ã…Â Ã‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    autoPaymentRefMissing: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã‹â€ Ã¢â‚¬Â¦ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¦ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â¸ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â­ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã¢â€žÂ¢: /paid TX123456',
    cancelBooking: 'ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â£ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â',
    bookingCancelled: 'ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â£ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Å¡ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â°ÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¸ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    bookingAlreadyClosed: 'ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â£ ÃƒÂ¡Ã‹â€ Ã¢â‚¬Å¡ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â°Ã‚Âµ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‹â€ ÃƒÂ¡Ã…Â Ã‹Å“ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    manualPaymentBankPrompt: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â»ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ÃƒÂ¡Ã‹â€ Ã‚Â: ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã…Â Ã‚Â­ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚Â¢',
    manualPaymentTelebirrPrompt: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã‚ÂÃ‚ÂÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â« ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â»ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ÃƒÂ¡Ã‹â€ Ã‚Â: Telebirr ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬Â¹ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢',
    referenceLabel: 'ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã‹â€ Ã‚Âµ',
    tripFallbackName: 'ÃƒÂ¡Ã…â€™Ã¢â‚¬Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â¾',
    notAvailable: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â',
    statusLabel: 'ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â³',
    refShortLabel: 'ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã‚ÂÃ‚Â',
    tripDetailsDestination: 'ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚Â»',
    tripDetailsDeparture: 'ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…Â Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â»',
    tripDetailsPrice: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬Â¹ÃƒÂ¡Ã…â€™Ã¢â‚¬Â¹',
    tripDetailsSeats: 'ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â«',
    tripDetailsNotes: 'ÃƒÂ¡Ã‹â€ Ã¢â‚¬ÂºÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‹â€ ÃƒÂ¡Ã‹â€ Ã‚Â»',
    seatUnit: 'ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‹Å“ÃƒÂ¡Ã…â€™Ã‚Â«',
    migrationRequired: 'ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â¨ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã‹â€ Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã¢â‚¬Å“ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â± ÃƒÂ¡Ã¢â‚¬Â°Ã¢â‚¬Â¦ÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â¥ÃƒÂ¡Ã‹â€ Ã‚Â­ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã…â€™Ã‚Â ÃƒÂ¡Ã…Â Ã¢â‚¬Å“ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã¢â‚¬Â°Ã¢â€šÂ¬ÃƒÂ¡Ã‹â€ Ã‚ÂÃƒÂ¡Ã‚ÂÃ‚Â¢ ÃƒÂ¡Ã…Â Ã‚Â¥ÃƒÂ¡Ã¢â‚¬Â°Ã‚Â£ÃƒÂ¡Ã…Â Ã‚Â­ÃƒÂ¡Ã¢â‚¬Â¹Ã…Â½ ÃƒÂ¡Ã…Â Ã‚Â ÃƒÂ¡Ã‹â€ Ã‚ÂµÃƒÂ¡Ã¢â‚¬Â°Ã‚Â°ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â³ÃƒÂ¡Ã‹â€ Ã‚ÂªÃƒÂ¡Ã¢â‚¬Â¹Ã‚ÂÃƒÂ¡Ã…Â Ã¢â‚¬Â¢ ÃƒÂ¡Ã¢â‚¬Â¹Ã‚Â«ÃƒÂ¡Ã…Â Ã‚ÂÃƒÂ¡Ã…â€™Ã¢â‚¬Â¹ÃƒÂ¡Ã…â€™Ã‚ÂÃƒÂ¡Ã‹â€ Ã‚Â©ÃƒÂ¡Ã‚ÂÃ‚Â¢',
  },
} as const;

function decodeMojibake(text: string): string {
  const suspect = /[ÃƒÃ‚Ã…Ã‹Ã†Æ’Ã¢â‚¬]/;
  if (!suspect.test(text)) return text;

  let current = text;
  for (let i = 0; i < 3; i += 1) {
    try {
      const decoded = Buffer.from(current, 'latin1').toString('utf8');
      if (!decoded || decoded === current) break;
      current = decoded;
      if (!suspect.test(current)) break;
    } catch {
      break;
    }
  }

  return current;
}

function repairLocale<T>(value: T): T {
  if (typeof value === 'string') {
    return decodeMojibake(value) as T;
  }

  if (typeof value === 'function') {
    return (((...args: unknown[]) => repairLocale((value as (...a: unknown[]) => unknown)(...args))) as unknown) as T;
  }

  if (Array.isArray(value)) {
    return (value.map((item) => repairLocale(item)) as unknown) as T;
  }

  if (value && typeof value === 'object') {
    const repaired: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      repaired[key] = repairLocale(nested);
    }
    return repaired as T;
  }

  return value;
}

const i18n = {
  en: repairLocale(copy.en),
  am: {
    ...repairLocale(copy.am),
    languageChanged: '\u124b\u1295\u124b \u12c8\u12f0 \u12a0\u121b\u122d\u129b \u1270\u1240\u12ed\u122f\u120d\u1362',
    ticketLabel: '\u1272\u12ac\u1275',
    expiredStatusLabel: '\u1246\u12ed\u1277\u120d',
    openTicketCard: (url: string) => `\u1272\u12ad\u1275 \u12ab\u122d\u12f5 \u12ed\u12ad\u1348\u1271: ${url}`,
    visualTicketsSummary: (shown: number, total: number) =>
      `${total} \u12e8\u1338\u12f0\u1241 \u126a\u12e5\u12e0\u120d \u1272\u12ad\u1276\u127d \u12cd\u1235\u1325 ${shown} \u1265\u127b \u1273\u12ed\u1270\u12cb\u120d\u1362`,
  },
} as const;

function verifyTelegramWebhook(): boolean {
  return Boolean(TELEGRAM_BOT_TOKEN);
}

function getServiceSupabaseClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createServiceClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

async function getPrimaryClient() {
  return getServiceSupabaseClient() || (await createServerClient());
}

function extractStartPayload(text: string | undefined) {
  const normalized = String(text || '').trim();
  if (!normalized.toLowerCase().startsWith('/start')) return '';
  const parts = normalized.split(/\s+/);
  if (parts.length < 2) return '';
  return String(parts[1] || '').trim();
}

function parseActivateCommand(text: string | undefined) {
  const normalized = String(text || '').trim();
  if (!normalized.toLowerCase().startsWith('/activate')) return null;
  const parts = normalized.split(/\s+/);
  if (parts.length < 4) return null;
  return {
    otp: String(parts[1] || '').trim(),
    username: String(parts[2] || '').trim(),
    newPassword: String(parts[3] || '').trim(),
  };
}

function validateActivationInput(input: { otp: string; username: string; newPassword: string }) {
  if (!/^\d{6}$/.test(input.otp)) return 'OTP must be 6 digits.';
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(input.username)) {
    return 'Username must be 3-32 chars (letters, numbers, underscore).';
  }
  if (input.newPassword.length < 10) return 'Password must be at least 10 characters.';
  if (!/[A-Z]/.test(input.newPassword)) return 'Password must include an uppercase letter.';
  if (!/[a-z]/.test(input.newPassword)) return 'Password must include a lowercase letter.';
  if (!/\d/.test(input.newPassword)) return 'Password must include a number.';
  return '';
}

async function findOnboardingByToken(client: any, token: string) {
  const { data, error } = await client
    .from('admin_user_onboarding')
    .select('id, admin_id, email, onboarding_token, otp_hash, status, attempts, max_attempts, locked_until, expires_at')
    .eq('onboarding_token', token)
    .maybeSingle();
  if (error) throw error;
  return data as
    | {
        id: string;
        admin_id: string;
        email: string;
        onboarding_token: string;
        otp_hash: string;
        status: string;
        attempts: number | null;
        max_attempts: number | null;
        locked_until: string | null;
        expires_at: string;
      }
    | null;
}

async function findLatestOnboardingByTelegramUser(client: any, telegramUserId: number) {
  const { data, error } = await client
    .from('admin_user_onboarding')
    .select('id, admin_id, email, onboarding_token, otp_hash, status, attempts, max_attempts, locked_until, expires_at')
    .eq('telegram_user_id', telegramUserId)
    .in('status', ['pending', 'linked', 'reset'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as
    | {
        id: string;
        admin_id: string;
        email: string;
        onboarding_token: string;
        otp_hash: string;
        status: string;
        attempts: number | null;
        max_attempts: number | null;
        locked_until: string | null;
        expires_at: string;
      }
    | null;
}

async function handleOnboardingStart(chatId: number, userId: number, payload: string) {
  if (!payload.startsWith('onboard_')) return false;

  const token = payload.replace(/^onboard_/i, '').trim();
  if (!token) {
    await sendTelegramMessage(chatId, 'Invalid onboarding token.');
    return true;
  }

  const client = await getPrimaryClient();
  const onboarding = await findOnboardingByToken(client, token).catch(() => null);
  if (!onboarding) {
    await sendTelegramMessage(chatId, 'Onboarding token was not found. Request a new reset from admin.');
    return true;
  }

  const status = String(onboarding.status || 'pending').toLowerCase();
  if (status === 'completed') {
    await sendTelegramMessage(chatId, 'This onboarding link was already completed.');
    return true;
  }
  if (status === 'locked') {
    await sendTelegramMessage(chatId, 'This onboarding link is locked. Contact admin for reset.');
    return true;
  }
  if (status !== 'pending' && status !== 'linked' && status !== 'reset') {
    await sendTelegramMessage(chatId, 'This onboarding link is no longer active.');
    return true;
  }

  const expiresAt = new Date(onboarding.expires_at || 0).getTime();
  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await client
      .from('admin_user_onboarding')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', onboarding.id);
    await sendTelegramMessage(chatId, 'This onboarding link has expired. Ask admin to reset your account.');
    return true;
  }

  const lockedUntil = onboarding.locked_until ? new Date(onboarding.locked_until).getTime() : 0;
  if (lockedUntil && lockedUntil > Date.now()) {
    await sendTelegramMessage(chatId, 'This onboarding link is temporarily locked. Try later or contact admin.');
    return true;
  }

  await client
    .from('admin_user_onboarding')
    .update({
      telegram_user_id: userId,
      status: 'linked',
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', onboarding.id);

  await sendTelegramMessage(
    chatId,
    'Account link verified. Send:\n/activate <otp> <username> <new_password>\nExample: /activate 123456 teddy_admin StrongPass!234'
  );
  return true;
}

async function handleOnboardingActivate(chatId: number, userId: number, text: string | undefined) {
  const command = parseActivateCommand(text);
  if (!command) return false;

  const validationError = validateActivationInput(command);
  if (validationError) {
    await sendTelegramMessage(chatId, validationError);
    return true;
  }

  const client = await getPrimaryClient();
  const onboarding = await findLatestOnboardingByTelegramUser(client, userId).catch(() => null);
  if (!onboarding) {
    await sendTelegramMessage(chatId, 'No active onboarding session found. Start again from your onboarding link.');
    return true;
  }

  const maxAttempts = Math.max(1, Number(onboarding.max_attempts || ONBOARDING_MAX_ATTEMPTS));
  const attempts = Math.max(0, Number(onboarding.attempts || 0));
  const expiresAt = new Date(onboarding.expires_at || 0).getTime();
  const lockedUntil = onboarding.locked_until ? new Date(onboarding.locked_until).getTime() : 0;

  if (lockedUntil && lockedUntil > Date.now()) {
    await sendTelegramMessage(chatId, 'Your onboarding is locked after multiple failed attempts. Contact admin.');
    return true;
  }

  if (!expiresAt || Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    await client
      .from('admin_user_onboarding')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', onboarding.id);
    await sendTelegramMessage(chatId, 'Onboarding OTP expired. Ask admin to reset your account.');
    return true;
  }

  const validOtp = verifyOnboardingOtp(onboarding.onboarding_token, command.otp, onboarding.otp_hash);
  if (!validOtp) {
    const nextAttempts = attempts + 1;
    const lockNow = nextAttempts >= maxAttempts;
    const lockUntilIso = lockNow ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null;

    await client
      .from('admin_user_onboarding')
      .update({
        attempts: nextAttempts,
        status: lockNow ? 'locked' : 'linked',
        locked_until: lockUntilIso,
        updated_at: new Date().toISOString(),
      })
      .eq('id', onboarding.id);

    if (lockNow) {
      await sendTelegramMessage(chatId, 'Too many invalid OTP attempts. Account is locked. Contact admin.');
    } else {
      await sendTelegramMessage(chatId, `Invalid OTP. Remaining attempts: ${Math.max(0, maxAttempts - nextAttempts)}.`);
    }
    return true;
  }

  const serviceClient = getServiceSupabaseClient();
  if (!serviceClient) {
    await sendTelegramMessage(chatId, 'Server setup incomplete. Missing service role key.');
    return true;
  }

  const updateAuth = await serviceClient.auth.admin.updateUserById(onboarding.admin_id, {
    password: command.newPassword,
    user_metadata: {
      username: command.username,
      telegram_user_id: userId,
    },
  });
  if (updateAuth.error) {
    await sendTelegramMessage(chatId, 'Failed to activate account. Please contact admin.');
    return true;
  }

  await client
    .from('admin_users')
    .update({
      telegram_user_id: userId,
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', onboarding.admin_id);

  await client
    .from('admin_user_onboarding')
    .update({
      status: 'completed',
      username: command.username,
      attempts: attempts + 1,
      completed_at: new Date().toISOString(),
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', onboarding.id);

  await client
    .from('admin_user_onboarding')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('admin_id', onboarding.admin_id)
    .in('status', ['pending', 'linked', 'reset'])
    .neq('id', onboarding.id);

  await sendTelegramMessage(chatId, 'Account activated successfully. You can now log in to the admin panel.');
  return true;
}

function fallbackLang(languageCode?: string): Lang {
  void languageCode;
  return 'am';
}

function menuLabels(lang: Lang) {
  if (lang === 'am') {
    return {
      trips: '\u1309\u12de\u12ce\u127d',
      bookings: '\u12e8\u12a5\u1294 \u1275\u12ac\u1276\u127d',
      help: '\u12a5\u1308\u12db',
      contact: '\u12a0\u1235\u1270\u12f3\u12f3\u122a',
      language: '\u124b\u1295\u124b',
    };
  }
  return {
    trips: 'Trips',
    bookings: 'My Bookings',
    help: 'Help',
    contact: 'Contact Admin',
    language: 'Language',
  };
}

function detectMenuLanguage(text: string): Lang | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const am = menuLabels('am');
  const en = menuLabels('en');
  const amValues = [am.trips, am.bookings, am.help, am.contact, am.language].map((value) => value.toLowerCase());
  const enValues = [en.trips, en.bookings, en.help, en.contact, en.language].map((value) => value.toLowerCase());

  if (amValues.includes(normalized)) return 'am';
  if (enValues.includes(normalized)) return 'en';
  return null;
}

function getMainMenu(lang: Lang) {
  const labels = menuLabels(lang);
  return {
    keyboard: [
      [{ text: labels.trips }, { text: labels.bookings }],
      [{ text: labels.help }, { text: labels.contact }],
      [{ text: labels.language }],
    ],
    resize_keyboard: true,
    persistent: true,
    one_time_keyboard: false,
  };
}

async function resolveUserLanguage(userId: number, fallback: string | undefined): Promise<Lang> {
  try {
    const client = await getPrimaryClient();
    const { data } = await client.from('telegram_users').select('language_code').eq('id', userId).maybeSingle();
    const fromDb = data?.language_code;
    if (fromDb === 'am' || fromDb === 'en') return fromDb;
    return fallbackLang(fallback);
  } catch {
    return fallbackLang(fallback);
  }
}

async function setUserLanguage(userId: number, lang: Lang) {
  const client = await getPrimaryClient();
  const first = await client
    .from('telegram_users')
    .upsert(
      {
        id: userId,
        language_code: lang,
        last_activity: new Date().toISOString(),
        last_interaction: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (!first.error) return;

  const second = await client.from('telegram_users').upsert(
    {
      id: userId,
      language_code: lang,
      last_activity: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (!second.error) return;

  await client.from('telegram_users').upsert(
    {
      id: userId,
      language_code: lang,
      last_interaction: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

async function upsertTelegramUser(message: TelegramMessage) {
  const from = message.message?.from;
  if (!from) return;

  const client = await getPrimaryClient();
  const { data: existing } = await client
    .from('telegram_users')
    .select('language_code')
    .eq('id', from.id)
    .maybeSingle();

  const resolvedLanguage: Lang =
    existing?.language_code === 'am' || existing?.language_code === 'en'
      ? existing.language_code
      : fallbackLang(from.language_code);

  const payload = {
    id: from.id,
    first_name: from.first_name,
    last_name: from.last_name || null,
    username: from.username || null,
    language_code: resolvedLanguage,
    last_activity: new Date().toISOString(),
    last_interaction: new Date().toISOString(),
  };

  const first = await client
    .from('telegram_users')
    .upsert(
      payload,
      { onConflict: 'id' }
    );

  if (!first.error) return;

  const { last_interaction: _omitInteraction, ...secondPayload } = payload;
  const second = await client.from('telegram_users').upsert(secondPayload, {
    onConflict: 'id',
  });
  if (!second.error) return;

  const { last_activity: _omitActivity, ...thirdPayload } = payload;
  await client.from('telegram_users').upsert(thirdPayload, {
    onConflict: 'id',
  });
}

async function ensureUserChannel(userId: number, username?: string) {
  try {
    const client = await getPrimaryClient();

    const firstAttempt = await client.from('telegram_channels').upsert(
      {
        telegram_user_id: userId,
        channel_id: userId,
        channel_name: `dm_${userId}`,
        channel_username: username ? `@${username}` : null,
        is_active: true,
      },
      { onConflict: 'channel_id' }
    );

    if (!firstAttempt.error) return;

    await client.from('telegram_channels').upsert(
      {
        channel_id: userId,
        channel_name: `dm_${userId}`,
        channel_type: 'private',
      },
      { onConflict: 'channel_id' }
    );
  } catch (error) {
    console.error('[telegram] ensureUserChannel error:', error);
  }
}

function formatDate(dateValue: string | null | undefined, lang: Lang) {
  const txt = i18n[lang];
  if (!dateValue) return txt.notAvailable;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return txt.notAvailable;
  return date.toLocaleString(lang === 'am' ? 'am-ET' : 'en-US');
}

function isTripExpired(dateValue?: string | null) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() > date.getTime();
}

function formatTripDetails(trip: TripRow, lang: Lang) {
  const txt = i18n[lang];
  return [
    `${trip.name || txt.tripFallbackName}`,
    `${txt.tripDetailsDestination}: ${trip.destination || txt.notAvailable}`,
    `${txt.tripDetailsDeparture}: ${formatDate(trip.departure_date, lang)}`,
    `${txt.tripDetailsPrice}: ${trip.price_per_ticket ?? 0} ETB`,
    `${txt.tripDetailsSeats}: ${trip.available_seats ?? 0}/${trip.total_seats ?? 0}`,
    trip.description ? `${txt.tripDetailsNotes}: ${trip.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function normalizeTrips(rows: TripRow[] | null | undefined): TripRow[] {
  return (rows || []).filter((row) => {
    return isBookableTripStatus(row.status ?? row.trip_status);
  });
}

function isBookableTripStatus(status: string | null | undefined): boolean {
  const normalized = String(status ?? 'active')
    .trim()
    .toLowerCase();
  if (!normalized || normalized === 'active') return true;

  return !['cancelled', 'canceled', 'completed', 'inactive', 'archived', 'closed'].includes(normalized);
}

function normalizePaymentMethod(raw: string): PaymentMethod | null {
  if (raw === 'bank' || raw === 'telebirr' || raw === 'telebirr_auto') return raw;
  return null;
}

async function queryTrips(): Promise<TripRow[]> {
  const client = await getPrimaryClient();
  const { data, error } = await client.from('trips').select('*').order('departure_date', { ascending: true });
  if (error) throw error;
  return normalizeTrips((data || []) as TripRow[]);
}

async function queryTripById(tripId: string): Promise<TripRow | null> {
  const client = await getPrimaryClient();
  const { data, error } = await client.from('trips').select('*').eq('id', tripId).maybeSingle();
  if (error) return null;
  const row = data as TripRow | null;
  if (!row) return null;
  return isBookableTripStatus(row.status ?? row.trip_status) ? row : null;
}

function manualPaymentPrompt(
  lang: Lang,
  method: PaymentMethod,
  trip?: TripRow | null,
  selectedBankIndex?: number
) {
  const txt = i18n[lang];
  const config = getTripManualPaymentConfig(trip || {});

  if (method === 'bank') {
    const lines: string[] = [txt.manualPaymentBankPrompt];
    if (config.bankAccounts.length) {
      if (
        Number.isInteger(selectedBankIndex) &&
        Number(selectedBankIndex) >= 0 &&
        Number(selectedBankIndex) < config.bankAccounts.length
      ) {
        const selected = config.bankAccounts[Number(selectedBankIndex)];
        lines.push(
          `Bank: ${selected.bank_name}`,
          `Account Name: ${selected.account_name}`,
          `Account No: ${selected.account_number}`
        );
      } else {
        lines.push('Available bank accounts:');
        lines.push(formatBankAccounts(config.bankAccounts));
      }
    } else {
      lines.push('Bank account details are not configured for this trip yet.');
    }

    if (config.manualPaymentNote) {
      lines.push(`Note: ${config.manualPaymentNote}`);
    }
    return lines.join('\n');
  }

  const telebirrLines: string[] = [txt.manualPaymentTelebirrPrompt];
  telebirrLines.push(
    `Account Name: ${config.telebirrManualAccountName || 'Not configured'}`,
    `Account Number: ${config.telebirrManualAccountNumber || 'Not configured'}`
  );
  if (config.manualPaymentNote) {
    telebirrLines.push(`Note: ${config.manualPaymentNote}`);
  }
  return telebirrLines.join('\n');
}

function bankSelectionPrompt(lang: Lang, trip: TripRow) {
  const config = getTripManualPaymentConfig(trip);
  if (!config.bankAccounts.length) {
    return manualPaymentPrompt(lang, 'bank', trip);
  }

  const title =
    lang === 'am'
      ? 'á‰£áŠ•áŠ­ á‹­áˆáˆ¨áŒ¡á¢ áŠ¨áŠ­áá‹« á‰ áŠ‹áˆ‹ á‹°áˆ¨áˆ°áŠ áŠ¨áˆªáˆáˆ¨áŠ•áˆµ áŒ‹áˆ­ á‹­áˆ‹áŠ©á¢'
      : 'Choose a bank account, then pay and upload receipt with reference.';
  return `${title}\n\n${formatBankAccounts(config.bankAccounts)}`;
}

function bankSelectionKeyboard(lang: Lang, trip: TripRow) {
  const config = getTripManualPaymentConfig(trip);
  const buttons = config.bankAccounts.map((account, idx) => [
    {
      text: `${idx + 1}. ${account.bank_name}`,
      callback_data: `banksel:${trip.id}:${idx}`,
    },
  ]);
  buttons.push([{ text: i18n[lang].backToTrips, callback_data: 'list:trips' }]);

  return { inline_keyboard: buttons };
}

function localizeTicketStatus(status: string | null | undefined, lang: Lang) {
  const normalized = String(status || '').toLowerCase();
  const map =
    lang === 'am'
      ? {
        pending: '\u1260\u1218\u1320\u1263\u1260\u1245 \u120b\u12ed',
        confirmed: '\u1338\u12f5\u124b\u120d',
        cancelled: '\u1270\u1230\u122d\u12df\u120d',
        used: '\u1325\u1245\u121d \u120b\u12ed \u12cd\u120f\u120d',
        expired: '\u1246\u12ed\u1277\u120d',
      }
      : {
        pending: 'Pending',
        confirmed: 'Confirmed',
        cancelled: 'Cancelled',
        used: 'Used',
        expired: 'EXPIRED',
      };

  return map[normalized as keyof typeof map] || status || i18n[lang].notAvailable;
}

async function openBookingSession(
  userId: number,
  tripId: string,
  paymentMethod: PaymentMethod,
  quantity = 1,
  status: BookingSessionStatus = 'awaiting_receipt'
) {
  const client = await getPrimaryClient();

  // Close previous open sessions for this user.
  await client
    .from('telegram_booking_sessions')
    .update({ status: 'cancelled' })
    .eq('telegram_user_id', userId)
    .in('status', ['awaiting_receipt', 'awaiting_auto_payment']);

  const { data, error } = await client
    .from('telegram_booking_sessions')
    .insert({
      telegram_user_id: userId,
      trip_id: tripId,
      payment_method: paymentMethod,
      quantity,
      status,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as BookingSessionRow;
}

async function getOpenBookingSession(
  userId: number,
  statuses: BookingSessionStatus[] = ['awaiting_receipt']
): Promise<BookingSessionRow | null> {
  const client = await getPrimaryClient();
  const { data, error } = await client
    .from('telegram_booking_sessions')
    .select('*')
    .eq('telegram_user_id', userId)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as BookingSessionRow | null) || null;
}

async function closeBookingSession(sessionId: string) {
  const client = await getPrimaryClient();
  await client.from('telegram_booking_sessions').update({ status: 'completed' }).eq('id', sessionId);
}

function extractReference(text: string | undefined): string | null {
  if (!text) return null;
  const tokens = text.match(/[A-Za-z0-9_-]{3,80}/g) || [];
  return tokens[0] || null;
}

async function resolveAttachment(message: TelegramMessage): Promise<TelegramAttachment | null> {
  const msg = message.message;
  if (!msg) return null;

  const photos = msg.photo;
  const document = msg.document as { file_id?: string; file_name?: string } | undefined;

  let fileId = '';
  let fileName = '';
  if (photos && photos.length > 0) {
    const last = photos[photos.length - 1] as { file_id?: string };
    fileId = last?.file_id || '';
    fileName = `photo_${Date.now()}.jpg`;
  } else if (document?.file_id) {
    fileId = document.file_id;
    fileName = document.file_name || `doc_${Date.now()}`;
  } else {
    return null;
  }

  const fileMeta = await getFile(fileId);
  const filePath = fileMeta?.file_path as string | undefined;
  const fileUrl =
    TELEGRAM_BOT_TOKEN && filePath
      ? `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`
      : null;

  return { fileId, fileName, fileUrl };
}

function buildReceiptHash(reference: string, userId: number, fileId: string) {
  return createHash('sha256')
    .update(`${reference}:${userId}:${fileId}:${Date.now()}`)
    .digest('hex');
}

function buildTicketNumberUnique(receiptId: string, index: number) {
  const base = generateTicketNumber(receiptId).replace(/[^A-Z0-9-]/g, '');
  return `${base}-${index + 1}-${Math.floor(Math.random() * 90 + 10)}`;
}

async function createPendingReceiptAndTickets(
  userId: number,
  session: BookingSessionRow,
  reference: string,
  attachment: TelegramAttachment
) {
  const client = await getPrimaryClient();
  const trip = await queryTripById(session.trip_id);
  if (!trip) throw new Error('Trip is not available');

  const quantity = Number(session.quantity || 1);
  const pricePerTicket = Number(trip.price_per_ticket || 0);
  const totalAmount = pricePerTicket * quantity;
  const paymentMethod = session.payment_method;
  const uniqueReference = `${reference}-${Date.now().toString().slice(-6)}`;
  const receiptHash = buildReceiptHash(reference, userId, attachment.fileId);

  const { data: receipt, error: receiptError } = await client
    .from('receipts')
    .insert({
      reference_number: uniqueReference,
      telegram_user_id: userId,
      payment_method: paymentMethod,
      amount_paid: totalAmount,
      currency: 'ETB',
      quantity,
      receipt_file_url: attachment.fileUrl,
      receipt_file_name: attachment.fileName,
      receipt_hash: receiptHash,
      approval_status: 'pending',
    })
    .select('*')
    .single();

  if (receiptError || !receipt) throw receiptError || new Error('Unable to create receipt');

  const ticketsToInsert = Array.from({ length: quantity }).map((_, idx) => ({
    ticket_number: buildTicketNumberUnique(receipt.id, idx),
    serial_number: generateTripSerialNumber(trip.name, trip.id, idx),
    receipt_id: receipt.id,
    trip_id: session.trip_id,
    telegram_user_id: userId,
    purchase_price: pricePerTicket,
    ticket_status: 'pending',
  }));

  const { data: insertedTickets, error: ticketsError } = await client
    .from('tickets')
    .insert(ticketsToInsert)
    .select('id');
  if (ticketsError) throw ticketsError;
  if (!insertedTickets || insertedTickets.length !== quantity) {
    throw new Error(`Ticket generation mismatch. Expected ${quantity}, got ${insertedTickets?.length || 0}`);
  }

  await closeBookingSession(session.id);
  return receipt.reference_number as string;
}

async function sendTripsGui(chatId: number, lang: Lang) {
  const txt = i18n[lang];
  try {
    const trips = await queryTrips();

    if (!trips.length) {
      await sendTelegramMessage(chatId, txt.noTrips, {
        reply_markup: getMainMenu(lang),
      });
      return;
    }

    await sendTelegramMessage(chatId, txt.tripsTitle, {
      reply_markup: {
        inline_keyboard: trips.slice(0, 10).map((trip, idx) => [
          {
            text: `${idx + 1}. ${trip.name || txt.tripFallbackName} (${trip.available_seats ?? 0} ${txt.seatUnit})`,
            callback_data: `trip:${trip.id}`,
          },
        ]),
      },
    });
  } catch (error) {
    console.error('[telegram] sendTripsGui error:', error);
    await sendTelegramMessage(chatId, txt.noTrips, {
      reply_markup: getMainMenu(lang),
    });
  }
}

async function sendBookings(chatId: number, userId: number, lang: Lang) {
  const txt = i18n[lang];
  try {
    const client = await getPrimaryClient();
    const { data: tickets, error } = await client
      .from('tickets')
      .select(
        `
        id,
        ticket_number,
        serial_number,
        ticket_status,
        trips (name, destination, departure_date),
        receipts (reference_number, approval_status)
      `
      )
      .eq('telegram_user_id', userId)
      .order('created_at', { ascending: false });

    if (error || !tickets || tickets.length === 0) {
      await sendTelegramMessage(chatId, txt.bookingsNone, {
        reply_markup: getMainMenu(lang),
      });
      return;
    }

    let body = txt.bookingsTitle;
    tickets.forEach((ticket: any, idx: number) => {
      const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
      const receipt = Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts;
      body += `\n${idx + 1}. ${ticket.serial_number}\n`;
      body += `   ${trip?.name || txt.tripFallbackName} - ${trip?.destination || txt.notAvailable}\n`;
      body += `   ${txt.statusLabel}: ${localizeTicketStatus(ticket.ticket_status, lang)}\n`;
      body += `   ${txt.refShortLabel}: ${receipt?.reference_number || txt.notAvailable}\n`;
    });

    await sendTelegramMessage(chatId, body, {
      reply_markup: getMainMenu(lang),
    });

    const appBaseUrl = resolvePublicAppBaseURL();
    if (!appBaseUrl) return;

    const visualCandidates = (tickets as any[]).filter((ticket) => {
      const receipt = Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts;
      const status = String(ticket.ticket_status || '').toLowerCase();
      const receiptApproval = String(receipt?.approval_status || '').toLowerCase();
      return status === 'confirmed' || receiptApproval === 'approved';
    });

    if (!visualCandidates.length) return;

    const maxVisualCards = 6;
    for (const ticket of visualCandidates.slice(0, maxVisualCards)) {
      const trip = Array.isArray(ticket.trips) ? ticket.trips[0] : ticket.trips;
      const expired = isTripExpired(trip?.departure_date);
      const cardUrl = `${appBaseUrl}/api/tickets/${ticket.id}/card?serial=${encodeURIComponent(ticket.serial_number || '')}`;
      const captionParts = [
        `${txt.tripFallbackName}: ${trip?.name || txt.tripFallbackName}`,
        `${txt.refShortLabel}: ${(Array.isArray(ticket.receipts) ? ticket.receipts[0] : ticket.receipts)?.reference_number || txt.notAvailable
        }`,
        `${txt.ticketLabel}: ${ticket.ticket_number || ticket.serial_number || txt.notAvailable}`,
      ];
      if (expired) {
        captionParts.push(`${txt.statusLabel}: ${txt.expiredStatusLabel}`);
      }

      const sent = await sendTelegramPhoto(chatId, cardUrl, captionParts.join('\n'));
      if (!sent) {
        await sendTelegramMessage(chatId, txt.openTicketCard(cardUrl), {
          reply_markup: getMainMenu(lang),
        });
      }
    }

    if (visualCandidates.length > maxVisualCards) {
      await sendTelegramMessage(
        chatId,
        txt.visualTicketsSummary(maxVisualCards, visualCandidates.length),
        { reply_markup: getMainMenu(lang) }
      );
    }
  } catch (error) {
    console.error('[telegram] sendBookings error:', error);
    await sendTelegramMessage(chatId, txt.bookingsNone, {
      reply_markup: getMainMenu(lang),
    });
  }
}

function isTripsIntent(text: string) {
  const normalized = text.trim().toLowerCase();
  const en = menuLabels('en');
  const am = menuLabels('am');
  return (
    normalized === '/trips' ||
    normalized.startsWith('/trips') ||
    normalized === 'trips' ||
    normalized === en.trips.toLowerCase() ||
    normalized === am.trips.toLowerCase()
  );
}

function isBookingsIntent(text: string) {
  const normalized = text.trim().toLowerCase();
  const en = menuLabels('en');
  const am = menuLabels('am');
  return (
    normalized === '/bookings' ||
    normalized.startsWith('/bookings') ||
    normalized === 'my bookings' ||
    normalized === 'bookings' ||
    normalized === en.bookings.toLowerCase() ||
    normalized === am.bookings.toLowerCase()
  );
}

function isHelpIntent(text: string) {
  const normalized = text.trim().toLowerCase();
  const en = menuLabels('en');
  const am = menuLabels('am');
  return (
    normalized === '/help' ||
    normalized.startsWith('/help') ||
    normalized === 'help' ||
    normalized === en.help.toLowerCase() ||
    normalized === am.help.toLowerCase()
  );
}

function isContactIntent(text: string) {
  const normalized = text.trim().toLowerCase();
  const en = menuLabels('en');
  const am = menuLabels('am');
  return (
    normalized.startsWith('/contact_admin') ||
    normalized === 'contact admin' ||
    normalized === 'contact' ||
    normalized === en.contact.toLowerCase() ||
    normalized === am.contact.toLowerCase()
  );
}

function isLanguageIntent(text: string) {
  const normalized = text.trim().toLowerCase();
  const en = menuLabels('en');
  const am = menuLabels('am');
  return (
    normalized === '/lang' ||
    normalized === 'language' ||
    normalized === en.language.toLowerCase() ||
    normalized === am.language.toLowerCase()
  );
}

function getMiniAppURL() {
  const base = resolvePublicAppBaseURL();
  if (!base) return '';
  return `${base}/miniapp`;
}

function miniAppButtonText(lang: Lang) {
  if (lang === 'am') return '\u121a\u1292 \u12a0\u1355 \u12ad\u1348\u1275';
  return 'Open Mini App';
}

async function sendMiniAppEntry(chatId: number, lang: Lang) {
  const url = getMiniAppURL();
  if (!url) return;

  await sendTelegramMessage(
    chatId,
    lang === 'am'
      ? '\u130d\u12de\u12ce\u127d \u1218\u121d\u1228\u1325 \u12a5\u1293 \u1240\u1325\u1273 \u1218\u12ab\u1348\u120d \u1208\u1218\u1300\u1218\u122d \u121a\u1292 \u12a0\u1355\u1295 \u12ad\u1348\u1275\u1362'
      : 'Open the Mini App to browse trips and start booking.',
    {
      reply_markup: {
        inline_keyboard: [[{ text: miniAppButtonText(lang), web_app: { url } }]],
      },
    }
  );
}

async function handleStartCommand(message: TelegramMessage, lang: Lang, startPayload = '') {
  const chatId = message.message!.chat.id;
  const from = message.message!.from;
  const txt = i18n[lang];

  await upsertTelegramUser(message);
  await ensureUserChannel(from.id, from.username);

  if (startPayload) {
    const onboardingHandled = await handleOnboardingStart(chatId, from.id, startPayload);
    if (onboardingHandled) return;
  }

  await sendTelegramMessage(chatId, txt.welcome(from.first_name), {
    reply_markup: getMainMenu(lang),
  });

  await sendMiniAppEntry(chatId, lang);
}

async function handleHelpCommand(chatId: number, lang: Lang) {
  await sendTelegramMessage(chatId, i18n[lang].help);
  await sendMiniAppEntry(chatId, lang);
}

async function handleReceiptUploadIfPending(message: TelegramMessage, lang: Lang): Promise<boolean> {
  const msg = message.message;
  if (!msg) return false;
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const txt = i18n[lang];

  const hasAttachment = Boolean((msg.photo && msg.photo.length > 0) || msg.document);
  if (!hasAttachment) return false;

  const session = await getOpenBookingSession(userId, ['awaiting_receipt']);
  if (!session) return false;

  const reference = extractReference(msg.caption || msg.text);
  if (!reference) {
    await sendTelegramMessage(chatId, txt.receiptNeedsReference, {
      reply_markup: getMainMenu(lang),
    });
    return true;
  }

  const attachment = await resolveAttachment(message);
  if (!attachment) {
    await sendTelegramMessage(chatId, txt.receiptSaveFailed, {
      reply_markup: getMainMenu(lang),
    });
    return true;
  }

  try {
    const savedReference = await createPendingReceiptAndTickets(userId, session, reference, attachment);
    await sendTelegramMessage(chatId, `${txt.receiptSaved}\n${txt.referenceLabel}: ${savedReference}`, {
      reply_markup: getMainMenu(lang),
    });
  } catch (error) {
    console.error('[telegram] receipt upload flow error:', error);
    await sendTelegramMessage(chatId, txt.receiptSaveFailed, {
      reply_markup: getMainMenu(lang),
    });
  }

  return true;
}

async function handleAutoPaidCommand(chatId: number, userId: number, lang: Lang, text: string) {
  const txt = i18n[lang];
  const parts = text.trim().split(/\s+/);
  const reference = parts[1] || '';

  if (!reference) {
    await sendTelegramMessage(chatId, txt.autoPaymentRefMissing, {
      reply_markup: getMainMenu(lang),
    });
    return;
  }

  const session = await getOpenBookingSession(userId, ['awaiting_auto_payment']);
  if (!session) {
    await sendTelegramMessage(chatId, txt.autoPaymentNoSession, {
      reply_markup: getMainMenu(lang),
    });
    return;
  }

  try {
    const savedReference = await createPendingReceiptAndTickets(
      userId,
      {
        ...session,
        payment_method: 'telebirr_auto',
      },
      reference,
      {
        fileId: `auto_${reference}`,
        fileName: `telebirr_auto_${reference}.txt`,
        fileUrl: null,
      }
    );
    await sendTelegramMessage(chatId, `${txt.autoPaymentSaved}\n${txt.referenceLabel}: ${savedReference}`, {
      reply_markup: getMainMenu(lang),
    });
  } catch (error) {
    console.error('[telegram] auto-paid flow error:', error);
    await sendTelegramMessage(chatId, txt.receiptSaveFailed, {
      reply_markup: getMainMenu(lang),
    });
  }
}

async function handleCallbackQuery(update: TelegramMessage) {
  const callback = update.callback_query;
  if (!callback) return;

  const queryId = callback.id;
  const callbackData = callback.data || '';
  const chatId = callback.message?.chat?.id || callback.from.id;
  const messageId = callback.message?.message_id;
  const lang = await resolveUserLanguage(callback.from.id, callback.from.language_code);
  const txt = i18n[lang];

  if (callbackData === 'list:trips') {
    await answerCallbackQuery(queryId, txt.refreshTrips);
    await sendTripsGui(chatId, lang);
    return;
  }

  if (callbackData === 'cancel:booking') {
    const session = await getOpenBookingSession(callback.from.id, ['awaiting_receipt', 'awaiting_auto_payment']);
    if (!session) {
      await answerCallbackQuery(queryId, txt.bookingAlreadyClosed, true);
      return;
    }

    const client = await getPrimaryClient();
    await client.from('telegram_booking_sessions').update({ status: 'cancelled' }).eq('id', session.id);

    await answerCallbackQuery(queryId, txt.bookingCancelled);
    await sendTelegramMessage(chatId, txt.bookingCancelled, {
      reply_markup: getMainMenu(lang),
    });
    return;
  }

  if (callbackData.startsWith('trip:')) {
    const tripId = callbackData.split(':')[1];
    const trip = await queryTripById(tripId);
    if (!trip) {
      await answerCallbackQuery(queryId, txt.tripNotFound, true);
      return;
    }

    const details = formatTripDetails(trip, lang);
    const markup = {
      inline_keyboard: [
        [{ text: txt.payTelebirrAuto, callback_data: `pay:${trip.id}:telebirr_auto` }],
        [{ text: txt.payTelebirr, callback_data: `pay:${trip.id}:telebirr` }],
        [{ text: txt.payBank, callback_data: `pay:${trip.id}:bank` }],
        [{ text: txt.backToTrips, callback_data: 'list:trips' }],
      ],
    };

    if (messageId) {
      await editMessageText(chatId, messageId, `${details}\n\n${txt.choosePayment}`, {
        reply_markup: markup,
      });
    } else {
      await sendTelegramMessage(chatId, `${details}\n\n${txt.choosePayment}`, {
        reply_markup: markup,
      });
    }

    await answerCallbackQuery(queryId, txt.tripLoaded);
    return;
  }

  if (callbackData.startsWith('banksel:')) {
    const parts = callbackData.split(':');
    const tripId = parts[1];
    const bankIndex = Number(parts[2] || -1);

    if (!tripId || !Number.isInteger(bankIndex) || bankIndex < 0) {
      await answerCallbackQuery(queryId, txt.unsupportedAction, true);
      return;
    }

    const trip = await queryTripById(tripId);
    if (!trip) {
      await answerCallbackQuery(queryId, txt.tripNotFound, true);
      return;
    }

    const config = getTripManualPaymentConfig(trip);
    if (bankIndex >= config.bankAccounts.length) {
      await answerCallbackQuery(queryId, txt.unsupportedAction, true);
      return;
    }

    try {
      await openBookingSession(callback.from.id, tripId, 'bank', 1, 'awaiting_receipt');
    } catch (error) {
      const message = String((error as any)?.message || '').toLowerCase();
      if (message.includes('telegram_booking_sessions')) {
        await answerCallbackQuery(queryId, txt.migrationRequired, true);
      } else {
        await answerCallbackQuery(queryId, txt.receiptSaveFailed, true);
      }
      return;
    }

    await answerCallbackQuery(queryId, txt.paySelected);
    await sendTelegramMessage(chatId, `${manualPaymentPrompt(lang, 'bank', trip, bankIndex)}\n\n${txt.uploadReceiptPrompt}`, {
      reply_markup: {
        inline_keyboard: [[{ text: txt.cancelBooking, callback_data: 'cancel:booking' }]],
      },
    });
    return;
  }

  if (callbackData.startsWith('pay:')) {
    const parts = callbackData.split(':');
    const tripId = parts[1];
    const method = normalizePaymentMethod(parts[2]);

    if (!tripId || !method) {
      await answerCallbackQuery(queryId, txt.unsupportedAction, true);
      return;
    }

    const trip = await queryTripById(tripId);
    if (!trip) {
      await answerCallbackQuery(queryId, txt.tripNotFound, true);
      return;
    }

    if (method === 'bank') {
      const config = getTripManualPaymentConfig(trip);
      if (config.bankAccounts.length > 1) {
        const prompt = bankSelectionPrompt(lang, trip);
        const markup = bankSelectionKeyboard(lang, trip);

        if (messageId) {
          await editMessageText(chatId, messageId, prompt, { reply_markup: markup });
        } else {
          await sendTelegramMessage(chatId, prompt, { reply_markup: markup });
        }
        await answerCallbackQuery(queryId, txt.paySelected);
        return;
      }
    }

    if (method === 'telebirr_auto') {
      await answerCallbackQuery(queryId, txt.telebirrAutoComingSoon, true);
      await sendTelegramMessage(chatId, txt.telebirrAutoComingSoon, {
        reply_markup: getMainMenu(lang),
      });
      return;
    }

    try {
      await openBookingSession(callback.from.id, tripId, method, 1, 'awaiting_receipt');
    } catch (error) {
      const message = String((error as any)?.message || '').toLowerCase();
      if (message.includes('telegram_booking_sessions')) {
        await answerCallbackQuery(queryId, txt.migrationRequired, true);
      } else {
        await answerCallbackQuery(queryId, txt.receiptSaveFailed, true);
      }
      return;
    }

    await answerCallbackQuery(queryId, txt.paySelected);

    await sendTelegramMessage(chatId, `${manualPaymentPrompt(lang, method, trip)}\n\n${txt.uploadReceiptPrompt}`, {
      reply_markup: {
        inline_keyboard: [[{ text: txt.cancelBooking, callback_data: 'cancel:booking' }]],
      },
    });
    return;
  }

  await answerCallbackQuery(queryId, txt.unsupportedAction);
}

async function handleMessage(update: TelegramMessage) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;

  await upsertTelegramUser(update);
  await ensureUserChannel(userId, msg.from.username);

  const lang = await resolveUserLanguage(userId, msg.from.language_code);

  if (await handleReceiptUploadIfPending(update, lang)) {
    return;
  }

  const rawText = String(msg.text || '').trim();
  const normalized = rawText.toLowerCase();
  const menuLang = detectMenuLanguage(normalized);
  const effectiveLang: Lang = menuLang || lang;
  const txt = i18n[effectiveLang];

  if (menuLang && menuLang !== lang) {
    await setUserLanguage(userId, menuLang);
  }

  if (normalized === '/start' || normalized.startsWith('/start')) {
    const startPayload = extractStartPayload(rawText);
    await handleStartCommand(update, lang, startPayload);
    return;
  }

  if (normalized.startsWith('/activate')) {
    if (await handleOnboardingActivate(chatId, userId, rawText)) return;
    return;
  }

  if (normalized === '/app' || normalized.startsWith('/app')) {
    await sendMiniAppEntry(chatId, effectiveLang);
    return;
  }

  if (isHelpIntent(normalized)) {
    await handleHelpCommand(chatId, effectiveLang);
    return;
  }

  if (isTripsIntent(normalized)) {
    await sendMiniAppEntry(chatId, effectiveLang);
    return;
  }

  if (isBookingsIntent(normalized)) {
    await sendMiniAppEntry(chatId, effectiveLang);
    return;
  }

  if (isContactIntent(normalized)) {
    await sendTelegramMessage(chatId, txt.contactAdmin);
    await sendMiniAppEntry(chatId, effectiveLang);
    return;
  }

  if (isLanguageIntent(normalized)) {
    const nextLang: Lang = effectiveLang === 'en' ? 'am' : 'en';
    await setUserLanguage(userId, nextLang);
    await sendTelegramMessage(chatId, i18n[nextLang].languageChanged, {
      reply_markup: getMainMenu(nextLang),
    });
    await sendMiniAppEntry(chatId, nextLang);
    return;
  }

  if (normalized.startsWith('/paid')) {
    await sendMiniAppEntry(chatId, effectiveLang);
    return;
  }

  await sendTelegramMessage(chatId, txt.menuPrompt);
  await sendMiniAppEntry(chatId, effectiveLang);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    if (!verifyTelegramWebhook()) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const data: TelegramMessage = JSON.parse(body);

    console.log('[telegram] Webhook received:', {
      update_id: data.update_id,
      type: data.message ? 'message' : data.callback_query ? 'callback' : 'unknown',
    });

    if (data.message) {
      await handleMessage(data);
    } else if (data.callback_query) {
      await handleCallbackQuery(data);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[telegram] Webhook error:', error);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: 'Telegram webhook is running',
  });
}
