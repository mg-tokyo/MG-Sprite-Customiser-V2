import { state, type Slot } from './store';

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
  const cleanSlots = state.slots.map(s => {
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
const SCENE_SCHEMA_VERSION = 1;
const MAX_SCENES = 50;

export interface SavedScene {
  _v: number;
  name: string;
  savedAt: number;
  slots: Slot[];
  activeSlotIndex: number;
  /** Small JPEG data URL of the canvas at save time (optional, older saves won't have it). */
  thumbnail?: string;
}

export function listSavedScenes(): SavedScene[] {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const scenes = (parsed as SavedScene[]).filter(s => s._v === SCENE_SCHEMA_VERSION);
    for (const scene of scenes) sanitizeSlots(scene.slots);
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
    slots.map(async s => {
      const { gifFrames: _gf, _gifFrameIdx: _idx, ...rest } = s;
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
    name: name.trim() || 'Untitled',
    savedAt: Date.now(),
    slots: await cleanSlotsWithImages(state.slots),
    activeSlotIndex: state.activeSlotIndex,
    thumbnail,
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

export function exportSceneJson(sceneIndex: number): string {
  const scenes = listSavedScenes();
  const scene = scenes[sceneIndex];
  if (!scene) return '{}';
  return JSON.stringify(scene, null, 2);
}

export function importSceneJson(json: string): SavedScene | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed._v !== SCENE_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.slots)) return null;
    const scene = parsed as unknown as SavedScene;
    sanitizeSlots(scene.slots);
    return scene;
  } catch {
    return null;
  }
}
