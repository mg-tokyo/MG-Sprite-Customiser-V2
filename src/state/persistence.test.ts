import { describe, expect, it } from 'vitest';
import { importSceneJson } from './persistence';

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
