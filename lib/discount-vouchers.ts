type VoucherRow = {
  id: string;
  invitation_code?: string | null;
  trip_id?: string | null;
  max_uses?: number | null;
  current_uses?: number | null;
  used_count?: number | null;
  discount_percent?: number | string | null;
  valid_from?: string | null;
  expires_at?: string | null;
  is_active?: boolean | null;
};

export type DiscountVoucher = {
  id: string;
  code: string;
  tripId: string | null;
  maxUses: number | null;
  currentUses: number;
  discountPercent: number;
  validFrom: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

export type DiscountResolution = {
  voucher: DiscountVoucher | null;
  error: string | null;
};

function toNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function isMissingColumn(error: unknown, columnName: string) {
  const message = String((error as any)?.message || '').toLowerCase();
  return message.includes('column') && message.includes(String(columnName || '').toLowerCase());
}

export function normalizeDiscountCode(raw: unknown) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
}

function normalizeVoucher(row: VoucherRow | null | undefined): DiscountVoucher | null {
  if (!row?.id) return null;
  const code = String(row.invitation_code || '').trim();
  if (!code) return null;

  const maxUsesRaw = row.max_uses;
  const maxUses = maxUsesRaw === null || maxUsesRaw === undefined ? null : Math.max(0, Math.floor(toNumber(maxUsesRaw)));
  const currentUses = Math.max(0, Math.floor(toNumber(row.current_uses ?? row.used_count ?? 0)));
  const discountPercent = Number(toNumber(row.discount_percent, 0).toFixed(2));
  const isActive = row.is_active !== false;

  return {
    id: String(row.id),
    code,
    tripId: row.trip_id ? String(row.trip_id) : null,
    maxUses,
    currentUses,
    discountPercent,
    validFrom: row.valid_from ? String(row.valid_from) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
    isActive,
  };
}

async function queryVoucherByCode(client: any, code: string): Promise<DiscountVoucher | null> {
  const selectCandidates = [
    'id, invitation_code, trip_id, max_uses, current_uses, discount_percent, valid_from, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, current_uses, discount_percent, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, current_uses, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, used_count, discount_percent, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, used_count, expires_at, is_active',
    'id, invitation_code, trip_id, max_uses, current_uses, discount_percent, expires_at',
    'id, invitation_code, trip_id, max_uses, current_uses, expires_at',
  ];

  for (const selectClause of selectCandidates) {
    const { data, error } = await client
      .from('invitations')
      .select(selectClause)
      .ilike('invitation_code', code)
      .limit(1)
      .maybeSingle();

    if (!error) return normalizeVoucher(data as VoucherRow);
    if (
      isMissingColumn(error, 'valid_from') ||
      isMissingColumn(error, 'discount_percent') ||
      isMissingColumn(error, 'current_uses') ||
      isMissingColumn(error, 'used_count') ||
      isMissingColumn(error, 'is_active')
    ) {
      continue;
    }
  }

  return null;
}

export async function resolveDiscountVoucher(
  client: any,
  rawCode: unknown,
  tripId: string
): Promise<DiscountResolution> {
  const code = normalizeDiscountCode(rawCode);
  if (!code) return { voucher: null, error: null };

  const voucher = await queryVoucherByCode(client, code);
  if (!voucher) {
    return { voucher: null, error: 'Discount code not found' };
  }
  if (!voucher.isActive) {
    return { voucher: null, error: 'Discount code is inactive' };
  }
  if (voucher.tripId && voucher.tripId !== tripId) {
    return { voucher: null, error: 'Discount code is not valid for this trip' };
  }
  if (voucher.validFrom) {
    const validFrom = new Date(voucher.validFrom);
    if (!Number.isNaN(validFrom.getTime()) && Date.now() < validFrom.getTime()) {
      return { voucher: null, error: 'Discount code is not active yet' };
    }
  }
  if (voucher.expiresAt) {
    const expiresAt = new Date(voucher.expiresAt);
    if (!Number.isNaN(expiresAt.getTime()) && Date.now() > expiresAt.getTime()) {
      return { voucher: null, error: 'Discount code has expired' };
    }
  }
  if (voucher.maxUses !== null && voucher.currentUses >= voucher.maxUses) {
    return { voucher: null, error: 'Discount code usage limit reached' };
  }
  if (!Number.isFinite(voucher.discountPercent) || voucher.discountPercent <= 0) {
    return { voucher: null, error: 'Discount code has zero discount value' };
  }

  return { voucher, error: null };
}

export function calculateDiscountAmount(baseAmount: number, discountPercent: number) {
  const base = Number((Number(baseAmount || 0)).toFixed(2));
  const percent = Math.max(0, Number((Number(discountPercent || 0)).toFixed(2)));
  const rawDiscount = (base * percent) / 100;
  const discount = Number(Math.min(base, rawDiscount).toFixed(2));
  const finalAmount = Number(Math.max(0, base - discount).toFixed(2));
  return {
    baseAmount: base,
    discountPercent: percent,
    discountAmount: discount,
    finalAmount,
  };
}

export async function incrementVoucherUsage(client: any, voucherId: string) {
  if (!voucherId) return;

  const { data } = await client
    .from('invitations')
    .select('id, max_uses, current_uses, used_count')
    .eq('id', voucherId)
    .maybeSingle();
  const row = (data || {}) as VoucherRow;
  const currentUses = Math.max(0, Math.floor(toNumber(row.current_uses ?? row.used_count ?? 0)));
  const maxUses = row.max_uses === null || row.max_uses === undefined ? null : Math.max(0, Math.floor(toNumber(row.max_uses)));
  if (maxUses !== null && currentUses >= maxUses) {
    throw new Error('Discount code usage limit reached');
  }

  const nextCount = currentUses + 1;
  const attempts: Array<Record<string, unknown>> = [
    { current_uses: nextCount, updated_at: new Date().toISOString() },
    { current_uses: nextCount },
    { used_count: nextCount, updated_at: new Date().toISOString() },
    { used_count: nextCount },
  ];

  for (const payload of attempts) {
    const result = await client.from('invitations').update(payload).eq('id', voucherId);
    if (!result.error) return;

    if (isMissingColumn(result.error, 'current_uses') || isMissingColumn(result.error, 'used_count') || isMissingColumn(result.error, 'updated_at')) {
      continue;
    }
  }
}

