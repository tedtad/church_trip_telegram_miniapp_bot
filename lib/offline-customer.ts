import { createHash } from 'crypto';

export function normalizePhoneForSearch(value: unknown) {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  return {
    raw: text,
    digits,
    normalized: text.startsWith('+') ? text : digits ? `+${digits}` : '',
  };
}

function createOfflineUserIdFromPhone(phoneDigits: string) {
  const hash = createHash('sha256').update(phoneDigits || 'offline').digest('hex');
  const numeric = parseInt(hash.slice(0, 12), 16);
  const safe = Number.isFinite(numeric) ? numeric : Date.now();
  return `-${safe}`;
}

function parseNameParts(fullName: string) {
  const normalized = String(fullName || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: 'Offline', lastName: 'Customer' };
  }

  const parts = normalized.split(' ');
  const firstName = parts.shift() || 'Offline';
  const lastName = parts.length ? parts.join(' ') : null;
  return { firstName, lastName };
}

export async function resolveOrCreateCustomerByPhone(params: {
  supabase: any;
  phone: string;
  fullName?: string;
  languageCode?: 'en' | 'am';
}) {
  const { supabase, phone, fullName, languageCode } = params;
  const normalizedPhone = normalizePhoneForSearch(phone);
  if (!normalizedPhone.digits) {
    throw new Error('Valid customer phone number is required');
  }

  const candidates = [normalizedPhone.raw, normalizedPhone.normalized, normalizedPhone.digits].filter(Boolean);
  for (const candidate of candidates) {
    const { data } = await supabase
      .from('telegram_users')
      .select('id, phone_number, first_name, last_name')
      .ilike('phone_number', `%${candidate}%`)
      .limit(25);

    const rows = (data || []) as Array<{ id: string | number; phone_number?: string | null }>;
    const exact = rows.find((row) => normalizePhoneForSearch(row.phone_number || '').digits === normalizedPhone.digits);
    if (exact) {
      return {
        userId: String(exact.id),
        created: false,
      };
    }
  }

  const { firstName, lastName } = parseNameParts(fullName || '');
  let offlineId = createOfflineUserIdFromPhone(normalizedPhone.digits);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const payload = {
      id: offlineId,
      first_name: firstName,
      last_name: lastName,
      username: null,
      phone_number: normalizedPhone.normalized || normalizedPhone.raw,
      language_code: languageCode || 'en',
      last_activity: new Date().toISOString(),
      last_interaction: new Date().toISOString(),
      status: 'active',
    };

    const insert = await supabase.from('telegram_users').upsert(payload, { onConflict: 'id' }).select('id').single();
    if (!insert.error && insert.data?.id) {
      return {
        userId: String(insert.data.id),
        created: true,
      };
    }

    offlineId = `-${Date.now()}${attempt + 1}`;
  }

  throw new Error('Failed to create offline customer profile');
}
