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
  undoStack: Slot[][];
  redoStack: Slot[][];

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

const INITIAL_SLOTS = 20;
export const MAX_SLOTS = 100;
const MAX_UNDO = 50;

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

export function getActiveSlot(): Slot {
  return state.slots[state.activeSlotIndex];
}

export function pushUndo(): void {
  state.undoStack.push(JSON.parse(JSON.stringify(state.slots)));
  if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
  state.redoStack = [];
}

export function undo(): void {
  const prev = state.undoStack.pop();
  if (!prev) return;
  state.redoStack.push(JSON.parse(JSON.stringify(state.slots)));
  state.slots = prev;
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function redo(): void {
  const next = state.redoStack.pop();
  if (!next) return;
  state.undoStack.push(JSON.parse(JSON.stringify(state.slots)));
  state.slots = next;
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function updateSlot(index: number, changes: Partial<Slot>): void {
  pushUndo();
  Object.assign(state.slots[index], changes);
  bus.emit(Events.SLOT_CHANGED, index);
  bus.emit(Events.RENDER_REQUEST, null);
}

/** Update slot without pushing undo — use with beginBatchUpdate/endBatchUpdate. */
export function updateSlotSilent(index: number, changes: Partial<Slot>): void {
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
  state.activeSlotIndex = index;
  bus.emit(Events.SLOT_SELECTED, index);
}

export function reorderSlots(fromIndex: number, insertBefore: number): void {
  if (fromIndex === insertBefore || fromIndex + 1 === insertBefore) return;
  pushUndo();
  const activeSlot = state.slots[state.activeSlotIndex];
  const newSlots = [...state.slots];
  const [moved] = newSlots.splice(fromIndex, 1);
  const adjustedPos = insertBefore > fromIndex ? insertBefore - 1 : insertBefore;
  newSlots.splice(adjustedPos, 0, moved);
  state.slots = newSlots;
  state.activeSlotIndex = newSlots.indexOf(activeSlot);
  bus.emit(Events.SLOT_CHANGED, null);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function clearSlot(index: number): void {
  pushUndo();
  state.slots[index] = createEmptySlot(index);
  bus.emit(Events.SLOT_CHANGED, index);
  bus.emit(Events.RENDER_REQUEST, null);
}

export function addSlot(): void {
  if (state.slots.length >= MAX_SLOTS) return;
  pushUndo();
  state.slots.push(createEmptySlot(state.slots.length));
  bus.emit(Events.SLOT_CHANGED, null);
}
