import { state, undo, redo, setActiveSlot, updateSlot, updateSlotSilent, beginBatchUpdate, getActiveSlot, clearSlot, reorderSlots } from '../state/store';
import type { Slot } from '../state/store';
import { initTheme, toggleTheme } from './theme';
import { FILTERS } from '../renderer/mutation-defs';
import { renderAll, renderSlot } from '../renderer/canvas-renderer';
import { renderCache, RenderCache } from '../renderer/render-cache';
import { bus, Events } from '../utils/events';
import { el } from '../utils/dom';
import { decodeGif } from '../gif/decoder';
import { FrameScheduler } from '../gif/frame-scheduler';
import { encodeGif } from '../gif/encoder';
import { applyMutations } from '../renderer/mutation-engine';
import { CustomDropdown } from './custom-dropdown';
import { renderThumb } from './thumbnail';
import type { DropdownItem } from './custom-dropdown';
import { spriteLoader } from '../api/sprite-loader';

// ── Hit-test content bounds ──────────────────────────────────────────────────
// Cache tight bounding boxes (content only, transparent padding stripped) so
// the canvas hit-test uses a small region rather than the full canvas size.
// Key = renderCache key (rendered path) or spriteUrl (pre-render fallback).
// Value = { cx, cy, hw, hv } in source pixels; null = tainted / fully transparent.
const hitBoundsCache = new Map<string, { cx: number; cy: number; hw: number; hv: number } | null>();

/**
 * Scan `source` for non-transparent pixels and return the tight content
 * bounding box as { cx, cy, hw, hv } (centre + half-extents in source pixels).
 * Uses a ≤128×128 downsample for speed. Returns null if the canvas is tainted
 * or the source is entirely transparent.
 */
function scanContentBounds(
  source: HTMLCanvasElement | HTMLImageElement,
): { cx: number; cy: number; hw: number; hv: number } | null {
  const srcW = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
  const srcH = source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
  if (srcW === 0 || srcH === 0) return null;

  const SCAN = 128;
  const scanW = Math.min(srcW, SCAN);
  const scanH = Math.min(srcH, SCAN);

  const tmp = document.createElement('canvas');
  tmp.width = scanW;
  tmp.height = scanH;
  const tmpCtx = tmp.getContext('2d')!;
  tmpCtx.drawImage(source as CanvasImageSource, 0, 0, scanW, scanH);

  let data: Uint8ClampedArray;
  try {
    data = tmpCtx.getImageData(0, 0, scanW, scanH).data;
  } catch {
    return null; // tainted canvas
  }

  let minX = scanW, minY = scanH, maxX = -1, maxY = -1;
  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      if (data[(y * scanW + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < minX) return null; // fully transparent

  const scaleX = srcW / scanW;
  const scaleY = srcH / scanH;
  const bx = Math.floor(minX * scaleX);
  const by = Math.floor(minY * scaleY);
  const bw = Math.ceil((maxX - minX + 1) * scaleX);
  const bh = Math.ceil((maxY - minY + 1) * scaleY);
  return { cx: bx + bw / 2, cy: by + bh / 2, hw: bw / 2, hv: bh / 2 };
}

export class App {
  private categoryDropdown!: CustomDropdown;
  private spriteDropdown!: CustomDropdown;
  private searchInput!: HTMLInputElement;
  private slotContainer!: HTMLElement;
  private mutationList!: HTMLElement;
  private customTintControls!: HTMLElement;
  private customColor!: HTMLInputElement;
  private customOpacity!: HTMLInputElement;
  private scaleInput!: HTMLInputElement;
  private rotationInput!: HTMLInputElement;
  private previewCanvas!: HTMLCanvasElement;
  private metaEl!: HTMLElement;
  private downloadProgress!: HTMLElement;
  private downloadBtn!: HTMLButtonElement;
  private timelineBar!: HTMLElement;
  private timelinePlayBtn!: HTMLElement;
  private timelineScrubber!: HTMLInputElement;
  private timelineLabel!: HTMLElement;
  private dragIdx: number | null = null;
  private dragInsertBefore: number | null = null;
  private frameScheduler = new FrameScheduler();

  constructor(container: HTMLElement) {
    initTheme();
    container.innerHTML = '';
    this.buildUI(container);
    this.bindEvents();
    this.refreshSlots();
    this.render();
  }

  private buildUI(container: HTMLElement): void {
    // ── Header ──
    const themeBtn = el('button', { id: 'themeToggle' });
    themeBtn.textContent = state.theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    themeBtn.title = 'Toggle Light/Dark Mode';
    themeBtn.addEventListener('click', () => {
      toggleTheme();
      themeBtn.textContent = state.theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    });

    const header = el('header', {}, [
      el('div', {}, [
        el('h1', { textContent: 'MG Sprite Customiser' }),
        el('p', { textContent: 'Choose a category, apply mutations, then download.' }),
      ]),
      themeBtn,
    ]);

    // ── Left Panel: Controls ──
    this.slotContainer = el('div', { className: 'slots' });

    this.searchInput = el('input', {
      id: 'search',
      type: 'text',
      placeholder: 'Filter sprites\u2026',
    }) as HTMLInputElement;

    // Category dropdown — no thumbnails, just text
    this.categoryDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'Select category\u2026',
      onSelect: (item: DropdownItem) => {
        state.selectedCategory = item.id;
        // Clear search when changing category
        this.searchInput.value = '';
        this.populateSprites();
      },
    });

    // Sprite dropdown — thumbnails from API
    this.spriteDropdown = new CustomDropdown({
      showThumbs: true,
      placeholder: 'Select sprite\u2026',
      // When a thumbnail scrolls into view in the dropdown, also warm SpriteLoader's
      // in-memory cache (fetch→blob→Image, low priority). So by the time the user
      // clicks, the canvas renderer finds it instantly without re-fetching.
      onThumbVisible: (url) => spriteLoader.preloadUrls([url]),
      onSelect: (item: DropdownItem) => {
        if (item.cardPresetUrls && item.cardPresetUrls.length > 0) {
          this.applyCardPreset(item.cardPresetUrls, item.label);
        } else if (item.animFrameUrls && item.animFrameUrls.length > 0) {
          // Show first frame immediately, then async-load all frames for animated playback
          updateSlot(state.activeSlotIndex, {
            type: 'sprite',
            spriteKey: item.id,
            spriteUrl: item.animFrameUrls[0],
            gifFrames: undefined,
            isAnimated: false,
          });
          this.stopGifPreview();
          this.loadAtlasAnimation(state.activeSlotIndex, item.id, item.animFrameUrls);
        } else {
          updateSlot(state.activeSlotIndex, {
            type: 'sprite',
            spriteKey: item.id,
            spriteUrl: item.thumbUrl ?? '',
            gifFrames: undefined,
            isAnimated: false,
          });
          this.stopGifPreview();
        }
      },
    });

    // Upload
    const fileInput = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif', id: 'uploadFile' }) as HTMLInputElement;
    const uploadBtn = el('button', { className: 'secondary', textContent: 'Upload PNG/GIF' });
    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, '');

      if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
        const buffer = await file.arrayBuffer();
        const decoded = decodeGif(buffer);
        const firstFrameBlob = await new Promise<Blob>((resolve) =>
          decoded.frames[0].canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const url = URL.createObjectURL(firstFrameBlob);
        updateSlot(state.activeSlotIndex, {
          type: 'custom',
          spriteKey: name,
          spriteUrl: url,
          gifFrames: decoded.frames,
          isAnimated: true,
        });
        this.startGifPreview();
      } else {
        const url = URL.createObjectURL(file);
        updateSlot(state.activeSlotIndex, {
          type: 'custom',
          spriteKey: name,
          spriteUrl: url,
          gifFrames: undefined,
          isAnimated: false,
        });
        this.stopGifPreview();
      }
      fileInput.value = '';
    });

    // Mutations
    this.mutationList = el('div', { className: 'mutations' });

    // Custom tint
    this.customColor = el('input', { type: 'color', id: 'customColor', value: '#ff00ff' }) as HTMLInputElement;
    this.customOpacity = el('input', { type: 'range', id: 'customOpacity', min: '0', max: '1', step: '0.05', value: '0' }) as HTMLInputElement;
    this.customTintControls = el('div', { id: 'customTintControls' }, [
      el('div', {}, [el('label', { textContent: 'Color' }), this.customColor]),
      el('div', {}, [el('label', { textContent: 'Opacity' }), this.customOpacity]),
    ]);

    // Options
    const optIcons = el('input', { type: 'checkbox', id: 'optIcons' }) as HTMLInputElement;
    optIcons.checked = true;
    const optOverlays = el('input', { type: 'checkbox', id: 'optOverlays' }) as HTMLInputElement;
    optOverlays.checked = true;
    const optionsDiv = el('div', { className: 'toggles' }, [
      this.makeCheckLabel('Icons', optIcons),
      this.makeCheckLabel('Tall overlays', optOverlays),
    ]);

    optIcons.addEventListener('change', () => updateSlot(state.activeSlotIndex, { options: { icons: optIcons.checked, overlays: optOverlays.checked } }));
    optOverlays.addEventListener('change', () => updateSlot(state.activeSlotIndex, { options: { icons: optIcons.checked, overlays: optOverlays.checked } }));

    // Scale / Rotation
    this.scaleInput = el('input', { id: 'scale', type: 'range', min: '0.1', max: '4', step: '0.1', value: '1' }) as HTMLInputElement;
    this.rotationInput = el('input', { id: 'rotation', type: 'range', min: '0', max: '360', step: '5', value: '0' }) as HTMLInputElement;

    // Timeline (for GIF playback)
    this.timelinePlayBtn = el('button', { className: 'btn-sm', textContent: 'Play' });
    this.timelineScrubber = el('input', { type: 'range', min: '0', max: '0', value: '0', className: 'timeline-scrubber' }) as HTMLInputElement;
    this.timelineLabel = el('span', { className: 'frame-label', textContent: '0/0' });
    this.timelineBar = el('div', { className: 'timeline-bar' }, [
      this.timelinePlayBtn,
      this.timelineScrubber,
      this.timelineLabel,
    ]);
    this.timelineBar.style.display = 'none';

    this.timelinePlayBtn.addEventListener('click', () => this.toggleGifPlay());
    this.timelineScrubber.addEventListener('input', () => {
      this.frameScheduler.seek(parseInt(this.timelineScrubber.value));
    });

    // Actions
    this.downloadBtn = el('button', { id: 'download', textContent: 'Download PNG' }) as HTMLButtonElement;
    const clearBtn = el('button', { className: 'secondary', textContent: 'Clear Slot' });
    const resetBtn = el('button', { className: 'danger', textContent: 'Reset All' });
    this.downloadProgress = el('div', { className: 'download-progress' });

    const controls = el('section', { className: 'panel', id: 'controls' }, [
      el('h2', { textContent: 'Controls' }),
      this.metaLabel('Layers', '(drag to reorder)'),
      this.slotContainer,
      el('label', { textContent: 'Category' }),
      this.categoryDropdown.element,
      el('label', { textContent: 'Search' }),
      this.searchInput,
      el('label', { textContent: 'Sprite' }),
      this.spriteDropdown.element,
      el('div', { className: 'upload-controls' }, [
        el('div', { className: 'upload-actions' }, [uploadBtn, fileInput]),
      ]),
      el('label', { textContent: 'Mutations' }),
      this.mutationList,
      this.customTintControls,
      el('label', { textContent: 'Options' }),
      optionsDiv,
      el('label', { textContent: 'Scale' }),
      this.scaleInput,
      el('label', { textContent: 'Rotation' }),
      this.rotationInput,
      this.timelineBar,
      el('div', { className: 'actions' }, [this.downloadBtn, clearBtn, resetBtn]),
      this.downloadProgress,
    ]);

    // ── Right Panel: Preview ──
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.width = 1024;
    this.previewCanvas.height = 1024;

    this.metaEl = el('div', { className: 'meta', id: 'meta' });

    const previewDiv = el('div', { id: 'previewCanvas' }, [this.previewCanvas]);
    const previewWrap = el('section', { className: 'panel', id: 'previewWrap' }, [
      el('h2', { textContent: 'Preview' }),
      previewDiv,
      this.metaEl,
    ]);

    const main = el('main', {}, [controls, previewWrap]);
    container.append(header, main);

    // ── Wire up actions ──
    this.downloadBtn.addEventListener('click', () => this.download());
    clearBtn.addEventListener('click', () => clearSlot(state.activeSlotIndex));
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all slots?')) {
        for (let i = 0; i < state.slots.length; i++) clearSlot(i);
      }
    });

    // Scale / Rotation (debounced)
    this.scaleInput.addEventListener('input', () => {
      beginBatchUpdate();
      updateSlotSilent(state.activeSlotIndex, { scale: parseFloat(this.scaleInput.value) || 1 });
    });
    this.rotationInput.addEventListener('input', () => {
      beginBatchUpdate();
      updateSlotSilent(state.activeSlotIndex, { rotation: parseFloat(this.rotationInput.value) || 0 });
    });

    // Custom tint (debounced)
    const updateTint = () => {
      beginBatchUpdate();
      updateSlotSilent(state.activeSlotIndex, {
        customTint: { color: this.customColor.value, opacity: parseFloat(this.customOpacity.value) },
      });
    };
    this.customColor.addEventListener('input', updateTint);
    this.customOpacity.addEventListener('input', updateTint);

    // Sync options checkboxes on slot change
    bus.on(Events.SLOT_SELECTED, () => {
      const slot = getActiveSlot();
      optIcons.checked = slot.options.icons;
      optOverlays.checked = slot.options.overlays;
      this.scaleInput.value = String(slot.scale);
      this.rotationInput.value = String(slot.rotation);
      this.customColor.value = slot.customTint.color;
      this.customOpacity.value = String(slot.customTint.opacity);
      if (slot.isAnimated && slot.gifFrames) {
        this.startGifPreview();
      } else {
        this.stopGifPreview();
      }
    });
  }

  private bindEvents(): void {
    // Search → filter sprite dropdown items in-place (no rebuild)
    this.searchInput.addEventListener('input', () => {
      this.spriteDropdown.filter(this.searchInput.value);
    });

    // Render on changes
    bus.on(Events.SLOT_CHANGED, () => { this.refreshSlots(); this.updateMeta(); this.syncDownloadBtn(); this.render(); });
    bus.on(Events.SLOT_SELECTED, () => {
      this.refreshSlots();
      this.refreshMutations();
      this.updateMeta();
      this.syncDownloadBtn();
      // Sync dropdown selection to the newly active slot's sprite (silent — no reload)
      this.spriteDropdown.selectById(getActiveSlot().spriteKey);
    });
    bus.on(Events.RENDER_REQUEST, () => this.render());
    bus.on(Events.DATA_LOADED, () => {
      this.populateCategories();
      this.refreshMutations();
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
      }
    });

    // Canvas drag
    this.setupCanvasDrag();
  }

  // ── Categories & Sprites ──

  private populateCategories(): void {
    const items: DropdownItem[] = [];
    const sd = state.spriteData;

    if (sd) {
      for (const cat of sd.categories) {
        items.push({ id: cat.cat, label: cat.cat });
      }
      // Card preset combo-category — only shown when the ui atlas is available
      if (sd.categories.some(c => c.cat === 'ui')) {
        items.push({ id: 'cards', label: 'Cards (preset)' });
      }
    }

    if (state.gameData) {
      const existingIds = new Set(items.map(i => i.id));
      for (const key of ['plants', 'pets', 'items', 'decor', 'eggs'] as const) {
        const data = state.gameData[key];
        if (!data || Object.keys(data).length === 0) continue;
        if (existingIds.has(key)) continue;
        items.push({ id: key, label: key });
      }
    }

    // Blobling / cosmetics categories (individual outfit pieces from /assets/cosmetics)
    if (state.cosmeticsData) {
      for (const cat of state.cosmeticsData.categories) {
        items.push({ id: `cosmetic:${cat.cat}`, label: `Blobling: ${cat.cat}` });
      }
    }

    // setItems fires onSelect (→ populateSprites) if it has to auto-select.
    // We also call populateSprites() unconditionally to handle the silent-restore case.
    this.categoryDropdown.setItems(items, state.selectedCategory || undefined);
    this.populateSprites();
  }

  private populateSprites(): void {
    const cat = state.selectedCategory;
    const sd = state.spriteData;
    const items: DropdownItem[] = [];

    // Card presets — stitch Bottom + Middle + Top layers into consecutive slots
    if (cat === 'cards') {
      const version = this.getUiSpriteVersion();
      const v = version ? `?v=${version}` : '';
      const base = 'https://mg-api.ariedam.fr/assets/sprites/ui';
      const topUrl = `${base}/CardTop.png${v}`;
      const CARD_TYPES: { key: string; label: string }[] = [
        { key: 'Plant', label: 'Plant Card' },
        { key: 'Pet',   label: 'Pet Card' },
        { key: 'Crop',  label: 'Crop Card' },
        { key: 'Decor', label: 'Decor Card' },
        { key: 'Egg',   label: 'Egg Card' },
        { key: 'Seed',  label: 'Seed Card' },
        { key: 'Tool',  label: 'Tool Card' },
      ];
      for (const cardType of CARD_TYPES) {
        const bottomUrl = `${base}/${cardType.key}CardBottom.png${v}`;
        const middleUrl = `${base}/${cardType.key}CardMiddle.png${v}`;
        items.push({
          id: `cardpreset/${cardType.key}`,
          label: cardType.label,
          thumbUrl: bottomUrl,
          cardPresetUrls: [bottomUrl, middleUrl, topUrl],
        });
      }
    }

    // Blobling / cosmetics categories
    if (cat.startsWith('cosmetic:')) {
      const catKey = cat.slice('cosmetic:'.length);
      const cosData = state.cosmeticsData;
      if (cosData) {
        const coscat = cosData.categories.find(c => c.cat === catKey);
        if (coscat) {
          for (const item of coscat.items) {
            items.push({ id: item.id, label: item.name, thumbUrl: item.url });
          }
        }
      }
    } else if (sd) {
      const category = sd.categories.find(c => c.cat === cat);
      if (category) {
        for (const item of category.items) {
          const vMatch = item.url.match(/\/version\/([a-f0-9]+)\//i);
          const version = vMatch?.[1] ?? state.gameVersion ?? '';
          if (item.type === 'frame') {
            const name = item.id.split('/').pop() ?? item.name;
            const url = `https://mg-api.ariedam.fr/assets/sprites/${cat}/${name}.png${version ? `?v=${version}` : ''}`;
            items.push({ id: item.id, label: item.name, thumbUrl: url });
          } else if (item.type === 'animation' && item.frames.length > 0) {
            const frameUrls = this.resolveAnimFrameUrls(item.frames, version);
            if (frameUrls.length > 0) {
              items.push({ id: item.id, label: `${item.name} (animated)`, thumbUrl: frameUrls[0], animFrameUrls: frameUrls });
            }
          }
        }
      }

      // CDN-only extras — assets that exist on the game CDN but are not in the sprite atlas.
      // The sprite-loader proxy handles magicgarden.gg URLs identically to cosmetics.
      if (cat === 'ui' && state.gameVersion) {
        const cdnBase = `https://magicgarden.gg/version/${state.gameVersion}/assets`;
        const cdnExtras: { id: string; label: string; file: string }[] = [
          { id: 'cdn/GardenJournal',  label: 'GardenJournal',          file: 'ui/GardenJournal.webp' },
          { id: 'cdn/AllRestocked',   label: 'AllRestocked (banner)',   file: 'ui/all-restocked.webp' },
          { id: 'cdn/EggsRestocked',  label: 'EggsRestocked (banner)',  file: 'ui/eggs-restocked.webp' },
          { id: 'cdn/SeedsRestocked', label: 'SeedsRestocked (banner)', file: 'ui/seeds-restocked.webp' },
          { id: 'cdn/ToolsRestocked', label: 'ToolsRestocked (banner)', file: 'ui/tools-restocked.webp' },
        ];
        for (const extra of cdnExtras) {
          items.push({ id: extra.id, label: extra.label, thumbUrl: `${cdnBase}/${extra.file}` });
        }
      }

      // Fallback to game data if sprite-data has no entries for this cat
      if (items.length === 0 && state.gameData) {
        const gd = state.gameData;
        let entries: [string, { sprite?: string; name?: string }][] = [];
        if (cat === 'plants' && gd.plants) entries = Object.entries(gd.plants).map(([k, v]) => [k, { sprite: v.plant.sprite, name: v.plant.name }]);
        else if (cat === 'pets' && gd.pets) entries = Object.entries(gd.pets).map(([k, v]) => [k, { sprite: v.sprite, name: v.name }]);
        else if (cat === 'items' && gd.items) entries = Object.entries(gd.items).map(([k, v]) => [k, { sprite: v.sprite, name: v.name }]);
        else if (cat === 'decor' && gd.decor) entries = Object.entries(gd.decor).map(([k, v]) => [k, { sprite: v.sprite, name: v.name }]);
        else if (cat === 'eggs' && gd.eggs) entries = Object.entries(gd.eggs).map(([k, v]) => [k, { sprite: v.sprite, name: v.name }]);

        for (const [, data] of entries) {
          if (!data.name || !data.sprite) continue;
          items.push({ id: data.name, label: data.name, thumbUrl: data.sprite });
        }
      }
    }

    // Pass active slot's spriteKey as restoreId — if found, selects silently.
    // If not found (different category or empty slot), auto-selects first item.
    const restoreId = getActiveSlot().spriteKey || undefined;
    this.spriteDropdown.setItems(items, restoreId);

    // Pre-warm SpriteLoader for the entire category at low priority.
    // By the time the user browses and picks a sprite, it will already be in the
    // in-memory LRU cache → zero lag on preview render.
    const thumbUrls = items.map(i => i.thumbUrl).filter((u): u is string => !!u);
    spriteLoader.preloadUrls(thumbUrls);
  }

  // ── Slots ──

  private refreshSlots(): void {
    this.slotContainer.innerHTML = '';
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i];
      const hasContent = !!slot.spriteUrl;
      const isActive = i === state.activeSlotIndex;

      const btn = el('button', {
        className: `slot-btn${isActive ? ' active' : ''}${hasContent ? ' occupied' : ''}`,
        draggable: 'true',
        title: hasContent ? slot.spriteKey.split('/').pop() ?? String(i + 1) : String(i + 1),
      });

      if (hasContent && slot.spriteUrl) {
        const thumb = document.createElement('canvas');
        thumb.className = 'slot-thumb';
        thumb.width = 34;
        thumb.height = 34;
        btn.appendChild(thumb);
        renderThumb(slot.spriteUrl, thumb);
      } else {
        btn.textContent = String(i + 1);
      }

      btn.addEventListener('click', () => setActiveSlot(i));

      btn.addEventListener('dragstart', () => {
        this.dragIdx = i;
        btn.classList.add('dragging');
      });

      btn.addEventListener('dragend', () => {
        this.dragIdx = null;
        this.dragInsertBefore = null;
        this.clearDropIndicators();
      });

      btn.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.dragIdx === null) return;
        const rect = btn.getBoundingClientRect();
        const midX = rect.left + rect.width / 2;
        this.clearDropIndicators();
        if (e.clientX < midX) {
          btn.classList.add('drop-before');
          this.dragInsertBefore = i;
        } else {
          btn.classList.add('drop-after');
          this.dragInsertBefore = i + 1;
        }
      });

      btn.addEventListener('dragleave', (e) => {
        if (!btn.contains(e.relatedTarget as Node)) {
          btn.classList.remove('drop-before', 'drop-after');
        }
      });

      btn.addEventListener('drop', (e) => {
        e.preventDefault();
        this.clearDropIndicators();
        if (this.dragIdx !== null && this.dragInsertBefore !== null) {
          reorderSlots(this.dragIdx, this.dragInsertBefore);
        }
        this.dragIdx = null;
        this.dragInsertBefore = null;
      });

      this.slotContainer.append(btn);
    }
  }

  private clearDropIndicators(): void {
    for (const btn of this.slotContainer.querySelectorAll('.slot-btn')) {
      btn.classList.remove('drop-before', 'drop-after');
    }
  }

  // ── Mutations ──

  private refreshMutations(): void {
    this.mutationList.innerHTML = '';
    const slot = getActiveSlot();

    for (const id of Object.keys(FILTERS)) {
      const isActive = slot.mutations.includes(id);
      const label = el('label', {}, []) as HTMLLabelElement;
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.checked = isActive;
      cb.addEventListener('change', () => {
        const s = getActiveSlot();
        const muts = [...s.mutations];
        const idx = muts.indexOf(id);
        if (idx >= 0) muts.splice(idx, 1);
        else muts.push(id);
        updateSlot(state.activeSlotIndex, { mutations: muts });
        this.refreshMutations();
      });
      label.append(cb, ` ${id}`);
      this.mutationList.append(label);
    }

    this.customTintControls.style.display = 'grid';
    this.customColor.value = slot.customTint.color;
    this.customOpacity.value = String(slot.customTint.opacity);
  }

  // ── Meta ──

  private updateMeta(): void {
    const slot = getActiveSlot();
    if (!slot.spriteUrl) {
      this.metaEl.textContent = '';
      return;
    }
    const muts = slot.mutations.length > 0 ? slot.mutations.join(', ') : 'None';
    const displayName = slot.spriteKey.split('/').pop() ?? slot.spriteKey;
    this.metaEl.innerHTML = `<strong>${displayName}</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; Mutations: ${muts} &middot; Scale: ${slot.scale}x`;
  }

  // ── Render ──

  private async render(): Promise<void> {
    await renderAll(this.previewCanvas);
  }

  // ── Canvas Drag ──

  private setupCanvasDrag(): void {
    let isDragging = false;
    let startX = 0, startY = 0;
    let slotStartX = 0, slotStartY = 0;

    /**
     * Hit-test all visible slots (topmost first).
     *
     * Stage 1 — tight bounding-box pre-filter:
     *   On first access, scanContentBounds() downsamples the rendered canvas to
     *   ≤128×128 and finds the pixel-accurate content bounds (ignoring transparent
     *   padding). The result is cached in hitBoundsCache. A 8-px margin is added so
     *   the clickable region is slightly larger than the visible pixels.
     *   Fallback: full canvas bounds (if the canvas is tainted or not yet scanned).
     *
     * Stage 2 — single-pixel alpha read:
     *   Only fires for clicks that passed Stage 1. Catches SecurityError from tainted
     *   canvases and accepts the hit (Stage 1 already proved we're inside the content
     *   region in that case).
     */
    const hitTestSlot = (canvasX: number, canvasY: number): number | null => {
      const W = this.previewCanvas.width;
      const H = this.previewCanvas.height;
      const MARGIN = 8; // canvas pixels added around content bounds
      for (let i = state.slots.length - 1; i >= 0; i--) {
        const slot = state.slots[i];
        if (!slot.visible || !slot.spriteUrl) continue;

        const cx = W / 2 + slot.position.x;
        const cy = H / 2 + slot.position.y;
        const relX = canvasX - cx;
        const relY = canvasY - cy;
        const angle = -(slot.rotation * Math.PI) / 180;
        const localX = relX * Math.cos(angle) - relY * Math.sin(angle);
        const localY = relX * Math.sin(angle) + relY * Math.cos(angle);

        // Look up the already-rendered canvas (same key as canvas-renderer uses).
        // Non-animated slots use frameIdx -1 in renderSlot; animated use the current frame index.
        const gifIdx = slot.isAnimated && slot.gifFrames ? (slot._gifFrameIdx ?? 0) : -1;
        const cacheKey = RenderCache.makeKey(slot.spriteUrl, slot.mutations, slot.options, slot.scale, slot.rotation)
          + `|${slot.customTint.color}:${slot.customTint.opacity}|f${gifIdx}`;
        const rendered = renderCache.get(cacheKey);

        if (rendered) {
          // Stage 1: tight content-bounds bounding box
          let hb = hitBoundsCache.get(cacheKey);
          if (hb === undefined) {
            hb = scanContentBounds(rendered);
            hitBoundsCache.set(cacheKey, hb);
          }
          if (hb) {
            const dx = (hb.cx - rendered.width / 2) * slot.scale;
            const dy = (hb.cy - rendered.height / 2) * slot.scale;
            const chw = (hb.hw + MARGIN) * slot.scale;
            const chv = (hb.hv + MARGIN) * slot.scale;
            if (Math.abs(localX - dx) > chw || Math.abs(localY - dy) > chv) continue;
          } else {
            // Tainted or fully transparent — fall back to full canvas bounds
            if (Math.abs(localX) > (rendered.width / 2) * slot.scale) continue;
            if (Math.abs(localY) > (rendered.height / 2) * slot.scale) continue;
          }

          // Stage 2: pixel-accurate alpha check
          const px = Math.round(localX / slot.scale + rendered.width / 2);
          const py = Math.round(localY / slot.scale + rendered.height / 2);
          const ctx2d = rendered.getContext('2d');
          try {
            if (ctx2d && ctx2d.getImageData(px, py, 1, 1).data[3] > 10) return i;
          } catch {
            // Tainted canvas — bounds check passed, accept the hit
            return i;
          }
        } else {
          // Pre-render fallback: scan the raw source image for content bounds
          const img = spriteLoader.getCached(slot.spriteUrl);
          if (img) {
            let hb = hitBoundsCache.get(slot.spriteUrl);
            if (hb === undefined) {
              hb = scanContentBounds(img);
              hitBoundsCache.set(slot.spriteUrl, hb);
            }
            if (hb) {
              const dx = (hb.cx - img.naturalWidth / 2) * slot.scale;
              const dy = (hb.cy - img.naturalHeight / 2) * slot.scale;
              const chw = (hb.hw + MARGIN) * slot.scale;
              const chv = (hb.hv + MARGIN) * slot.scale;
              if (Math.abs(localX - dx) <= chw && Math.abs(localY - dy) <= chv) return i;
            } else {
              const hw = (img.naturalWidth / 2) * slot.scale;
              const hh = (img.naturalHeight / 2) * slot.scale;
              if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) return i;
            }
          } else {
            if (Math.abs(localX) <= 128 * slot.scale && Math.abs(localY) <= 128 * slot.scale) return i;
          }
        }
      }
      return null;
    };

    this.previewCanvas.addEventListener('mousedown', (e) => {
      const rect = this.previewCanvas.getBoundingClientRect();
      const cssScale = rect.width / this.previewCanvas.width;
      const canvasX = (e.clientX - rect.left) / cssScale;
      const canvasY = (e.clientY - rect.top) / cssScale;

      const hitIdx = hitTestSlot(canvasX, canvasY);
      if (hitIdx === null) return; // No sprite hit — don't start drag
      if (hitIdx !== state.activeSlotIndex) {
        setActiveSlot(hitIdx);
      }

      const slot = getActiveSlot();
      if (slot.locked) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      slotStartX = slot.position.x;
      slotStartY = slot.position.y;
      this.previewCanvas.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = this.previewCanvas.getBoundingClientRect();
      const cssScale = rect.width / this.previewCanvas.width;
      const slot = getActiveSlot();
      slot.position.x = slotStartX + (e.clientX - startX) / cssScale;
      slot.position.y = slotStartY + (e.clientY - startY) / cssScale;
      this.render();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.previewCanvas.classList.remove('dragging');
      }
    });

    // ── Touch: single-finger drag + two-finger pinch-scale / twist-rotate ──

    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let pinchStartAngle = 0;
    let pinchStartRotation = 0;

    this.previewCanvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = this.previewCanvas.getBoundingClientRect();
        const cssScale = rect.width / this.previewCanvas.width;
        const canvasX = (touch.clientX - rect.left) / cssScale;
        const canvasY = (touch.clientY - rect.top) / cssScale;

        const hitIdx = hitTestSlot(canvasX, canvasY);
        if (hitIdx === null) return;
        if (hitIdx !== state.activeSlotIndex) setActiveSlot(hitIdx);

        const slot = getActiveSlot();
        if (slot.locked) return;
        isDragging = true;
        startX = touch.clientX;
        startY = touch.clientY;
        slotStartX = slot.position.x;
        slotStartY = slot.position.y;
        this.previewCanvas.classList.add('dragging');
      } else if (e.touches.length === 2) {
        // Second finger down: cancel any active drag, begin pinch/twist
        isDragging = false;
        this.previewCanvas.classList.remove('dragging');
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        pinchStartDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
        pinchStartScale = getActiveSlot().scale;
        pinchStartAngle = Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
        pinchStartRotation = getActiveSlot().rotation;
      }
    }, { passive: false });

    this.previewCanvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1 && isDragging) {
        const touch = e.touches[0];
        const rect = this.previewCanvas.getBoundingClientRect();
        const cssScale = rect.width / this.previewCanvas.width;
        const slot = getActiveSlot();
        slot.position.x = slotStartX + (touch.clientX - startX) / cssScale;
        slot.position.y = slotStartY + (touch.clientY - startY) / cssScale;
        this.render();
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t1.clientX - t0.clientX;
        const dy = t1.clientY - t0.clientY;
        const slot = getActiveSlot();

        // Pinch → scale (clamped to slider range)
        const dist = Math.hypot(dx, dy);
        slot.scale = Math.max(0.1, Math.min(4, pinchStartScale * (dist / pinchStartDist)));
        this.scaleInput.value = slot.scale.toFixed(1);

        // Twist → rotation
        const angle = Math.atan2(dy, dx);
        slot.rotation = ((pinchStartRotation + (angle - pinchStartAngle) * (180 / Math.PI)) % 360 + 360) % 360;
        this.rotationInput.value = String(Math.round(slot.rotation));

        this.render();
      }
    }, { passive: false });

    window.addEventListener('touchend', () => {
      if (isDragging) {
        isDragging = false;
        this.previewCanvas.classList.remove('dragging');
      }
    });

    window.addEventListener('touchcancel', () => {
      isDragging = false;
      this.previewCanvas.classList.remove('dragging');
    });
  }

  // ── Download ──

  private async download(): Promise<void> {
    const hasGif = state.slots.some(s => s.visible && s.isAnimated && s.gifFrames && s.gifFrames.length > 1);
    if (hasGif) {
      await this.downloadGIF();
    } else {
      await this.downloadPNG();
    }
  }

  private async downloadPNG(): Promise<void> {
    this.downloadProgress.textContent = 'Rendering...';
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    await renderAll(canvas);
    const link = document.createElement('a');
    link.download = `${getActiveSlot().spriteKey.split('/').pop() || 'sprite'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    this.downloadProgress.textContent = '';
  }

  private async downloadGIF(): Promise<void> {
    this.downloadProgress.textContent = 'Rendering...';
    this.downloadBtn.disabled = true;

    let maxFrames = 0;
    let primaryFrames: { canvas: HTMLCanvasElement; delay: number }[] = [];
    for (const slot of state.slots) {
      if (slot.visible && slot.isAnimated && slot.gifFrames && slot.gifFrames.length > maxFrames) {
        maxFrames = slot.gifFrames.length;
        primaryFrames = slot.gifFrames;
      }
    }

    if (primaryFrames.length === 0) {
      this.downloadProgress.textContent = '';
      this.downloadBtn.disabled = false;
      return;
    }

    // Composite is built at full 1024×1024 then scaled to EXPORT_SIZE before encoding.
    // 512×512 = 4× fewer pixels per frame → gif.js encodes ~4× faster.
    // Smaller pixel area also reduces per-frame colour-palette shifts, which is the cause
    // of static slots with gradients (e.g. Rainbow) appearing to animate across frames.
    const FULL = 1024;
    const EXPORT_SIZE = 512;

    // Pre-render all static (non-animated) slots once before the frame loop.
    // Even though renderSlot caches its output, calling it N times per static slot
    // inside the loop adds N async yields and N cache-key computations per slot.
    this.downloadProgress.textContent = 'Preparing static layers...';
    const staticCanvases = new Map<Slot, HTMLCanvasElement>();
    for (const slot of state.slots) {
      if (!slot.visible || !slot.spriteUrl) continue;
      if (slot.isAnimated && slot.gifFrames && slot.gifFrames.length > 0) continue;
      const rendered = await renderSlot(slot);
      if (rendered) staticCanvases.set(slot, rendered);
    }

    const renderedFrames: { canvas: HTMLCanvasElement; delay: number }[] = [];

    for (let i = 0; i < primaryFrames.length; i++) {
      this.downloadProgress.textContent = `Rendering frame ${i + 1}/${primaryFrames.length}...`;

      const outCanvas = document.createElement('canvas');
      outCanvas.width = FULL;
      outCanvas.height = FULL;
      const outCtx = outCanvas.getContext('2d')!;
      outCtx.clearRect(0, 0, FULL, FULL);

      for (const slot of state.slots) {
        if (!slot.visible || !slot.spriteUrl) continue;

        if (slot.isAnimated && slot.gifFrames && slot.gifFrames.length > 0) {
          const fi = i % slot.gifFrames.length;
          const src = slot.gifFrames[fi].canvas;
          const frameCanvas = document.createElement('canvas');
          frameCanvas.width = src.width;
          frameCanvas.height = src.height;
          frameCanvas.getContext('2d')!.drawImage(src, 0, 0);
          applyMutations(frameCanvas, slot.mutations, false, slot.customTint);
          outCtx.save();
          outCtx.translate(FULL / 2 + slot.position.x, FULL / 2 + slot.position.y);
          outCtx.rotate((slot.rotation * Math.PI) / 180);
          outCtx.scale(slot.scale, slot.scale);
          outCtx.drawImage(frameCanvas, -frameCanvas.width / 2, -frameCanvas.height / 2);
          outCtx.restore();
        } else {
          const rendered = staticCanvases.get(slot);
          if (!rendered) continue;
          outCtx.save();
          outCtx.translate(FULL / 2 + slot.position.x, FULL / 2 + slot.position.y);
          outCtx.rotate((slot.rotation * Math.PI) / 180);
          outCtx.scale(slot.scale, slot.scale);
          outCtx.drawImage(rendered, -rendered.width / 2, -rendered.height / 2);
          outCtx.restore();
        }
      }

      // Scale the full-size composite down to the export size.
      const frameOut = document.createElement('canvas');
      frameOut.width = EXPORT_SIZE;
      frameOut.height = EXPORT_SIZE;
      frameOut.getContext('2d')!.drawImage(outCanvas, 0, 0, EXPORT_SIZE, EXPORT_SIZE);
      renderedFrames.push({ canvas: frameOut, delay: primaryFrames[i].delay });
    }

    try {
      this.downloadProgress.textContent = 'Encoding GIF...';
      const blob = await encodeGif({
        frames: renderedFrames,
        width: EXPORT_SIZE,
        height: EXPORT_SIZE,
        onProgress: (p) => {
          this.downloadProgress.textContent = `Encoding GIF... ${Math.round(p * 100)}%`;
        },
      });
      const link = document.createElement('a');
      link.download = `${getActiveSlot().spriteKey.split('/').pop() || 'sprite'}.gif`;
      link.href = URL.createObjectURL(blob);
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('GIF export failed:', err);
      this.downloadProgress.textContent = 'GIF export failed!';
    }

    this.downloadBtn.disabled = false;
    this.downloadProgress.textContent = '';
  }

  // ── GIF Preview ──

  private startGifPreview(): void {
    const slot = getActiveSlot();
    if (!slot.isAnimated || !slot.gifFrames || slot.gifFrames.length < 2) {
      this.stopGifPreview();
      return;
    }

    const frames = slot.gifFrames;
    this.frameScheduler.setFrames(frames);
    this.frameScheduler.setCallback((_frame, index) => {
      slot._gifFrameIdx = index;
      this.timelineScrubber.value = String(index);
      this.timelineLabel.textContent = `${index + 1}/${frames.length}`;
      this.render();
    });

    this.timelineScrubber.max = String(frames.length - 1);
    this.timelineScrubber.value = '0';
    this.timelineLabel.textContent = `1/${frames.length}`;
    this.timelineBar.style.display = 'flex';
    this.syncDownloadBtn();
    this.frameScheduler.play();
    this.timelinePlayBtn.textContent = 'Pause';
  }

  private stopGifPreview(): void {
    this.frameScheduler.stop();
    this.timelineBar.style.display = 'none';
    this.timelinePlayBtn.textContent = 'Play';
    this.syncDownloadBtn();
  }

  private toggleGifPlay(): void {
    if (this.frameScheduler.isPlaying) {
      this.frameScheduler.pause();
      this.timelinePlayBtn.textContent = 'Play';
    } else {
      this.frameScheduler.play();
      this.timelinePlayBtn.textContent = 'Pause';
    }
  }

  /**
   * Return the version string from the ui sprite-data category URLs (e.g. "49").
   * Falls back to state.gameVersion if the category or its URLs aren't available yet.
   */
  private getUiSpriteVersion(): string {
    const sd = state.spriteData;
    if (sd) {
      const uiCat = sd.categories.find(c => c.cat === 'ui');
      if (uiCat) {
        for (const item of uiCat.items) {
          const vMatch = item.url.match(/\/version\/([a-f0-9]+)\//i);
          if (vMatch) return vMatch[1];
        }
      }
    }
    return state.gameVersion ?? '';
  }

  /**
   * Composite all card layers (Bottom → Middle → Top) into a single canvas and load
   * the result as one sprite in the active slot.
   */
  private async applyCardPreset(urls: string[], label: string): Promise<void> {
    this.stopGifPreview();

    let images: HTMLImageElement[];
    try {
      images = await Promise.all(urls.map(url => spriteLoader.load(url)));
    } catch (err) {
      console.error('[MG] Failed to load card preset layers:', err);
      return;
    }

    // Composite all layers onto a single canvas (centred within the max dimensions)
    const width  = Math.max(...images.map(img => img.naturalWidth));
    const height = Math.max(...images.map(img => img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    for (const img of images) {
      ctx.drawImage(img, (width - img.naturalWidth) / 2, (height - img.naturalHeight) / 2);
    }

    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/png'));
    const blobUrl = URL.createObjectURL(blob);

    updateSlot(state.activeSlotIndex, {
      type: 'custom',
      spriteKey: label,
      spriteUrl: blobUrl,
      gifFrames: undefined,
      isAnimated: false,
    });
  }

  /**
   * Resolve animation frame IDs to mg-api PNG URLs by searching all sprite-data categories.
   * Handles both prefixed IDs ('animations/CelestialActive-0') and short names ('CelestialActive-0').
   */
  private resolveAnimFrameUrls(frameIds: string[], version: string): string[] {
    const sd = state.spriteData;
    if (!sd) return [];

    // Build a lookup keyed by both full frame ID and short name (last path segment)
    const frameMap = new Map<string, { cat: string; name: string }>();
    for (const category of sd.categories) {
      for (const entry of category.items) {
        if (entry.type !== 'frame') continue;
        const name = entry.id.split('/').pop() ?? entry.id;
        if (!frameMap.has(entry.id)) frameMap.set(entry.id, { cat: category.cat, name });
        if (!frameMap.has(name)) frameMap.set(name, { cat: category.cat, name });
      }
    }

    const v = version ? `?v=${version}` : '';
    return frameIds.flatMap(frameId => {
      const shortName = frameId.split('/').pop() ?? frameId;
      const match = frameMap.get(frameId) ?? frameMap.get(shortName);
      if (!match) return [];
      return [`https://mg-api.ariedam.fr/assets/sprites/${match.cat}/${match.name}.png${v}`];
    });
  }

  /**
   * Load all frames of a sprite-atlas animation and switch the slot to animated playback.
   * Shows the first frame immediately (already set by onSelect) while loading in the background.
   */
  private async loadAtlasAnimation(slotIndex: number, spriteKey: string, frameUrls: string[]): Promise<void> {
    const FRAME_DELAY = 100; // ms — ~10fps; sprite-data carries no timing metadata
    try {
      const images = await Promise.all(frameUrls.map(url => spriteLoader.load(url)));
      const gifFrames = images.map(img => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        return { canvas, delay: FRAME_DELAY };
      });
      // Guard: abort if the user already switched to a different sprite
      if (state.slots[slotIndex].spriteKey !== spriteKey) return;
      updateSlot(slotIndex, { spriteUrl: frameUrls[0], gifFrames, isAnimated: true });
      if (slotIndex === state.activeSlotIndex) this.startGifPreview();
    } catch (err) {
      console.error('[MG] Failed to load animation frames:', err);
    }
  }

  // ── Helpers ──

  /** Set download button label based on whether any visible slot has an animated GIF. */
  private syncDownloadBtn(): void {
    const hasGif = state.slots.some(s => s.visible && s.isAnimated && s.gifFrames && s.gifFrames.length > 1);
    this.downloadBtn.textContent = hasGif ? 'Download GIF' : 'Download PNG';
  }

  private metaLabel(text: string, hint: string): HTMLElement {
    const lbl = el('label', {}, []);
    lbl.innerHTML = `${text} <span class="meta" style="font-weight:normal">${hint}</span>`;
    return lbl;
  }

  private makeCheckLabel(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = el('label', {}, []) as HTMLLabelElement;
    label.append(input, ` ${text}`);
    return label;
  }
}
