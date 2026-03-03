import type { GameData, SpriteDataResponse, CosmeticsResponse } from '../api/types';
import { bus, Events } from '../utils/events';

export type FullCardType   = 'Pet' | 'Plant' | 'Crop' | 'Seed' | 'Egg' | 'Tool' | 'Decor';
export type FullCardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Legendary' | 'Mythic' | 'Divine' | 'Celestial';

export interface FullCardAbilityEntry {
  kind: 'game' | 'custom';
  /** Ability id (for game abilities). */
  id?: string;
  /** Display name (for custom abilities). */
  name?: string;
  /** Custom color (hex) for custom abilities. */
  color?: string;
}

/** A single sprite slot in a diet / crop / egg-hatch list. */
export interface FullCardSpriteSlot {
  /** Sprite id (e.g. 'sprite/pets/Cat'). Empty string = blank/no sprite. */
  spriteKey: string;
  /** Active mutation ids for this slot. */
  mutations: string[];
  /** Optional %-label (egg hatch rates only). */
  pctText?: string;
}

export interface FullCardData {
  cardType:   FullCardType;
  itemName:   string;
  /** Plant card: total slot count (>= 1). */
  plantSlotCount?: number;
  /** Plant card: number of mature slots (0..plantSlotCount). */
  plantMaturedSlots?: number;
  /** Plant card: maturity progress percent (0..100). */
  plantMaturityPct?: number;
  // Pet-specific
  rarity?:    FullCardRarity;
  /** Pet ability rows (game/custom). */
  petAbilityEntries?: FullCardAbilityEntry[];
  petAge?:    string;
  petMaxStr?: string;    // max STR level (e.g. "80")
  petStr?:    string;    // current STR level (e.g. "50")
  petStrPct?: number;    // 0–100; XP progress within current STR level (bar fill)
  petWeight?: string;    // e.g. "12.5 kg"
  petSellPrice?: string; // displayed coin sell price (e.g. "1,000")
  petHungerPct?: number; // 0–100; hunger bar fill percent
  petDietSlots?: FullCardSpriteSlot[];
  // Count-based (Seed, Tool, Decor, Egg)
  itemCount?: string;
  // Crop / Plant produce
  cropWeight?: string;
  cropSellPrice?: string;
  cropSlots?: FullCardSpriteSlot[];      // matured crop sprites (Plant/Crop cards)
  // Egg hatch
  eggHatchSlots?: FullCardSpriteSlot[];  // hatch species sprites
  eggGoldRateText?: string;
  eggRainbowRateText?: string;
  // Tool description
  toolDescription?: string;
  // Seed rarity chip
  seedRarity?: FullCardRarity;
  // Whether the game item shows as locked (padlock icon on portrait)
  isLocked?: boolean;
  // Custom bar labels (pet card only)
  petStrLabel?: string;    // defaults to 'Strength' if blank
  petHungerLabel?: string; // defaults to 'Hunger' if blank
  /** Pet strength/hunger bar fill colors. */
  petStrColor?: string;
  petHungerColor?: string;
  /** Left padding between label area and bar track. */
  petStrLabelPadding?: number;
  petHungerLabelPadding?: number;
  /** Optional custom icon refs (sprite id or direct image URL). */
  petStrCurrentIcon?: string;
  petStrNextIcon?: string;
  petStrMaxIcon?: string;
}

export type PetBarKind = 'hunger' | 'strength';

export interface PetBarData {
  kind: PetBarKind;
  /** Label shown at the left side of the bar. */
  label: string;
  /** Row width used by the renderer. */
  length: number;
  /** Progress fill percent (0..100). */
  progressPct: number;
  /** Fill color for this bar. */
  barColor?: string;
  /** Left padding between label area and bar track. */
  labelPadding?: number;
  /** Strength-only value labels. */
  currentStr?: string;
  nextStr?: string;
  maxStr?: string;
  /** Strength-only icon refs (sprite id or direct image URL). */
  currentIcon?: string;
  nextIcon?: string;
  maxIcon?: string;
  /** Hunger-only diet slots. */
  dietSlots?: FullCardSpriteSlot[];
}

export interface TextData {
  content: string;
  /** CSS font-family string (e.g. 'Greycliff CF', 'Impact') */
  fontFamily: string;
  /** Display label shown in the font picker */
  fontLabel: string;
  /** CSS font-weight (e.g. '400', '700') */
  fontWeight: string;
  /** CSS font-style ('normal' | 'italic') */
  fontStyle: string;
  /** Font size in px (8–200). Stored in slot.scale for UI reuse. */
  fontSize: number;
  align: 'left' | 'center' | 'right';
  wordWrap: boolean;
  /** Max line width in px before wrapping */
  wordWrapWidth: number;
  bold: boolean;
  italic: boolean;
  /** Apply MG textSlapper shadow: -3px 5px 0 rgba(0,0,0,0.25) */
  mgShadow: boolean;
  strokeEnabled: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** LingoJam unicode style key, or undefined for no transformation */
  unicodeStyle?: string;
  /** Google Fonts family URL param (e.g. 'Bebas+Neue'), if applicable */
  gfFamily?: string;
}

export interface Slot {
  id: string;
  type: 'sprite' | 'custom' | 'cosmetic' | 'text' | 'full-card';
  spriteKey: string;
  spriteUrl: string;
  mutations: string[];
  options: { icons: boolean; overlays: boolean };
  customTint: { color: string; opacity: number };
  position: { x: number; y: number };
  /** For text slots: font size in px (8–200). For sprite slots: render scale (0.1–4). */
  scale: number;
  rotation: number;
  visible: boolean;
  locked: boolean;
  cosmeticLayers?: Record<string, string>;
  /** Blobling rig: animation ID to apply (e.g. 'animation/Blobling/Walk'). */
  bloblingAnimId?: string;
  textData?: TextData;
  fullCardData?: FullCardData;
  petBarData?: PetBarData;
  fullCardVariantId?: string;
  fullCardVariantSource?: 'builtin' | 'user';
  // GIF animation data (not persisted)
  gifFrames?: { canvas: HTMLCanvasElement; delay: number }[];
  isAnimated?: boolean;
  /** Transient: current frame index for animated preview (not persisted) */
  _gifFrameIdx?: number;
}

export interface AppState {
  gameData: GameData | null;
  spriteData: SpriteDataResponse | null;
  cosmeticsData: CosmeticsResponse | null;
  gameVersion: string | null;

  mode: 'sprites' | 'cosmetics';
  slots: Slot[];
  activeSlotIndex: number;
  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  theme: 'light' | 'dark';
  selectedCategory: string;
  searchQuery: string;
  previewZoom: number;

  
}

function createEmptySlot(index: number): Slot {
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

interface HistorySnapshot {
  slots: Slot[];
  activeSlotIndex: number;
  meta?: unknown;
}

type HistoryMetaCapture = () => unknown;
type HistoryMetaRestore = (meta: unknown) => void;

function cloneSpriteSlot(slot: FullCardSpriteSlot): FullCardSpriteSlot {
  return {
    ...slot,
    mutations: [...slot.mutations],
  };
}

function cloneFullCardAbilityEntry(entry: FullCardAbilityEntry): FullCardAbilityEntry {
  return { ...entry };
}

function cloneFullCardData(data: FullCardData): FullCardData {
  return {
    ...data,
    petAbilityEntries: data.petAbilityEntries?.map(cloneFullCardAbilityEntry),
    petDietSlots: data.petDietSlots?.map(cloneSpriteSlot),
    cropSlots: data.cropSlots?.map(cloneSpriteSlot),
    eggHatchSlots: data.eggHatchSlots?.map(cloneSpriteSlot),
  };
}

function clonePetBarData(data: PetBarData): PetBarData {
  return {
    ...data,
    dietSlots: data.dietSlots?.map(cloneSpriteSlot),
  };
}

function cloneSlot(slot: Slot): Slot {
  return {
    ...slot,
    mutations: [...slot.mutations],
    options: { ...slot.options },
    customTint: { ...slot.customTint },
    position: { ...slot.position },
    cosmeticLayers: slot.cosmeticLayers ? { ...slot.cosmeticLayers } : undefined,
    textData: slot.textData ? { ...slot.textData } : undefined,
    fullCardData: slot.fullCardData ? cloneFullCardData(slot.fullCardData) : undefined,
    petBarData: slot.petBarData ? clonePetBarData(slot.petBarData) : undefined,
    gifFrames: slot.gifFrames?.map(frame => ({ canvas: frame.canvas, delay: frame.delay })),
  };
}

function cloneSlots(slots: Slot[]): Slot[] {
  return slots.map(cloneSlot);
}

const INITIAL_SLOTS = 20;
export const MAX_SLOTS = 100;
const MAX_UNDO = 50;
let historyMetaCapture: HistoryMetaCapture | null = null;
let historyMetaRestore: HistoryMetaRestore | null = null;
let singleUndoDepth = 0;
let singleUndoCaptured = false;

export const state: AppState = {
  gameData: null,
  spriteData: null,
  cosmeticsData: null,
  gameVersion: null,

  mode: 'sprites',
  slots: Array.from({ length: INITIAL_SLOTS }, (_, i) => createEmptySlot(i)),
  activeSlotIndex: 0,
  undoStack: [],
  redoStack: [],

  theme: 'dark',
  selectedCategory: 'plants',
  searchQuery: '',
  previewZoom: 1,
};

function clampActiveSlotIndex(index: number, slotsLength = state.slots.length): number {
  if (slotsLength <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  const normalized = Math.trunc(index);
  return Math.max(0, Math.min(normalized, slotsLength - 1));
}

function ensureValidActiveSlot(): void {
  if (state.slots.length === 0) state.slots = [createEmptySlot(0)];
  state.activeSlotIndex = clampActiveSlotIndex(state.activeSlotIndex, state.slots.length);
}

function createHistorySnapshot(): HistorySnapshot {
  let meta: unknown;
  if (historyMetaCapture) {
    try {
      meta = historyMetaCapture();
    } catch (err) {
      console.error('[Store] History meta capture failed:', err);
      meta = undefined;
    }
  }
  return {
    slots: cloneSlots(state.slots),
    activeSlotIndex: clampActiveSlotIndex(state.activeSlotIndex, state.slots.length),
    meta,
  };
}

function applyHistorySnapshot(snapshot: HistorySnapshot): void {
  state.slots = cloneSlots(snapshot.slots);
  if (state.slots.length === 0) state.slots = [createEmptySlot(0)];
  state.activeSlotIndex = clampActiveSlotIndex(snapshot.activeSlotIndex, state.slots.length);
  if (historyMetaRestore) {
    try {
      historyMetaRestore(snapshot.meta);
    } catch (err) {
      console.error('[Store] History meta restore failed:', err);
    }
  }
}

export function getActiveSlot(): Slot {
  ensureValidActiveSlot();
  return state.slots[state.activeSlotIndex];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as PromiseLike<unknown>).then === 'function';
}

function beginSingleUndoTransaction(): void {
  singleUndoDepth += 1;
  if (singleUndoDepth === 1) singleUndoCaptured = false;
}

function endSingleUndoTransaction(): void {
  if (singleUndoDepth === 0) return;
  singleUndoDepth -= 1;
  if (singleUndoDepth === 0) singleUndoCaptured = false;
}

export function setHistoryMetaHandlers(capture: () => unknown, restore: (meta: unknown) => void): void {
  historyMetaCapture = capture;
  historyMetaRestore = restore;
}

export function runWithSingleUndo<T>(fn: () => T): T {
  beginSingleUndoTransaction();
  try {
    const result = fn();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        endSingleUndoTransaction();
      }) as T;
    }
    endSingleUndoTransaction();
    return result;
  } catch (err) {
    endSingleUndoTransaction();
    throw err;
  }
}

export function pushUndo(): void {
  if (singleUndoDepth > 0) {
    if (singleUndoCaptured) return;
    singleUndoCaptured = true;
  }
  state.undoStack.push(createHistorySnapshot());
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}

export function undo(): void {
  const prev = state.undoStack.pop();
  if (!prev) return;
  state.redoStack.push(createHistorySnapshot());
  if (state.redoStack.length > MAX_UNDO) state.redoStack.shift();
  applyHistorySnapshot(prev);
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function redo(): void {
  const next = state.redoStack.pop();
  if (!next) return;
  state.undoStack.push(createHistorySnapshot());
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  applyHistorySnapshot(next);
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function updateSlot(index: number, changes: Partial<Slot>): void {
  if (index < 0 || index >= state.slots.length) return;
  pushUndo();
  Object.assign(state.slots[index], changes);
  bus.emit(Events.SLOT_CHANGED, index);
  bus.emit(Events.RENDER_REQUEST, null);
}

/** Update slot without pushing undo — use with beginBatchUpdate/endBatchUpdate. */
export function updateSlotSilent(index: number, changes: Partial<Slot>): void {
  if (index < 0 || index >= state.slots.length) return;
  Object.assign(state.slots[index], changes);
  bus.emit(Events.SLOT_CHANGED, index);
  bus.emit(Events.RENDER_REQUEST, null);
}

let batchUndoPushed = false;
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/** Begin a batch of rapid updates (e.g. slider drag). Pushes undo once at the start. */
export function beginBatchUpdate(): void {
  if (!batchUndoPushed) {
    pushUndo();
    batchUndoPushed = true;
  }
  if (batchTimer) clearTimeout(batchTimer);
  batchTimer = setTimeout(() => { batchUndoPushed = false; }, 500);
}

export function setActiveSlot(index: number): void {
  const clamped = clampActiveSlotIndex(index);
  state.activeSlotIndex = clamped;
  bus.emit(Events.SLOT_SELECTED, clamped);
}

export function reorderSlots(fromIndex: number, insertBefore: number): void {
  if (fromIndex < 0 || fromIndex >= state.slots.length) return;
  const clampedInsertBefore = Math.max(0, Math.min(insertBefore, state.slots.length));
  if (fromIndex === clampedInsertBefore || fromIndex + 1 === clampedInsertBefore) return;
  pushUndo();
  const activeSlot = state.slots[state.activeSlotIndex];
  const newSlots = [...state.slots];
  const [moved] = newSlots.splice(fromIndex, 1);
  const adjustedPos = clampedInsertBefore > fromIndex ? clampedInsertBefore - 1 : clampedInsertBefore;
  newSlots.splice(adjustedPos, 0, moved);
  state.slots = newSlots;
  const nextActiveIndex = newSlots.indexOf(activeSlot);
  state.activeSlotIndex = nextActiveIndex >= 0 ? nextActiveIndex : clampActiveSlotIndex(state.activeSlotIndex, newSlots.length);
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function clearSlot(index: number): void {
  if (index < 0 || index >= state.slots.length) return;
  pushUndo();
  state.slots[index] = createEmptySlot(index);
  bus.emit(Events.SLOT_CHANGED, index);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function clearSlots(indexes: number[]): void {
  if (indexes.length === 0) return;
  const validIndexes = Array.from(new Set(indexes))
    .filter((index) => index >= 0 && index < state.slots.length);
  if (validIndexes.length === 0) return;
  pushUndo();
  for (const index of validIndexes) {
    state.slots[index] = createEmptySlot(index);
  }
  bus.emit(Events.SLOT_CHANGED, validIndexes.length === 1 ? validIndexes[0] : null);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function addSlot(): void {
  if (state.slots.length >= MAX_SLOTS) return;
  pushUndo();
  state.slots.push(createEmptySlot(state.slots.length));
  bus.emit(Events.SLOT_CHANGED, null);
}
