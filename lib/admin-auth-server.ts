import 'server-only';

import { createClient } from '@supabase/supabase-js';

type AnySupabaseClient = any;

const SUPABASE_URL = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = String(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export type AdminAuthRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  telegram_user_id?: string | number | null;
  two_factor_enabled?: boolean | null;
};

export function createPublicAuthClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase public credentials are missing in environment variables.');
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function loadAdminByEmailOrUserId(
  supabase: AnySupabaseClient,
  email: string,
  authUserId: string
): Promise<AdminAuthRow | null> {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedUserId = String(authUserId || '').trim();

  if (!normalizedEmail && !normalizedUserId) return null;

  const selectClause =
    'id, email, name, role, is_active, telegram_user_id, two_factor_enabled';

  if (normalizedEmail) {
    const byEmail = await supabase
      .from('admin_users')
      .select(selectClause)
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!byEmail.error && byEmail.data) return byEmail.data as AdminAuthRow;

    const message = String(byEmail.error?.message || '').toLowerCase();
    const missingColumns =
      message.includes('column') &&
      (message.includes('telegram_user_id') || message.includes('two_factor_enabled'));
    if (missingColumns) {
      const fallback = await supabase
        .from('admin_users')
        .select('id, email, name, role, is_active')
        .eq('email', normalizedEmail)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        return {
          ...(fallback.data as AdminAuthRow),
          telegram_user_id: null,
          two_factor_enabled: true,
        };
      }
    }
  }

  if (normalizedUserId) {
    const byId = await supabase
      .from('admin_users')
      .select(selectClause)
      .eq('id', normalizedUserId)
      .maybeSingle();

    if (!byId.error && byId.data) return byId.data as AdminAuthRow;

    const message = String(byId.error?.message || '').toLowerCase();
    const missingColumns =
      message.includes('column') &&
      (message.includes('telegram_user_id') || message.includes('two_factor_enabled'));
    if (missingColumns) {
      const fallback = await supabase
        .from('admin_users')
        .select('id, email, name, role, is_active')
        .eq('id', normalizedUserId)
        .maybeSingle();
      if (!fallback.error && fallback.data) {
        return {
          ...(fallback.data as AdminAuthRow),
          telegram_user_id: null,
          two_factor_enabled: true,
        };
      }
    }
  }

  return null;
}

export async function isGlobalTwoFactorEnabled(supabase: AnySupabaseClient) {
  const { data, error } = await supabase
    .from('app_settings')
    .select('two_factor_enabled')
    .eq('id', 'default')
    .maybeSingle();

  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('column') && message.includes('two_factor_enabled')) {
      return true;
    }
    if (message.includes('relation') && message.includes('app_settings') && message.includes('does not exist')) {
      return true;
    }
  }

  return data?.two_factor_enabled !== false;
}
