# Telebirr Proxy Setup

This repo now includes a deployable proxy service at:

`proxy/telebirr-gateway`

## Quick steps

1. Deploy `proxy/telebirr-gateway` on a VPS with HTTPS domain.
2. Use domain like:
   - `https://pay-proxy.yourdomain.com/apiaccess/payment/gateway`
3. In Vercel project env, set:
   - `TELEBIRR_GATEWAY_PROXY_URL=https://pay-proxy.yourdomain.com/apiaccess/payment/gateway`
4. Redeploy Vercel app.
5. Verify from admin:
   - open `/api/admin/telebirr/debug`
   - check `config.requestBaseURL`

## Notes

- `TELEBIRR_GATEWAY_PROXY_URL` must be your real domain, not `yourdomain.com`.
- If your proxy uses different path prefix, set matching value in `TELEBIRR_GATEWAY_PROXY_URL`.
