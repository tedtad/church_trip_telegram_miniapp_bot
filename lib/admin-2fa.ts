import 'server-only';

import { createHash, randomInt, timingSafeEqual } from 'crypto';

function getOtpSecret() {
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

export function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

export function hashOtpCode(challengeId: string, code: string) {
  const normalizedChallenge = String(challengeId || '').trim();
  const normalizedCode = String(code || '').trim();
  return createHash('sha256')
    .update(`${normalizedChallenge}:${normalizedCode}:${getOtpSecret()}`)
    .digest('hex');
}

export function verifyOtpCodeHash(challengeId: string, providedCode: string, storedHash: string) {
  const calculated = Buffer.from(hashOtpCode(challengeId, providedCode), 'utf8');
  const stored = Buffer.from(String(storedHash || ''), 'utf8');
  if (calculated.length !== stored.length) return false;
  return timingSafeEqual(calculated, stored);
}

export function maskTelegramId(value: string | number | null | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length <= 4) return raw;
  return `${'*'.repeat(Math.max(2, raw.length - 4))}${raw.slice(-4)}`;
}
