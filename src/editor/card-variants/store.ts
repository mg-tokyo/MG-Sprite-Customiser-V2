import builtinRaw from '../../data/card-variants/builtin-variants.v1.json';
import genericSceneRaw from '../../data/card-variants/GENERIC.mgscene.json';
import genericNormSceneRaw from '../../data/card-variants/GENERICNORM.mgscene.json';
import type { FullCardData, FullCardType } from '../../state/store';
import type { Slot } from '../../state/store';
import type {
  BuiltinCardVariantV1,
  CardVariantExportV1,
  CardVariantV1,
  UserCardVariantV1,
} from './types';

const USER_VARIANTS_KEY = 'mgsc_user_card_variants_v1';
const EXPORT_VERSION = 1;

interface ScenePresetFileV1 {
  _v?: number;
  slots?: Slot[];
  activeSlotIndex?: number;
  thumbnail?: string;
}

interface BuiltinScenePresetV1 {
  id: string;
  slots: Slot[];
  activeSlotIndex: number;
  thumbnail?: string;
}

const BUILTIN_SCENE_PRESETS = buildBuiltinScenePresetMap();

function deepCloneFullCardData(data: FullCardData): FullCardData {
  return JSON.parse(JSON.stringify(data)) as FullCardData;
}

function ensureUserVariantShape(input: Partial<UserCardVariantV1>): UserCardVariantV1 | null {
  if (!input || input.source !== 'user' || input.readonly !== false) return null;
  if (!input.id?.startsWith('user:')) return null;
  if (!input.name || !input.cardType || !input.fullCardData) return null;
  if (input.version !== 1) return null;
  const now = Date.now();
  return {
    id: input.id,
    name: input.name,
    cardType: input.cardType,
    fullCardData: deepCloneFullCardData(input.fullCardData),
    layerRefs: input.layerRefs ? [...input.layerRefs] : undefined,
    thumbnailRef: input.thumbnailRef,
    version: 1,
    source: 'user',
    readonly: false,
    createdAt: typeof input.createdAt === 'number' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'number' ? input.updatedAt : now,
  };
}

function readUserVariantsStorage(): UserCardVariantV1[] {
  try {
    const raw = localStorage.getItem(USER_VARIANTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => ensureUserVariantShape(item as Partial<UserCardVariantV1>))
      .filter((item): item is UserCardVariantV1 => !!item);
  } catch {
    return [];
  }
}

function writeUserVariantsStorage(variants: UserCardVariantV1[]): void {
  try {
    localStorage.setItem(USER_VARIANTS_KEY, JSON.stringify(variants));
  } catch {
    // Ignore storage write errors (quota/private mode)
  }
}

function createUserVariantId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `user:${crypto.randomUUID()}`;
  }
  return `user:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function deepCloneSlots(slots: Slot[]): Slot[] {
  return JSON.parse(JSON.stringify(slots)) as Slot[];
}

function sanitizeScenePreset(raw: unknown): { slots: Slot[]; activeSlotIndex: number; thumbnail?: string } | null {
  const parsed = raw as ScenePresetFileV1;
  if (!parsed || !Array.isArray(parsed.slots)) return null;
  const slots = deepCloneSlots(parsed.slots);
  const activeSlotIndex = typeof parsed.activeSlotIndex === 'number' ? Math.max(0, parsed.activeSlotIndex) : 0;
  return {
    slots,
    activeSlotIndex,
    thumbnail: typeof parsed.thumbnail === 'string' && parsed.thumbnail.length > 0 ? parsed.thumbnail : undefined,
  };
}

function buildBuiltinScenePresetMap(): Map<string, BuiltinScenePresetV1> {
  const map = new Map<string, BuiltinScenePresetV1>();
  const defs: Array<{ id: string; raw: unknown }> = [
    { id: 'generic', raw: genericSceneRaw },
    { id: 'genericnorm', raw: genericNormSceneRaw },
  ];
  for (const def of defs) {
    const sanitized = sanitizeScenePreset(def.raw);
    if (!sanitized) continue;
    map.set(def.id, {
      id: def.id,
      slots: sanitized.slots,
      activeSlotIndex: sanitized.activeSlotIndex,
      thumbnail: sanitized.thumbnail,
    });
  }
  return map;
}

function cloneBuiltinVariants(): BuiltinCardVariantV1[] {
  return (builtinRaw as BuiltinCardVariantV1[]).map(variant => ({
    ...variant,
    fullCardData: deepCloneFullCardData(variant.fullCardData),
    layerRefs: variant.layerRefs ? [...variant.layerRefs] : undefined,
  }));
}

export function loadBuiltinVariants(): BuiltinCardVariantV1[] {
  return cloneBuiltinVariants();
}

export function loadUserVariants(): UserCardVariantV1[] {
  return readUserVariantsStorage().map(variant => ({
    ...variant,
    fullCardData: deepCloneFullCardData(variant.fullCardData),
    layerRefs: variant.layerRefs ? [...variant.layerRefs] : undefined,
  }));
}

export function loadAllVariants(): CardVariantV1[] {
  return [...loadBuiltinVariants(), ...loadUserVariants()];
}

export function getBuiltinScenePreset(scenePresetId: string): BuiltinScenePresetV1 | null {
  const preset = BUILTIN_SCENE_PRESETS.get(scenePresetId);
  if (!preset) return null;
  return {
    id: preset.id,
    slots: deepCloneSlots(preset.slots),
    activeSlotIndex: preset.activeSlotIndex,
    thumbnail: preset.thumbnail,
  };
}

export function getBuiltinScenePresetThumbnail(scenePresetId: string): string | null {
  const preset = BUILTIN_SCENE_PRESETS.get(scenePresetId);
  if (!preset?.thumbnail) return null;
  return preset.thumbnail;
}

export function saveUserVariant(input: {
  id?: string;
  name: string;
  cardType: FullCardType;
  fullCardData: FullCardData;
  layerRefs?: string[];
  thumbnailRef?: string;
}): UserCardVariantV1 {
  const variants = readUserVariantsStorage();
  const now = Date.now();
  const name = input.name.trim() || 'Untitled Variant';

  if (input.id && input.id.startsWith('user:')) {
    const idx = variants.findIndex(variant => variant.id === input.id);
    if (idx >= 0) {
      const updated: UserCardVariantV1 = {
        ...variants[idx],
        name,
        cardType: input.cardType,
        fullCardData: deepCloneFullCardData(input.fullCardData),
        layerRefs: input.layerRefs ? [...input.layerRefs] : undefined,
        thumbnailRef: input.thumbnailRef,
        updatedAt: now,
      };
      variants[idx] = updated;
      writeUserVariantsStorage(variants);
      return { ...updated, fullCardData: deepCloneFullCardData(updated.fullCardData) };
    }
  }

  const created: UserCardVariantV1 = {
    id: createUserVariantId(),
    name,
    cardType: input.cardType,
    fullCardData: deepCloneFullCardData(input.fullCardData),
    layerRefs: input.layerRefs ? [...input.layerRefs] : undefined,
    thumbnailRef: input.thumbnailRef,
    version: 1,
    source: 'user',
    readonly: false,
    createdAt: now,
    updatedAt: now,
  };
  variants.push(created);
  writeUserVariantsStorage(variants);
  return { ...created, fullCardData: deepCloneFullCardData(created.fullCardData) };
}

export function deleteUserVariant(id: string): boolean {
  if (!id.startsWith('user:')) return false;
  const variants = readUserVariantsStorage();
  const next = variants.filter(variant => variant.id !== id);
  if (next.length === variants.length) return false;
  writeUserVariantsStorage(next);
  return true;
}

export function duplicateBuiltinToUser(builtinId: string, nextName?: string): UserCardVariantV1 | null {
  const builtin = loadBuiltinVariants().find(variant => variant.id === builtinId);
  if (!builtin) return null;
  const copied = saveUserVariant({
    name: nextName?.trim() || `${builtin.name} Copy`,
    cardType: builtin.cardType,
    fullCardData: deepCloneFullCardData(builtin.fullCardData),
    layerRefs: builtin.layerRefs ? [...builtin.layerRefs] : undefined,
    thumbnailRef: builtin.thumbnailRef,
  });
  return copied;
}

export function exportUserVariantsJson(): string {
  const variants = loadUserVariants();
  const payload: CardVariantExportV1 = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    variants,
  };
  return JSON.stringify(payload, null, 2);
}

export function importUserVariantsJson(json: string): { imported: number } {
  const parsed = JSON.parse(json) as Partial<CardVariantExportV1>;
  if (!parsed || parsed.version !== EXPORT_VERSION || !Array.isArray(parsed.variants)) {
    throw new Error('Invalid variants export payload');
  }

  const existing = readUserVariantsStorage();
  const byId = new Map(existing.map(variant => [variant.id, variant] as const));
  let imported = 0;

  for (const input of parsed.variants) {
    const shaped = ensureUserVariantShape(input);
    if (!shaped) continue;
    byId.set(shaped.id, shaped);
    imported += 1;
  }

  writeUserVariantsStorage(Array.from(byId.values()));
  return { imported };
}
