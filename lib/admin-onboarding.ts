import 'server-only';

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const ONBOARDING_MAX_ATTEMPTS = 3;
export const ONBOARDING_OTP_TTL_SECONDS = 30 * 60;

function getOnboardingSecret() {
  const secret =
    String(process.env.ADMIN_OTP_SECRET || '').trim() ||
    String(process.env.ADMIN_SESSION_SECRET || '').trim() ||
    String(process.env.NEXTAUTH_SECRET || '').trim() ||
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!secret || secret.length < 24) {
    throw new Error('ADMIN_OTP_SECRET is missing or too short.');
  }

  return secret;
}

export function generateOnboardingToken() {
  return randomBytes(16).toString('hex');
}

export function generateOnboardingOtp() {
  return String(randomInt(100000, 1000000));
}

export function hashOnboardingOtp(token: string, otp: string) {
  const normalizedToken = String(token || '').trim();
  const normalizedOtp = String(otp || '').trim();

  return createHash('sha256')
    .update(`onboarding:${normalizedToken}:${normalizedOtp}:${getOnboardingSecret()}`)
    .digest('hex');
}

export function verifyOnboardingOtp(token: string, otp: string, hash: string) {
  const calculated = Buffer.from(hashOnboardingOtp(token, otp), 'utf8');
  const stored = Buffer.from(String(hash || ''), 'utf8');
  if (calculated.length !== stored.length) return false;
  return timingSafeEqual(calculated, stored);
}

async function resolveBotUsername() {
  const fromEnv = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
  if (fromEnv) return fromEnv;

  const botToken = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!botToken) return '';

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/getMe`, {
      cache: 'no-store',
    });
    if (!response.ok) return '';
    const payload = await response.json().catch(() => ({}));
    const username = String(payload?.result?.username || '').trim().replace(/^@/, '');
    return username;
  } catch {
    return '';
  }
}

export async function getBotStartLink(token: string) {
  const botUsername = await resolveBotUsername();
  if (!botUsername) return '';
  return `https://t.me/${botUsername}?start=onboard_${token}`;
}

export async function buildOnboardingTelegramMessage(input: {
  name: string;
  token: string;
  otp: string;
  expiresInMinutes: number;
}) {
  const botUsername = await resolveBotUsername();
  const botStartLink = botUsername ? `https://t.me/${botUsername}?start=onboard_${input.token}` : '';
  const safeName = String(input.name || 'Admin User').trim() || 'Admin User';

  const lines = [
    `TicketHub admin onboarding for ${safeName}`,
    '',
    `One-time code: ${input.otp}`,
    `Expires in: ${input.expiresInMinutes} minutes`,
    '',
    botStartLink
      ? `1) Open: ${botStartLink}`
      : '1) Bot username is not configured. Set TELEGRAM_BOT_USERNAME, then regenerate onboarding.',
    botUsername ? `Or send in private chat: /start onboard_${input.token}` : '',
    '2) In chat, send: /activate <otp> <username> <new_password>',
    'Example: /activate 123456 teddy_admin StrongPass!234',
    '',
    'If this was not expected, ignore this message.',
  ];

  return {
    botStartLink,
    text: lines.join('\n'),
  };
}
