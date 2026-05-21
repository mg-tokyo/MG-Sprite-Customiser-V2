/**
 * Font definitions for the text layer feature.
 * Three tiers:
 *   1. MG Fonts  — Greycliff CF (7 weights) + Shrikhand, named by their UI role in-game
 *   2. System    — universally available fonts, no network requests
 *   3. Google    — curated popular picks + full search
 *   4. Unicode   — LingoJam-style character substitutions (no font loading)
 */

import { state } from '../state/store';
import { isLocalhostHost, resolveCorsProxy } from '../api/proxy-config';

// ── MG font CDN base URL (Vite content-hashed filenames from magicgarden.gg build) ──
// These are served as static Vite assets; the hash is baked into the filename.
const MG_CDN_FALLBACK = 'https://magicgarden.gg/assets';

const IS_DEV = import.meta.env.DEV;

function buildProxyUrl(prefix: string, target: string): string {
  if (!prefix) return target;
  if (prefix.includes('{url}')) return prefix.replace('{url}', encodeURIComponent(target));
  return `${prefix}${encodeURIComponent(target)}`;
}

function proxyUrl(url: string): string {
  if (IS_DEV) {
    if (url.startsWith('https://magicgarden.gg/')) {
      return url.replace('https://magicgarden.gg/', '/mggg-proxy/');
    }
    return url;
  }

  const isLocalhost =
    typeof window !== 'undefined' && isLocalhostHost(window.location.hostname);

  if (isLocalhost && url.startsWith('https://magicgarden.gg/')) {
    return url.replace('https://magicgarden.gg/', '/mggg-proxy/');
  }

  const corsProxy = resolveCorsProxy();
  if (corsProxy && url.startsWith('https://magicgarden.gg/')) {
    return buildProxyUrl(corsProxy, url);
  }

  return url;
}

function getMgCdnBases(): string[] {
  const version = state.gameVersion ?? '';
  if (version) {
    return [`https://magicgarden.gg/version/${version}/assets`, MG_CDN_FALLBACK];
  }
  return [MG_CDN_FALLBACK];
}

function resolveFontUrls(font: FontDef): string[] {
  if (font.woff2Url) return [font.woff2Url];
  if (font.woff2File) {
    return getMgCdnBases().map(base => `${base}/${font.woff2File}`);
  }
  return [];
}

export interface FontDef {
  id: string;
  label: string;
  /** CSS font-family value — what gets passed to ctx.font */
  family: string;
  /** CSS font-weight */
  weight: string;
  /** CSS font-style */
  style: string;
  /** Remote woff2 URL to load via FontFace API (undefined = no loading needed) */
  woff2Url?: string;
  /** Remote woff2 filename (used with magicgarden.gg asset base) */
  woff2File?: string;
  /** Google Fonts family query param for on-demand loading (e.g. 'Bebas+Neue') */
  gfFamily?: string;
  /** This font requires FontFace loading before it can be used */
  needsLoad?: boolean;
}

// ── 1. MG Fonts ──────────────────────────────────────────────────────────────
// Named by their role in the MG UI. Font files have content-hash suffixes from
// the Vite build. The CDN typically doesn't require CORS for font loads.
export const MG_FONTS: FontDef[] = [
  {
    id: 'mg-body',
    label: 'Body (light text)',
    family: 'Greycliff CF',
    weight: '400',
    style: 'normal',
    woff2File: 'GreycliffCF-Regular-D0Q0G3H6.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-subheading',
    label: 'Subheading (chat, menus)',
    family: 'Greycliff CF',
    weight: '500',
    style: 'normal',
    woff2File: 'GreycliffCF-Medium-Bq7MO2Nh.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-heading',
    label: 'Heading (inventory, names)',
    family: 'Greycliff CF',
    weight: '600',
    style: 'normal',
    woff2File: 'GreycliffCF-DemiBold-YCEdFtJd.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-bold-heading',
    label: 'Bold Heading (shops, pets)',
    family: 'Greycliff CF',
    weight: '700',
    style: 'normal',
    woff2File: 'GreycliffCF-Bold-DYxkH0oV.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-display',
    label: 'Display (modal headings)',
    family: 'Greycliff CF',
    weight: '800',
    style: 'normal',
    woff2File: 'GreycliffCF-ExtraBold-B6VqhyJG.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-heavy',
    label: 'Heavy (chat button)',
    family: 'Greycliff CF',
    weight: '900',
    style: 'normal',
    woff2File: 'GreycliffCF-Heavy-CrhSKyyL.woff2',
    needsLoad: true,
  },
  {
    id: 'mg-text-slapper',
    label: 'Shrikhand (textSlapper)',
    family: 'Shrikhand',
    weight: '400',
    style: 'normal',
    // Shrikhand is on Google Fonts; load from there (no CORS issues)
    gfFamily: 'Shrikhand',
    needsLoad: true,
  },
];

// ── 2. System Fonts ───────────────────────────────────────────────────────────
export const SYSTEM_FONTS: FontDef[] = [
  { id: 'sys-arial',         label: 'Arial',            family: 'Arial',            weight: '400', style: 'normal' },
  { id: 'sys-arial-black',   label: 'Arial Black',      family: 'Arial Black',       weight: '900', style: 'normal' },
  { id: 'sys-georgia',       label: 'Georgia',           family: 'Georgia',           weight: '400', style: 'normal' },
  { id: 'sys-courier',       label: 'Courier New',       family: 'Courier New',       weight: '400', style: 'normal' },
  { id: 'sys-verdana',       label: 'Verdana',           family: 'Verdana',           weight: '400', style: 'normal' },
  { id: 'sys-impact',        label: 'Impact',            family: 'Impact',            weight: '400', style: 'normal' },
  { id: 'sys-comic-sans',    label: 'Comic Sans MS',     family: 'Comic Sans MS',     weight: '400', style: 'normal' },
  { id: 'sys-trebuchet',     label: 'Trebuchet MS',      family: 'Trebuchet MS',      weight: '400', style: 'normal' },
  { id: 'sys-times',         label: 'Times New Roman',   family: 'Times New Roman',   weight: '400', style: 'normal' },
  { id: 'sys-palatino',      label: 'Palatino',          family: 'Palatino',          weight: '400', style: 'normal' },
];

// ── 3. Curated Google Fonts ───────────────────────────────────────────────────
export const GOOGLE_FONTS_CURATED: FontDef[] = [
  // Bold / Display
  { id: 'gf-bebas-neue',         label: 'Bebas Neue',        family: 'Bebas Neue',        weight: '400', style: 'normal', gfFamily: 'Bebas+Neue',         needsLoad: true },
  { id: 'gf-bangers',            label: 'Bangers',           family: 'Bangers',           weight: '400', style: 'normal', gfFamily: 'Bangers',             needsLoad: true },
  { id: 'gf-lilita-one',         label: 'Lilita One',        family: 'Lilita One',        weight: '400', style: 'normal', gfFamily: 'Lilita+One',          needsLoad: true },
  { id: 'gf-alfa-slab',          label: 'Alfa Slab One',     family: 'Alfa Slab One',     weight: '400', style: 'normal', gfFamily: 'Alfa+Slab+One',       needsLoad: true },
  { id: 'gf-righteous',          label: 'Righteous',         family: 'Righteous',         weight: '400', style: 'normal', gfFamily: 'Righteous',           needsLoad: true },
  { id: 'gf-fredoka',            label: 'Fredoka One',       family: 'Fredoka One',       weight: '400', style: 'normal', gfFamily: 'Fredoka+One',         needsLoad: true },
  // Handwriting
  { id: 'gf-lobster',            label: 'Lobster',           family: 'Lobster',           weight: '400', style: 'normal', gfFamily: 'Lobster',             needsLoad: true },
  { id: 'gf-pacifico',           label: 'Pacifico',          family: 'Pacifico',          weight: '400', style: 'normal', gfFamily: 'Pacifico',            needsLoad: true },
  { id: 'gf-dancing-script',     label: 'Dancing Script',    family: 'Dancing Script',    weight: '700', style: 'normal', gfFamily: 'Dancing+Script:wght@700', needsLoad: true },
  { id: 'gf-caveat',             label: 'Caveat',            family: 'Caveat',            weight: '700', style: 'normal', gfFamily: 'Caveat:wght@700',     needsLoad: true },
  { id: 'gf-permanent-marker',   label: 'Permanent Marker',  family: 'Permanent Marker',  weight: '400', style: 'normal', gfFamily: 'Permanent+Marker',    needsLoad: true },
  // Clean / Modern
  { id: 'gf-roboto',             label: 'Roboto',            family: 'Roboto',            weight: '700', style: 'normal', gfFamily: 'Roboto:wght@700',     needsLoad: true },
  { id: 'gf-lato',               label: 'Lato',              family: 'Lato',              weight: '700', style: 'normal', gfFamily: 'Lato:wght@700',       needsLoad: true },
  { id: 'gf-oswald',             label: 'Oswald',            family: 'Oswald',            weight: '700', style: 'normal', gfFamily: 'Oswald:wght@700',     needsLoad: true },
  { id: 'gf-raleway',            label: 'Raleway',           family: 'Raleway',           weight: '700', style: 'normal', gfFamily: 'Raleway:wght@700',    needsLoad: true },
  // Pixel / Retro
  { id: 'gf-press-start',        label: 'Press Start 2P',    family: 'Press Start 2P',    weight: '400', style: 'normal', gfFamily: 'Press+Start+2P',      needsLoad: true },
  { id: 'gf-silkscreen',         label: 'Silkscreen',        family: 'Silkscreen',        weight: '400', style: 'normal', gfFamily: 'Silkscreen',          needsLoad: true },
  { id: 'gf-vt323',              label: 'VT323',             family: 'VT323',             weight: '400', style: 'normal', gfFamily: 'VT323',               needsLoad: true },
];

// ── 4. Unicode (LingoJam-style) Styles ───────────────────────────────────────
export interface UnicodeDef {
  id: string;
  label: string;
  /** Transform a single character. Returns transformed string (may be multiple code units). */
  transform: (char: string) => string;
}

/** Build a char-map transformer from a codepoint offset for a–z range. */
function alphaOffset(lowerStart: number, upperStart: number): (c: string) => string {
  return (c: string) => {
    const code = c.codePointAt(0) ?? 0;
    if (code >= 0x61 && code <= 0x7A) return String.fromCodePoint(lowerStart + code - 0x61);
    if (code >= 0x41 && code <= 0x5A) return String.fromCodePoint(upperStart + code - 0x41);
    return c;
  };
}

const SMALL_CAPS_MAP: Record<string, string> = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ',
  j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ', n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'q', r: 'ʀ',
  s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

const UPSIDE_DOWN_MAP: Record<string, string> = {
  a: 'ɐ', b: 'q', c: 'ɔ', d: 'p', e: 'ǝ', f: 'ɟ', g: 'ƃ', h: 'ɥ', i: 'ᵢ',
  j: 'ɾ', k: 'ʞ', l: 'ʃ', m: 'ɯ', n: 'u', o: 'o', p: 'd', q: 'b', r: 'ɹ',
  s: 's', t: 'ʇ', u: 'n', v: 'ʌ', w: 'ʍ', x: 'x', y: 'ʎ', z: 'z',
  A: '∀', B: 'ᗺ', C: 'Ɔ', D: 'ᗡ', E: 'Ǝ', F: 'Ⅎ', G: 'פ', H: 'H', I: 'I',
  J: 'ɾ', K: 'ʞ', L: '˥', M: 'W', N: 'N', O: 'O', P: 'Ԁ', Q: 'Q', R: 'ᴚ',
  S: 'S', T: '┴', U: '∩', V: 'Λ', W: 'M', X: 'X', Y: '⅄', Z: 'Z',
};

export const UNICODE_STYLES: UnicodeDef[] = [
  {
    id: 'unicode-script',
    label: '𝓢𝓬𝓻𝓲𝓹𝓽  Script',
    // Mathematical Script Bold block (U+1D400 area)
    transform: alphaOffset(0x1D4EA, 0x1D4D0),
  },
  {
    id: 'unicode-fraktur',
    label: '𝔉𝔯𝔞𝔨𝔱𝔲𝔯  Fraktur',
    transform: alphaOffset(0x1D51E, 0x1D504),
  },
  {
    id: 'unicode-double-struck',
    label: '𝔻𝕠𝕦𝕓𝕝𝕖  Double-struck',
    transform: alphaOffset(0x1D552, 0x1D538),
  },
  {
    id: 'unicode-small-caps',
    label: 'ꜱᴍᴀʟʟ ᴄᴀᴘꜱ  Small Caps',
    transform: (c) => SMALL_CAPS_MAP[c] ?? c,
  },
  {
    id: 'unicode-upside-down',
    label: 'uʍop-ǝpᴉsdn  Upside-down',
    transform: (c) => {
      const flipped = UPSIDE_DOWN_MAP[c];
      return flipped ?? c;
    },
  },
  {
    id: 'unicode-vaporwave',
    label: 'Ｖａｐｏｒ  Vaporwave',
    transform: (c) => {
      const code = c.codePointAt(0) ?? 0;
      // Full-width: printable ASCII 0x21–0x7E → U+FF01–U+FF5E
      if (code >= 0x21 && code <= 0x7E) return String.fromCodePoint(0xFF01 + code - 0x21);
      if (code === 0x20) return '\u3000'; // ideographic space
      return c;
    },
  },
  {
    id: 'unicode-bold-serif',
    label: '𝐁𝐨𝐥𝐝  Bold Serif',
    transform: alphaOffset(0x1D41A, 0x1D400),
  },
  {
    id: 'unicode-strikethrough',
    label: 'S̶t̶r̶i̶k̶e̶  Strikethrough',
    transform: (c) => c + '\u0336',
  },
];

// ── Font loading helpers ──────────────────────────────────────────────────────

/** Tracks which fonts have already been loaded this session (by CSS font spec). */
const loadedFonts = new Set<string>();
const loadingFontTasks = new Map<string, Promise<void>>();

async function waitForFontReady(font: FontDef): Promise<boolean> {
  if (typeof document === 'undefined' || !('fonts' in document)) return false;
  const fontSpec = `${font.style} ${font.weight} 16px "${font.family}"`;
  const timeoutMs = 7000;
  try {
    await Promise.race([
      document.fonts.load(fontSpec).then(() => undefined),
      new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Ignore and fall back to check below.
  }
  return document.fonts.check(fontSpec);
}

/**
 * Ensure a font is available in document.fonts before canvas fillText.
 * - MG fonts: tries FontFace API from CDN (silently fails if CORS blocks it).
 * - Google Fonts: injects a <link> tag; waits for document.fonts.ready.
 * - System fonts: no-op.
 */
export async function ensureFontLoaded(font: FontDef): Promise<void> {
  if (!font.needsLoad) return;

  const specKey = `${font.family}-${font.weight}-${font.style}`;
  if (loadedFonts.has(specKey)) return;
  const existingTask = loadingFontTasks.get(specKey);
  if (existingTask) {
    await existingTask;
    return;
  }

  const task = (async () => {
    // Google Fonts (including Shrikhand)
    if (font.gfFamily) {
      const href = `https://fonts.googleapis.com/css2?family=${font.gfFamily}&display=swap`;
      let link = document.querySelector(`link[href="${href}"]`) as HTMLLinkElement | null;
      if (!link) {
        const newLink = document.createElement('link');
        newLink.rel = 'stylesheet';
        newLink.href = href;
        document.head.appendChild(newLink);
        await new Promise<void>((resolve) => {
          newLink.addEventListener('load', () => resolve(), { once: true });
          newLink.addEventListener('error', () => resolve(), { once: true });
          // Safety timeout so a blocked request doesn't hang render forever.
          setTimeout(resolve, 4500);
        });
        link = newLink;
      }
      // Force a direct readiness check for the requested face before drawing.
      if (typeof document !== 'undefined' && 'fonts' in document) {
        const fontSpec = `${font.style} ${font.weight} 16px "${font.family}"`;
        try {
          await Promise.race([
            document.fonts.load(fontSpec).then(() => undefined),
            new Promise<void>(resolve => setTimeout(resolve, 4500)),
          ]);
        } catch {
          // Fall through to check below.
        }
      }
      if (await waitForFontReady(font)) loadedFonts.add(specKey);
      return;
    }

    // MG CDN woff2 via FontFace API
    const urls = resolveFontUrls(font);
    for (const url of urls) {
      try {
        const fetchUrl = proxyUrl(url);
        const face = new FontFace(font.family, `url(${fetchUrl})`, {
          weight: font.weight,
          style: font.style,
        });
        const loaded = await face.load();
        document.fonts.add(loaded);
        if (await waitForFontReady(font)) {
          loadedFonts.add(specKey);
          return;
        }
      } catch {
        // Try the next candidate
      }
    }
  })();

  loadingFontTasks.set(specKey, task);
  try {
    await task;
  } finally {
    loadingFontTasks.delete(specKey);
  }
}

/**
 * Apply a Unicode style transformation to an entire string.
 * For upside-down, also reverses the character order.
 */
export function applyUnicodeStyle(text: string, styleId: string): string {
  const def = UNICODE_STYLES.find(s => s.id === styleId);
  if (!def) return text;

  const chars = [...text]; // spread handles surrogate pairs correctly
  const transformed = chars.map(def.transform);
  if (styleId === 'unicode-upside-down') transformed.reverse();
  return transformed.join('');
}
