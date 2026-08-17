import { describe, expect, it } from 'vitest';
import { importSceneJson, serializeSceneAsQpmV1, getFilteredSlotSummary } from './persistence';
import type { SavedScene } from './persistence';
import type { Slot } from './store';

function makeBaseScene() {
  return {
    _v: 1,
    name: 'Scene',
    savedAt: Date.now(),
    activeSlotIndex: 10,
    slots: [
      {
        id: 'slot-custom',
        type: 'sprite',
        spriteKey: 'sprite/plants/Rose',
        spriteUrl: 'https://mg-api.ariedam.fr/assets/sprites/plants/Rose.png',
        mutations: ['Wet'],
        options: { icons: true, overlays: true },
        customTint: { color: '#ffffff', opacity: 0.5 },
        position: { x: 10, y: 20 },
        scale: 1,
        rotation: 0,
        visible: true,
        locked: false,
      },
    ],
  };
}

describe('scene import hardening', () => {
  it('preserves role:"base" and drops any other role value', () => {
    const scene = makeBaseScene();
    (scene.slots[0] as Slot & { role?: unknown }).role = 'base';
    const withBad = { ...scene, slots: [scene.slots[0], { ...scene.slots[0], role: 'evil' }] };
    const result = importSceneJson(JSON.stringify(withBad));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.slots[0].role).toBe('base');
    expect(result.scene.slots[1]).not.toHaveProperty('role');
  });

  it('accepts legacy v1 scenes and normalizes to v2', () => {
    const scene = makeBaseScene();
    const result = importSceneJson(JSON.stringify(scene));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.scene._v).toBe(2);
    expect(result.scene.activeSlotIndex).toBe(0);
    expect(result.scene.slots).toHaveLength(1);
  });

  it('rejects oversized payloads early', () => {
    const huge = 'a'.repeat(2_000_100);
    const result = importSceneJson(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });

  it('sanitizes unsafe sprite URLs', () => {
    const scene = makeBaseScene();
    scene.slots[0].spriteUrl = 'javascript:alert(1)';
    const result = importSceneJson(JSON.stringify(scene));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.slots[0].spriteUrl).toBe('');
  });
});

function makeSlot(overrides: Partial<Slot>): Slot {
  return {
    id: 'slot-x',
    type: 'sprite',
    spriteKey: 'sprite/plants/Rose',
    spriteUrl: '',
    mutations: [],
    options: { icons: true, overlays: true },
    customTint: { color: '#ffffff', opacity: 0 },
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeMixedScene(): SavedScene {
  return {
    _v: 2,
    name: 'Mixed',
    savedAt: 1_700_000_000_000,
    activeSlotIndex: 0,
    slots: [
      makeSlot({ id: 's1', type: 'sprite', spriteKey: 'sprite/plants/Carrot', mutations: ['Gold'] }),
      makeSlot({ id: 's2', type: 'sprite', spriteKey: 'sprite/pets/Cat', customTint: { color: '#8f82ff', opacity: 0.4 } }),
      makeSlot({ id: 's3', type: 'text' }),
      makeSlot({ id: 's4', type: 'full-card' }),
      makeSlot({ id: 's5', type: 'sprite', visible: false }),
    ],
  };
}

describe('serializeSceneAsQpmV1', () => {
  it('emits v1 header + filters non-sprite and invisible slots', () => {
    const scene = makeMixedScene();
    const jsonStr = serializeSceneAsQpmV1(scene);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.$schema).toBe('mgscene/v1');
    expect(parsed.rendererVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(parsed.capabilities).toEqual(['sprite']);
    expect(parsed.canvas).toEqual({ width: 256, height: 256, originAnchor: 'top-left' });
    expect(parsed.slots).toHaveLength(2);
    expect(parsed.slots.every((s: { type: string }) => s.type === 'sprite')).toBe(true);
    expect(parsed.slots.map((s: { id: string }) => s.id)).toEqual(['s1', 's2']);
  });

  it('emits role:"base" only on the flagged slot', () => {
    const scene: SavedScene = {
      _v: 2,
      name: 'Base',
      savedAt: 0,
      activeSlotIndex: 0,
      slots: [
        makeSlot({ id: 'ammo', spriteKey: 'sprite/decor/MarbleKnight', rotation: 90, scale: 0.4 }),
        makeSlot({ id: 'foot', spriteKey: 'sprite/decor/MarbleKnight', role: 'base' }),
      ],
    };
    const parsed = JSON.parse(serializeSceneAsQpmV1(scene));
    expect(parsed.slots[0]).not.toHaveProperty('role');
    expect(parsed.slots[1].role).toBe('base');
  });

  it('converts rotation from degrees to radians', () => {
    const scene: SavedScene = {
      _v: 2,
      name: 'Rotated',
      savedAt: 0,
      activeSlotIndex: 0,
      slots: [makeSlot({ rotation: 180 })],
    };
    const parsed = JSON.parse(serializeSceneAsQpmV1(scene));
    expect(parsed.slots[0].transform.rotation).toBeCloseTo(Math.PI, 6);
  });

  it('assigns zIndex by post-filter position', () => {
    const scene = makeMixedScene();
    const parsed = JSON.parse(serializeSceneAsQpmV1(scene));
    expect(parsed.slots[0].zIndex).toBe(0);
    expect(parsed.slots[1].zIndex).toBe(1);
  });

  it('filters out placeholder slots with empty spriteKey', () => {
    const scene: SavedScene = {
      _v: 2,
      name: 'WithEmpties',
      savedAt: 0,
      activeSlotIndex: 0,
      slots: [
        makeSlot({ id: 'real', spriteKey: 'sprite/plants/Carrot' }),
        makeSlot({ id: 'empty', spriteKey: '' }),
        makeSlot({ id: 'real2', spriteKey: 'sprite/pets/Cat' }),
      ],
    };
    const parsed = JSON.parse(serializeSceneAsQpmV1(scene));
    expect(parsed.slots).toHaveLength(2);
    expect(parsed.slots.map((s: { id: string }) => s.id)).toEqual(['real', 'real2']);
  });
});

describe('getFilteredSlotSummary', () => {
  it('counts kept sprite slots and skipped-by-type slots', () => {
    const scene = makeMixedScene();
    const summary = getFilteredSlotSummary(scene);
    // s5 (invisible sprite) counts as kept for the summary — filter is v1-serialize's job.
    expect(summary.keptSpriteCount).toBe(3);
    expect(summary.skipped).toEqual({ text: 1, fullCard: 1, cosmetic: 0, custom: 0 });
  });

  it('reports zero-kept when scene has no sprite slots', () => {
    const scene: SavedScene = {
      _v: 2,
      name: 'NoSprites',
      savedAt: 0,
      activeSlotIndex: 0,
      slots: [makeSlot({ type: 'text' }), makeSlot({ type: 'cosmetic' })],
    };
    const summary = getFilteredSlotSummary(scene);
    expect(summary.keptSpriteCount).toBe(0);
    expect(summary.skipped).toEqual({ text: 1, fullCard: 0, cosmetic: 1, custom: 0 });
  });
});
