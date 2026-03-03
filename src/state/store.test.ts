import { beforeEach, describe, expect, it } from 'vitest';
import type { Slot } from './store';
import {
  addSlot,
  beginBatchUpdate,
  runWithSingleUndo,
  setHistoryMetaHandlers,
  state,
  undo,
  redo,
  updateSlot,
  updateSlotSilent,
} from './store';

function makeSlot(index: number): Slot {
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

function resetStore(): void {
  state.slots = [makeSlot(0)];
  state.activeSlotIndex = 0;
  state.undoStack = [];
  state.redoStack = [];
}

describe('store history controls', () => {
  beforeEach(() => {
    resetStore();
    setHistoryMetaHandlers(() => undefined, () => {});
  });

  it('coalesces nested runWithSingleUndo calls into one undo snapshot', () => {
    runWithSingleUndo(() => {
      runWithSingleUndo(() => {
        updateSlot(0, { spriteKey: 'alpha' });
        addSlot();
        updateSlot(1, { spriteKey: 'beta' });
      });
    });

    expect(state.undoStack).toHaveLength(1);
    expect(state.slots).toHaveLength(2);
    expect(state.slots[0]?.spriteKey).toBe('alpha');
    expect(state.slots[1]?.spriteKey).toBe('beta');

    undo();
    expect(state.slots).toHaveLength(1);
    expect(state.slots[0]?.spriteKey).toBe('');
  });

  it('round-trips history meta on undo and redo', () => {
    let token = 0;
    const restoredTokens: number[] = [];
    setHistoryMetaHandlers(
      () => ({ token }),
      (meta) => {
        const payload = meta as { token?: number } | undefined;
        restoredTokens.push(payload?.token ?? -1);
      },
    );

    updateSlot(0, { spriteKey: 'first' });
    token = 1;
    undo();
    redo();

    expect(restoredTokens).toContain(0);
    expect(restoredTokens).toContain(1);
  });

  it('groups beginBatchUpdate + updateSlotSilent into one undo step', async () => {
    beginBatchUpdate();
    updateSlotSilent(0, { spriteKey: 'one' });
    beginBatchUpdate();
    updateSlotSilent(0, { spriteKey: 'two' });

    expect(state.undoStack).toHaveLength(1);
    undo();
    expect(state.slots[0]?.spriteKey).toBe('');

    await new Promise((resolve) => setTimeout(resolve, 520));
  });
});
