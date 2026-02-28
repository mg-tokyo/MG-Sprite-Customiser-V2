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
      // Sanitize: clear blob URLs that can't survive across sessions
      for (const slot of data.slots) {
        if (slot.spriteUrl && slot.spriteUrl.startsWith('blob:')) {
          slot.spriteUrl = '';
          slot.isAnimated = false;
        }
      }
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
}

function cleanSlotsForPersistence(slots: Slot[]): Slot[] {
  return slots.map(s => {
    const { gifFrames: _gf, _gifFrameIdx: _idx, ...rest } = s;
    if (rest.spriteUrl && rest.spriteUrl.startsWith('blob:')) {
      return { ...rest, spriteUrl: '', isAnimated: false } as Slot;
    }
    return { ...rest, isAnimated: false } as Slot;
  });
}

export function listSavedScenes(): SavedScene[] {
  try {
    const raw = localStorage.getItem(SCENES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedScene[]).filter(s => s._v === SCENE_SCHEMA_VERSION);
  } catch {
    return [];
  }
}

export function saveNamedScene(name: string): void {
  const scene: SavedScene = {
    _v: SCENE_SCHEMA_VERSION,
    name: name.trim() || 'Untitled',
    savedAt: Date.now(),
    slots: cleanSlotsForPersistence(state.slots),
    activeSlotIndex: state.activeSlotIndex,
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
    // Sanitize blobs
    for (const slot of scene.slots) {
      if (slot.spriteUrl?.startsWith('blob:')) {
        slot.spriteUrl = '';
        slot.isAnimated = false;
      }
    }
    return scene;
  } catch {
    return null;
  }
}
