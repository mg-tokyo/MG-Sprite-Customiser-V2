const proxy = process.env.VITE_CORS_PROXY?.trim() ?? '';
const debugFlag = process.env.VITE_ENABLE_PROXY_DEBUG?.trim() ?? '';

if (!proxy) {
  console.error(
    '[build] Missing VITE_CORS_PROXY. Configure a dedicated Cloudflare Worker URL prefix (for example: https://<worker>.workers.dev/?url=).',
  );
  process.exit(1);
}

if (!/^https?:\/\//i.test(proxy)) {
  console.error('[build] VITE_CORS_PROXY must start with http:// or https://');
  process.exit(1);
}

if (debugFlag && debugFlag !== 'true' && debugFlag !== 'false') {
  console.error('[build] VITE_ENABLE_PROXY_DEBUG must be "true" or "false" when set.');
  process.exit(1);
}
