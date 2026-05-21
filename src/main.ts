import { fetchGameData, fetchSpriteData, fetchCosmetics } from './api/client';
import { state } from './state/store';
import { restoreState, saveState } from './state/persistence';
import { bus, Events } from './utils/events';
import { App } from './editor/app';
import { clearSpriteIdCache } from './renderer/icon-layout';
import { clampDisplayText } from './utils/safe-text';

async function init(): Promise<void> {
  restoreState();

  const container = document.getElementById('app')!;
  container.innerHTML = '<div class="loading">Loading game data...</div>';

  try {
    const [gameData, spriteData, cosmeticsData] = await Promise.all([
      fetchGameData(),
      fetchSpriteData(),
      fetchCosmetics(),
    ]);

    state.gameData = gameData;
    state.spriteData = spriteData;
    state.cosmeticsData = cosmeticsData;
    clearSpriteIdCache(); // Rebuild icon lookup set from new data

    // Extract version
    for (const m of Object.values(gameData.mutations)) {
      if (m.sprite) {
        const match =
          m.sprite.match(/[?&]v=([a-f0-9]+)/i) ?? m.sprite.match(/\/version\/([a-f0-9]+)\//i);
        if (match) {
          state.gameVersion = match[1];
          break;
        }
      }
    }

    // Build editor UI
    new App(container);

    // Persist state on changes
    bus.on(Events.SLOT_CHANGED, saveState);
    bus.on(Events.SLOT_SELECTED, saveState);
    bus.on(Events.THEME_CHANGED, saveState);

    // Notify panels that data is ready
    bus.emit(Events.DATA_LOADED, null);
  } catch (err) {
    console.error('Failed to load game data:', err);
    container.textContent = '';
    const errorEl = document.createElement('div');
    errorEl.className = 'error';
    const message = err instanceof Error ? err.message : String(err);
    errorEl.textContent = `Failed to load game data: ${clampDisplayText(message, 240)}`;
    container.append(errorEl);
  }
}

init();
