import 'server-only';

import { createHmac, timingSafeEqual, randomUUID } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const ADMIN_SESSION_COOKIE_NAME = 'th_admin_session';
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export type AdminSessionClaims = {
  adminId: string;
  email: string;
  role: string;
  name: string;
  iat: number;
  exp: number;
  jti: string;
};

function getSessionSecret() {
  const secret =
    String(process.env.ADMIN_SESSION_SECRET || '').trim() ||
    String(process.env.NEXTAUTH_SECRET || '').trim() ||
    String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!secret || secret.length < 24) {
    throw new Error(
      'ADMIN_SESSION_SECRET is missing or too short. Set a strong secret (>=24 chars).'
    );
  }

  return secret;
}

function encodeBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signValue(value: string) {
  return createHmac('sha256', getSessionSecret()).update(value).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAdminSessionToken(input: {
  adminId: string;
  email: string;
  role: string;
  name?: string;
  ttlSeconds?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.floor(input.ttlSeconds || DEFAULT_SESSION_TTL_SECONDS));
  const payload: AdminSessionClaims = {
    adminId: String(input.adminId || '').trim(),
    email: String(input.email || '').trim().toLowerCase(),
    role: String(input.role || 'admin').trim(),
    name: String(input.name || '').trim(),
    iat: now,
    exp: now + ttl,
    jti: randomUUID(),
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signValue(encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: payload.exp * 1000,
  };
}

export function verifyAdminSessionToken(token: string | null | undefined): AdminSessionClaims | null {
  const raw = String(token || '').trim();
  if (!raw) return null;

  const parts = raw.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, receivedSignature] = parts;
  const expectedSignature = signValue(encodedPayload);
  if (!safeEqual(receivedSignature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<AdminSessionClaims>;
    const adminId = String(payload.adminId || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const role = String(payload.role || '').trim();
    const name = String(payload.name || '').trim();
    const iat = Number(payload.iat || 0);
    const exp = Number(payload.exp || 0);
    const jti = String(payload.jti || '').trim();

    if (!adminId || !email || !role || !iat || !exp || !jti) return null;
    if (!Number.isFinite(iat) || !Number.isFinite(exp)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) return null;

    return { adminId, email, role, name, iat, exp, jti };
  } catch {
    return null;
  }
}

export function getAdminSessionTokenFromRequest(request: NextRequest | Request | any): string {
  const cookieValue = request?.cookies?.get?.(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (cookieValue) return String(cookieValue);

  const cookieHeader = String(request?.headers?.get?.('cookie') || '');
  if (!cookieHeader) return '';

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...rest] = pair.split('=');
    if (String(key || '').trim() !== ADMIN_SESSION_COOKIE_NAME) continue;
    return decodeURIComponent(rest.join('='));
  }

  return '';
}

export function setAdminSessionCookie(response: NextResponse, token: string, expiresAtMs: number) {
  const maxAge = Math.max(60, Math.floor((expiresAtMs - Date.now()) / 1000));
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearAdminSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
