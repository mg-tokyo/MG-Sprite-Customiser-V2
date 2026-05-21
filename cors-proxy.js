/**
 * Cloudflare Worker CORS proxy for MG Sprite Customiser.
 *
 * Environment variables:
 * - ALLOWED_ORIGINS (comma-separated, e.g. "https://example.com,https://foo.com")
 * - ALLOWED_HOSTS (comma-separated, defaults to mg-api.ariedam.fr,magicgarden.gg)
 * - ALLOWED_PATH_PREFIXES (format: "host:/a,/b;host2:/c")
 * - RATE_LIMIT_ENABLED ("true"/"false", default false)
 * - RATE_LIMIT_RPM (default 240)
 * - PROXY_TIMEOUT_MS (default 8000)
 */

const DEFAULT_ALLOWED_ORIGINS = [
  'https://ryandt2305-cpu.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

const DEFAULT_ALLOWED_HOSTS = ['mg-api.ariedam.fr', 'magicgarden.gg'];
const DEFAULT_ALLOWED_PATH_PREFIXES = {
  'mg-api.ariedam.fr': ['/data', '/assets/sprite-data', '/assets/cosmetics', '/assets/sprites/'],
  'magicgarden.gg': ['/assets/', '/version/'],
};

const RATE_BUCKETS = new Map();

function parseCsv(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  const values = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values.length > 0 ? values : fallback;
}

function parsePathPrefixes(raw) {
  if (!raw || typeof raw !== 'string') return DEFAULT_ALLOWED_PATH_PREFIXES;
  const mapping = {};
  for (const hostSection of raw.split(';')) {
    const section = hostSection.trim();
    if (!section) continue;
    const splitAt = section.indexOf(':');
    if (splitAt <= 0) continue;
    const host = section.slice(0, splitAt).trim();
    const prefixes = section
      .slice(splitAt + 1)
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (!host || prefixes.length === 0) continue;
    mapping[host] = prefixes;
  }
  return Object.keys(mapping).length > 0 ? mapping : DEFAULT_ALLOWED_PATH_PREFIXES;
}

function createConfig(env = {}) {
  return {
    allowedOrigins: new Set(parseCsv(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS)),
    allowedHosts: new Set(parseCsv(env.ALLOWED_HOSTS, DEFAULT_ALLOWED_HOSTS)),
    allowedPathPrefixes: parsePathPrefixes(env.ALLOWED_PATH_PREFIXES),
    rateLimitEnabled: String(env.RATE_LIMIT_ENABLED || 'false').toLowerCase() === 'true',
    rateLimitRpm: Number.parseInt(env.RATE_LIMIT_RPM || '240', 10) || 240,
    proxyTimeoutMs: Number.parseInt(env.PROXY_TIMEOUT_MS || '8000', 10) || 8000,
  };
}

function getClientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function logSecurity(event, details) {
  console.log(JSON.stringify({ level: 'warn', event, ...details }));
}

function consumeRateLimit(ip, rpm) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const existing = RATE_BUCKETS.get(ip) || [];
  const fresh = existing.filter((stamp) => stamp >= windowStart);
  if (fresh.length >= rpm) {
    RATE_BUCKETS.set(ip, fresh);
    return false;
  }
  fresh.push(now);
  RATE_BUCKETS.set(ip, fresh);
  return true;
}

function buildCorsHeaders(origin) {
  const headers = new Headers();
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, If-Modified-Since, If-None-Match');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return true;
  return allowedOrigins.has(origin);
}

function isAllowedTarget(targetUrl, config) {
  if (targetUrl.protocol !== 'https:') return false;
  if (!config.allowedHosts.has(targetUrl.hostname)) return false;
  if (targetUrl.username || targetUrl.password) return false;
  if (/(\.\.|%2e%2e)/i.test(targetUrl.pathname)) return false;
  const prefixes = config.allowedPathPrefixes[targetUrl.hostname] || [];
  if (prefixes.length === 0) return false;
  return prefixes.some((prefix) => targetUrl.pathname.startsWith(prefix));
}

function shouldEdgeCache(targetUrl, response) {
  if (!response.ok) return false;
  if (targetUrl.hostname === 'mg-api.ariedam.fr' && targetUrl.pathname === '/data') return true;
  if (
    targetUrl.hostname === 'mg-api.ariedam.fr' &&
    (targetUrl.pathname.startsWith('/assets/sprite-data') ||
      targetUrl.pathname.startsWith('/assets/cosmetics') ||
      targetUrl.pathname.startsWith('/assets/sprites/'))
  ) {
    return true;
  }
  if (targetUrl.hostname === 'magicgarden.gg' && targetUrl.pathname.startsWith('/version/')) return true;

  const contentType = response.headers.get('content-type') || '';
  return (
    contentType.startsWith('image/') ||
    contentType.startsWith('font/') ||
    contentType.includes('application/wasm') ||
    contentType.includes('text/css') ||
    contentType.includes('javascript')
  );
}

export async function handleProxyRequest(request, env = {}) {
  const config = createConfig(env);
  const method = request.method.toUpperCase();
  const origin = request.headers.get('origin') || '';
  const ip = getClientIp(request);

  if (!isAllowedOrigin(origin, config.allowedOrigins)) {
    logSecurity('blocked_origin', { origin, ip, method });
    return new Response('Forbidden origin', { status: 403 });
  }

  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: buildCorsHeaders(origin),
    });
  }

  if (method !== 'GET' && method !== 'HEAD') {
    logSecurity('blocked_method', { method, ip });
    return new Response('Method not allowed', { status: 405, headers: buildCorsHeaders(origin) });
  }

  if (config.rateLimitEnabled && !consumeRateLimit(ip, config.rateLimitRpm)) {
    logSecurity('rate_limited', { ip, method });
    return new Response('Rate limit exceeded', {
      status: 429,
      headers: buildCorsHeaders(origin),
    });
  }

  const { searchParams } = new URL(request.url);
  const target = searchParams.get('url') || '';
  if (!target || target.length > 2048) {
    return new Response('Missing or invalid ?url parameter', {
      status: 400,
      headers: buildCorsHeaders(origin),
    });
  }

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response('Invalid URL', { status: 400, headers: buildCorsHeaders(origin) });
  }

  if (!isAllowedTarget(targetUrl, config)) {
    logSecurity('blocked_target', { ip, target: targetUrl.href });
    return new Response('Forbidden target', { status: 403, headers: buildCorsHeaders(origin) });
  }

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort('timeout'), config.proxyTimeoutMs);
  let upstream;
  try {
    upstream = await fetch(targetUrl.href, {
      method,
      redirect: 'follow',
      signal: abortController.signal,
      cf: { cacheTtl: 3600 },
    });
  } catch (err) {
    logSecurity('upstream_error', { ip, target: targetUrl.href, error: String(err) });
    return new Response('Upstream fetch failed', {
      status: 502,
      headers: buildCorsHeaders(origin),
    });
  } finally {
    clearTimeout(timeout);
  }

  const headers = new Headers(upstream.headers);
  for (const [key, value] of buildCorsHeaders(origin).entries()) headers.set(key, value);
  if (shouldEdgeCache(targetUrl, upstream)) {
    headers.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  } else {
    headers.set('Cache-Control', 'no-store');
  }
  headers.delete('set-cookie');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    return handleProxyRequest(request, env);
  },
};
