# Telebirr Gateway Proxy

Small proxy service for server-to-server Telebirr calls when your app host cannot directly reach Telebirr.

## 1) Install and run

```bash
cd proxy/telebirr-gateway
npm install
npm run start
```

Default port is `3000`.

## 2) Environment variables

- `PORT` (optional): default `3000`
- `TELEBIRR_ORIGIN` (optional): default `https://196.188.120.3:38443`
- `PROXY_PREFIX` (optional): default `/apiaccess/payment/gateway`
- `TELEBIRR_PROXY_INSECURE_TLS` (optional): `true|false`, default `false`

Example:

```bash
PORT=3000
TELEBIRR_ORIGIN=https://196.188.120.3:38443
PROXY_PREFIX=/apiaccess/payment/gateway
TELEBIRR_PROXY_INSECURE_TLS=false
```

## 3) Put behind HTTPS domain

Expose this service at a public HTTPS domain, for example:

`https://pay-proxy.example.com/apiaccess/payment/gateway`

## 4) Configure your Next.js app (Vercel)

Set:

`TELEBIRR_GATEWAY_PROXY_URL=https://pay-proxy.example.com/apiaccess/payment/gateway`

Redeploy, then test:

- `GET /api/admin/telebirr/debug`
- confirm `config.requestBaseURL` is your proxy URL

## 5) Health check

`GET /healthz`
