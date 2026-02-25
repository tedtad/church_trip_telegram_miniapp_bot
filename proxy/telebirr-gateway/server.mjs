import express from 'express';
import { Agent, fetch } from 'undici';

const app = express();

const PORT = Number(process.env.PORT || 3000);
const TELEBIRR_ORIGIN = String(process.env.TELEBIRR_ORIGIN || 'https://196.188.120.3:38443').trim();
const PROXY_PREFIX = String(process.env.PROXY_PREFIX || '/apiaccess/payment/gateway').trim() || '/apiaccess/payment/gateway';
const ALLOW_INSECURE_TLS = String(process.env.TELEBIRR_PROXY_INSECURE_TLS || 'false').toLowerCase() === 'true';

const dispatcher = new Agent({
  connect: {
    rejectUnauthorized: !ALLOW_INSECURE_TLS,
  },
});

// Keep raw body to support non-JSON payloads too.
app.use(express.raw({ type: '*/*', limit: '5mb' }));

app.get('/healthz', (_req, res) => {
  res.status(200).json({
    ok: true,
    service: 'telebirr-gateway-proxy',
    proxyPrefix: PROXY_PREFIX,
    telebirrOrigin: TELEBIRR_ORIGIN,
  });
});

app.all(`${PROXY_PREFIX}/*`, async (req, res) => {
  try {
    const targetURL = `${TELEBIRR_ORIGIN}${req.originalUrl}`;
    const headers = { ...req.headers };

    // Node/undici will set these correctly for outbound request.
    delete headers.host;
    delete headers['content-length'];
    delete headers.connection;

    const upstream = await fetch(targetURL, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
      dispatcher,
    });

    res.status(upstream.status);

    upstream.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });

    const raw = Buffer.from(await upstream.arrayBuffer());
    res.send(raw);
  } catch (error) {
    const err = error;
    res.status(502).json({
      ok: false,
      error: 'proxy_request_failed',
      message: err instanceof Error ? err.message : 'Unknown proxy error',
      code: err?.code || err?.cause?.code || null,
      cause: err?.cause?.message || null,
    });
  }
});

app.use((_req, res) => {
  res.status(404).json({
    ok: false,
    error: 'not_found',
    message: `Use proxy path starting with ${PROXY_PREFIX}`,
  });
});

app.listen(PORT, () => {
  console.log(`[telebirr-proxy] listening on :${PORT}`);
  console.log(`[telebirr-proxy] prefix: ${PROXY_PREFIX}`);
  console.log(`[telebirr-proxy] target: ${TELEBIRR_ORIGIN}`);
  console.log(`[telebirr-proxy] insecureTLS: ${ALLOW_INSECURE_TLS}`);
});
