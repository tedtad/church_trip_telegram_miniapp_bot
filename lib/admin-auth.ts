import { createClient } from '@/lib/supabase/client';
import { AdminUser } from '@/lib/types';

const ADMIN_SESSION_KEY = 'tickethub_admin_session';

export interface AdminSession {
  admin: AdminUser;
  token: string;
  expiresAt: number;
}

export async function adminLogin(email: string, password: string): Promise<{ success: boolean; admin?: AdminUser; error?: string }> {
  try {
    const supabase = createClient();

    // Sign in with Supabase Auth (using email/password)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return {
        success: false,
        error: 'Invalid email or password',
      };
    }

    // Check if user is an admin
    const { data: adminData, error: adminError } = await supabase
      .from('admin_users')
      .select('*')
      .eq('email', email)
      .single();

    if (adminError || !adminData) {
      // Sign out the non-admin user
      await supabase.auth.signOut();
      return {
        success: false,
        error: 'You do not have admin privileges',
      };
    }

    // Store admin session
    const session: AdminSession = {
      admin: adminData,
      token: authData.session?.access_token || '',
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
    }

    return {
      success: true,
      admin: adminData,
    };
  } catch (error) {
    console.error('[admin-auth] Login error:', error);
    return {
      success: false,
      error: 'An unexpected error occurred',
    };
  }
}

export async function adminLogout(): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.auth.signOut();

    if (typeof window !== 'undefined') {
      localStorage.removeItem(ADMIN_SESSION_KEY);
    }
  } catch (error) {
    console.error('[admin-auth] Logout error:', error);
  }
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === 'undefined') return null;

  try {
    const sessionStr = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!sessionStr) return null;

    const session = JSON.parse(sessionStr) as AdminSession;

    // Check if session expired
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
