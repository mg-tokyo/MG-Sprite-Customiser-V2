import { state, undo, redo, setActiveSlot, updateSlot, updateSlotSilent, beginBatchUpdate, getActiveSlot, clearSlot, reorderSlots, pushUndo, addSlot, MAX_SLOTS } from '../state/store';
import { listSavedScenes, saveNamedScene, deleteNamedScene, exportSceneJson, importSceneJson } from '../state/persistence';
import type { Slot, TextData, FullCardData, FullCardType, FullCardRarity, FullCardAbilityEntry, FullCardSpriteSlot } from '../state/store';
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
import type { SpriteFrame } from '../api/types';
import { renderTextToCanvas, defaultTextData } from './text-renderer';
import { drawFullCardStats, defaultFullCardData, abilityColor } from './full-card-renderer';
import { MG_FONTS, SYSTEM_FONTS, GOOGLE_FONTS_CURATED, UNICODE_STYLES, ensureFontLoaded } from './font-data';

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

// ── Mutation chip colors (for toggle-chip UI) ────────────────────────────────
const MUTATION_CHIP_COLORS: Record<string, string> = {
  Gold:          '#EBC800',
  Rainbow:       'linear-gradient(90deg, #FF1744, #FF9100, #FFEA00, #00E676, #2979FF, #D500F9)',
  Wet:           '#32B4C8',
  Chilled:       '#64A0D2',
  Frozen:        '#6482DC',
  Thunderstruck: '#FFD700',
  Dawnlit:       '#D146E7',
  Ambershine:    '#BE6428',
  Dawncharged:   '#8C50C8',
  Ambercharged:  '#AA3C19',
};


// (card-tinting functions removed — card PNG sprites are pre-colored per type)

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
  private scaleLabel!: HTMLElement;
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

  // ── Text layer UI ──
  private spriteControls!: HTMLElement;   // search + sprite dropdown section (category is separate)
  private textControls!: HTMLElement;     // text-layer-specific section
  private textArea!: HTMLTextAreaElement;
  private fontGroupDropdown!: CustomDropdown; // font category (MG / System / Google / Unicode)
  private fontItemDropdown!: CustomDropdown;  // individual font within group
  private fontGoogleSearch!: HTMLInputElement;
  private fontGoogleResults!: HTMLElement;
  private alignBtns!: HTMLButtonElement[];
  private wordWrapToggle!: HTMLInputElement;
  private wordWrapWidthRow!: HTMLElement;
  private wordWrapWidthInput!: HTMLInputElement;
  private boldToggle!: HTMLInputElement;
  private italicToggle!: HTMLInputElement;
  private mgShadowToggle!: HTMLInputElement;
  private strokeToggle!: HTMLInputElement;
  private strokeControls!: HTMLElement;
  private strokeColorInput!: HTMLInputElement;
  private strokeWidthInput!: HTMLInputElement;
  private unicodeRow!: HTMLElement;
  private unicodeDropdown!: CustomDropdown;
  private tintLabel!: HTMLElement;       // relabelled when text/full-card slot active
  private addTextBtn!: HTMLButtonElement;
  private textRenderDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── Scenes UI ──
  private scenesListEl!: HTMLElement;
  private sceneNameInput!: HTMLInputElement;

  // ── Blobling Rig UI ──
  private bloblingControls!: HTMLElement;
  private bloblingCatDropdowns = new Map<string, CustomDropdown>();
  private bloblingAnimDropdown!: CustomDropdown;
  private bloblingRenderDebounce: ReturnType<typeof setTimeout> | null = null;

  // ── Full Card layer UI ──
  private fullCardControls!: HTMLElement;
  private fullCardTypeLabel!: HTMLElement;
  private fullCardNameInput!: HTMLInputElement;
  private fullCardRaritySelect!: HTMLSelectElement;
  private fullCardRarityRow!: HTMLElement;
  private fullCardLockedCheck!: HTMLInputElement;
  // Mutations section (all card types)
  private fullCardItemMutationsContainer!: HTMLElement;
  // Pet fields
  private fullCardPetSection!: HTMLElement;
  private fullCardPetCurrentStrInput!: HTMLInputElement;
  private fullCardPetMaxStrInput!: HTMLInputElement;
  private fullCardPetStrPctInput!: HTMLInputElement;
  private fullCardPetStrPctDisplay!: HTMLElement;
  private fullCardPetHungerPctInput!: HTMLInputElement;
  private fullCardPetHungerPctDisplay!: HTMLElement;
  private fullCardPetAgeInput!: HTMLInputElement;
  private fullCardPetWeightInput!: HTMLInputElement;
  private fullCardPetSellInput!: HTMLInputElement;
  private fullCardDietSlotList!: HTMLElement;
  private fullCardPetAbilityChips!: HTMLElement;
  private fullCardPetAbilityAddSelect!: HTMLSelectElement;
  private fullCardPetAbilityAddBtn!: HTMLButtonElement;
  private fullCardPetAbilityList!: HTMLElement;
  private fullCardAddCustomAbilityBtn!: HTMLButtonElement;
  // Plant fields
  private fullCardPlantSection!: HTMLElement;
  private fullCardPlantSlotCountInput!: HTMLInputElement;
  private fullCardPlantMaturedSlotsInput!: HTMLInputElement;
  private fullCardPlantMaturityInput!: HTMLInputElement;
  private fullCardPlantCropSlotList!: HTMLElement;
  private fullCardPlantCropWeightInput!: HTMLInputElement;
  private fullCardPlantCropSellInput!: HTMLInputElement;
  // Crop fields
  private fullCardCropSection!: HTMLElement;
  private fullCardCropSlotList!: HTMLElement;
  private fullCardCropWeightInput!: HTMLInputElement;
  private fullCardCropSellInput!: HTMLInputElement;
  // Seed fields
  private fullCardSeedSection!: HTMLElement;
  private fullCardSeedRaritySelect!: HTMLSelectElement;
  private fullCardSeedCountInput!: HTMLInputElement;
  // Egg fields
  private fullCardEggSection!: HTMLElement;
  private fullCardEggCountInput!: HTMLInputElement;
  private fullCardEggHatchSlotList!: HTMLElement;
  private fullCardEggGoldRateInput!: HTMLInputElement;
  private fullCardEggRainbowRateInput!: HTMLInputElement;
  // Pet bar label inputs
  private fullCardPetStrLabelInput!: HTMLInputElement;
  private fullCardPetHungerLabelInput!: HTMLInputElement;
  // Tool fields
  private fullCardToolSection!: HTMLElement;
  private fullCardToolCountInput!: HTMLInputElement;
  private fullCardToolDescInput!: HTMLTextAreaElement;
  // Decor fields
  private fullCardDecorSection!: HTMLElement;
  private fullCardDecorCountInput!: HTMLInputElement;
  // Slot picker overlay and mutation popover (singletons)
  private fcSlotPickerOverlay!: HTMLElement;
  private fcMutPopover!: HTMLElement;
  private fcActiveSlotCtx: { list: 'diet' | 'crop' | 'egg'; index: number } | null = null;
  // In-memory slot data (kept in sync with controls)
  private fcDietSlots: FullCardSpriteSlot[] = [];
  private fcCropSlots: FullCardSpriteSlot[] = [];
  private fcEggHatchSlots: FullCardSpriteSlot[] = [];

  private fullCardRenderDebounce: ReturnType<typeof setTimeout> | null = null;

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
        if (!item.fullCardType && !item.cardPresetUrls) {
          // no-op: lastSpriteSelection removed
        }
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
        if (item.id === 'blobling-new') {
          this.addBloblingLayer();
        } else if (item.fullCardType) {
          this.addFullCardPreset(item.fullCardType as FullCardType);
        } else if (item.cardPresetUrls && item.cardPresetUrls.length > 0) {
          this.applyCardPreset(item.cardPresetUrls, item.label);
        } else if (item.animFrameUrls && item.animFrameUrls.length > 0) {
          // Show first frame immediately, then async-load all frames for animated playback
          const firstUrl = item.animFrameUrls[0];
          updateSlot(state.activeSlotIndex, {
            type: 'sprite',
            spriteKey: item.id,
            spriteUrl: firstUrl,
            gifFrames: undefined,
            isAnimated: false,
          });
          this.stopGifPreview();
          this.loadAtlasAnimation(state.activeSlotIndex, item.id, item.animFrameUrls);
        } else {
          const url = item.thumbUrl ?? '';
          updateSlot(state.activeSlotIndex, {
            type: 'sprite',
            spriteKey: item.id,
            spriteUrl: url,
            gifFrames: undefined,
            isAnimated: false,
          });
          this.stopGifPreview();
        }
      },
    });

    // ── Sprite controls section (hidden when text slot is active) ──
    // Category dropdown lives OUTSIDE spriteControls so it is always visible.
    this.spriteControls = el('div', { className: 'sprite-controls-section' });

    // ── Text Layer Controls (hidden when sprite slot active) ──
    this.textControls = el('div', { className: 'text-controls-section', style: 'display:none' });
    this.buildTextControls();

    // ── Full Card Controls (hidden unless full-card slot active) ──
    this.fullCardControls = this.buildFullCardControls();

    // ── Blobling Rig Controls (hidden unless cosmetic blobling slot active) ──
    this.bloblingControls = this.buildBloblingControls();

    // Populate sprite controls contents (search + sprite list only — no category here)
    this.spriteControls.append(
      el('label', { textContent: 'Search' }),
      this.searchInput,
      el('label', { textContent: 'Sprite' }),
      this.spriteDropdown.element,
    );

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

    // Add text layer button
    this.addTextBtn = el('button', { className: 'secondary txt-add-btn', textContent: '+ Text Layer' }) as HTMLButtonElement;
    this.addTextBtn.addEventListener('click', () => this.addTextLayer());

    // Mutations
    this.mutationList = el('div', { className: 'mutations' });

    // Custom tint / text color
    this.tintLabel = el('label', { textContent: 'Custom Tint' }) as HTMLElement;
    this.customColor = el('input', { type: 'color', id: 'customColor', value: '#ffffff' }) as HTMLInputElement;
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
    this.scaleLabel = el('label', { textContent: 'Scale' });
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
      // Category dropdown is always visible regardless of slot type
      el('label', { textContent: 'Category' }),
      this.categoryDropdown.element,
      this.spriteControls,
      this.textControls,
      this.fullCardControls,
      this.bloblingControls,
      el('div', { className: 'upload-controls' }, [
        el('div', { className: 'upload-actions' }, [uploadBtn, fileInput, this.addTextBtn]),
      ]),
      el('label', { textContent: 'Mutations' }),
      this.mutationList,
      this.tintLabel,
      this.customTintControls,
      el('label', { textContent: 'Options' }),
      optionsDiv,
      this.scaleLabel,
      this.scaleInput,
      el('label', { textContent: 'Rotation' }),
      this.rotationInput,
      this.timelineBar,
      el('div', { className: 'actions' }, [this.downloadBtn, clearBtn, resetBtn]),
      this.downloadProgress,
      this.buildScenesSection(),
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
        const slot = getActiveSlot();
        beginBatchUpdate();
        if (slot.type === 'text') {
          // Scale slider = font size for text layers
          const fontSize = Math.max(6, Math.min(200, parseFloat(this.scaleInput.value) || 36));
          const td = { ...slot.textData!, fontSize };
          updateSlotSilent(state.activeSlotIndex, { textData: td });
          this.scheduleTextRerender();
        } else {
        updateSlotSilent(state.activeSlotIndex, { scale: parseFloat(this.scaleInput.value) || 1 });
      }
    });
    this.rotationInput.addEventListener('input', () => {
      beginBatchUpdate();
      updateSlotSilent(state.activeSlotIndex, { rotation: parseFloat(this.rotationInput.value) || 0 });
    });

    // Custom tint (debounced) — for text slots this drives the text fill colour
    const updateTint = () => {
      const slot = getActiveSlot();
      beginBatchUpdate();
      updateSlotSilent(state.activeSlotIndex, {
        customTint: { color: this.customColor.value, opacity: parseFloat(this.customOpacity.value) },
      });
      if (slot.type === 'text') this.scheduleTextRerender();
      // Full-card: tint is applied by renderSlot, no canvas rerender needed
    };
    this.customColor.addEventListener('input', updateTint);
    this.customOpacity.addEventListener('input', updateTint);

    // Sync options checkboxes on slot change
    bus.on(Events.SLOT_SELECTED, () => {
      const slot = getActiveSlot();
      optIcons.checked = slot.options.icons;
      optOverlays.checked = slot.options.overlays;
      this.rotationInput.value = String(slot.rotation);
      this.customColor.value = slot.customTint.color;
      this.customOpacity.value = String(slot.customTint.opacity);
      this.syncTextSlotUI(slot);
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
    bus.on(Events.SLOT_CHANGED, () => { this.refreshSlots(); this.updateMeta(); this.syncDownloadBtn(); this.render(); this.syncTextSlotUI(getActiveSlot()); });
    bus.on(Events.SLOT_SELECTED, () => {
      this.refreshSlots();
      this.refreshMutations();
      this.updateMeta();
      this.syncDownloadBtn();
      const slot = getActiveSlot();
      // Sync dropdown selection to the newly active slot's sprite (silent — no reload)
      if (slot.type !== 'text' && slot.type !== 'full-card' && slot.type !== 'cosmetic') this.spriteDropdown.selectById(slot.spriteKey);
      this.syncTextSlotUI(slot);
    });
    bus.on(Events.RENDER_REQUEST, () => this.render());
    bus.on(Events.DATA_LOADED, () => {
      this.populateCategories();
      this.refreshMutations();
      const slot = getActiveSlot();
      if (slot.type === 'full-card') this.syncFullCardUI(slot);
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

  // ── Text Layer ──────────────────────────────────────────────────────────────

  /** Build all text-layer control DOM elements (called once in buildUI). */
  private buildTextControls(): void {
    // ── Font group selector ──
    const FONT_GROUPS = [
      { id: 'mg',      label: 'MG Fonts' },
      { id: 'system',  label: 'System Fonts' },
      { id: 'google',  label: 'Google Fonts' },
      { id: 'unicode', label: 'Unicode Styles' },
    ];
    this.fontGroupDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'Font group…',
      onSelect: (item) => this.onFontGroupSelect(item.id),
    });
    this.fontGroupDropdown.setItems(
      FONT_GROUPS.map(g => ({ id: g.id, label: g.label })),
      'mg',
    );

    // ── Font item selector ──
    this.fontItemDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'Select font…',
      onSelect: (item) => {
        const slot = getActiveSlot();
        if (slot.type !== 'text' || !slot.textData) return;
        // item.id encodes fontId; label is the display name
        // We resolve the font def from item.id
        this.applyFontSelection(item.id);
      },
    });

    // ── Google font search ──
    this.fontGoogleSearch = el('input', {
      type: 'text',
      placeholder: 'Search Google Fonts…',
      className: 'font-google-search',
      style: 'display:none',
    }) as HTMLInputElement;
    this.fontGoogleResults = el('div', { className: 'font-google-results', style: 'display:none' });

    this.fontGoogleSearch.addEventListener('input', () => this.onGoogleFontSearch());

    // ── Unicode style selector ──
    this.unicodeDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'None (off)',
      onSelect: (item) => {
        const slot = getActiveSlot();
        if (slot.type !== 'text' || !slot.textData) return;
        const td = { ...slot.textData, unicodeStyle: item.id === 'none' ? undefined : item.id };
        updateSlot(state.activeSlotIndex, { textData: td });
        this.scheduleTextRerender();
      },
    });
    const unicodeItems: DropdownItem[] = [
      { id: 'none', label: 'None (off)' },
      ...UNICODE_STYLES.map(u => ({ id: u.id, label: u.label })),
    ];
    this.unicodeDropdown.setItems(unicodeItems, 'none');
    this.unicodeRow = el('div', { className: 'text-control-row' }, [
      el('label', { textContent: 'Unicode style' }),
      this.unicodeDropdown.element,
    ]);

    // ── Text area ──
    this.textArea = el('textarea', {
      className: 'text-input-area',
      placeholder: 'Type your text…',
      rows: '3',
    }) as HTMLTextAreaElement;
    this.textArea.addEventListener('input', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      const td = { ...slot.textData, content: this.textArea.value };
      updateSlotSilent(state.activeSlotIndex, { textData: td });
      this.scheduleTextRerender();
    });

    // ── Alignment ──
    const alignLabels: Array<{ id: TextData['align']; glyph: string }> = [
      { id: 'left',   glyph: '⫷' },
      { id: 'center', glyph: '≡' },
      { id: 'right',  glyph: '⫸' },
    ];
    this.alignBtns = alignLabels.map(({ id, glyph }) => {
      const btn = el('button', { className: 'align-btn', textContent: glyph, title: id }) as HTMLButtonElement;
      btn.dataset.align = id;
      btn.addEventListener('click', () => {
        const slot = getActiveSlot();
        if (slot.type !== 'text' || !slot.textData) return;
        const td = { ...slot.textData, align: id };
        updateSlot(state.activeSlotIndex, { textData: td });
        this.scheduleTextRerender();
        this.syncAlignBtns(id);
      });
      return btn;
    });
    const alignRow = el('div', { className: 'align-row' }, [
      el('span', { textContent: 'Align:', className: 'align-row-label' }),
      ...this.alignBtns,
    ]);

    // ── Word wrap ──
    this.wordWrapToggle = el('input', { type: 'checkbox', id: 'txtWordWrap' }) as HTMLInputElement;
    this.wordWrapWidthInput = el('input', { type: 'range', min: '100', max: '900', step: '10', value: '400', id: 'txtWrapWidth' }) as HTMLInputElement;
    this.wordWrapWidthRow = el('div', { className: 'word-wrap-width-row', style: 'display:none' }, [
      el('label', { textContent: 'Max width' }),
      this.wordWrapWidthInput,
    ]);

    this.wordWrapToggle.addEventListener('change', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      this.wordWrapWidthRow.style.display = this.wordWrapToggle.checked ? '' : 'none';
      const td = { ...slot.textData, wordWrap: this.wordWrapToggle.checked };
      updateSlot(state.activeSlotIndex, { textData: td });
      this.scheduleTextRerender();
    });
    this.wordWrapWidthInput.addEventListener('input', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      const td = { ...slot.textData, wordWrapWidth: parseInt(this.wordWrapWidthInput.value) };
      updateSlotSilent(state.activeSlotIndex, { textData: td });
      this.scheduleTextRerender();
    });

    // ── Style toggles (bold, italic) ──
    this.boldToggle   = el('input', { type: 'checkbox', id: 'txtBold' })   as HTMLInputElement;
    this.italicToggle = el('input', { type: 'checkbox', id: 'txtItalic' }) as HTMLInputElement;
    this.boldToggle.addEventListener('change', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      updateSlot(state.activeSlotIndex, { textData: { ...slot.textData, bold: this.boldToggle.checked } });
      this.scheduleTextRerender();
    });
    this.italicToggle.addEventListener('change', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      updateSlot(state.activeSlotIndex, { textData: { ...slot.textData, italic: this.italicToggle.checked } });
      this.scheduleTextRerender();
    });

    // ── MG presets ──
    this.mgShadowToggle = el('input', { type: 'checkbox', id: 'txtMgShadow' }) as HTMLInputElement;
    this.mgShadowToggle.checked = true; // default on for textSlapper
    this.mgShadowToggle.addEventListener('change', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      updateSlot(state.activeSlotIndex, { textData: { ...slot.textData, mgShadow: this.mgShadowToggle.checked } });
      this.scheduleTextRerender();
    });

    // ── Stroke ──
    this.strokeToggle = el('input', { type: 'checkbox', id: 'txtStroke' }) as HTMLInputElement;
    this.strokeColorInput = el('input', { type: 'color', id: 'txtStrokeColor', value: '#000000' }) as HTMLInputElement;
    this.strokeWidthInput = el('input', { type: 'range', min: '1', max: '20', step: '1', value: '3', id: 'txtStrokeWidth' }) as HTMLInputElement;
    this.strokeControls = el('div', { className: 'stroke-controls', style: 'display:none' }, [
      el('div', {}, [el('label', { textContent: 'Outline color' }), this.strokeColorInput]),
      el('div', {}, [el('label', { textContent: 'Outline width' }), this.strokeWidthInput]),
    ]);

    this.strokeToggle.addEventListener('change', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      this.strokeControls.style.display = this.strokeToggle.checked ? '' : 'none';
      updateSlot(state.activeSlotIndex, { textData: { ...slot.textData, strokeEnabled: this.strokeToggle.checked } });
      this.scheduleTextRerender();
    });
    this.strokeColorInput.addEventListener('input', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      updateSlotSilent(state.activeSlotIndex, { textData: { ...slot.textData, strokeColor: this.strokeColorInput.value } });
      this.scheduleTextRerender();
    });
    this.strokeWidthInput.addEventListener('input', () => {
      const slot = getActiveSlot();
      if (slot.type !== 'text' || !slot.textData) return;
      updateSlotSilent(state.activeSlotIndex, { textData: { ...slot.textData, strokeWidth: parseInt(this.strokeWidthInput.value) } });
      this.scheduleTextRerender();
    });

    // Assemble text controls panel
    this.textControls.append(
      el('label', { textContent: 'Font group' }),
      this.fontGroupDropdown.element,
      el('label', { textContent: 'Font' }),
      this.fontItemDropdown.element,
      this.fontGoogleSearch,
      this.fontGoogleResults,
      this.unicodeRow,
      el('label', { textContent: 'Text' }),
      this.textArea,
      alignRow,
      el('div', { className: 'text-style-row' }, [
        this.makeCheckLabel('Word wrap', this.wordWrapToggle),
        this.makeCheckLabel('Bold', this.boldToggle),
        this.makeCheckLabel('Italic', this.italicToggle),
      ]),
      this.wordWrapWidthRow,
      el('div', { className: 'text-preset-row' }, [
        this.makeCheckLabel('MG drop shadow', this.mgShadowToggle),
        this.makeCheckLabel('Outline/Stroke', this.strokeToggle),
      ]),
      this.strokeControls,
    );

    // Initialise font list for MG group (default)
    this.onFontGroupSelect('mg');
  }

  /** Called when the font group dropdown changes. Repopulates the font item dropdown. */
  private onFontGroupSelect(groupId: string): void {
    let items: DropdownItem[];

    if (groupId === 'mg') {
      items = MG_FONTS.map(f => ({ id: f.id, label: f.label }));
      this.fontGoogleSearch.style.display = 'none';
      this.fontGoogleResults.style.display = 'none';
      this.unicodeRow.style.display = 'none';
    } else if (groupId === 'system') {
      items = SYSTEM_FONTS.map(f => ({ id: f.id, label: f.label }));
      this.fontGoogleSearch.style.display = 'none';
      this.fontGoogleResults.style.display = 'none';
      this.unicodeRow.style.display = 'none';
    } else if (groupId === 'google') {
      items = [
        ...GOOGLE_FONTS_CURATED.map(f => ({ id: f.id, label: f.label })),
        { id: 'gf-search', label: '🔍 Search all Google Fonts…' },
      ];
      this.fontGoogleSearch.style.display = 'none';
      this.fontGoogleResults.style.display = 'none';
      this.unicodeRow.style.display = 'none';
    } else {
      // unicode group — font item dropdown shows base fonts, unicode style is separate
      items = [
        ...MG_FONTS.map(f => ({ id: f.id, label: f.label })),
        ...SYSTEM_FONTS.map(f => ({ id: f.id, label: f.label })),
      ];
      this.fontGoogleSearch.style.display = 'none';
      this.fontGoogleResults.style.display = 'none';
      this.unicodeRow.style.display = '';
    }

    this.fontItemDropdown.setItems(items);
  }

  /** Resolve a font definition by id and apply it to the active text slot. */
  private applyFontSelection(fontId: string): void {
    const slot = getActiveSlot();
    if (slot.type !== 'text' || !slot.textData) return;

    if (fontId === 'gf-search') {
      // Show the Google font search box instead
      this.fontGoogleSearch.style.display = '';
      this.fontGoogleResults.style.display = '';
      this.fontGoogleSearch.focus();
      return;
    }

    const allDefs = [...MG_FONTS, ...SYSTEM_FONTS, ...GOOGLE_FONTS_CURATED];
    const def = allDefs.find(f => f.id === fontId);
    if (!def) return;

    // Fire-and-forget font load
    if (def.needsLoad) ensureFontLoaded(def).catch(() => {});

    const td: TextData = {
      ...slot.textData,
      fontFamily: def.family,
      fontLabel: def.label,
      fontWeight: def.weight,
      fontStyle: def.style,
      gfFamily: def.gfFamily,
    };
    updateSlot(state.activeSlotIndex, { textData: td });
    this.scheduleTextRerender();
  }

  /** Live-filter Google Fonts by name and show results as buttons. */
  private onGoogleFontSearch(): void {
    const q = this.fontGoogleSearch.value.toLowerCase().trim();
    this.fontGoogleResults.innerHTML = '';
    if (!q) return;

    const matches = GOOGLE_FONTS_CURATED.filter(f => f.label.toLowerCase().includes(q));
    if (matches.length === 0) {
      this.fontGoogleResults.textContent = 'No results in curated list.';
      return;
    }
    for (const f of matches) {
      const btn = el('button', { className: 'font-result-btn', textContent: f.label });
      btn.style.fontFamily = f.family;
      btn.addEventListener('click', () => this.applyFontSelection(f.id));
      this.fontGoogleResults.append(btn);
    }
  }

  /** Sync visible/hidden and slider range when switching between slot types. */
  private syncTextSlotUI(slot: Slot): void {
    const isText     = slot.type === 'text';
    const isFullCard = slot.type === 'full-card';
    const isCosmetic = slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:';

    // Category dropdown is always visible (lives above spriteControls in the DOM).
    // Only hide the sprite list for text/blobling slots.
    this.spriteControls.style.display   = (isText || isCosmetic) ? 'none' : '';
    this.textControls.style.display     = isText     ? '' : 'none';
    this.fullCardControls.style.display = isFullCard ? '' : 'none';
    this.bloblingControls.style.display = isCosmetic ? '' : 'none';
    this.tintLabel.textContent = isText ? 'Text Color' : (isFullCard ? 'Card Tint' : 'Custom Tint');

    if (isCosmetic) {
      // Blobling slot: scale slider in normal sprite mode
      this.scaleLabel.textContent = 'Scale';
      this.scaleInput.min  = '0.1';
      this.scaleInput.max  = '4';
      this.scaleInput.step = '0.1';
      this.scaleInput.value = String(slot.scale);
      this.syncBloblingUI(slot);
    } else if (isText) {
        // Switch scale slider → font size mode
        this.scaleLabel.textContent = 'Font Size';
        this.scaleInput.min  = '6';
        this.scaleInput.max  = '200';
        this.scaleInput.step = '1';
        this.scaleInput.value = String(slot.textData?.fontSize ?? 36);

      // Sync text-specific controls from slot state
      if (slot.textData) {
        this.textArea.value = slot.textData.content;
        this.syncAlignBtns(slot.textData.align);
        this.wordWrapToggle.checked = slot.textData.wordWrap;
        this.wordWrapWidthRow.style.display = slot.textData.wordWrap ? '' : 'none';
        this.wordWrapWidthInput.value = String(slot.textData.wordWrapWidth);
        this.boldToggle.checked    = slot.textData.bold;
        this.italicToggle.checked  = slot.textData.italic;
        this.mgShadowToggle.checked = slot.textData.mgShadow;
        this.strokeToggle.checked  = slot.textData.strokeEnabled;
        this.strokeControls.style.display = slot.textData.strokeEnabled ? '' : 'none';
        this.strokeColorInput.value = slot.textData.strokeColor;
        this.strokeWidthInput.value = String(slot.textData.strokeWidth);
        this.unicodeDropdown.selectById(slot.textData.unicodeStyle ?? 'none');
        // Sync font group + item dropdowns from saved textData.
        // Use setItems(items, restoreId) so CustomDropdown takes the silent
        // restore path — calling onFontGroupSelect would trigger setItems with
        // no restoreId, auto-selecting the first item and firing onSelectCb →
        // applyFontSelection → updateSlot → SLOT_CHANGED → infinite loop.
        const { fontFamily, fontWeight } = slot.textData;
        const mgDef  = MG_FONTS.find(f => f.family === fontFamily && f.weight === fontWeight);
        const sysDef = SYSTEM_FONTS.find(f => f.family === fontFamily);
        const gfDef  = GOOGLE_FONTS_CURATED.find(f => f.family === fontFamily);
        if (mgDef) {
          this.fontGroupDropdown.selectById('mg');
          this.fontItemDropdown.setItems(MG_FONTS.map(f => ({ id: f.id, label: f.label })), mgDef.id);
          this.fontGoogleSearch.style.display = 'none';
          this.fontGoogleResults.style.display = 'none';
          this.unicodeRow.style.display = 'none';
        } else if (sysDef) {
          this.fontGroupDropdown.selectById('system');
          this.fontItemDropdown.setItems(SYSTEM_FONTS.map(f => ({ id: f.id, label: f.label })), sysDef.id);
          this.fontGoogleSearch.style.display = 'none';
          this.fontGoogleResults.style.display = 'none';
          this.unicodeRow.style.display = 'none';
        } else if (gfDef) {
          this.fontGroupDropdown.selectById('google');
          this.fontItemDropdown.setItems(
            [...GOOGLE_FONTS_CURATED.map(f => ({ id: f.id, label: f.label })), { id: 'gf-search', label: '\uD83D\uDD0D Search all Google Fonts\u2026' }],
            gfDef.id,
          );
          this.fontGoogleSearch.style.display = 'none';
          this.fontGoogleResults.style.display = 'none';
          this.unicodeRow.style.display = 'none';
        }
      }
    } else {
      // Sprite or full-card: scale slider stays in sprite scale mode (0.1–4)
      this.scaleLabel.textContent = 'Scale';
      this.scaleInput.min  = '0.1';
      this.scaleInput.max  = '4';
      this.scaleInput.step = '0.1';
      this.scaleInput.value = String(slot.scale);

      if (isFullCard) {
        this.syncFullCardUI(slot);
      }
    }
  }

  /** Highlight the currently active alignment button. */
  private syncAlignBtns(align: TextData['align']): void {
    for (const btn of this.alignBtns) {
      btn.classList.toggle('active', btn.dataset.align === align);
    }
  }

  /** Add a new text layer slot (finds first empty slot or appends at end logic). */
    private addTextLayer(): void {
    // Find the first empty slot and activate it
    const emptyIdx = state.slots.findIndex(s => !s.spriteUrl && s.type !== 'text');
    // If no empty slot, use the current active one (overwrite)
    const targetIdx = emptyIdx >= 0 ? emptyIdx : state.activeSlotIndex;

    const td = defaultTextData();
    // Default color: white for textSlapper
      updateSlot(targetIdx, {
        type: 'text',
        spriteKey: 'text-layer',
        spriteUrl: 'text:', // sentinel — tells renderSlot this is a text slot
        textData: td,
        gifFrames: undefined,
        isAnimated: true, // marks as 'use gifFrames path' after first render
        scale: 1,
        customTint: { color: '#ffffff', opacity: 0 },
        mutations: [],
      });
    setActiveSlot(targetIdx);
    this.syncTextSlotUI(state.slots[targetIdx]);
    // Render an initial (empty) text canvas placeholder
    this.scheduleTextRerender();
  }

  // ── Blobling Rig ─────────────────────────────────────────────────────────────

  private static readonly BLOBLING_LAYER_ORDER = ['Default', 'Mid', 'Bottom', 'Top', 'Expression', 'FaceProp', 'Status', 'Banner'] as const;

  /** Build the blobling rig controls panel (called once in buildUI). */
  private buildBloblingControls(): HTMLElement {
    const rows: HTMLElement[] = [];

    for (const cat of App.BLOBLING_LAYER_ORDER) {
      const dropdown = new CustomDropdown({
        showThumbs: true,
        placeholder: 'None',
        onSelect: (item) => {
          const slot = getActiveSlot();
          if (slot.type !== 'cosmetic') return;
          const layers = { ...(slot.cosmeticLayers ?? {}) };
          if (item.id === 'none') {
            delete layers[cat];
          } else {
            layers[cat] = item.id;
          }
          updateSlotSilent(state.activeSlotIndex, { cosmeticLayers: layers });
          this.scheduleBloblingRerender();
        },
      });
      // Pre-populate with just 'None' so the dropdown renders immediately;
      // syncBloblingUI will repopulate with the full cosmetics list.
      dropdown.setItems([{ id: 'none', label: 'None' }], 'none');
      this.bloblingCatDropdowns.set(cat, dropdown);

      rows.push(el('div', { className: 'blobling-cat-row' }, [
        el('span', { className: 'blobling-cat-label', textContent: cat }),
        dropdown.element,
      ]));
    }

    // Animation picker
    this.bloblingAnimDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'None (static)',
      onSelect: (item) => {
        const slot = getActiveSlot();
        if (slot.type !== 'cosmetic') return;
        const animId = item.id === 'none' ? undefined : item.id;
        updateSlotSilent(state.activeSlotIndex, { bloblingAnimId: animId });
        this.scheduleBloblingRerender();
      },
    });
    this.bloblingAnimDropdown.setItems([{ id: 'none', label: 'None (static)' }], 'none');

    return el('div', { className: 'blobling-controls-section', style: 'display:none' }, [
      el('h3', { className: 'blobling-heading', textContent: 'Blobling Rig' }),
      el('p', { className: 'blobling-hint', textContent: 'Layer cosmetics to build your blobling.' }),
      ...rows,
      el('div', { className: 'blobling-anim-section' }, [
        el('label', { textContent: 'Animation' }),
        this.bloblingAnimDropdown.element,
      ]),
    ]);
  }

  /** Add a new blobling rig slot (finds first empty slot or uses active). */
  private addBloblingLayer(): void {
    const emptyIdx = state.slots.findIndex(s => !s.spriteUrl && s.type !== 'text');
    const targetIdx = emptyIdx >= 0 ? emptyIdx : state.activeSlotIndex;

    updateSlot(targetIdx, {
      type: 'cosmetic',
      spriteKey: 'blobling',
      spriteUrl: 'blobling:',
      cosmeticLayers: {},
      bloblingAnimId: undefined,
      gifFrames: undefined,
      isAnimated: false,
      scale: 1,
      customTint: { color: '#ffffff', opacity: 0 },
      mutations: [],
    });
    setActiveSlot(targetIdx);
    this.syncTextSlotUI(state.slots[targetIdx]);
  }

  /** Sync blobling rig controls UI from the slot's current state. */
  private syncBloblingUI(slot: Slot): void {
    if (slot.type !== 'cosmetic') return;
    const cosData = state.cosmeticsData;

    for (const cat of App.BLOBLING_LAYER_ORDER) {
      const dropdown = this.bloblingCatDropdowns.get(cat);
      if (!dropdown) continue;

      const items: DropdownItem[] = [{ id: 'none', label: 'None' }];
      if (cosData) {
        const catData = cosData.categories.find(c => c.cat === cat);
        if (catData) {
          for (const item of catData.items) {
            items.push({ id: item.id, label: item.name, thumbUrl: item.url });
          }
        }
      }
      const selectedId = slot.cosmeticLayers?.[cat] ?? 'none';
      dropdown.setItems(items, selectedId);
    }

    // Populate animation dropdown
    const animItems: DropdownItem[] = [{ id: 'none', label: 'None (static)' }];
    const sd = state.spriteData;
    if (sd) {
      const animCat = sd.categories.find(c => c.cat === 'animations');
      if (animCat) {
        for (const item of animCat.items) {
          if (item.type === 'animation') {
            animItems.push({ id: item.id, label: item.name });
          }
        }
      }
    }
    this.bloblingAnimDropdown.setItems(animItems, slot.bloblingAnimId ?? 'none');
  }

  /** Debounce blobling re-renders during rapid cosmetic changes. */
  private scheduleBloblingRerender(): void {
    if (this.bloblingRenderDebounce !== null) clearTimeout(this.bloblingRenderDebounce);
    this.bloblingRenderDebounce = setTimeout(() => {
      this.bloblingRenderDebounce = null;
      this.rerenderBlobling(state.activeSlotIndex).catch(err => console.error('[MG] Blobling re-render failed:', err));
    }, 150);
  }

  /** Re-render the blobling slot at `idx` into gifFrames (static or animated). */
  private async rerenderBlobling(idx: number): Promise<void> {
    const slot = state.slots[idx];
    if (slot.type !== 'cosmetic' || slot.spriteUrl !== 'blobling:') return;

    const cosData = state.cosmeticsData;
    const FRAME_DELAY = 100; // ms — ~10fps

    // Resolve all selected cosmetic layer URLs in render order
    const cosmeticUrls: string[] = [];
    for (const cat of App.BLOBLING_LAYER_ORDER) {
      const cosmeticId = slot.cosmeticLayers?.[cat];
      if (!cosmeticId) continue;
      if (!cosData) continue;
      const catData = cosData.categories.find(c => c.cat === cat);
      const item = catData?.items.find(i => i.id === cosmeticId);
      if (item?.url) cosmeticUrls.push(item.url);
    }

    const animId = slot.bloblingAnimId;

    if (animId) {
      // Animated: load animation frames, composite cosmetics on top of each frame
      const sd = state.spriteData;
      if (!sd) return;

      const animEntry = sd.categories
        .find(c => c.cat === 'animations')
        ?.items.find(i => i.id === animId && i.type === 'animation');

      if (!animEntry || animEntry.type !== 'animation' || animEntry.frames.length === 0) return;

      const version = animEntry.url.match(/\/version\/([a-f0-9]+)\//i)?.[1] ?? state.gameVersion ?? '';
      const frameUrls = this.resolveAnimFrameUrls(animEntry.frames, version);
      if (frameUrls.length === 0) return;

      const [animImages, cosmeticImages] = await Promise.all([
        Promise.all(frameUrls.map(url => spriteLoader.load(url))),
        Promise.all(cosmeticUrls.map(url => spriteLoader.load(url))),
      ]);

      // Guard: bail if slot changed while loading
      const s = state.slots[idx];
      if (s.type !== 'cosmetic' || s.bloblingAnimId !== animId) return;

      const gifFrames = animImages.map(animImg => {
        const canvas = document.createElement('canvas');
        canvas.width = animImg.naturalWidth;
        canvas.height = animImg.naturalHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(animImg, 0, 0);
        for (const cosImg of cosmeticImages) {
          ctx.drawImage(cosImg, 0, 0, canvas.width, canvas.height);
        }
        return { canvas, delay: FRAME_DELAY };
      });

      s.gifFrames  = gifFrames;
      s.isAnimated = true;
      s.spriteUrl  = 'blobling:';
      bus.emit(Events.RENDER_REQUEST, null);
      this.refreshSlots();
      if (idx === state.activeSlotIndex) this.startGifPreview();
    } else {
      // Static: composite all cosmetics layers
      if (cosmeticUrls.length === 0) {
        // No cosmetics — blank placeholder canvas
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const s = state.slots[idx];
        if (s.type !== 'cosmetic') return;
        s.gifFrames  = [{ canvas, delay: 0 }];
        s.isAnimated = false;
        bus.emit(Events.RENDER_REQUEST, null);
        this.refreshSlots();
        return;
      }

      const cosmeticImages = await Promise.all(cosmeticUrls.map(url => spriteLoader.load(url)));
      const s = state.slots[idx];
      if (s.type !== 'cosmetic' || s.spriteUrl !== 'blobling:') return;

      const firstImg = cosmeticImages[0];
      const canvas = document.createElement('canvas');
      canvas.width  = firstImg.naturalWidth;
      canvas.height = firstImg.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      for (const img of cosmeticImages) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      }

      s.gifFrames  = [{ canvas, delay: 0 }];
      s.isAnimated = false;
      s.spriteUrl  = 'blobling:';
      bus.emit(Events.RENDER_REQUEST, null);
      this.refreshSlots();
      if (idx === state.activeSlotIndex) this.stopGifPreview();
    }
  }

  /** Debounce text re-renders so rapid typing doesn't flood the canvas pipeline. */
  private scheduleTextRerender(): void {
    if (this.textRenderDebounce !== null) clearTimeout(this.textRenderDebounce);
    this.textRenderDebounce = setTimeout(() => {
      this.textRenderDebounce = null;
      this.rerenderTextLayer().catch((err) => console.error('[MG] Text render failed:', err));
    }, 80);
  }

  /** Re-render the active text slot's canvas and store it in gifFrames[0]. */
  private async rerenderTextLayer(): Promise<void> {
    const slot = getActiveSlot();
    if (slot.type !== 'text' || !slot.textData) return;
    const canvas = await renderTextToCanvas(slot.textData, slot.customTint.color);
    // Update gifFrames in place without pushing undo (visual refresh only)
    const currentSlot = state.slots[state.activeSlotIndex];
    if (currentSlot.type !== 'text') return; // slot changed while awaiting
    currentSlot.gifFrames = [{ canvas, delay: 0 }];
    currentSlot.isAnimated = true;
    currentSlot.spriteUrl  = 'text:'; // keep sentinel URL
    bus.emit(Events.RENDER_REQUEST, null);
    // Also refresh the slot button thumbnail
    this.refreshSlots();
  }

  // ── Full Card Layer ──────────────────────────────────────────────────────────

  /** Build the slot picker overlay (singleton, appended to document.body). */
  private buildSlotPickerOverlay(): void {
    const overlay = el('div', { className: 'fc-slot-picker', style: 'display:none' });

    const search = el('input', {
      type: 'text',
      className: 'fc-slot-picker-search',
      placeholder: 'Search sprites…',
    }) as HTMLInputElement;

    const catSelect = el('select', { className: 'fc-slot-picker-cat' }) as HTMLSelectElement;
    catSelect.append(el('option', { value: '', textContent: 'All categories' }));
    if (state.spriteData) {
      for (const cat of state.spriteData.categories) {
        catSelect.append(el('option', { value: cat.cat, textContent: cat.cat }));
      }
    }
    if (state.cosmeticsData) {
      for (const cat of state.cosmeticsData.categories) {
        catSelect.append(el('option', { value: `cosmetic:${cat.cat}`, textContent: `Blobling: ${cat.cat}` }));
      }
    }

    const grid = el('div', { className: 'fc-slot-picker-grid' });

    const clearBtn = el('button', { textContent: 'Clear' }) as HTMLButtonElement;
    const closeBtn = el('button', { textContent: 'Close' }) as HTMLButtonElement;
    const footer = el('div', { className: 'fc-slot-picker-footer' }, [clearBtn, closeBtn]);

    overlay.append(search, catSelect, grid, footer);
    document.body.append(overlay);
    this.fcSlotPickerOverlay = overlay;

    const rebuildGrid = () => {
      grid.innerHTML = '';
      const q = search.value.toLowerCase();
      const catFilter = catSelect.value; // '' | atlas catName | 'cosmetic:catName'
      const sd = state.spriteData;
      const cd = state.cosmeticsData;

      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const img = entry.target as HTMLImageElement;
            const src = img.dataset.src;
            if (src) { img.src = src; delete img.dataset.src; }
            observer.unobserve(img);
          }
        }
      }, { root: grid, rootMargin: '40px' });

      const seen = new Set<string>();
      const addEntry = (key: string, displayName: string, thumbUrl: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        if (q && !displayName.toLowerCase().includes(q)) return;
        const img = document.createElement('img');
        img.dataset.src = thumbUrl;
        // No crossOrigin — picker thumbnails are display-only.
        img.alt = displayName;
        img.title = displayName;
        const div = el('div', { className: 'fc-slot-picker-item' }, [img]);
        div.addEventListener('click', () => {
          this.applySlotPickerSelection(key);
          overlay.style.display = 'none';
        });
        grid.append(div);
        observer.observe(img);
      };

      // ── Atlas frames + animations ──
      const showAtlas = !catFilter || !catFilter.startsWith('cosmetic:');
      if (showAtlas && sd) {
        for (const cat of sd.categories) {
          if (catFilter && cat.cat !== catFilter) continue;
          for (const item of cat.items) {
            const version = item.url.match(/\/version\/([a-f0-9]+)\//i)?.[1] ?? state.gameVersion ?? '';
            if (item.type === 'frame') {
              const name = item.id.split('/').pop() ?? item.name;
              const url = `https://mg-api.ariedam.fr/assets/sprites/${cat.cat}/${name}.png${version ? `?v=${version}` : ''}`;
              addEntry(item.id, item.name, url);
            } else if (item.type === 'animation' && item.frames.length > 0) {
              const frameUrls = this.resolveAnimFrameUrls(item.frames, version);
              if (frameUrls.length > 0) {
                addEntry(frameUrls[0], item.name, frameUrls[0]);
              }
            }
          }
        }
        // CDN-only extras (shown under 'ui' or when no filter)
        if (state.gameVersion && (!catFilter || catFilter === 'ui')) {
          const cdnBase = `https://magicgarden.gg/version/${state.gameVersion}/assets`;
          const cdnExtras: { label: string; file: string }[] = [
            { label: 'GardenJournal',          file: 'ui/GardenJournal.webp' },
            { label: 'AllRestocked (banner)',   file: 'ui/all-restocked.webp' },
            { label: 'EggsRestocked (banner)',  file: 'ui/eggs-restocked.webp' },
            { label: 'SeedsRestocked (banner)', file: 'ui/seeds-restocked.webp' },
            { label: 'ToolsRestocked (banner)', file: 'ui/tools-restocked.webp' },
          ];
          for (const extra of cdnExtras) {
            const url = `${cdnBase}/${extra.file}`;
            addEntry(url, extra.label, url);
          }
        }
      }

      // ── Cosmetics ──
      const showCosmetics = !catFilter || catFilter.startsWith('cosmetic:');
      if (showCosmetics && cd) {
        for (const cat of cd.categories) {
          if (catFilter && catFilter !== `cosmetic:${cat.cat}`) continue;
          for (const item of cat.items) {
            addEntry(item.url, item.name, item.url);
          }
        }
      }
    };

    search.addEventListener('input', rebuildGrid);
    catSelect.addEventListener('change', rebuildGrid);

    clearBtn.addEventListener('click', () => {
      this.applySlotPickerSelection('');
      overlay.style.display = 'none';
    });
    closeBtn.addEventListener('click', () => { overlay.style.display = 'none'; });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (overlay.style.display !== 'none' && !overlay.contains(e.target as Node)) {
        overlay.style.display = 'none';
      }
    }, true);

    // Store rebuild fn on element for re-population on open
    (overlay as any)._rebuild = rebuildGrid;
  }

  private openSlotPicker(trigger: HTMLElement, listType: 'diet' | 'crop' | 'egg', index: number): void {
    this.fcActiveSlotCtx = { list: listType, index };
    const overlay = this.fcSlotPickerOverlay;
    const rebuild = (overlay as any)._rebuild as (() => void) | undefined;
    if (rebuild) rebuild();
    const rect = trigger.getBoundingClientRect();
    const overlayW = 300;
    const overlayH = 400;
    // Open to the right of the trigger; fall back to left side if no room
    let left = rect.right + 4;
    let top = rect.top;
    if (left + overlayW > window.innerWidth) left = rect.left - overlayW - 4;
    if (left < 0) left = 4;
    if (top + overlayH > window.innerHeight) top = window.innerHeight - overlayH - 8;
    if (top < 0) top = 4;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${top}px`;
    overlay.style.display = 'flex';
  }

  private applySlotPickerSelection(spriteKey: string): void {
    const ctx = this.fcActiveSlotCtx;
    if (!ctx) return;
    const slots = this.getSlotArray(ctx.list);
    if (ctx.index >= 0 && ctx.index < slots.length) {
      slots[ctx.index] = { ...slots[ctx.index], spriteKey };
    }
    this.renderSlotListUI(ctx.list);
    this.scheduleFullCardRerender();
  }

  /** Build the per-slot mutation popover (singleton, appended to document.body). */
  private buildMutPopover(): void {
    const popover = el('div', { className: 'fc-mut-popover', style: 'display:none' });
    const chips = el('div', { className: 'fc-mut-popover-chips' });
    popover.append(chips);
    document.body.append(popover);
    this.fcMutPopover = popover;

    for (const id of Object.keys(MUTATION_CHIP_COLORS)) {
      const chip = el('span', { className: 'full-card-mutation-chip', textContent: id }) as HTMLElement;
      chip.dataset.mutId = id;
      chip.style.background = MUTATION_CHIP_COLORS[id] ?? '#555';
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const ctx = this.fcActiveSlotCtx;
        if (!ctx) return;
        const slots = this.getSlotArray(ctx.list);
        if (ctx.index >= 0 && ctx.index < slots.length) {
          const active = Array.from(chips.querySelectorAll<HTMLElement>('.full-card-mutation-chip.active'))
            .map(c => c.dataset.mutId as string).filter(Boolean);
          slots[ctx.index] = { ...slots[ctx.index], mutations: active };
        }
        this.renderSlotListUI(ctx.list);
        this.scheduleFullCardRerender();
      });
      chips.append(chip);
    }

    document.addEventListener('click', (e) => {
      if (popover.style.display !== 'none' && !popover.contains(e.target as Node)) {
        popover.style.display = 'none';
      }
    }, true);
  }

  private openMutPopover(trigger: HTMLElement, listType: 'diet' | 'crop' | 'egg', index: number): void {
    this.fcActiveSlotCtx = { list: listType, index };
    const popover = this.fcMutPopover;
    const slots = this.getSlotArray(listType);
    const currentMuts = new Set(slots[index]?.mutations ?? []);
    for (const chip of Array.from(popover.querySelectorAll<HTMLElement>('[data-mut-id]'))) {
      chip.classList.toggle('active', currentMuts.has(chip.dataset.mutId ?? ''));
    }
    const rect = trigger.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;
    if (left + 260 > window.innerWidth) left = window.innerWidth - 268;
    if (top + 200 > window.innerHeight) top = rect.top - 204;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.display = 'block';
  }

  private getSlotArray(listType: 'diet' | 'crop' | 'egg'): FullCardSpriteSlot[] {
    if (listType === 'diet') return this.fcDietSlots;
    if (listType === 'crop') return this.fcCropSlots;
    return this.fcEggHatchSlots;
  }

  private makeSlotRow(listType: 'diet' | 'crop' | 'egg', index: number, slot: FullCardSpriteSlot): HTMLElement {
    const thumb = document.createElement('img');
    thumb.className = 'full-card-slot-thumb';
    // No crossOrigin — thumbnails are display-only, don't need canvas access.
    // crossOrigin='anonymous' would break them in production if the server
    // doesn't send CORS headers (which mg-api does not per sprite-loader.ts).
    if (slot.spriteKey) {
      const url = this.fcBuildSpriteUrl(slot.spriteKey);
      if (url) thumb.src = url;
    }

    const rawName = slot.spriteKey
      ? (slot.spriteKey.split('?')[0].split('/').pop()?.replace(/\.(png|webp|gif|jpg)$/i, '') ?? '(empty)')
      : '(empty)';
    const name = el('span', { className: 'full-card-slot-name', textContent: rawName });

    const openPicker = () => this.openSlotPicker(thumb, listType, index);
    thumb.addEventListener('click', openPicker);
    name.addEventListener('click', openPicker);

    const mutBtn = el('button', {
      className: `full-card-slot-mut-btn${slot.mutations.length > 0 ? ' has-mutations' : ''}`,
      textContent: '✦',
      title: 'Mutations',
      type: 'button',
    }) as HTMLButtonElement;
    mutBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openMutPopover(mutBtn, listType, index);
    });

    const removeBtn = el('button', {
      className: 'full-card-slot-remove',
      textContent: '×',
      type: 'button',
    }) as HTMLButtonElement;
    removeBtn.addEventListener('click', () => {
      const slots = this.getSlotArray(listType);
      slots.splice(index, 1);
      this.renderSlotListUI(listType);
      this.scheduleFullCardRerender();
    });

    const children: HTMLElement[] = [thumb as unknown as HTMLElement, name as HTMLElement, mutBtn, removeBtn];

    if (listType === 'egg') {
      const pctInput = el('input', {
        type: 'text',
        className: 'full-card-slot-pct',
        placeholder: '0%',
        value: slot.pctText ?? '',
      }) as HTMLInputElement;
      pctInput.addEventListener('input', () => {
        const slots = this.getSlotArray(listType);
        if (slots[index]) slots[index] = { ...slots[index], pctText: pctInput.value };
      });
      children.splice(3, 0, pctInput);
    }

    return el('div', { className: 'full-card-slot-row' }, children);
  }

  private renderSlotListUI(listType: 'diet' | 'crop' | 'egg'): void {
    let container: HTMLElement;
    if (listType === 'diet') container = this.fullCardDietSlotList;
    else if (listType === 'crop') {
      this.renderSlotListInContainer(this.fullCardPlantCropSlotList, 'crop');
      container = this.fullCardCropSlotList;
    } else container = this.fullCardEggHatchSlotList;
    this.renderSlotListInContainer(container, listType);
  }

  private renderSlotListInContainer(container: HTMLElement, listType: 'diet' | 'crop' | 'egg'): void {
    container.innerHTML = '';
    const slots = this.getSlotArray(listType);
    slots.forEach((slot, index) => {
      container.append(this.makeSlotRow(listType, index, slot));
    });
    const addBtn = el('button', {
      className: 'full-card-slot-add-btn',
      textContent: '+ Add',
      type: 'button',
    }) as HTMLButtonElement;
    addBtn.addEventListener('click', () => {
      slots.push({ spriteKey: '', mutations: [] });
      this.renderSlotListInContainer(container, listType);
      if (listType === 'crop') {
        // sync the other crop container
        const other = container === this.fullCardCropSlotList ? this.fullCardPlantCropSlotList : this.fullCardCropSlotList;
        if (other) this.renderSlotListInContainer(other, 'crop');
      }
      this.scheduleFullCardRerender();
    });
    container.append(addBtn);
  }

  private fcBuildSpriteUrl(spriteKey: string): string | null {
    if (!spriteKey) return null;
    if (spriteKey.startsWith('http') || spriteKey.startsWith('blob:') || spriteKey.startsWith('data:')) return spriteKey;
    if (spriteKey.startsWith('sprite/')) {
      const [, cat, ...rest] = spriteKey.split('/');
      const name = rest.join('/');
      if (cat && name) {
        const version = state.gameVersion ?? '';
        return `https://mg-api.ariedam.fr/assets/sprites/${cat}/${name}.png${version ? `?v=${version}` : ''}`;
      }
    }
    return null;
  }

  /** Build the compact full-card control panel (called once in buildUI). */
  private buildFullCardControls(): HTMLElement {
    const RARITIES: FullCardRarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythic', 'Divine', 'Celestial'];

    this.fullCardTypeLabel = el('div', { className: 'full-card-type-label', textContent: 'Full Card' }) as HTMLElement;

    this.fullCardNameInput = el('input', { type: 'text', placeholder: 'Item name...' }) as HTMLInputElement;
    this.fullCardNameInput.addEventListener('input', () => this.scheduleFullCardRerender());

    // ── Pet section ──
    this.fullCardRaritySelect = el('select') as HTMLSelectElement;
    for (const r of RARITIES) {
      this.fullCardRaritySelect.append(el('option', { value: r, textContent: r }));
    }
    this.fullCardRaritySelect.addEventListener('change', () => this.scheduleFullCardRerender());

    this.fullCardRarityRow = el('div', { className: 'full-card-field' }, [
      el('label', { textContent: 'Rarity' }), this.fullCardRaritySelect,
    ]) as HTMLElement;

    this.fullCardPetCurrentStrInput = el('input', { type: 'number', min: '0', max: '1000', step: '1', value: '50' }) as HTMLInputElement;
    this.fullCardPetCurrentStrInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPetMaxStrInput = el('input', { type: 'number', min: '0', max: '1000', step: '1', value: '80' }) as HTMLInputElement;
    this.fullCardPetMaxStrInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPetStrPctDisplay = el('span', { className: 'full-card-slider-val', textContent: '0%' });
    this.fullCardPetStrPctInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0' }) as HTMLInputElement;
    this.fullCardPetStrPctInput.addEventListener('input', () => {
      this.fullCardPetStrPctDisplay.textContent = `${this.fullCardPetStrPctInput.value}%`;
      this.scheduleFullCardRerender();
    });

    this.fullCardPetHungerPctDisplay = el('span', { className: 'full-card-slider-val', textContent: '100%' });
    this.fullCardPetHungerPctInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '100' }) as HTMLInputElement;
    this.fullCardPetHungerPctInput.addEventListener('input', () => {
      this.fullCardPetHungerPctDisplay.textContent = `${this.fullCardPetHungerPctInput.value}%`;
      this.scheduleFullCardRerender();
    });

    this.fullCardPetAgeInput = el('input', { type: 'text', placeholder: '0h' }) as HTMLInputElement;
    this.fullCardPetAgeInput.addEventListener('input', () => this.scheduleFullCardRerender());
    this.fullCardPetWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
    this.fullCardPetWeightInput.addEventListener('input', () => this.scheduleFullCardRerender());
    this.fullCardPetSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
    this.fullCardPetSellInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPetStrLabelInput = el('input', { type: 'text', placeholder: 'Strength' }) as HTMLInputElement;
    this.fullCardPetStrLabelInput.addEventListener('input', () => this.scheduleFullCardRerender());
    this.fullCardPetHungerLabelInput = el('input', { type: 'text', placeholder: 'Hunger' }) as HTMLInputElement;
    this.fullCardPetHungerLabelInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardDietSlotList = el('div', { className: 'full-card-slot-list' });

    // Ability chips
    this.fullCardPetAbilityChips = el('div', { className: 'full-card-ability-chips' });
    this.fullCardPetAbilityAddSelect = el('select') as HTMLSelectElement;
    this.fullCardPetAbilityAddBtn = el('button', {
      type: 'button',
      className: 'full-card-item-btn',
      textContent: 'Add',
    }) as HTMLButtonElement;
    this.fullCardPetAbilityAddBtn.addEventListener('click', () => {
      const id = this.fullCardPetAbilityAddSelect.value;
      if (!id) return;
      const existing = Array.from(this.fullCardPetAbilityChips.querySelectorAll<HTMLElement>('[data-ability-id]'))
        .map(c => c.dataset.abilityId);
      if (existing.includes(id)) return;
      const name = this.fullCardPetAbilityAddSelect.selectedOptions[0]?.textContent ?? id;
      this.fullCardPetAbilityChips.append(this.createAbilityChip(id, name));
      this.scheduleFullCardRerender();
    });
    const abilityAddRow = el('div', { className: 'full-card-ability-add-row' }, [
      this.fullCardPetAbilityAddSelect,
      this.fullCardPetAbilityAddBtn,
    ]);

    this.fullCardPetAbilityList = el('div', { className: 'full-card-abilities-list' });
    this.fullCardAddCustomAbilityBtn = el('button', {
      type: 'button',
      className: 'full-card-ability-add',
      textContent: '+',
      title: 'Add custom ability',
    }) as HTMLButtonElement;
    this.fullCardAddCustomAbilityBtn.addEventListener('click', () => {
      this.fullCardPetAbilityList.append(this.createCustomAbilityRow());
      this.scheduleFullCardRerender();
    });
    const abilityWrap = el('div', { className: 'full-card-abilities-wrap' }, [
      this.fullCardPetAbilityChips,
      abilityAddRow,
      el('div', { className: 'full-card-abilities-custom' }, [
        this.fullCardPetAbilityList,
        this.fullCardAddCustomAbilityBtn,
      ]),
    ]);

    this.fullCardPetSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Pet Stats' }),
      this.fullCardRarityRow,
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Current STR' }), this.fullCardPetCurrentStrInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Max STR' }), this.fullCardPetMaxStrInput]),
      el('div', { className: 'full-card-field' }, [
        el('label', { textContent: 'XP % (within level)' }),
        el('div', { className: 'full-card-slider-row' }, [this.fullCardPetStrPctInput, this.fullCardPetStrPctDisplay]),
      ]),
      el('div', { className: 'full-card-field' }, [
        el('label', { textContent: 'Hunger %' }),
        el('div', { className: 'full-card-slider-row' }, [this.fullCardPetHungerPctInput, this.fullCardPetHungerPctDisplay]),
      ]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Age' }), this.fullCardPetAgeInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Weight' }), this.fullCardPetWeightInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Sell Price' }), this.fullCardPetSellInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Str label' }), this.fullCardPetStrLabelInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Hunger label' }), this.fullCardPetHungerLabelInput]),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Diet' }), this.fullCardDietSlotList]),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Abilities' }), abilityWrap]),
    ]);

    // ── Plant section ──
    this.fullCardPlantSlotCountInput = el('input', { type: 'number', min: '1', step: '1', value: '1' }) as HTMLInputElement;
    this.fullCardPlantSlotCountInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPlantMaturedSlotsInput = el('input', { type: 'number', min: '0', step: '1', value: '0' }) as HTMLInputElement;
    this.fullCardPlantMaturedSlotsInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPlantMaturityInput = el('input', { type: 'range', min: '0', max: '100', step: '1', value: '0' }) as HTMLInputElement;
    this.fullCardPlantMaturityInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPlantCropSlotList = el('div', { className: 'full-card-slot-list' });

    this.fullCardPlantCropWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
    this.fullCardPlantCropWeightInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPlantCropSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
    this.fullCardPlantCropSellInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardPlantSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Growth' }),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Total Slots' }), this.fullCardPlantSlotCountInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Mature Slots' }), this.fullCardPlantMaturedSlotsInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Maturity %' }), this.fullCardPlantMaturityInput]),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Crops' }), this.fullCardPlantCropSlotList]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Crop Weight' }), this.fullCardPlantCropWeightInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Crop Sell Price' }), this.fullCardPlantCropSellInput]),
    ]);

    // ── Crop section ──
    this.fullCardCropSlotList = el('div', { className: 'full-card-slot-list' });

    this.fullCardCropWeightInput = el('input', { type: 'text', placeholder: '0 kg' }) as HTMLInputElement;
    this.fullCardCropWeightInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardCropSellInput = el('input', { type: 'text', placeholder: '0' }) as HTMLInputElement;
    this.fullCardCropSellInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardCropSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Crop' }),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Produce' }), this.fullCardCropSlotList]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Weight' }), this.fullCardCropWeightInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Sell Price' }), this.fullCardCropSellInput]),
    ]);

    // ── Seed section ──
    this.fullCardSeedCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
    this.fullCardSeedCountInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardSeedRaritySelect = el('select') as HTMLSelectElement;
    for (const r of RARITIES) {
      this.fullCardSeedRaritySelect.append(el('option', { value: r, textContent: r }));
    }
    this.fullCardSeedRaritySelect.addEventListener('change', () => this.scheduleFullCardRerender());

    this.fullCardSeedSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Seed' }),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), this.fullCardSeedCountInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Rarity' }), this.fullCardSeedRaritySelect]),
    ]);

    // ── Egg section ──
    this.fullCardEggCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
    this.fullCardEggCountInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardEggHatchSlotList = el('div', { className: 'full-card-slot-list' });

    this.fullCardEggGoldRateInput = el('input', { type: 'text', placeholder: '0%' }) as HTMLInputElement;
    this.fullCardEggGoldRateInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardEggRainbowRateInput = el('input', { type: 'text', placeholder: '0%' }) as HTMLInputElement;
    this.fullCardEggRainbowRateInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardEggSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Egg' }),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), this.fullCardEggCountInput]),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Hatches' }), this.fullCardEggHatchSlotList]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Gold Rate' }), this.fullCardEggGoldRateInput]),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Rainbow Rate' }), this.fullCardEggRainbowRateInput]),
    ]);

    // ── Tool section ──
    this.fullCardToolCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
    this.fullCardToolCountInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardToolDescInput = el('textarea', { placeholder: 'Tool description...' }) as HTMLTextAreaElement;
    this.fullCardToolDescInput.rows = 3;
    this.fullCardToolDescInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardToolSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Tool' }),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), this.fullCardToolCountInput]),
      el('div', { className: 'full-card-field full-card-field--stack' }, [el('label', { textContent: 'Description' }), this.fullCardToolDescInput]),
    ]);

    // ── Decor section ──
    this.fullCardDecorCountInput = el('input', { type: 'text', placeholder: '1' }) as HTMLInputElement;
    this.fullCardDecorCountInput.addEventListener('input', () => this.scheduleFullCardRerender());

    this.fullCardDecorSection = el('div', { className: 'full-card-section', style: 'display:none' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Decor' }),
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Count' }), this.fullCardDecorCountInput]),
    ]);

    // ── Shared: mutations (all card types) ──
    this.fullCardItemMutationsContainer = el('div', { className: 'full-card-mutations-wrap' });
    for (const id of Object.keys(FILTERS)) {
      const chip = el('span', {
        className: 'full-card-mutation-chip',
        textContent: id,
      }) as HTMLElement;
      chip.dataset.mutationId = id;
      chip.style.background = MUTATION_CHIP_COLORS[id] ?? '#555';
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        this.scheduleFullCardRerender();
      });
      this.fullCardItemMutationsContainer.append(chip);
    }

    // ── Shared: locked toggle ──
    this.fullCardLockedCheck = el('input', { type: 'checkbox' }) as HTMLInputElement;
    this.fullCardLockedCheck.addEventListener('change', () => this.scheduleFullCardRerender());

    // ── Assemble ──
    const mutationsSection = el('div', { className: 'full-card-section' }, [
      el('div', { className: 'full-card-section-title', textContent: 'Mutations' }),
      this.fullCardItemMutationsContainer,
    ]);

    const section = el('div', { className: 'full-card-controls-section', style: 'display:none' });
    section.append(
      this.fullCardTypeLabel,
      el('div', { className: 'full-card-field' }, [el('label', { textContent: 'Name' }), this.fullCardNameInput]),
      el('label', { className: 'full-card-locked-wrap' }, [this.fullCardLockedCheck, document.createTextNode(' Locked')]),
      this.fullCardPetSection,
      this.fullCardPlantSection,
      this.fullCardCropSection,
      this.fullCardSeedSection,
      this.fullCardEggSection,
      this.fullCardToolSection,
      this.fullCardDecorSection,
      mutationsSection,
    );

    // Build singleton overlays (appended to body)
    this.buildSlotPickerOverlay();
    this.buildMutPopover();

    return section;
  }

  private populateAbilityOptions(selectedIds: string[] = []): void {
    const gd = state.gameData;
    // Populate the add-select dropdown
    const addSelect = this.fullCardPetAbilityAddSelect;
    addSelect.innerHTML = '';
    if (!gd) {
      addSelect.append(el('option', { value: '', textContent: '(loading...)' }));
    } else {
      const abilities = Object.entries(gd.abilities).map(([id, def]) => ({
        id,
        name: def?.name ?? id,
      }));
      abilities.sort((a, b) => a.name.localeCompare(b.name));
      for (const ability of abilities) {
        const label = ability.name && ability.name !== ability.id
          ? `${ability.name} (${ability.id})`
          : ability.id;
        addSelect.append(el('option', { value: ability.id, textContent: label, title: ability.id }));
      }
    }
    // Render chips for selected IDs
    this.fullCardPetAbilityChips.innerHTML = '';
    for (const id of selectedIds) {
      if (!id) continue;
      const optEl = Array.from(addSelect.options).find(o => o.value === id);
      const name = optEl?.textContent ?? id;
      this.fullCardPetAbilityChips.append(this.createAbilityChip(id, name));
    }
  }

  private createAbilityChip(id: string, name: string): HTMLElement {
    const removeBtn = el('button', {
      type: 'button',
      className: 'full-card-chip-remove',
      textContent: '×',
    }) as HTMLButtonElement;
    const chip = el('span', { className: 'full-card-ability-chip' }, [
      document.createTextNode(name),
      removeBtn,
    ]) as HTMLElement;
    chip.dataset.abilityId = id;
    chip.style.background = abilityColor(id);
    removeBtn.addEventListener('click', () => {
      chip.remove();
      this.scheduleFullCardRerender();
    });
    return chip;
  }

  private createCustomAbilityRow(entry?: FullCardAbilityEntry): HTMLElement {
    const nameInput = el('input', {
      type: 'text',
      placeholder: 'Custom ability',
      value: entry?.name ?? '',
    }) as HTMLInputElement;
    nameInput.dataset.role = 'name';
    nameInput.addEventListener('input', () => this.scheduleFullCardRerender());

    const colorInput = el('input', {
      type: 'color',
      value: entry?.color ?? '#969696',
      className: 'full-card-ability-color',
    }) as HTMLInputElement;
    colorInput.dataset.role = 'color';
    colorInput.addEventListener('input', () => this.scheduleFullCardRerender());

    const removeBtn = el('button', {
      type: 'button',
      className: 'full-card-ability-remove',
      textContent: '×',
      title: 'Remove ability',
    }) as HTMLButtonElement;

    const row = el('div', { className: 'full-card-ability-row' }, [
      nameInput,
      colorInput,
      removeBtn,
    ]) as HTMLElement;

    removeBtn.addEventListener('click', () => {
      row.remove();
      this.scheduleFullCardRerender();
    });

    return row;
  }

  private renderCustomAbilityRows(entries: FullCardAbilityEntry[]): void {
    this.fullCardPetAbilityList.innerHTML = '';
    const customs = entries.filter(entry => entry.kind === 'custom');
    for (const entry of customs) {
      this.fullCardPetAbilityList.append(this.createCustomAbilityRow(entry));
    }
  }

  private readCustomAbilityEntries(): FullCardAbilityEntry[] {
    const entries: FullCardAbilityEntry[] = [];
    const rows = Array.from(this.fullCardPetAbilityList.children) as HTMLElement[];
    for (const row of rows) {
      const nameInput = row.querySelector('input[data-role="name"]') as HTMLInputElement | null;
      const colorInput = row.querySelector('input[data-role="color"]') as HTMLInputElement | null;
      const name = nameInput?.value.trim() ?? '';
      if (!name) continue;
      entries.push({
        kind: 'custom',
        name,
        color: colorInput?.value ?? '#969696',
      });
    }
    return entries;
  }

  /** Populate full-card form fields from a slot's fullCardData. */
  private syncFullCardUI(slot: Slot): void {
    const data = slot.fullCardData;
    if (!data) return;

    this.fullCardTypeLabel.textContent = `${data.cardType} Card`;
    this.fullCardNameInput.value = data.itemName;
    this.fullCardLockedCheck.checked = data.isLocked ?? false;

    const isPet   = data.cardType === 'Pet';
    const isPlant = data.cardType === 'Plant';
    const isCrop  = data.cardType === 'Crop';
    const isSeed  = data.cardType === 'Seed';
    const isEgg   = data.cardType === 'Egg';
    const isTool  = data.cardType === 'Tool';
    const isDecor = data.cardType === 'Decor';

    this.fullCardPetSection.style.display   = isPet   ? '' : 'none';
    this.fullCardPlantSection.style.display = isPlant ? '' : 'none';
    this.fullCardCropSection.style.display  = isCrop  ? '' : 'none';
    this.fullCardSeedSection.style.display  = isSeed  ? '' : 'none';
    this.fullCardEggSection.style.display   = isEgg   ? '' : 'none';
    this.fullCardToolSection.style.display  = isTool  ? '' : 'none';
    this.fullCardDecorSection.style.display = isDecor ? '' : 'none';

    if (isPet) {
      this.fullCardRaritySelect.value = data.rarity ?? 'Common';
      this.fullCardPetCurrentStrInput.value = data.petStr ?? '50';
      this.fullCardPetMaxStrInput.value = data.petMaxStr ?? '80';
      const strPct = data.petStrPct ?? 0;
      this.fullCardPetStrPctInput.value = String(strPct);
      this.fullCardPetStrPctDisplay.textContent = `${strPct}%`;
      const hungerPct = data.petHungerPct ?? 100;
      this.fullCardPetHungerPctInput.value = String(hungerPct);
      this.fullCardPetHungerPctDisplay.textContent = `${hungerPct}%`;
      this.fullCardPetAgeInput.value = data.petAge ?? '';
      this.fullCardPetWeightInput.value = data.petWeight ?? '';
      this.fullCardPetSellInput.value = data.petSellPrice ?? '';
      this.fullCardPetStrLabelInput.value = data.petStrLabel ?? '';
      this.fullCardPetHungerLabelInput.value = data.petHungerLabel ?? '';
      this.fcDietSlots = (data.petDietSlots ?? []).map(s => ({ ...s }));
      this.renderSlotListInContainer(this.fullCardDietSlotList, 'diet');
      const entries = data.petAbilityEntries ?? [];
      const gameIds = entries.filter(e => e.kind === 'game' && e.id).map(e => e.id as string);
      this.populateAbilityOptions(gameIds);
      this.renderCustomAbilityRows(entries);
    }

    if (isPlant) {
      this.fullCardPlantSlotCountInput.value = String(data.plantSlotCount ?? 1);
      this.fullCardPlantMaturedSlotsInput.value = String(data.plantMaturedSlots ?? 0);
      this.fullCardPlantMaturityInput.value = String(data.plantMaturityPct ?? 0);
      this.fcCropSlots = (data.cropSlots ?? []).map(s => ({ ...s }));
      this.renderSlotListInContainer(this.fullCardPlantCropSlotList, 'crop');
      this.fullCardPlantCropWeightInput.value = data.cropWeight ?? '';
      this.fullCardPlantCropSellInput.value = data.cropSellPrice ?? '';
    }

    if (isCrop) {
      this.fcCropSlots = (data.cropSlots ?? []).map(s => ({ ...s }));
      this.renderSlotListInContainer(this.fullCardCropSlotList, 'crop');
      this.fullCardCropWeightInput.value = data.cropWeight ?? '';
      this.fullCardCropSellInput.value = data.cropSellPrice ?? '';
    }

    if (isSeed) {
      this.fullCardSeedCountInput.value = data.itemCount ?? '';
      this.fullCardSeedRaritySelect.value = data.seedRarity ?? 'Common';
    }

    if (isEgg) {
      this.fullCardEggCountInput.value = data.itemCount ?? '';
      this.fcEggHatchSlots = (data.eggHatchSlots ?? []).map(s => ({ ...s }));
      this.renderSlotListInContainer(this.fullCardEggHatchSlotList, 'egg');
      this.fullCardEggGoldRateInput.value = data.eggGoldRateText ?? '0%';
      this.fullCardEggRainbowRateInput.value = data.eggRainbowRateText ?? '0%';
    }

    if (isTool) {
      this.fullCardToolCountInput.value = data.itemCount ?? '';
      this.fullCardToolDescInput.value = data.toolDescription ?? '';
    }

    if (isDecor) {
      this.fullCardDecorCountInput.value = data.itemCount ?? '';
    }

    // Mutations
    const mutationSet = new Set(slot.mutations ?? []);
    for (const chip of Array.from(this.fullCardItemMutationsContainer.querySelectorAll<HTMLElement>('[data-mutation-id]'))) {
      chip.classList.toggle('active', mutationSet.has(chip.dataset.mutationId ?? ''));
    }
  }

  /** Read current form state into a FullCardData object (cardType is immutable). */
  private readFullCardDataFromUI(base: FullCardData): FullCardData {
    const cardType = base.cardType;
    const result: FullCardData = {
      cardType,
      itemName: this.fullCardNameInput.value || base.itemName,
      isLocked: this.fullCardLockedCheck.checked,
    };

    if (cardType === 'Pet') {
      result.rarity = (this.fullCardRaritySelect.value as FullCardRarity) || 'Common';
      result.petStr = this.fullCardPetCurrentStrInput.value;
      result.petMaxStr = this.fullCardPetMaxStrInput.value;
      result.petStrPct = parseInt(this.fullCardPetStrPctInput.value) || 0;
      result.petHungerPct = parseInt(this.fullCardPetHungerPctInput.value) || 100;
      result.petAge = this.fullCardPetAgeInput.value;
      result.petWeight = this.fullCardPetWeightInput.value;
      result.petSellPrice = this.fullCardPetSellInput.value;
      result.petStrLabel = this.fullCardPetStrLabelInput.value || undefined;
      result.petHungerLabel = this.fullCardPetHungerLabelInput.value || undefined;
      result.petDietSlots = this.fcDietSlots.map(s => ({ ...s }));
      const selectedGameIds = Array.from(this.fullCardPetAbilityChips.querySelectorAll<HTMLElement>('[data-ability-id]'))
        .map(c => c.dataset.abilityId as string)
        .filter(Boolean);
      const customEntries = this.readCustomAbilityEntries();
      result.petAbilityEntries = [
        ...selectedGameIds.map(id => ({ kind: 'game' as const, id })),
        ...customEntries,
      ];
    } else if (cardType === 'Plant') {
      const slotCount = Math.max(1, parseInt(this.fullCardPlantSlotCountInput.value) || 1);
      const maturedSlots = Math.max(0, Math.min(slotCount, parseInt(this.fullCardPlantMaturedSlotsInput.value) || 0));
      const maturityPct = Math.max(0, Math.min(100, parseInt(this.fullCardPlantMaturityInput.value) || 0));
      result.plantSlotCount = slotCount;
      result.plantMaturedSlots = maturedSlots;
      result.plantMaturityPct = maturityPct;
      result.cropSlots = this.fcCropSlots.map(s => ({ ...s }));
      result.cropWeight = this.fullCardPlantCropWeightInput.value;
      result.cropSellPrice = this.fullCardPlantCropSellInput.value;
    } else if (cardType === 'Crop') {
      result.cropSlots = this.fcCropSlots.map(s => ({ ...s }));
      result.cropWeight = this.fullCardCropWeightInput.value;
      result.cropSellPrice = this.fullCardCropSellInput.value;
    } else if (cardType === 'Seed') {
      result.itemCount = this.fullCardSeedCountInput.value;
      result.seedRarity = (this.fullCardSeedRaritySelect.value as FullCardRarity) || 'Common';
    } else if (cardType === 'Egg') {
      result.itemCount = this.fullCardEggCountInput.value;
      result.eggHatchSlots = this.fcEggHatchSlots.map(s => ({ ...s }));
      result.eggGoldRateText = this.fullCardEggGoldRateInput.value;
      result.eggRainbowRateText = this.fullCardEggRainbowRateInput.value;
    } else if (cardType === 'Tool') {
      result.itemCount = this.fullCardToolCountInput.value;
      result.toolDescription = this.fullCardToolDescInput.value;
    } else if (cardType === 'Decor') {
      result.itemCount = this.fullCardDecorCountInput.value;
    }

    return result;
  }

  /** Load a full-card preset into the active slot (mirrors applyCardPreset flow). */
  private addFullCardPreset(cardType: FullCardType): void {
    this.stopGifPreview();
    const data = defaultFullCardData(cardType);
    updateSlot(state.activeSlotIndex, {
      type:         'full-card',
      spriteKey:    `full-card/${cardType}`,
      spriteUrl:    'full-card:',
      fullCardData: data,
      gifFrames:    undefined,
      isAnimated:   true,
      scale:        1,
      customTint:   { color: '#ffffff', opacity: 0 },
      mutations:    [],
    });
    this.syncTextSlotUI(state.slots[state.activeSlotIndex]);
    this.scheduleFullCardRerender();
  }

  /** Debounce full-card re-renders (same pattern as text layer). */
  private scheduleFullCardRerender(): void {
    if (this.fullCardRenderDebounce !== null) clearTimeout(this.fullCardRenderDebounce);
    this.fullCardRenderDebounce = setTimeout(() => {
      this.fullCardRenderDebounce = null;
      this.rerenderFullCard().catch(err => console.error('[MG] Full card render failed:', err));
    }, 80);
  }

  /** Re-composite the card layers, overlay stats, and store result in gifFrames[0]. */
  private async rerenderFullCard(): Promise<void> {
    const slot = getActiveSlot();
    if (slot.type !== 'full-card' || !slot.fullCardData) return;

    const data = this.readFullCardDataFromUI(slot.fullCardData);
    const idx  = state.activeSlotIndex;
    // Update slot data silently (no undo push — visual refresh only)
    state.slots[idx].fullCardData = data;

    // Build layer URLs
    const version = this.getUiSpriteVersion();
    const v       = version ? `?v=${version}` : '';
    const apiBase = 'https://mg-api.ariedam.fr/assets/sprites/ui';
    const cardType = data.cardType;

    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width  : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    const layerResults = await Promise.allSettled([
      this.loadSpriteLayer(`${cardType}CardBottom`, `${apiBase}/${cardType}CardBottom.png${v}`),
      this.loadSpriteLayer(`${cardType}CardMiddle`, `${apiBase}/${cardType}CardMiddle.png${v}`),
    ]);

    // Layers drawn as-is — card PNG sprites are pre-colored per type, no JS tinting.
    const layers: LayerSrc[] = layerResults.flatMap((r) => {
      if (r.status !== 'fulfilled' || r.value === null) return [];
      return [r.value];
    });

    if (layers.length === 0) {
      console.error('[MG] Full card: failed to load any card layers');
      return;
    }

    const width  = Math.max(...layers.map(getW));
    const height = Math.max(...layers.map(getH));
    const canvas = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    for (const layer of layers) {
      ctx.drawImage(layer as CanvasImageSource, (width - getW(layer)) / 2, (height - getH(layer)) / 2);
    }

    // Draw stats overlay in-place
    await drawFullCardStats(canvas, data, slot.mutations);

    // Guard: bail if the user switched away while awaiting
    const currentSlot = state.slots[idx];
    if (currentSlot.type !== 'full-card') return;

    currentSlot.gifFrames  = [{ canvas, delay: 0 }];
    currentSlot.isAnimated = true;
    currentSlot.spriteUrl  = 'full-card:';
    bus.emit(Events.RENDER_REQUEST, null);
    this.refreshSlots();
  }

  // ── Categories & Sprites ──

  private populateCategories(): void {
    const items: DropdownItem[] = [];
    const sd = state.spriteData;

    if (sd) {
      for (const cat of sd.categories) {
        items.push({ id: cat.cat, label: cat.cat });
      }
      // Card preset categories — only shown when the ui atlas is available
      if (sd.categories.some(c => c.cat === 'ui')) {
        items.push({ id: 'cards',      label: 'Cards (preset)' });
        items.push({ id: 'full-cards', label: 'Full Cards (stats)' });
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

    // Blobling Rig: composite outfit builder + Blobling individual cosmetic categories
    if (state.cosmeticsData && state.cosmeticsData.categories.length > 0) {
      items.push({ id: 'blobling-rig', label: 'Blobling Rig' });
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

    // Card preset / Full Card categories — build layer URLs from ui atlas
    if (cat === 'cards' || cat === 'full-cards') {
      const version = this.getUiSpriteVersion();
      const v = version ? `?v=${version}` : '';
      const base = 'https://mg-api.ariedam.fr/assets/sprites/ui';
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
        if (cat === 'cards') {
          items.push({
            id: `cardpreset/${cardType.key}`,
            label: cardType.label,
            thumbUrl: bottomUrl,
            cardPresetUrls: [bottomUrl, middleUrl],
          });
        } else {
          // full-cards: same layer URLs for thumbnail, but fullCardType signals onSelect
          items.push({
            id: `full-card/${cardType.key}`,
            label: cardType.label,
            thumbUrl: bottomUrl,
            cardPresetUrls: [bottomUrl, middleUrl],
            fullCardType: cardType.key,
          });
        }
      }
    }

    // Blobling Rig
    if (cat === 'blobling-rig') {
      items.push({ id: 'blobling-new', label: '+ Add Blobling Layer' });
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

    // Pass restoreId so setItems selects silently rather than firing onSelect.
    // For full-cards: restore the active slot's card type if it's a full-card slot,
    // otherwise force a silent-select of the first item to avoid auto-triggering addFullCardPreset.
    // For blobling-rig: always pass the first item id to prevent auto-triggering addBloblingLayer.
    const slot = getActiveSlot();
    let restoreId: string | undefined;
    if (cat === 'full-cards') {
      restoreId = slot.type === 'full-card'
        ? `full-card/${slot.fullCardData?.cardType}`
        : (items[0]?.id ?? undefined);
    } else if (cat === 'blobling-rig') {
      restoreId = items[0]?.id ?? undefined; // 'blobling-new' — prevents auto-trigger
    } else {
      restoreId = slot.spriteKey || undefined;
    }
    this.spriteDropdown.setItems(items, restoreId);

    // Asynchronously generate composited thumbnails for card categories
    if (cat === 'cards' || cat === 'full-cards') this.generateCardListThumbnails(items);

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
        // Card presets store the composited canvas in gifFrames[0] — render it directly
        // instead of loading from spriteUrl (which is just the CardBottom layer URL).
        const gifCanvas = slot.gifFrames?.[0]?.canvas;
        if (gifCanvas instanceof HTMLCanvasElement && gifCanvas.width > 0) {
          const ctx = thumb.getContext('2d')!;
          const scale = Math.min(34 / gifCanvas.width, 34 / gifCanvas.height);
          ctx.drawImage(gifCanvas, (34 - gifCanvas.width * scale) / 2, (34 - gifCanvas.height * scale) / 2, gifCanvas.width * scale, gifCanvas.height * scale);
        } else if (slot.type !== 'full-card' && slot.type !== 'text' && slot.type !== 'cosmetic') {
          renderThumb(slot.spriteUrl, thumb);
        }
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

    if (state.slots.length < MAX_SLOTS) {
      const addBtn = el('button', { className: 'slot-btn slot-add-btn', title: 'Add layer' });
      addBtn.textContent = '+';
      addBtn.addEventListener('click', () => addSlot());
      this.slotContainer.append(addBtn);
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
    if (!slot.spriteUrl && slot.type !== 'text' && slot.type !== 'full-card') {
      this.metaEl.textContent = '';
      return;
    }
    const muts = slot.mutations.length > 0 ? slot.mutations.join(', ') : 'None';
    if (slot.type === 'text') {
      const td = slot.textData;
      this.metaEl.innerHTML = `<strong>Text Layer</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; Font: ${td?.fontLabel ?? '—'} &middot; ${td?.fontSize ?? 0}px`;
    } else if (slot.type === 'full-card') {
      const fcd = slot.fullCardData;
      this.metaEl.innerHTML = `<strong>Full Card</strong> &middot; ${fcd?.cardType ?? '?'} Card &middot; Slot ${state.activeSlotIndex + 1}`;
    } else if (slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:') {
      const layerCount = Object.keys(slot.cosmeticLayers ?? {}).length;
      const animLabel = slot.bloblingAnimId ? ` &middot; Animated` : '';
      this.metaEl.innerHTML = `<strong>Blobling Rig</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; ${layerCount} cosmetic${layerCount !== 1 ? 's' : ''}${animLabel}`;
    } else {
      const displayName = slot.spriteKey.split('/').pop() ?? slot.spriteKey;
      this.metaEl.innerHTML = `<strong>${displayName}</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; Mutations: ${muts} &middot; Scale: ${slot.scale}x`;
    }
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

          const scale = slot.type === 'text' ? 1 : slot.scale;
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
              const dx = (hb.cx - rendered.width / 2) * scale;
              const dy = (hb.cy - rendered.height / 2) * scale;
              const chw = (hb.hw + MARGIN) * scale;
              const chv = (hb.hv + MARGIN) * scale;
              if (Math.abs(localX - dx) > chw || Math.abs(localY - dy) > chv) continue;
            } else {
              // Tainted or fully transparent — fall back to full canvas bounds
              if (Math.abs(localX) > (rendered.width / 2) * scale) continue;
              if (Math.abs(localY) > (rendered.height / 2) * scale) continue;
            }

            // Stage 2: pixel-accurate alpha check
            const px = Math.round(localX / scale + rendered.width / 2);
            const py = Math.round(localY / scale + rendered.height / 2);
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
                const dx = (hb.cx - img.naturalWidth / 2) * scale;
                const dy = (hb.cy - img.naturalHeight / 2) * scale;
                const chw = (hb.hw + MARGIN) * scale;
                const chv = (hb.hv + MARGIN) * scale;
                if (Math.abs(localX - dx) <= chw && Math.abs(localY - dy) <= chv) return i;
              } else {
                const hw = (img.naturalWidth / 2) * scale;
                const hh = (img.naturalHeight / 2) * scale;
                if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) return i;
              }
            } else {
              if (Math.abs(localX) <= 128 * scale && Math.abs(localY) <= 128 * scale) return i;
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

    private getEffectiveScale(slot: Slot): number {
      return slot.type === 'text' ? 1 : slot.scale;
    }

    private computeCompositeBounds(
      sizeMap: Map<Slot, { w: number; h: number }>,
      fullSize: number,
      padding: number,
    ): { x: number; y: number; w: number; h: number } {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const [slot, size] of sizeMap.entries()) {
        const scale = this.getEffectiveScale(slot);
        const w = size.w * scale;
        const h = size.h * scale;
        const hw = w / 2;
        const hh = h / 2;
        const angle = (slot.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const cx = fullSize / 2 + slot.position.x;
        const cy = fullSize / 2 + slot.position.y;

        const corners = [
          { x: -hw, y: -hh },
          { x:  hw, y: -hh },
          { x:  hw, y:  hh },
          { x: -hw, y:  hh },
        ];

        for (const c of corners) {
          const rx = c.x * cos - c.y * sin;
          const ry = c.x * sin + c.y * cos;
          const px = cx + rx;
          const py = cy + ry;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      }

      if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
        return { x: 0, y: 0, w: fullSize, h: fullSize };
      }

      let x0 = Math.max(0, Math.floor(minX - padding));
      let y0 = Math.max(0, Math.floor(minY - padding));
      let x1 = Math.min(fullSize, Math.ceil(maxX + padding));
      let y1 = Math.min(fullSize, Math.ceil(maxY + padding));

      const w = Math.max(1, x1 - x0);
      const h = Math.max(1, y1 - y0);
      return { x: x0, y: y0, w, h };
    }

    private async downloadPNG(): Promise<void> {
      this.downloadProgress.textContent = 'Rendering...';
      const FULL = 1024;
      const SAFE_PAD = 24;
      const canvas = document.createElement('canvas');
      canvas.width = FULL;
      canvas.height = FULL;
      await renderAll(canvas);

      const sizeMap = new Map<Slot, { w: number; h: number }>();
      for (const slot of state.slots) {
        if (!slot.visible) continue;
        if (slot.type === 'text' || slot.type === 'full-card') {
          if (!slot.gifFrames || slot.gifFrames.length === 0) continue;
        } else if (!slot.spriteUrl) {
          continue;
        }
        const gifIdx = slot.isAnimated && slot.gifFrames ? (slot._gifFrameIdx ?? 0) : undefined;
        const rendered = await renderSlot(slot, gifIdx);
        if (rendered) sizeMap.set(slot, { w: rendered.width, h: rendered.height });
      }

      const bounds = this.computeCompositeBounds(sizeMap, FULL, SAFE_PAD);
      const out = document.createElement('canvas');
      out.width = bounds.w;
      out.height = bounds.h;
      out.getContext('2d')!.drawImage(
        canvas,
        bounds.x,
        bounds.y,
        bounds.w,
        bounds.h,
        0,
        0,
        bounds.w,
        bounds.h,
      );
      const link = document.createElement('a');
      link.download = `${getActiveSlot().spriteKey.split('/').pop() || 'sprite'}.png`;
      link.href = out.toDataURL('image/png');
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

      // Composite is built at full 1024×1024, then cropped to bounds with padding.
      // If the result is larger than EXPORT_MAX, it is scaled down preserving aspect.
      const FULL = 1024;
      const EXPORT_MAX = 512;
      const SAFE_PAD = 24;

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

      // Precompute bounds from slot sizes (use max frame size for animated slots)
      const sizeMap = new Map<Slot, { w: number; h: number }>();
      for (const slot of state.slots) {
        if (!slot.visible || !slot.spriteUrl) continue;
        if (slot.isAnimated && slot.gifFrames && slot.gifFrames.length > 0) {
          let maxW = 0;
          let maxH = 0;
          for (const f of slot.gifFrames) {
            if (f.canvas.width > maxW) maxW = f.canvas.width;
            if (f.canvas.height > maxH) maxH = f.canvas.height;
          }
          if (maxW > 0 && maxH > 0) sizeMap.set(slot, { w: maxW, h: maxH });
          continue;
        }
        const rendered = staticCanvases.get(slot);
        if (rendered) sizeMap.set(slot, { w: rendered.width, h: rendered.height });
      }

      const bounds = this.computeCompositeBounds(sizeMap, FULL, SAFE_PAD);
      const scaleDown = Math.min(1, EXPORT_MAX / Math.max(bounds.w, bounds.h));
      const outW = Math.max(1, Math.round(bounds.w * scaleDown));
      const outH = Math.max(1, Math.round(bounds.h * scaleDown));

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
            outCtx.scale(this.getEffectiveScale(slot), this.getEffectiveScale(slot));
            outCtx.drawImage(frameCanvas, -frameCanvas.width / 2, -frameCanvas.height / 2);
            outCtx.restore();
          } else {
            const rendered = staticCanvases.get(slot);
            if (!rendered) continue;
            outCtx.save();
            outCtx.translate(FULL / 2 + slot.position.x, FULL / 2 + slot.position.y);
            outCtx.rotate((slot.rotation * Math.PI) / 180);
            outCtx.scale(this.getEffectiveScale(slot), this.getEffectiveScale(slot));
            outCtx.drawImage(rendered, -rendered.width / 2, -rendered.height / 2);
            outCtx.restore();
          }
        }

        // Crop to bounds and scale down if needed.
        const cropped = document.createElement('canvas');
        cropped.width = bounds.w;
        cropped.height = bounds.h;
        cropped.getContext('2d')!.drawImage(
          outCanvas,
          bounds.x,
          bounds.y,
          bounds.w,
          bounds.h,
          0,
          0,
          bounds.w,
          bounds.h,
        );

        const frameOut = document.createElement('canvas');
        frameOut.width = outW;
        frameOut.height = outH;
        frameOut.getContext('2d')!.drawImage(cropped, 0, 0, outW, outH);
        renderedFrames.push({ canvas: frameOut, delay: primaryFrames[i].delay });
      }

    try {
      this.downloadProgress.textContent = 'Encoding GIF...';
      const blob = await encodeGif({
        frames: renderedFrames,
          width: outW,
          height: outH,
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
   * Asynchronously composite all card preset items and push the results into the
   * dropdown list thumbnails. Runs in parallel — atlas is fetched once and cached.
   */
  private async generateCardListThumbnails(items: DropdownItem[]): Promise<void> {
    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    await Promise.allSettled(
      items.filter(i => i.cardPresetUrls && i.cardPresetUrls.length > 0).map(async item => {
        const layerResults = await Promise.allSettled(
          item.cardPresetUrls!.map(url => {
            const name = url.split('/').pop()?.split('?')[0].replace('.png', '') ?? '';
            return this.loadSpriteLayer(name, url);
          }),
        );
        const layers = layerResults
          .filter((r): r is PromiseFulfilledResult<LayerSrc | null> => r.status === 'fulfilled')
          .map(r => r.value)
          .filter((v): v is LayerSrc => v !== null);
        if (layers.length === 0) return;

        const width  = Math.max(...layers.map(getW));
        const height = Math.max(...layers.map(getH));
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        for (const layer of layers) {
          ctx.drawImage(layer as CanvasImageSource, (width - getW(layer)) / 2, (height - getH(layer)) / 2);
        }
        this.spriteDropdown.setItemThumbCanvas(item.id, canvas);
      }),
    );
  }

  /**
   * Load a sprite layer for card compositing.
   * Primary path: mg-api PNG (fast, cached).
   * Fallback: if mg-api returns a non-OK response (e.g. 403 for CardMiddle sprites),
   * locate the SpriteFrame entry in sprite-data and extract the region directly from
   * the source atlas on the game CDN. The proxy handles magicgarden.gg CORS.
   */
  private async loadSpriteLayer(
    layerName: string,
    mgApiUrl: string,
  ): Promise<HTMLImageElement | HTMLCanvasElement | null> {
    // Primary: mg-api PNG
    try {
      return await spriteLoader.load(mgApiUrl);
    } catch {
      // Fall through to atlas extraction
    }

    // Fallback: find the SpriteFrame and slice it from the source atlas
    const sd = state.spriteData;
    if (!sd) return null;

    let frameEntry: SpriteFrame | null = null;
    outer: for (const cat of sd.categories) {
      for (const item of cat.items) {
        if (item.type === 'frame' && (item.id.split('/').pop() ?? '') === layerName) {
          frameEntry = item as SpriteFrame;
          break outer;
        }
      }
    }
    if (!frameEntry) return null;

    try {
      const atlasImg = await spriteLoader.load(frameEntry.url);
      const { x, y, w, h } = frameEntry.frame;
      const out = document.createElement('canvas');
      out.width  = w;
      out.height = h;
      const ctx = out.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(atlasImg, x, y, w, h, 0, 0, w, h);
      return out;
    } catch {
      return null;
    }
  }

  /**
   * Composite all card layers (Bottom → Middle → Top) into a single canvas and load
   * it into the active slot without any blob-URL or re-fetch roundtrip.
   *
   * Each layer is attempted via mg-api first; on 403 it falls back to direct atlas
   * extraction (loadSpriteLayer). The composited canvas is stored as gifFrames[0] —
   * the same in-memory path used for uploaded GIFs.
   */
  private async applyCardPreset(urls: string[], label: string): Promise<void> {
    this.stopGifPreview();

    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const layerResults = await Promise.allSettled(
      urls.map(url => {
        const layerName = url.split('/').pop()?.split('?')[0].replace('.png', '') ?? '';
        return this.loadSpriteLayer(layerName, url);
      }),
    );

    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    const layers: LayerSrc[] = layerResults
      .filter((r): r is PromiseFulfilledResult<LayerSrc | null> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter((v): v is LayerSrc => v !== null);

    if (layers.length === 0) {
      console.error('[MG] Failed to load any card preset layers');
      return;
    }

    try {
      const width  = Math.max(...layers.map(getW));
      const height = Math.max(...layers.map(getH));
      const canvas = document.createElement('canvas');
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2d context');
      for (const layer of layers) {
        const lw = getW(layer);
        const lh = getH(layer);
        ctx.drawImage(layer as CanvasImageSource, (width - lw) / 2, (height - lh) / 2);
      }

      updateSlot(state.activeSlotIndex, {
        type: 'custom',
        spriteKey: label,
        spriteUrl: urls[0],              // CardBottom URL — slot thumbnail falls back to this
        gifFrames: [{ canvas, delay: 0 }],
        isAnimated: true,
      });

      // Update dropdown trigger thumbnail to show the composited card
      this.spriteDropdown.setTriggerCanvas(canvas);
    } catch (err) {
      console.error('[MG] Failed to composite card preset:', err);
    }
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

  /**
   * After a scene load, text and full-card slots have no gifFrames (stripped on
   * save). Re-render each one so they display immediately.
   */
  private async rerenderAllSpecialSlots(): Promise<void> {
    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width  : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    const version = this.getUiSpriteVersion();
    const v       = version ? `?v=${version}` : '';
    const apiBase = 'https://mg-api.ariedam.fr/assets/sprites/ui';

    const tasks = state.slots.map((slot, idx) => {
      if (slot.type === 'text' && slot.textData) {
        return renderTextToCanvas(slot.textData, slot.customTint.color).then(canvas => {
          const s = state.slots[idx];
          if (s.type !== 'text') return;
          s.gifFrames  = [{ canvas, delay: 0 }];
          s.isAnimated = true;
        });
      }

      if (slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:') {
        return this.rerenderBlobling(idx);
      }

      if (slot.type === 'full-card' && slot.fullCardData) {
        const data      = slot.fullCardData;
        const cardType  = data.cardType;
        return (async () => {
          const layerResults = await Promise.allSettled([
            this.loadSpriteLayer(`${cardType}CardBottom`, `${apiBase}/${cardType}CardBottom.png${v}`),
            this.loadSpriteLayer(`${cardType}CardMiddle`, `${apiBase}/${cardType}CardMiddle.png${v}`),
          ]);
          const layers: LayerSrc[] = layerResults.flatMap(r =>
            r.status === 'fulfilled' && r.value ? [r.value] : [],
          );
          if (layers.length === 0) return;

          const width  = Math.max(...layers.map(getW));
          const height = Math.max(...layers.map(getH));
          const canvas = document.createElement('canvas');
          canvas.width  = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          for (const layer of layers) {
            ctx.drawImage(layer as CanvasImageSource, (width - getW(layer)) / 2, (height - getH(layer)) / 2);
          }
          await drawFullCardStats(canvas, data, slot.mutations);

          const s = state.slots[idx];
          if (s.type !== 'full-card') return;
          s.gifFrames  = [{ canvas, delay: 0 }];
          s.isAnimated = true;
        })();
      }

      return Promise.resolve();
    });

    await Promise.allSettled(tasks);
    bus.emit(Events.RENDER_REQUEST, null);
    this.refreshSlots();
  }

  /** Capture a small square JPEG of the current preview canvas for scene thumbnails. */
  private captureSceneThumbnail(size = 64): string | undefined {
    try {
      const src = this.previewCanvas;
      if (!src || src.width === 0 || src.height === 0) return undefined;
      const thumb = document.createElement('canvas');
      thumb.width = size;
      thumb.height = size;
      thumb.getContext('2d')!.drawImage(src, 0, 0, size, size);
      return thumb.toDataURL('image/jpeg', 0.8);
    } catch {
      return undefined;
    }
  }

  // ── Scenes section ──────────────────────────────────────────────────────────

  private buildScenesSection(): HTMLElement {
    this.sceneNameInput = el('input', {
      type: 'text',
      className: 'scene-name-input',
      placeholder: 'Scene name\u2026',
    }) as HTMLInputElement;

    const saveBtn = el('button', { className: 'secondary', textContent: 'Save' }) as HTMLButtonElement;
    saveBtn.addEventListener('click', () => {
      const name = this.sceneNameInput.value.trim();
      saveBtn.disabled = true;
      const thumbnail = this.captureSceneThumbnail();
      saveNamedScene(name || 'Untitled', thumbnail)
        .then(() => { this.sceneNameInput.value = ''; this.refreshScenesList(); })
        .catch(err => console.error('[MG] Save scene failed:', err))
        .finally(() => { saveBtn.disabled = false; });
    });

    this.scenesListEl = el('div', { className: 'scenes-list' });

    const importFileInput = el('input', { type: 'file', accept: '.json' }) as HTMLInputElement;
    importFileInput.style.display = 'none';
    const importBtn = el('button', { className: 'secondary', textContent: 'Import JSON' }) as HTMLButtonElement;
    importBtn.addEventListener('click', () => importFileInput.click());
    importFileInput.addEventListener('change', () => {
      const file = importFileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const scene = importSceneJson(reader.result as string);
        if (!scene) {
          alert('Invalid scene file');
          return;
        }
        pushUndo();
        state.slots = scene.slots;
        state.activeSlotIndex = Math.min(scene.activeSlotIndex, state.slots.length - 1);
        bus.emit(Events.SLOT_CHANGED, null);
        bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
        bus.emit(Events.RENDER_REQUEST, null);
        this.rerenderAllSpecialSlots().catch(err => console.error('[MG] Scene re-render failed:', err));
      };
      reader.readAsText(file);
      importFileInput.value = '';
    });

    const section = el('div', { className: 'scenes-section' }, [
      el('h3', { className: 'scenes-heading', textContent: 'Scenes' }),
      el('div', { className: 'scenes-save-row' }, [this.sceneNameInput, saveBtn]),
      this.scenesListEl,
      el('div', { className: 'scenes-import-row' }, [importBtn, importFileInput]),
    ]);

    this.refreshScenesList();
    return section;
  }

  private refreshScenesList(): void {
    this.scenesListEl.innerHTML = '';
    const scenes = listSavedScenes();
    if (scenes.length === 0) {
      const empty = el('div', { style: 'font-size:12px;color:var(--muted);padding:4px 2px' });
      empty.textContent = 'No saved scenes yet.';
      this.scenesListEl.append(empty);
      return;
    }

    scenes.forEach((scene, index) => {
      const date = new Date(scene.savedAt);
      const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

      const loadBtn = el('button', { className: 'btn-sm', textContent: 'Load' }) as HTMLButtonElement;
      loadBtn.addEventListener('click', () => {
        pushUndo();
        state.slots = scene.slots;
        state.activeSlotIndex = Math.min(scene.activeSlotIndex, state.slots.length - 1);
        bus.emit(Events.SLOT_CHANGED, null);
        bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
        bus.emit(Events.RENDER_REQUEST, null);
        this.rerenderAllSpecialSlots().catch(err => console.error('[MG] Scene re-render failed:', err));
      });

      const exportBtn = el('button', { className: 'btn-sm', textContent: 'Export' }) as HTMLButtonElement;
      exportBtn.addEventListener('click', () => {
        const json = exportSceneJson(index);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${scene.name.replace(/[^a-z0-9_-]/gi, '_')}.mgscene.json`;
        a.click();
        URL.revokeObjectURL(url);
      });

      const deleteBtn = el('button', { className: 'btn-sm danger-sm', textContent: '\u00d7' }) as HTMLButtonElement;
      deleteBtn.addEventListener('click', () => {
        deleteNamedScene(index);
        this.refreshScenesList();
      });

      const thumbEl = el('div', { className: 'scene-item-thumb' });
      if (scene.thumbnail) {
        const img = el('img') as HTMLImageElement;
        img.src = scene.thumbnail;
        img.alt = '';
        thumbEl.append(img);
      }

      const item = el('div', { className: 'scene-item' }, [
        thumbEl,
        el('div', { className: 'scene-item-info' }, [
          el('span', { className: 'scene-item-name', textContent: scene.name }),
          el('span', { className: 'scene-item-date', textContent: dateStr }),
        ]),
        el('div', { className: 'scene-item-actions' }, [loadBtn, exportBtn, deleteBtn]),
      ]);
      this.scenesListEl.append(item);
    });
  }

  // ── End scenes section ───────────────────────────────────────────────────────

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
