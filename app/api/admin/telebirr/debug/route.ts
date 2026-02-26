import { NextRequest, NextResponse } from 'next/server';
import {
  getTelebirrConfig,
  getTelebirrConfigStatus,
  getTelebirrGatewayProxyURL,
  resolveTelebirrGatewayBaseURL,
} from '@/lib/telebirr';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdminPermission } from '@/lib/admin-rbac';

function normalizeBaseURL(raw: string) {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function normalizePath(path: string) {
  const trimmed = String(path || '').trim();
  if (!trimmed) return '/';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinURL(baseURL: string, path: string) {
  const base = normalizeBaseURL(baseURL);
  let relative = normalizePath(path);
  const lowerBase = base.toLowerCase();
  const lowerRelative = relative.toLowerCase();

  const duplicatePrefixes = ['/apiaccess/payment/gateway', '/payment/gateway'];
  for (const prefix of duplicatePrefixes) {
    if (lowerBase.endsWith(prefix) && lowerRelative.startsWith(`${prefix}/`)) {
      relative = relative.slice(prefix.length);
      relative = relative.startsWith('/') ? relative : `/${relative}`;
      break;
    }
  }

  return `${base}${relative}`;
}

function resolveTokenEndpoint(baseURL: string) {
  const tokenPath = String(process.env.TELEBIRR_TOKEN_PATH || '/payment/v1/token').trim();
  return /^https?:\/\//i.test(tokenPath) ? tokenPath.replace(/\/+$/, '') : joinURL(baseURL, tokenPath);
}

function resolveInitiateEndpoints(baseURL: string) {
  const fromEnv = String(process.env.TELEBIRR_INITIATE_PATHS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const defaults = ['/payment/v1/merchant/preOrder', '/merchant/preOrder', '/v1/merchant/preOrder'];
  const all = [...fromEnv, ...defaults];

  return [...new Set(all.map((path) => (/^https?:\/\//i.test(path) ? path.replace(/\/+$/, '') : joinURL(baseURL, path))))];
}

function toSnippet(text: string, max = 600) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

async function fetchProbe(url: string, init: RequestInit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      bodySnippet: toSnippet(text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: 'NETWORK_ERROR',
      bodySnippet: toSnippet((error as any)?.message || String(error || 'Unknown error')),
      error: {
        message: String((error as any)?.message || 'Request failed'),
        code: (error as any)?.code || (error as any)?.cause?.code || null,
        cause: (error as any)?.cause?.message || null,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createAdminClient();
    const auth = await requireAdminPermission({
      supabase,
      request,
      permission: 'bot_manage',
    });
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const cfg = getTelebirrConfig();
    const status = getTelebirrConfigStatus();
    const gatewayProxyURL = getTelebirrGatewayProxyURL();
    const requestBaseURL = resolveTelebirrGatewayBaseURL(cfg.baseURL);
    const tokenEndpoint = resolveTokenEndpoint(requestBaseURL);
    const initiateEndpoints = resolveInitiateEndpoints(requestBaseURL).slice(0, 4);

    const tokenProbe = await fetchProbe(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': cfg.fabricAppId || '',
      },
      body: JSON.stringify({ appSecret: cfg.appSecret || '' }),
    });

    const initiateProbeResults = [];
    for (const endpoint of initiateEndpoints) {
      const result = await fetchProbe(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-APP-Key': cfg.fabricAppId || '',
          Authorization: 'DEBUG_PROBE',
        },
        body: JSON.stringify({}),
      });
      initiateProbeResults.push({ endpoint, ...result });
    }

    return NextResponse.json({
      ok: true,
      config: {
        ...status,
        gatewayProxyURL: gatewayProxyURL || null,
        requestBaseURL,
        hasAppSecret: Boolean(cfg.appSecret),
        hasPrivateKey: Boolean(cfg.privateKey),
      },
      probes: {
        tokenEndpoint,
        token: tokenProbe,
        initiate: initiateProbeResults,
      },
      hints: [
        'If token probe has NETWORK_ERROR, this is usually TLS/firewall/network reachability.',
        'If token probe returns 4xx/5xx with response body, connectivity works and issue is credentials/payload/contract.',
        'If initiate probes are NETWORK_ERROR but token works, check TELEBIRR_INITIATE_PATHS contract path.',
        'If your host cannot directly reach Telebirr, set TELEBIRR_GATEWAY_PROXY_URL to a reachable relay/proxy base URL.',
      ],
    });
  } catch (error) {
    console.error('[admin-telebirr-debug] Error:', error);
    return NextResponse.json({ ok: false, error: 'Failed to run Telebirr debug' }, { status: 500 });
  }
}
