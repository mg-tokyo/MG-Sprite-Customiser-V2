import { MAX_SLOTS, refreshBlobUrlTracking, state, type Slot } from './store';
import { RENDERER_VERSION } from '../../mg-sprite-render/src';

const STORAGE_KEY = 'mgsc_editor_state';
const SCHEMA_VERSION = 5; // Bump to invalidate stale persisted data

interface PersistedState {
  _v?: number;
  slots: Slot[];
  activeSlotIndex: number;
  theme: 'light' | 'dark';
  selectedCategory: string;
  previewZoom: number;
}

const REMOVED_OVERLAY_URLS = new Set([
  'overlays/connector-callout-number-1.svg',
  'overlays/connector-callout-number-2.svg',
]);

const REMOVED_OVERLAY_URL_PREFIXES = [
  'overlays/comic-',
  'overlays/weatherfx-',
  'overlays/hand-',
  'overlays/control-',
  'overlays/flame-',
];

const REMOVED_OVERLAY_KEYS = new Set([
  'overlay/connector-callout-number-1',
  'overlay/connector-callout-number-2',
]);

const REMOVED_OVERLAY_KEY_PREFIXES = [
  'overlay/comic-',
  'overlay/weatherfx-',
  'overlay/hand-',
  'overlay/control-',
  'overlay/flame-',
];

function isRemovedOverlayUrl(url: string | undefined): boolean {
  if (!url) return false;
  const normalized = url.toLowerCase();
  if (REMOVED_OVERLAY_URLS.has(normalized)) return true;
  return REMOVED_OVERLAY_URL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isRemovedOverlayKey(key: string | undefined): boolean {
  if (!key) return false;
  const normalized = key.toLowerCase();
  if (REMOVED_OVERLAY_KEYS.has(normalized)) return true;
  return REMOVED_OVERLAY_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function sanitizeSlotAssets(slot: Slot): void {
  if (slot.spriteUrl && slot.spriteUrl.startsWith('blob:')) {
    slot.spriteUrl = '';
    slot.isAnimated = false;
  }
  if (isRemovedOverlayUrl(slot.spriteUrl) || isRemovedOverlayKey(slot.spriteKey)) {
    slot.spriteUrl = '';
    slot.spriteKey = '';
    slot.isAnimated = false;
  }
}

function sanitizeSlots(slots: Slot[]): void {
  for (const slot of slots) sanitizeSlotAssets(slot);
}

export function saveState(): void {
  // Strip non-serializable GIF data from slots before persisting
  const cleanSlots = state.slots.map((s) => {
    const { gifFrames, _gifFrameIdx, ...rest } = s;
    return { ...rest, isAnimated: false };
  });
  const data: PersistedState = {
    _v: SCHEMA_VERSION,
    slots: cleanSlots as Slot[],
    activeSlotIndex: state.activeSlotIndex,
    theme: state.theme,
    selectedCategory: state.selectedCategory,
    previewZoom: state.previewZoom,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full
  }
}

export function restoreState(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data: PersistedState = JSON.parse(raw);
    if (data._v !== SCHEMA_VERSION) {
      // Stale schema — wipe and start fresh
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    if (data.slots) {
      sanitizeSlots(data.slots);
      state.slots = data.slots;
      refreshBlobUrlTracking();
    }
    if (typeof data.activeSlotIndex === 'number') state.activeSlotIndex = data.activeSlotIndex;
    if (data.theme) state.theme = data.theme;
    if (data.selectedCategory) state.selectedCategory = data.selectedCategory;
    if (typeof data.previewZoom === 'number') state.previewZoom = data.previewZoom;
  } catch {
    // Corrupt data, ignore
  }
}

// ── Named scenes ─────────────────────────────────────────────────────────────

const SCENES_KEY = 'mgsc_named_scenes';
const SCENE_SCHEMA_VERSION = 2;
const SCENE_SCHEMA_VERSION_LEGACY = 1;
const MAX_SCENES = 50;
const MAX_SCENE_JSON_CHARS = 2_000_000;
const MAX_SCENE_NAME_LENGTH = 80;
const MAX_SLOT_STRING_LENGTH = 320;
const MAX_CONTENT_STRING_LENGTH = 5000;
const MAX_MUTATIONS_PER_SLOT = 64;
const MAX_SCENE_THUMBNAIL_CHARS = 900_000;
const MAX_COLOR_STRING_LENGTH = 32;

export interface SavedScene {
  _v: number;
  name: string;
  savedAt: number;
  slots: Slot[];
  activeSlotIndex: number;
  /** Small JPEG data URL of the canvas at save time (optional, older saves won't have it). */
  thumbnail?: string;
}

export type SceneImportResult =
  | { ok: true; scene: SavedScene }
  | { ok: false; error: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampNumber(value, min, max, fallback));
}

function clampText(value: unknown, maxLen: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  return trimmed.slice(0, maxLen);
}

function isSafeSpriteUrl(raw: string): boolean {
  if (!raw) return true;
  if (/^[a-z0-9-]+:$/i.test(raw)) return true; // Internal sentinels like text:/blobling:
  if (raw.startsWith('overlays/')) return true;
  if (raw.startsWith('blob:')) return true;
  if (raw.startsWith('data:image/')) return true;
  if (raw.startsWith('/')) return true;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function sanitizeColor(value: unknown, fallback: string): string {
  const raw = clampText(value, MAX_COLOR_STRING_LENGTH, fallback);
  if (!raw) return fallback;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) return raw;
  return fallback;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return undefined;
  if (value == null) return value;
  if (typeof value === 'string') return value.slice(0, MAX_CONTENT_STRING_LENGTH);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 120).map((entry) => sanitizeJsonValue(entry, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (count >= 160) break;
      out[key.slice(0, 80)] = sanitizeJsonValue(entry, depth + 1);
      count += 1;
    }
    return out;
  }
  return undefined;
}

function createDefaultSlot(index: number): Slot {
  return {
    id: `slot-${index}`,
    type: 'sprite',
    spriteKey: '',
    spriteUrl: '',
    mutations: [],
    options: { icons: true, overlays: true },
    customTint: { color: '#ffffff', opacity: 0 },
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    visible: true,
    locked: false,
  };
}

function normalizeSlot(rawSlot: unknown, index: number): Slot {
  const raw = asRecord(rawSlot);
  const base = createDefaultSlot(index);
  if (!raw) return base;

  const rawType = clampText(raw.type, 20, base.type);
  if (rawType === 'sprite' || rawType === 'custom' || rawType === 'cosmetic' || rawType === 'text' || rawType === 'full-card') {
    base.type = rawType;
  }

  base.id = clampText(raw.id, 64, base.id);
  base.spriteKey = clampText(raw.spriteKey, MAX_SLOT_STRING_LENGTH, '');

  const spriteUrl = clampText(raw.spriteUrl, MAX_CONTENT_STRING_LENGTH, '');
  base.spriteUrl = isSafeSpriteUrl(spriteUrl) ? spriteUrl : '';

  const rawMutations = Array.isArray(raw.mutations) ? raw.mutations : [];
  base.mutations = rawMutations
    .slice(0, MAX_MUTATIONS_PER_SLOT)
    .map((entry) => clampText(entry, 80))
    .filter(Boolean);

  const options = asRecord(raw.options);
  base.options = {
    icons: typeof options?.icons === 'boolean' ? options.icons : true,
    overlays: typeof options?.overlays === 'boolean' ? options.overlays : true,
  };

  const customTint = asRecord(raw.customTint);
  base.customTint = {
    color: sanitizeColor(customTint?.color, '#ffffff'),
    opacity: clampNumber(customTint?.opacity, 0, 1, 0),
  };

  const position = asRecord(raw.position);
  base.position = {
    x: clampNumber(position?.x, -6000, 6000, 0),
    y: clampNumber(position?.y, -6000, 6000, 0),
  };

  base.scale =
    base.type === 'text'
      ? clampNumber(raw.scale, 8, 200, 36)
      : clampNumber(raw.scale, 0.1, 4, 1);
  base.rotation = clampNumber(raw.rotation, -360, 360, 0);
  base.visible = typeof raw.visible === 'boolean' ? raw.visible : true;
  base.locked = typeof raw.locked === 'boolean' ? raw.locked : false;
  base.isAnimated = typeof raw.isAnimated === 'boolean' ? raw.isAnimated : false;

  if (raw.bloblingAnimId != null) {
    base.bloblingAnimId = clampText(raw.bloblingAnimId, 40);
  }

  const cosmeticLayers = asRecord(raw.cosmeticLayers);
  if (cosmeticLayers) {
    const normalized: Record<string, string> = {};
    let count = 0;
    for (const [key, value] of Object.entries(cosmeticLayers)) {
      if (count >= 16) break;
      const sk = clampText(key, 40);
      const sv = clampText(value, 120);
      if (sk && sv) normalized[sk] = sv;
      count += 1;
    }
    if (Object.keys(normalized).length > 0) base.cosmeticLayers = normalized;
  }

  const textData = asRecord(raw.textData);
  if (textData) {
    base.textData = {
      content: clampText(textData.content, MAX_CONTENT_STRING_LENGTH),
      fontFamily: clampText(textData.fontFamily, 120, 'Greycliff CF'),
      fontLabel: clampText(textData.fontLabel, 120, 'Custom'),
      fontWeight: clampText(textData.fontWeight, 20, '400'),
      fontStyle: clampText(textData.fontStyle, 20, 'normal'),
      fontSize: clampNumber(textData.fontSize, 8, 200, 36),
      align:
        textData.align === 'left' || textData.align === 'center' || textData.align === 'right'
          ? textData.align
          : 'center',
      wordWrap: typeof textData.wordWrap === 'boolean' ? textData.wordWrap : true,
      wordWrapWidth: clampNumber(textData.wordWrapWidth, 40, 2000, 520),
      bold: !!textData.bold,
      italic: !!textData.italic,
      mgShadow: !!textData.mgShadow,
      strokeEnabled: !!textData.strokeEnabled,
      strokeColor: sanitizeColor(textData.strokeColor, '#000000'),
      strokeWidth: clampNumber(textData.strokeWidth, 0, 40, 0),
      unicodeStyle: clampText(textData.unicodeStyle, 60) || undefined,
      gfFamily: clampText(textData.gfFamily, 120) || undefined,
    };
  }

  const fullCardData = sanitizeJsonValue(raw.fullCardData);
  if (asRecord(fullCardData)) base.fullCardData = fullCardData as Slot['fullCardData'];
  const petBarData = sanitizeJsonValue(raw.petBarData);
  if (asRecord(petBarData)) base.petBarData = petBarData as Slot['petBarData'];

  sanitizeSlotAssets(base);
  return base;
}

function normalizeSceneLike(parsed: unknown): SavedScene | null {
  const raw = asRecord(parsed);
  if (!raw) return null;

  const version = clampInt(raw._v, 0, 999, 0);
  if (version !== SCENE_SCHEMA_VERSION && version !== SCENE_SCHEMA_VERSION_LEGACY) return null;

  const slotsRaw = Array.isArray(raw.slots) ? raw.slots : [];
  const normalizedSlots = slotsRaw
    .slice(0, MAX_SLOTS)
    .map((entry, index) => normalizeSlot(entry, index));

  if (normalizedSlots.length === 0) return null;

  const normalized: SavedScene = {
    _v: SCENE_SCHEMA_VERSION,
    name: clampText(raw.name, MAX_SCENE_NAME_LENGTH, 'Untitled'),
    savedAt: clampInt(raw.savedAt, 0, 9_999_999_999_999, Date.now()),
    slots: normalizedSlots,
    activeSlotIndex: clampInt(raw.activeSlotIndex, 0, normalizedSlots.length - 1, 0),
  };

  const thumbnail = clampText(raw.thumbnail, MAX_SCENE_THUMBNAIL_CHARS);
  if (thumbnail.startsWith('data:image/')) normalized.thumbnail = thumbnail;
  return normalized;
}

function parseSceneJson(rawJson: string): SceneImportResult {
  if (rawJson.length > MAX_SCENE_JSON_CHARS) {
    return { ok: false, error: 'Scene file is too large.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return { ok: false, error: 'Scene file is not valid JSON.' };
  }

  const normalized = normalizeSceneLike(parsed);
  if (!normalized) {
    return { ok: false, error: 'Scene file has an unsupported or invalid structure.' };
  }

  return { ok: true, scene: normalized };
}

export function listSavedScenes(): SavedScene[] {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const scenes: SavedScene[] = [];
    for (const sceneRaw of parsed) {
      const normalized = normalizeSceneLike(sceneRaw);
      if (!normalized) continue;
      scenes.push(normalized);
      if (scenes.length >= MAX_SCENES) break;
    }
    return scenes;
  } catch {
    return [];
  }
}

/** Max base64 size per custom image — keeps localStorage from overflowing. */
const MAX_IMAGE_DATA_URL_BYTES = 800_000;

async function blobUrlToDataUrl(blobUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(blobUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function cleanSlotsWithImages(slots: Slot[]): Promise<Slot[]> {
  return Promise.all(
    slots.map(async (s, index) => {
      const normalized = normalizeSlot(s, index);
      const { gifFrames: _gf, _gifFrameIdx: _idx, ...rest } = normalized;
      if (rest.spriteUrl?.startsWith('blob:')) {
        const dataUrl = await blobUrlToDataUrl(rest.spriteUrl);
        if (dataUrl && dataUrl.length < MAX_IMAGE_DATA_URL_BYTES) {
          return { ...rest, spriteUrl: dataUrl, isAnimated: false } as Slot;
        }
        return { ...rest, spriteUrl: '', isAnimated: false } as Slot;
      }
      return { ...rest, isAnimated: false } as Slot;
    }),
  );
}

export async function saveNamedScene(name: string, thumbnail?: string): Promise<void> {
  const scene: SavedScene = {
    _v: SCENE_SCHEMA_VERSION,
    name: clampText(name, MAX_SCENE_NAME_LENGTH, 'Untitled'),
    savedAt: Date.now(),
    slots: await cleanSlotsWithImages(state.slots),
    activeSlotIndex: clampInt(state.activeSlotIndex, 0, Math.max(0, state.slots.length - 1), 0),
    thumbnail: thumbnail?.startsWith('data:image/')
      ? clampText(thumbnail, MAX_SCENE_THUMBNAIL_CHARS)
      : undefined,
  };
  const scenes = listSavedScenes();
  scenes.unshift(scene); // newest first
  try {
    localStorage.setItem(SCENES_KEY, JSON.stringify(scenes.slice(0, MAX_SCENES)));
  } catch {
    // Storage full
  }
}

export function deleteNamedScene(index: number): void {
  const scenes = listSavedScenes();
  scenes.splice(index, 1);
  try {
    localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
  } catch {
    // Storage full
  }
}

export interface FilteredSlotSummary {
  keptSpriteCount: number;
  skipped: { text: number; fullCard: number; cosmetic: number; custom: number };
}

export function getFilteredSlotSummary(scene: SavedScene): FilteredSlotSummary {
  const skipped = { text: 0, fullCard: 0, cosmetic: 0, custom: 0 };
  let kept = 0;
  for (const s of scene.slots) {
    if (s.type === 'sprite') { kept += 1; continue; }
    if (s.type === 'text') skipped.text += 1;
    else if (s.type === 'full-card') skipped.fullCard += 1;
    else if (s.type === 'cosmetic') skipped.cosmetic += 1;
    else if (s.type === 'custom') skipped.custom += 1;
  }
  return { keptSpriteCount: kept, skipped };
}

// Pure so the QPM v1 serialization can be unit-tested without a localStorage stub.
export function serializeSceneAsQpmV1(scene: SavedScene): string {
  const spriteSlots = scene.slots.filter((s) => s.type === 'sprite' && s.visible !== false);
  const normalized = spriteSlots.map((s, i) => ({
    id: s.id,
    type: 'sprite' as const,
    spriteKey: s.spriteKey,
    mutations: s.mutations ?? [],
    tint: { color: s.customTint?.color ?? '#ffffff', opacity: s.customTint?.opacity ?? 0 },
    transform: {
      x: s.position?.x ?? 0,
      y: s.position?.y ?? 0,
      scale: s.scale ?? 1,
      rotation: (s.rotation ?? 0) * (Math.PI / 180),
      anchor: 'auto' as const,
    },
    options: { icons: s.options?.icons ?? true, overlays: s.options?.overlays ?? true },
    visible: true,
    zIndex: i,
  }));

  return JSON.stringify({
    $schema: 'mgscene/v1',
    name: scene.name,
    createdAt: new Date().toISOString(),
    rendererVersion: RENDERER_VERSION,
    capabilities: ['sprite'],
    canvas: { width: 256, height: 256, originAnchor: 'top-left' },
    slots: normalized,
  }, null, 2);
}

export function exportSceneJson(sceneIndex: number, opts?: { forQpmV1?: boolean }): string {
  const scenes = listSavedScenes();
  const scene = scenes[sceneIndex];
  if (!scene) return '{}';
  if (!opts?.forQpmV1) return JSON.stringify(scene, null, 2);
  return serializeSceneAsQpmV1(scene);
}

export function importSceneJson(json: string): SceneImportResult {
  return parseSceneJson(json);
}
