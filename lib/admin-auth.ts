import { AdminUser } from '@/lib/types';

const ADMIN_SESSION_KEY = 'tickethub_admin_session';

export interface AdminSession {
  admin: AdminUser;
  token: string;
  expiresAt: number;
}

export type AdminLoginStartResult =
  | {
      success: true;
      requiresOtp: true;
      challengeId: string;
      expiresInSeconds: number;
      telegram: string;
      admin: AdminUser;
    }
  | {
      success: true;
      requiresOtp: false;
      admin: AdminUser;
      expiresAt: number;
    }
  | {
      success: false;
      error: string;
    };

function toAdminUser(input: any): AdminUser {
  return {
    id: String(input?.id || ''),
    email: String(input?.email || ''),
    name: String(input?.name || input?.email || ''),
    role: (String(input?.role || 'admin') as AdminUser['role']),
    is_active: true,
    created_at: String(input?.created_at || new Date().toISOString()),
    last_login: String(input?.last_login || ''),
  };
}

function persistAdminSession(admin: AdminUser, expiresAt: number) {
  const session: AdminSession = {
    admin,
    token: 'cookie',
    expiresAt,
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  }

  return session;
}

export async function adminLogin(email: string, password: string): Promise<AdminLoginStartResult> {
  try {
    const response = await fetch('/api/admin/auth/login/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      return {
        success: false,
        error: String(json?.error || 'Invalid email or password.'),
      };
    }

    const admin = toAdminUser(json.admin || {});
    if (json.requiresOtp) {
      return {
        success: true,
        requiresOtp: true,
        challengeId: String(json.challengeId || ''),
        expiresInSeconds: Number(json.expiresInSeconds || 0),
        telegram: String(json.telegram || ''),
        admin,
      };
    }

    const expiresAt = Number(json.expiresAt || Date.now() + 12 * 60 * 60 * 1000);
    persistAdminSession(admin, expiresAt);
    return {
      success: true,
      requiresOtp: false,
      admin,
      expiresAt,
    };
  } catch (error) {
    console.error('[admin-auth] Login error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }
}

export async function adminVerifyOtp(challengeId: string, otp: string) {
  try {
    const response = await fetch('/api/admin/auth/login/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ challengeId, otp }),
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      return {
        success: false,
        error: String(json?.error || 'Invalid verification code.'),
      };
    }

    const admin = toAdminUser(json.admin || {});
    const expiresAt = Number(json.expiresAt || Date.now() + 12 * 60 * 60 * 1000);
    persistAdminSession(admin, expiresAt);

    return {
      success: true,
      admin,
      expiresAt,
    };
  } catch (error) {
    console.error('[admin-auth] OTP verify error:', error);
    return {
      success: false,
      error: 'Failed to verify OTP code.',
    };
  }
}

export async function refreshAdminSession() {
  try {
    const response = await fetch('/api/admin/auth/session', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });

    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json?.success) {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(ADMIN_SESSION_KEY);
      }
      return null;
    }

    const admin = toAdminUser(json.admin || {});
    const expiresAt = Number(json.expiresAt || Date.now() + 60 * 60 * 1000);
    return persistAdminSession(admin, expiresAt);
  } catch (error) {
    console.error('[admin-auth] refresh session error:', error);
    return null;
  }
}

export async function adminLogout(): Promise<void> {
  try {
    await fetch('/api/admin/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error('[admin-auth] Logout API error:', error);
  } finally {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(ADMIN_SESSION_KEY);
    }
  }
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const sessionStr = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!sessionStr) return null;

    const session = JSON.parse(sessionStr) as AdminSession;

    if (session.expiresAt < Date.now()) {
      localStorage.removeItem(ADMIN_SESSION_KEY);
      return null;
    }

    return session;
  } catch (error) {
    console.error('[admin-auth] Get session error:', error);
    return null;
  }
}

export function isAdminAuthenticated(): boolean {
  const session = getAdminSession();
  return !!session?.admin;
}
