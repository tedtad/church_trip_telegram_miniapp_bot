type Scope = 'admin' | 'mini';
type MethodKind = 'read' | 'write';

type RateLimitConfig = {
  windowMs: number;
  max: number;
};

type RateLimitState = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const ADMIN_LIMITS: Record<MethodKind, RateLimitConfig> = {
  read: { windowMs: 60_000, max: 120 },
  write: { windowMs: 60_000, max: 40 },
};

const MINI_LIMITS: Record<MethodKind, RateLimitConfig> = {
  read: { windowMs: 60_000, max: 180 },
  write: { windowMs: 60_000, max: 70 },
};

const RATE_STORE_KEY = '__tickethub_rate_limit_store__';
const LAST_CLEANUP_KEY = '__tickethub_rate_limit_last_cleanup__';
const CLEANUP_INTERVAL_MS = 60_000;

function getStore(): Map<string, RateLimitState> {
  const globalRef = globalThis as unknown as Record<string, unknown>;
  if (!(globalRef[RATE_STORE_KEY] instanceof Map)) {
    globalRef[RATE_STORE_KEY] = new Map<string, RateLimitState>();
  }
  return globalRef[RATE_STORE_KEY] as Map<string, RateLimitState>;
}

function cleanupExpired(now: number) {
  const globalRef = globalThis as unknown as Record<string, unknown>;
  const lastCleanup = Number(globalRef[LAST_CLEANUP_KEY] || 0);
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  const store = getStore();
  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key);
    }
  }
  globalRef[LAST_CLEANUP_KEY] = now;
}

function kindForMethod(method: string): MethodKind {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS' ? 'read' : 'write';
}

function getConfig(scope: Scope, method: string): RateLimitConfig {
  const kind = kindForMethod(method);
  return scope === 'admin' ? ADMIN_LIMITS[kind] : MINI_LIMITS[kind];
}

function computeIdentifier(candidate: string | null | undefined) {
  const normalized = String(candidate || '').trim();
  return normalized || 'anonymous';
}

export function extractClientIp(headers: Headers) {
  const forwarded = String(headers.get('x-forwarded-for') || '').trim();
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return (
    String(headers.get('x-real-ip') || '').trim() ||
    String(headers.get('cf-connecting-ip') || '').trim() ||
    'unknown'
  );
}

export function enforceRequestRateLimit(input: {
  scope: Scope;
  method: string;
  identifier: string;
  bucket?: string;
}): RateLimitResult {
  const now = Date.now();
  cleanupExpired(now);

  const config = getConfig(input.scope, input.method);
  const store = getStore();
  const bucket = String(input.bucket || '').trim() || 'default';
  const key = `${input.scope}:${computeIdentifier(input.identifier)}:${bucket}:${kindForMethod(input.method)}`;

  const existing = store.get(key);
  let state: RateLimitState;

  if (!existing || existing.resetAt <= now) {
    state = { count: 0, resetAt: now + config.windowMs };
  } else {
    state = existing;
  }

  state.count += 1;
  store.set(key, state);

  const remaining = Math.max(0, config.max - state.count);
  const retryAfterSeconds = Math.max(1, Math.ceil((state.resetAt - now) / 1000));
  const ok = state.count <= config.max;

  return {
    ok,
    limit: config.max,
    remaining,
    resetAt: state.resetAt,
    retryAfterSeconds,
  };
}
