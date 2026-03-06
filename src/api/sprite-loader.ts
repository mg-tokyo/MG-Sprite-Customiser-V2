interface QueueItem {
  url: string;
  resolve: (img: HTMLImageElement) => void;
  reject: (err: Error) => void;
  priority: number;
}

const MAX_CONCURRENCY = 6;
const MAX_CACHE_SIZE = 500;

const IS_DEV = import.meta.env.DEV;

/**
 * Optional CORS proxy prefix for production builds (set via VITE_CORS_PROXY env var).
 * e.g. "https://corsproxy.io/?url=" — appended with encodeURIComponent(targetUrl).
 */
const BUILD_CORS_PROXY = import.meta.env.VITE_CORS_PROXY ?? '';

function isLocalhostHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  return hostname.endsWith('.localhost');
}

function getRuntimeCorsProxy(): string {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams(window.location.search);
  const qp = params.get('proxy')?.trim() ?? '';
  if (qp) {
    try {
      const parsed = new URL(qp);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        try {
          localStorage.setItem('mg_sprite_proxy', qp);
        } catch {
          // ignore storage errors
        }
        return qp;
      }
    } catch {
      // ignore invalid query param
    }
  }

  try {
    return localStorage.getItem('mg_sprite_proxy') ?? '';
  } catch {
    return '';
  }
}

const RUNTIME_CORS_PROXY = getRuntimeCorsProxy();

function buildProxyUrl(prefix: string, target: string): string {
  if (!prefix) return target;
  if (prefix.includes('{url}')) return prefix.replace('{url}', encodeURIComponent(target));
  return `${prefix}${encodeURIComponent(target)}`;
}

/**
 * Rewrite external URLs to a CORS-safe form.
 *
 * Dev:        route through Vite's proxy rules (/api → mg-api, /mggg-proxy → magicgarden.gg)
 * Production: neither mg-api.ariedam.fr nor magicgarden.gg serve images with CORS headers,
 *             so both are routed through VITE_CORS_PROXY when set.
 *             The proxy is called as: `${CORS_PROXY}${encodeURIComponent(originalUrl)}`
 */
export function proxyUrl(url: string): string {
  if (IS_DEV) {
    if (url.startsWith('https://mg-api.ariedam.fr/')) {
      return url.replace('https://mg-api.ariedam.fr/', '/api/');
    }
    if (url.startsWith('https://magicgarden.gg/')) {
      return url.replace('https://magicgarden.gg/', '/mggg-proxy/');
    }
    return url;
  }

  const isLocalhost =
    typeof window !== 'undefined' && isLocalhostHost(window.location.hostname);

  // Local preview: use the same Vite proxy paths even in production builds.
  if (isLocalhost) {
    if (url.startsWith('https://mg-api.ariedam.fr/')) {
      return url.replace('https://mg-api.ariedam.fr/', '/api/');
    }
    if (url.startsWith('https://magicgarden.gg/')) {
      return url.replace('https://magicgarden.gg/', '/mggg-proxy/');
    }
  }

  const corsProxy = RUNTIME_CORS_PROXY || BUILD_CORS_PROXY;
  // Production: proxy both game asset domains directly (no URL rewriting)
  if (
    corsProxy &&
    (url.startsWith('https://mg-api.ariedam.fr/') || url.startsWith('https://magicgarden.gg/'))
  ) {
    return buildProxyUrl(corsProxy, url);
  }

  return url;
}

export class SpriteLoader {
  private cache = new Map<string, HTMLImageElement>();
  private pending = new Map<string, Promise<HTMLImageElement>>();
  private queue: QueueItem[] = [];
  private activeCount = 0;
  private lruOrder: string[] = [];
  private fallbackImagePromise: Promise<HTMLImageElement> | null = null;

  async load(url: string, priority = 0): Promise<HTMLImageElement> {
    const cached = this.cache.get(url);
    if (cached) {
      this.touchLru(url);
      return cached;
    }

    const inflight = this.pending.get(url);
    if (inflight) return inflight;

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
      this.queue.push({ url, resolve, reject, priority });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processQueue();
    });

    this.pending.set(url, promise);
    promise.finally(() => this.pending.delete(url));
    return promise;
  }

  getCached(url: string): HTMLImageElement | null {
    return this.cache.get(url) ?? null;
  }

  preloadUrls(urls: string[]): void {
    for (const url of urls) {
      if (!this.cache.has(url) && !this.pending.has(url)) {
        this.load(url, -1); // Low priority
      }
    }
  }

  private processQueue(): void {
    while (this.activeCount < MAX_CONCURRENCY && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.activeCount++;
      this.fetchImage(item.url)
        .then((img) => {
          this.storeInCache(item.url, img);
          item.resolve(img);
        })
        .catch((err) => item.reject(err))
        .finally(() => {
          this.activeCount--;
          this.processQueue();
        });
    }
  }

  private async fetchImage(url: string): Promise<HTMLImageElement> {
    // Use fetch + blob to avoid CORS issues with canvas taint
    const fetchUrl = proxyUrl(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        console.warn(`[SpriteLoader] Missing asset, using fallback: ${url}`);
        return this.getFallbackImage();
      }
      throw new Error(`Failed to load: ${url} (${res.status})`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error(`Failed to decode: ${url}`));
      };
      img.src = blobUrl;
    });
  }

  private getFallbackImage(): Promise<HTMLImageElement> {
    if (this.fallbackImagePromise) return this.fallbackImagePromise;
    this.fallbackImagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const dataUrl = canvas.toDataURL('image/png');
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to decode fallback image'));
      img.src = dataUrl;
    });
    return this.fallbackImagePromise;
  }

  private storeInCache(url: string, img: HTMLImageElement): void {
    if (this.cache.size >= MAX_CACHE_SIZE) {
      const evict = this.lruOrder.shift();
      if (evict) this.cache.delete(evict);
    }
    this.cache.set(url, img);
    this.lruOrder.push(url);
  }

  private touchLru(url: string): void {
    const idx = this.lruOrder.indexOf(url);
    if (idx !== -1) {
      this.lruOrder.splice(idx, 1);
      this.lruOrder.push(url);
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.lruOrder = [];
  }
}

export const spriteLoader = new SpriteLoader();
