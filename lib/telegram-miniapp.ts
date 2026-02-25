import { createHmac, timingSafeEqual } from 'crypto';

export type MiniAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type MiniAppAuth = {
  user: MiniAppUser;
  queryId: string;
  authDate: number;
};

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function verifyTelegramMiniAppInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 60 * 60 * 24
): MiniAppAuth | null {
  const normalized = String(initData || '').trim();
  const token = String(botToken || '').trim();
  if (!normalized || !token) return null;

  const params = new URLSearchParams(normalized);
  const hash = params.get('hash') || '';
  if (!hash) return null;

  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const hashBuf = Buffer.from(hash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  if (hashBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(hashBuf, expectedBuf)) return null;

  const authDateRaw = Number(params.get('auth_date') || 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!authDateRaw || nowSeconds - authDateRaw > maxAgeSeconds) return null;

  const user = safeJsonParse<MiniAppUser | null>(params.get('user') || '', null);
  if (!user?.id) return null;

  return {
    user,
    queryId: params.get('query_id') || '',
    authDate: authDateRaw,
  };
}
