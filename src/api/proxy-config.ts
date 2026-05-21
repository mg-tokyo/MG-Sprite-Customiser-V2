const DEBUG_PROXY_STORAGE_KEY = 'mg_sprite_proxy_debug';

export const BUILD_CORS_PROXY = import.meta.env.VITE_CORS_PROXY ?? '';
const ENABLE_PROXY_DEBUG = import.meta.env.VITE_ENABLE_PROXY_DEBUG === 'true';

export function isLocalhostHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  return hostname.endsWith('.localhost');
}

function isValidProxyPrefix(prefix: string): boolean {
  const trimmed = prefix.trim();
  if (!trimmed) return false;
  return trimmed.startsWith('https://') || trimmed.startsWith('http://');
}

function canUseRuntimeProxyOverride(): boolean {
  if (!ENABLE_PROXY_DEBUG) return false;
  if (typeof window === 'undefined') return false;
  return isLocalhostHost(window.location.hostname);
}

export function getRuntimeCorsProxy(): string {
  if (!canUseRuntimeProxyOverride()) return '';

  const params = new URLSearchParams(window.location.search);
  const qp = params.get('proxy')?.trim() ?? '';
  const wantsPersistence = params.get('proxyPersist') === '1';

  if (qp) {
    if (!isValidProxyPrefix(qp)) return '';
    try {
      if (wantsPersistence) localStorage.setItem(DEBUG_PROXY_STORAGE_KEY, qp);
      else localStorage.removeItem(DEBUG_PROXY_STORAGE_KEY);
    } catch {
      // Ignore storage failures in debug mode.
    }
    return qp;
  }

  try {
    const stored = localStorage.getItem(DEBUG_PROXY_STORAGE_KEY) ?? '';
    return isValidProxyPrefix(stored) ? stored : '';
  } catch {
    return '';
  }
}

export function resolveCorsProxy(): string {
  return getRuntimeCorsProxy() || BUILD_CORS_PROXY;
}
