import { createHmac, createSign, randomBytes, timingSafeEqual } from 'crypto';

export interface TelebirrConfig {
  apiKey: string;
  merchantId: string;
  merchantCode: string;
  fabricAppId: string;
  appSecret: string;
  privateKey: string;
  baseURL: string;
}

export interface TelebirrConfigStatus {
  configured: boolean;
  missing: string[];
  optionalMissing: string[];
  mode: 'live' | 'demo';
  baseURL: string;
}

export interface TelebirrPaymentRequest {
  phoneNumber?: string;
  amount: number;
  referenceNumber: string;
  description: string;
  tradeType?: 'Checkout' | 'InApp';
  callbackURL?: string;
  returnURL?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

export interface TelebirrPaymentResponse {
  status: 'pending' | 'confirmed' | 'failed';
  transactionId?: string;
  message: string;
  redirectURL?: string;
  rawRequest?: string;
  raw?: unknown;
}

export interface TelebirrWebhookPayload {
  transactionId: string;
  status: 'success' | 'failed' | 'pending';
  amount: number;
  phoneNumber: string;
  referenceNumber: string;
  timestamp: string;
  signature: string;
}

const DEMO_BASE_URL = 'https://example.invalid/telebirr-demo';
let telebirrDispatcher: any = null;

function getEnv(name: string) {
  return String(process.env[name] || '').trim();
}

function getEnvAny(names: string[]) {
  for (const name of names) {
    const value = getEnv(name);
    if (value) return value;
  }
  return '';
}

export function getTelebirrGatewayProxyURL() {
  return getEnvAny(['TELEBIRR_GATEWAY_PROXY_URL']);
}

export function resolveTelebirrGatewayBaseURL(baseURL: string) {
  const proxyURL = getTelebirrGatewayProxyURL();
  return normalizeBaseURL(proxyURL || baseURL);
}

function isDemoMode() {
  return getEnv('TELEBIRR_DEMO_MODE').toLowerCase() === 'true';
}

function isInsecureTlsMode() {
  return getEnv('TELEBIRR_INSECURE_TLS').toLowerCase() === 'true';
}

function getPositiveInt(value: string, fallback: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

function getTelebirrConnectTimeoutMs() {
  return getPositiveInt(getEnv('TELEBIRR_CONNECT_TIMEOUT_MS'), 30_000);
}

function getTelebirrRequestTimeoutMs(connectTimeoutMs: number) {
  return getPositiveInt(getEnv('TELEBIRR_REQUEST_TIMEOUT_MS'), Math.max(connectTimeoutMs + 20_000, 60_000));
}

async function importUndiciRuntime(): Promise<any | null> {
  try {
    // Avoid compile-time module resolution for environments where undici types are missing.
    const dynamicImporter = new Function('specifier', 'return import(specifier)') as (
      specifier: string
    ) => Promise<any>;
    return await dynamicImporter('undici');
  } catch {
    return null;
  }
}

async function telebirrFetch(url: string, init: RequestInit) {
  const connectTimeoutMs = getTelebirrConnectTimeoutMs();
  const requestTimeoutMs = getTelebirrRequestTimeoutMs(connectTimeoutMs);
  const insecureTls = isInsecureTlsMode();
  const fallbackSignal =
    !init.signal && typeof AbortSignal !== 'undefined' && typeof (AbortSignal as any).timeout === 'function'
      ? (AbortSignal as any).timeout(requestTimeoutMs)
      : undefined;
  const initWithTimeout = fallbackSignal ? { ...init, signal: fallbackSignal } : init;

  try {
    if (!telebirrDispatcher) {
      const undici = await importUndiciRuntime();
      if (!undici?.Agent) {
        return fetch(url, initWithTimeout);
      }

      telebirrDispatcher = new undici.Agent({
        connect: {
          rejectUnauthorized: !insecureTls,
          timeout: connectTimeoutMs,
        },
      });
    }

    return fetch(url, {
      ...initWithTimeout,
      dispatcher: telebirrDispatcher,
    } as RequestInit & { dispatcher: unknown });
  } catch {
    // Fallback to normal fetch if undici dispatcher is unavailable.
    return fetch(url, initWithTimeout);
  }
}

export function getTelebirrConfig(): TelebirrConfig {
  // Support multiple aliases so existing deployments keep working.
  const appSecret = getEnvAny([
    'TELEBIRR_APP_SECRET',
    'APP_SECRET',
    'appSecret',
  ]);
  const apiKey =
    getEnvAny([
      'TELEBIRR_API_KEY',
      'TELEBIRR_ACCESS_TOKEN',
      'API_KEY',
      'apiKey',
    ]) || appSecret;
  const merchantId = getEnvAny([
    'TELEBIRR_MERCHANT_ID',
    'TELEBIRR_MERCHANT_APP_ID',
    'MERCHANT_APP_ID',
    'merchantAppId',
  ]);
  const merchantCode = getEnvAny([
    'TELEBIRR_MERCHANT_CODE',
    'TELEBIRR_SHORT_CODE',
    'SHORT_CODE',
    'merchantCode',
    'shortCode',
  ]);
  const fabricAppId =
    getEnvAny([
      'TELEBIRR_FABRIC_APP_ID',
      'FABRIC_APP_ID',
      'fabricAppId',
    ]) || apiKey;
  const privateKey = getEnvAny([
    'TELEBIRR_PRIVATE_KEY',
    'PRIVATE_KEY',
    'privateKey',
  ]);
  const baseURL = getEnvAny([
    'TELEBIRR_API_URL',
    'TELEBIRR_BASE_URL',
    'BASE_URL',
    'baseUrl',
  ]) || DEMO_BASE_URL;

  return {
    apiKey,
    merchantId,
    merchantCode,
    fabricAppId,
    appSecret,
    privateKey,
    baseURL,
  };
}

export function getTelebirrConfigStatus(): TelebirrConfigStatus {
  const cfg = getTelebirrConfig();
  const missing: string[] = [];
  const optionalMissing: string[] = [];

  if (!cfg.apiKey) missing.push('TELEBIRR_API_KEY');
  if (!cfg.merchantId) missing.push('TELEBIRR_MERCHANT_ID');
  if (!cfg.merchantCode) missing.push('TELEBIRR_MERCHANT_CODE');
  if (!cfg.fabricAppId) missing.push('TELEBIRR_FABRIC_APP_ID');
  if (!cfg.appSecret) {
    missing.push('TELEBIRR_APP_SECRET');
    optionalMissing.push('TELEBIRR_APP_SECRET');
  }
  if (!cfg.privateKey) {
    missing.push('TELEBIRR_PRIVATE_KEY');
    optionalMissing.push('TELEBIRR_PRIVATE_KEY');
  }
  if (!cfg.baseURL) missing.push('TELEBIRR_API_URL');

  const demo = isDemoMode();
  return {
    configured: demo || missing.length === 0,
    missing: demo ? [] : missing,
    optionalMissing: demo ? [] : optionalMissing,
    mode: demo ? 'demo' : 'live',
    baseURL: cfg.baseURL,
  };
}

function fabricHeaders(config: TelebirrConfig, fabricToken?: string) {
  const normalizedToken = String(fabricToken || '').trim();
  const authorizationValue = normalizedToken
    ? /^bearer\s+/i.test(normalizedToken)
      ? normalizedToken
      : `Bearer ${normalizedToken}`
    : '';

  return {
    'Content-Type': 'application/json',
    'X-APP-Key': config.fabricAppId,
    ...(authorizationValue ? { Authorization: authorizationValue } : {}),
  };
}

function authHeaders(config: TelebirrConfig) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    'x-fabric-app-id': config.fabricAppId,
    'x-merchant-id': config.merchantId,
    'x-merchant-code': config.merchantCode,
  };
}

function normalizeBaseURL(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';

    let pathname = parsed.pathname.replace(/\/+$/, '');
    const lowerPath = pathname.toLowerCase();
    const checkoutSuffixes = ['/payment/web/paygate', '/totradewebpay', '/payment/gateway/totradewebpay'];

    for (const suffix of checkoutSuffixes) {
      if (lowerPath.endsWith(suffix)) {
        pathname = pathname.slice(0, pathname.length - suffix.length).replace(/\/+$/, '');
        break;
      }
    }

    return `${parsed.origin}${pathname ? pathname : ''}`;
  } catch {
    // Keep best-effort normalization for non-URL inputs.
    return value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function isCheckoutPath(pathname: string) {
  const normalized = String(pathname || '').toLowerCase().replace(/\/+$/, '');
  return (
    normalized.endsWith('/payment/web/paygate') ||
    normalized.endsWith('/totradewebpay') ||
    normalized.endsWith('/payment/gateway/totradewebpay')
  );
}

function normalizeAbsoluteEndpointURL(raw: string) {
  const value = String(raw || '').trim();
  if (!value) return '';

  try {
    const parsed = new URL(value);
    let pathname = parsed.pathname || '/';
    const queryAsPath = parsed.search.startsWith('?/') ? parsed.search.slice(1) : '';

    // Repair malformed URLs such as ".../payment/web/paygate?/payment/v1/token".
    if (queryAsPath && /^\/[a-z0-9/_-]+$/i.test(queryAsPath)) {
      if (isCheckoutPath(pathname) || /^\/payment\/v1\/token$/i.test(queryAsPath)) {
        pathname = queryAsPath;
      }
    }

    pathname = pathname.replace(/\/+$/, '');
    return `${parsed.origin}${pathname || ''}`;
  } catch {
    return value.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function normalizePath(path: string) {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinTelebirrURL(baseURL: string, path: string) {
  const normalizedBase = normalizeBaseURL(baseURL);
  let relative = normalizePath(path);
  const lowerBase = normalizedBase.toLowerCase();
  const lowerRelative = relative.toLowerCase();

  // Avoid duplicated segments when base already ends with gateway path.
  const duplicatePrefixes = ['/apiaccess/payment/gateway', '/payment/gateway'];
  for (const prefix of duplicatePrefixes) {
    if (lowerBase.endsWith(prefix) && lowerRelative.startsWith(`${prefix}/`)) {
      relative = relative.slice(prefix.length);
      relative = relative.startsWith('/') ? relative : `/${relative}`;
      break;
    }
  }

  return `${normalizedBase}${relative}`;
}

function describeFetchError(error: unknown) {
  const err = error as any;
  const message = err instanceof Error ? err.message : String(error || 'Unknown initiate error');
  const causeMessage = err?.cause?.message ? String(err.cause.message) : undefined;
  const causeCode = err?.cause?.code || err?.code;

  return {
    message,
    causeMessage,
    causeCode,
  };
}

function createNonceStr() {
  return randomBytes(16).toString('hex');
}

function createTimeStamp() {
  return `${Math.floor(Date.now() / 1000)}`;
}

function toMerchantOrderId(value: string) {
  const alnum = String(value || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  if (alnum) return alnum;
  return `ORD${Date.now()}`.slice(0, 64);
}

function resolveTradeType(request: TelebirrPaymentRequest): 'Checkout' | 'InApp' {
  const requestValue = String(request.tradeType || '').trim();
  if (requestValue.toLowerCase() === 'inapp') return 'InApp';
  if (requestValue.toLowerCase() === 'checkout') return 'Checkout';

  const envValue = String(process.env.TELEBIRR_TRADE_TYPE || '').trim();
  if (envValue.toLowerCase() === 'inapp') return 'InApp';
  if (envValue.toLowerCase() === 'checkout') return 'Checkout';

  return 'Checkout';
}

function normalizePrivateKey(rawKey: string) {
  const raw = String(rawKey || '')
    .trim()
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '');
  if (!raw) return '';

  if (raw.includes('BEGIN PRIVATE KEY') || raw.includes('BEGIN RSA PRIVATE KEY')) {
    return raw;
  }

  const cleaned = raw.replace(/\s+/g, '');
  const chunks = cleaned.match(/.{1,64}/g) || [cleaned];
  return `-----BEGIN PRIVATE KEY-----\n${chunks.join('\n')}\n-----END PRIVATE KEY-----`;
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested === undefined || nested === null || nested === '') continue;
      output[key] = sortDeep(nested);
    }
    return output;
  }

  return value;
}

function toSignString(payload: Record<string, unknown>) {
  // Match Telebirr demo signing behavior:
  // sort top-level keys only, then stringify object values as-is.
  return Object.keys(payload)
    .sort()
    .map((key) => {
      const value = payload[key];
      if (value === undefined || value === null || value === '') return '';
      if (typeof value === 'object') return `${key}=${JSON.stringify(value)}`;
      return `${key}=${String(value)}`;
    })
    .filter(Boolean)
    .join('&');
}

function signWithRsa(payload: Record<string, unknown>, privateKey: string) {
  const signSource = toSignString(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(signSource, 'utf8');
  signer.end();
  return signer.sign(normalizePrivateKey(privateKey), 'base64');
}

function normalizeRawRequest(rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') return undefined;
  const cleaned = rawValue
    .replace(/\r/g, '')
    .replace(/\n/g, '')
    .trim();
  return cleaned || undefined;
}

function getNumberAmount(amount: number) {
  if (!Number.isFinite(amount)) return 0;
  return Number(amount.toFixed(2));
}

function collectRawRequest(data: any): string | undefined {
  const raw =
    data?.rawRequest ||
    data?.raw_request ||
    data?.result?.rawRequest ||
    data?.result?.raw_request ||
    data?.data?.rawRequest ||
    data?.data?.raw_request ||
    data?.biz_content?.rawRequest ||
    data?.biz_content?.raw_request ||
    data?.bizContent?.rawRequest ||
    data?.bizContent?.raw_request;

  return normalizeRawRequest(raw);
}

function parseRawRequestParams(rawRequest: string) {
  const query = String(rawRequest || '').replace(/^\?/, '').trim();
  if (!query) return null;

  try {
    return new URLSearchParams(query);
  } catch {
    return null;
  }
}

function looksInvalidRawRequestValue(value: string | null) {
  const normalized = String(value || '').trim().toLowerCase();
  return !normalized || ['undefined', 'null', 'nan'].includes(normalized);
}

function isUsableRawRequest(rawRequest: string | undefined) {
  if (!rawRequest) return false;
  const params = parseRawRequestParams(rawRequest);
  if (!params) return false;

  const appid = params.get('appid');
  const merchCode = params.get('merch_code');
  const prepayId = params.get('prepay_id');
  const sign = params.get('sign');

  if (looksInvalidRawRequestValue(appid)) return false;
  if (looksInvalidRawRequestValue(merchCode)) return false;
  if (looksInvalidRawRequestValue(prepayId)) return false;
  if (looksInvalidRawRequestValue(sign)) return false;
  return true;
}

function collectRedirectURL(data: any): string | undefined {
  const direct =
    data?.redirectURL ||
    data?.redirectUrl ||
    data?.checkoutUrl ||
    data?.checkoutURL ||
    data?.toPayUrl ||
    data?.toPayURL ||
    data?.paymentUrl ||
    data?.payUrl ||
    data?.url ||
    data?.checkout_url ||
    data?.payment_url ||
    data?.to_pay_url ||
    data?.result?.redirectURL ||
    data?.result?.checkoutUrl ||
    data?.result?.toPayUrl ||
    data?.result?.paymentUrl ||
    data?.result?.url ||
    data?.data?.redirectURL ||
    data?.data?.checkoutUrl ||
    data?.data?.toPayUrl ||
    data?.data?.paymentUrl ||
    data?.data?.url ||
    data?.biz_content?.redirectURL ||
    data?.biz_content?.checkoutUrl ||
    data?.biz_content?.toPayUrl ||
    data?.biz_content?.paymentUrl ||
    data?.biz_content?.url ||
    data?.bizContent?.redirectURL ||
    data?.bizContent?.checkoutUrl ||
    data?.bizContent?.toPayUrl ||
    data?.bizContent?.paymentUrl ||
    data?.bizContent?.url;

  return typeof direct === 'string' && direct.trim() ? direct.trim() : undefined;
}

function isCheckoutRedirectURL(value: string | undefined) {
  const url = String(value || '').trim();
  if (!url) return false;

  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
    if (!path) return false;

    const validCheckoutPaths = [
      '/payment/web/paygate',
      '/totradewebpay',
      '/payment/gateway/totradewebpay',
      '/apiaccess/payment/gateway/totradewebpay',
    ];

    if (validCheckoutPaths.some((suffix) => path.endsWith(suffix))) {
      return true;
    }

    if (path.includes('/payment/v1/token') || path.includes('/payment/v1/merchant/preorder')) {
      return false;
    }

    return false;
  } catch {
    return false;
  }
}

function collectTransactionId(data: any): string | undefined {
  const value =
    data?.transactionId ||
    data?.txRef ||
    data?.transaction_id ||
    data?.tradeNo ||
    data?.prepay_id ||
    data?.prepayId ||
    data?.outTradeNo ||
    data?.reference ||
    data?.result?.transactionId ||
    data?.result?.tradeNo ||
    data?.result?.prepay_id ||
    data?.result?.prepayId ||
    data?.result?.outTradeNo ||
    data?.data?.transactionId ||
    data?.data?.tradeNo ||
    data?.data?.prepay_id ||
    data?.data?.prepayId ||
    data?.data?.outTradeNo ||
    data?.biz_content?.transactionId ||
    data?.biz_content?.tradeNo ||
    data?.biz_content?.prepay_id ||
    data?.biz_content?.prepayId ||
    data?.biz_content?.outTradeNo ||
    data?.bizContent?.transactionId ||
    data?.bizContent?.tradeNo ||
    data?.bizContent?.prepay_id ||
    data?.bizContent?.prepayId ||
    data?.bizContent?.outTradeNo;

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function collectFabricToken(data: any): string | undefined {
  const token =
    data?.token ||
    data?.access_token ||
    data?.accessToken ||
    data?.auth_token ||
    data?.authToken ||
    data?.result?.token ||
    data?.result?.access_token ||
    data?.result?.accessToken ||
    data?.data?.token ||
    data?.data?.access_token ||
    data?.data?.accessToken ||
    data?.biz_content?.token ||
    data?.bizContent?.token;

  return typeof token === 'string' && token.trim() ? token.trim() : undefined;
}

function collectPrepayId(data: any): string | undefined {
  const prepayId =
    data?.prepay_id ||
    data?.prepayId ||
    data?.biz_content?.prepay_id ||
    data?.biz_content?.prepayId ||
    data?.bizContent?.prepay_id ||
    data?.bizContent?.prepayId ||
    data?.result?.prepay_id ||
    data?.result?.prepayId ||
    data?.data?.prepay_id ||
    data?.data?.prepayId;

  return typeof prepayId === 'string' && prepayId.trim() ? prepayId.trim() : undefined;
}

function resolveTokenEndpoint(baseURL: string) {
  const originFrom = (value: string) => {
    try {
      return new URL(normalizeBaseURL(value)).origin;
    } catch {
      return '';
    }
  };

  const tokenEndpoint = getEnvAny(['TELEBIRR_TOKEN_URL', 'TELEBIRR_TOKEN_ENDPOINT']);
  if (/^https?:\/\//i.test(tokenEndpoint)) {
    const normalized = normalizeAbsoluteEndpointURL(tokenEndpoint);
    try {
      const parsed = new URL(normalized);
      if (isCheckoutPath(parsed.pathname)) {
        const derivedBase = normalizeBaseURL(tokenEndpoint);
        return joinTelebirrURL(derivedBase, '/payment/v1/token');
      }
    } catch { }
    return normalized;
  }

  const tokenPath = getEnv('TELEBIRR_TOKEN_PATH') || '/payment/v1/token';
  if (/^https?:\/\//i.test(tokenPath)) {
    const normalized = normalizeAbsoluteEndpointURL(tokenPath);
    try {
      const parsed = new URL(normalized);
      if (isCheckoutPath(parsed.pathname)) {
        const derivedBase = normalizeBaseURL(tokenPath);
        return joinTelebirrURL(derivedBase, '/payment/v1/token');
      }
    } catch { }
    return normalized;
  }

  // Telebirr token endpoint is typically host-level (/payment/v1/token),
  // not under /apiaccess/payment/gateway.
  if (/^\/payment\/v1\/token$/i.test(tokenPath)) {
    const origin = originFrom(baseURL);
    if (origin) {
      return `${origin}/payment/v1/token`;
    }
  }

  return joinTelebirrURL(baseURL, tokenPath);
}

function resolveInitiateEndpoints(baseURL: string): string[] {
  const fromEnv = String(process.env.TELEBIRR_INITIATE_PATHS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

  const defaultPaths = [
    '/payment/v1/merchant/preOrder',
    '/merchant/preOrder',
    '/v1/merchant/preOrder',
    '/payment/gateway/merchant/preOrder',
  ];

  const allPaths = [...fromEnv, ...defaultPaths];
  const urls = new Set<string>();

  for (const path of allPaths) {
    if (/^https?:\/\//i.test(path)) {
      urls.add(normalizeAbsoluteEndpointURL(path));
      continue;
    }
    urls.add(joinTelebirrURL(baseURL, path));
  }

  return [...urls];
}

function appendCheckoutQueryDefaults(rawRequest: string, tradeType: 'Checkout' | 'InApp') {
  let query = rawRequest.replace(/^\?/, '');
  if (!/(^|&)version=/.test(query)) {
    query += `${query ? '&' : ''}version=1.0`;
  }
  if (!/(^|&)trade_type=/.test(query)) {
    query += `${query ? '&' : ''}trade_type=${tradeType}`;
  }
  return query;
}

function resolveWebCheckoutURL(baseURL: string, rawRequest: string, tradeType: 'Checkout' | 'InApp'): string {
  const originFromBase = (() => {
    try {
      return new URL(normalizeBaseURL(baseURL)).origin;
    } catch {
      return '';
    }
  })();

  const resolveCheckoutEndpoint = (value: string) => {
    const cleaned = String(value || '').trim().replace(/[?&]+$/, '').replace(/\/+$/, '');
    if (!cleaned) return '';

    if (/^https?:\/\//i.test(cleaned)) {
      // If API base is mistakenly configured as checkout URL, auto-map to paygate endpoint.
      if (/\/apiaccess\/payment\/gateway$/i.test(cleaned) || /\/payment\/gateway$/i.test(cleaned)) {
        try {
          const origin = new URL(cleaned).origin;
          return `${origin}/payment/web/paygate`;
        } catch {
          return cleaned;
        }
      }
      return cleaned;
    }

    if (originFromBase) {
      if (
        cleaned.startsWith('/payment/web/paygate') ||
        cleaned.startsWith('/toTradeWebPay') ||
        cleaned.startsWith('/payment/gateway/toTradeWebPay') ||
        cleaned.startsWith('/apiaccess/payment/gateway/toTradeWebPay')
      ) {
        return `${originFromBase}${cleaned.startsWith('/') ? cleaned : `/${cleaned}`}`.replace(/\/+$/, '');
      }
    }

    return joinTelebirrURL(baseURL, cleaned);
  };

  const explicit = getEnvAny(['TELEBIRR_WEB_CHECKOUT_URL', 'WEB_BASE_URL']);
  const query = appendCheckoutQueryDefaults(rawRequest, tradeType);
  if (explicit) {
    return `${resolveCheckoutEndpoint(explicit)}?${query}`;
  }

  const fromEnv = getEnvAny(['TELEBIRR_WEB_CHECKOUT_PATHS', 'WEB_CHECKOUT_PATHS'])
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const defaultPaths = ['/payment/web/paygate', '/toTradeWebPay', '/payment/gateway/toTradeWebPay'];

  const candidates = [...fromEnv, ...defaultPaths];
  const path = candidates.find(Boolean) || '/toTradeWebPay';
  const endpoint = resolveCheckoutEndpoint(path);

  return `${endpoint}?${query}`;
}

function buildPreOrderPayload(config: TelebirrConfig, request: TelebirrPaymentRequest) {
  const amountNumber = getNumberAmount(request.amount);
  const amount =
    Number.isInteger(amountNumber) ? String(amountNumber) : amountNumber.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  const notifyURL = request.callbackURL || request.returnURL || '';
  const redirectURL = request.returnURL || request.callbackURL || '';
  const callbackInfo = request.metadata ? JSON.stringify(sortDeep(request.metadata)) : request.referenceNumber;
  const tradeType = resolveTradeType(request);
  const merchOrderId = toMerchantOrderId(request.referenceNumber);

  const payloadWithoutSignType: Record<string, unknown> = {
    nonce_str: createNonceStr(),
    method: 'payment.preorder',
    timestamp: createTimeStamp(),
    version: '1.0',
    biz_content: {
      notify_url: notifyURL,
      appid: config.merchantId,
      merch_code: config.merchantCode,
      merch_order_id: merchOrderId,
      trade_type: tradeType,
      title: request.description || 'Trip ticket',
      total_amount: amount,
      trans_currency: 'ETB',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier: config.merchantCode,
      payee_identifier_type: '04',
      payee_type: '5000',
      redirect_url: redirectURL,
      callback_info: callbackInfo,
    },
  };

  // Telebirr preOrder signature must exclude both sign and sign_type.
  const sign = signWithRsa(payloadWithoutSignType, config.privateKey);

  return {
    ...payloadWithoutSignType,
    sign_type: 'SHA256WithRSA',
    sign,
  };
}

function buildRawRequest(config: TelebirrConfig, prepayId: string) {
  const payloadToSign: Record<string, string> = {
    appid: config.merchantId,
    merch_code: config.merchantCode,
    nonce_str: createNonceStr(),
    prepay_id: prepayId,
    timestamp: createTimeStamp(),
  };

  // Per Telebirr demo, sign raw-request fields without sign_type.
  const sign = signWithRsa(payloadToSign, config.privateKey);
  const pairs: Array<[string, string]> = [
    ['appid', payloadToSign.appid],
    ['merch_code', payloadToSign.merch_code],
    ['nonce_str', payloadToSign.nonce_str],
    ['prepay_id', payloadToSign.prepay_id],
    ['timestamp', payloadToSign.timestamp],
    ['sign', sign],
    ['sign_type', 'SHA256WithRSA'],
  ];

  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * Initiate Telebirr payment.
 * Note: endpoint path may differ depending on your contracted Telebirr spec.
 */
export async function initiateTelebirrPayment(
  request: TelebirrPaymentRequest
): Promise<TelebirrPaymentResponse> {
  const config = getTelebirrConfig();
  const status = getTelebirrConfigStatus();
  const requestBaseURL = resolveTelebirrGatewayBaseURL(config.baseURL);
  const requestedTradeType = resolveTradeType(request);

  if (status.mode === 'demo') {
    const fallbackDemoRedirect = `${config.baseURL}?reference=${encodeURIComponent(request.referenceNumber)}`;
    return {
      status: 'pending',
      transactionId: `demo-${Date.now()}`,
      message: 'Demo mode: payment initiated',
      // In demo mode, prefer returning to app flow instead of hitting live Telebirr endpoints.
      redirectURL: request.returnURL || request.callbackURL || fallbackDemoRedirect,
    };
  }

  if (!status.configured) {
    return {
      status: 'failed',
      message: `Telebirr not configured. Missing: ${status.missing.join(', ')}`,
    };
  }

  try {
    const tokenEndpoint = resolveTokenEndpoint(requestBaseURL);
    let tokenResponse: Response;
    try {
      tokenResponse = await telebirrFetch(tokenEndpoint, {
        method: 'POST',
        headers: fabricHeaders(config),
        body: JSON.stringify({ appSecret: config.appSecret }),
      });
    } catch (error) {
      return {
        status: 'failed',
        message: 'Telebirr token request failed (network error)',
        raw: {
          endpoint: tokenEndpoint,
          data: describeFetchError(error),
        },
      };
    }

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      return {
        status: 'failed',
        message: `Telebirr token request failed (${tokenResponse.status})`,
        raw: { endpoint: tokenEndpoint, data: tokenData },
      };
    }

    const fabricToken = collectFabricToken(tokenData);
    if (!fabricToken) {
      return {
        status: 'failed',
        message: 'Telebirr token missing from response',
        raw: { endpoint: tokenEndpoint, data: tokenData },
      };
    }

    const payload = buildPreOrderPayload(config, request);
    const endpoints = resolveInitiateEndpoints(requestBaseURL);
    let lastFailure: { status?: number; endpoint?: string; data?: unknown } | null = null;

    for (const endpoint of endpoints) {
      try {
        const response = await telebirrFetch(endpoint, {
          method: 'POST',
          headers: fabricHeaders(config, fabricToken),
          body: JSON.stringify(payload),
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          lastFailure = { status: response.status, endpoint, data };
          continue;
        }

        const redirectCandidate = collectRedirectURL(data);
        const redirect = isCheckoutRedirectURL(redirectCandidate) ? redirectCandidate : undefined;
        const prepayId = collectPrepayId(data);
        const rawRequestCandidate = collectRawRequest(data);
        const rawRequest =
          isUsableRawRequest(rawRequestCandidate)
            ? rawRequestCandidate
            : prepayId
              ? buildRawRequest(config, prepayId)
              : undefined;
        const computedRedirect =
          redirect || (rawRequest ? resolveWebCheckoutURL(config.baseURL, rawRequest, requestedTradeType) : undefined);
        return {
          status: (data?.status as 'pending' | 'confirmed' | 'failed') || 'pending',
          transactionId: collectTransactionId(data) || prepayId || request.referenceNumber,
          message: data?.message || 'Payment initiated',
          redirectURL: computedRedirect,
          rawRequest,
          raw: { endpoint, data },
        };
      } catch (error) {
        const fetchError = describeFetchError(error);
        lastFailure = {
          endpoint,
          data: fetchError,
        };
      }
    }

    return {
      status: 'failed',
      message: `Telebirr initiate failed${lastFailure?.status ? ` (${lastFailure.status})` : ''}`,
      raw: lastFailure,
    };
  } catch (error) {
    console.error('[telebirr] initiate error:', error);
    const fetchError = describeFetchError(error);
    return {
      status: 'failed',
      message: fetchError.message || 'Payment initiation failed',
      raw: { data: fetchError },
    };
  }
}

export async function verifyTelebirrPayment(
  transactionId: string
): Promise<{ status: string; details: unknown }> {
  const config = getTelebirrConfig();
  const status = getTelebirrConfigStatus();
  const requestBaseURL = resolveTelebirrGatewayBaseURL(config.baseURL);

  if (status.mode === 'demo') {
    return {
      status: 'success',
      details: {
        transactionId,
        status: 'confirmed',
        amount: 0,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (!status.configured) {
    return {
      status: 'error',
      details: { message: `Telebirr not configured. Missing: ${status.missing.join(', ')}` },
    };
  }

  try {
    const response = await telebirrFetch(
      `${requestBaseURL}/payment/verify/${encodeURIComponent(transactionId)}`,
      {
        method: 'GET',
        headers: authHeaders(config),
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        status: 'error',
        details: { message: `Verify failed (${response.status})`, raw: data },
      };
    }

    return {
      status: String(data?.status || 'unknown'),
      details: data,
    };
  } catch (error) {
    console.error('[telebirr] verify error:', error);
    return {
      status: 'error',
      details: { message: error instanceof Error ? error.message : 'Verification failed' },
    };
  }
}

export function validateTelebirrWebhookSignature(payload: unknown, signature: string): boolean {
  const status = getTelebirrConfigStatus();
  if (status.mode === 'demo') return true;

  const config = getTelebirrConfig();
  if (!config.appSecret || !signature) return false;

  try {
    const body = JSON.stringify(payload || {});
    const expected = createHmac('sha256', config.appSecret).update(body).digest('hex');

    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(String(signature).toLowerCase());

    if (expectedBuf.length !== signatureBuf.length) return false;
    return timingSafeEqual(expectedBuf, signatureBuf);
  } catch (error) {
    console.error('[telebirr] signature validation error:', error);
    return false;
  }
}

export function formatTelebirrPhone(phoneNumber: string): string {
  const cleaned = String(phoneNumber || '').replace(/\D/g, '');
  if (cleaned.startsWith('251')) return `+${cleaned}`;
  if (cleaned.startsWith('9')) return `+251${cleaned.substring(1)}`;
  return phoneNumber;
}

export async function getTelebirrPaymentStatus(
  referenceNumber: string
): Promise<{ isPaid: boolean; details: unknown }> {
  const config = getTelebirrConfig();
  const status = getTelebirrConfigStatus();
  const requestBaseURL = resolveTelebirrGatewayBaseURL(config.baseURL);

  if (status.mode === 'demo') {
    return {
      isPaid: false,
      details: { message: 'Demo mode - no real payment state' },
    };
  }

  if (!status.configured) {
    return {
      isPaid: false,
      details: { message: `Telebirr not configured. Missing: ${status.missing.join(', ')}` },
    };
  }

  try {
    const response = await telebirrFetch(
      `${requestBaseURL}/payment/status/${encodeURIComponent(referenceNumber)}`,
      {
        method: 'GET',
        headers: authHeaders(config),
      }
    );
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        isPaid: false,
        details: { message: `Status check failed (${response.status})`, raw: data },
      };
    }

    const normalized = String(data?.status || '').toLowerCase();
    return {
      isPaid: ['success', 'paid', 'confirmed', 'completed', 'successful', 'ok', '0', 'succeed'].includes(normalized),
      details: data,
    };
  } catch (error) {
    console.error('[telebirr] status error:', error);
    return {
      isPaid: false,
      details: { message: error instanceof Error ? error.message : 'Status check failed' },
    };
  }
}
