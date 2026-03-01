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
import { drawFullCardStats, abilityColor, defaultFullCardData } from './full-card-renderer';
import { MG_FONTS, SYSTEM_FONTS, GOOGLE_FONTS_CURATED, UNICODE_STYLES, ensureFontLoaded } from './font-data';
import { getRiveFileUrl, getBloblingAnimations, renderBloblingFrames, BLOBLING_ANIMATIONS, getExpressionIndex } from './blobling-rive';
import { buildToolbar } from './toolbar';
import { buildAssetBrowser, populateBrowserTabs, populateBrowserGrid } from './panels/asset-browser';
import { Drawer } from './drawers/drawer';
import { BLOBLING_LAYER_ORDER } from './drawers/blobling-drawer';
import type { BloblingLayerKey } from './drawers/blobling-drawer';
import { MUTATION_CHIP_COLORS } from './drawers/card-drawer';

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
  const tmpCtx = tmp.getContext('2d', { willReadFrequently: true })!;
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

// MUTATION_CHIP_COLORS imported from './drawers/card-drawer'


// (card-tinting functions removed — card PNG sprites are pre-colored per type)

export class App {
  private categoryDropdown!: CustomDropdown;
  private spriteDropdown!: CustomDropdown;
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
  private selectedSlotIndexes = new Set<number>();
  private groupDragIndexes: number[] = [];
  private groupDragStartPos = new Map<number, { x: number; y: number }>();
  private frameScheduler = new FrameScheduler();
  // ── New layout refs ──
  private drawer!: Drawer;
  private mainEl!: HTMLElement;
  private cardTypePickerEl!: HTMLElement;
  private cardPickerCanvases = new Map<string, HTMLCanvasElement>();
  private cardPickerMode: 'layers' | 'full' = 'layers';
  private inspectorEl!: HTMLElement;
  private browserTabsEl!: HTMLElement;
  private browserGridEl!: HTMLElement;
  private browserSearchInput!: HTMLInputElement;
  private browserCleanup: (() => void) | null = null;
  private optionsDiv!: HTMLElement;
  private tintLabel!: HTMLElement;
  private browserItems: DropdownItem[] = [];
  private readonly VISUAL_SCALE_MIN = 0.05;
  private readonly VISUAL_SCALE_MAX = 8;
  private readonly VISUAL_SCALE_STEP = 0.01;
  private readonly TEXT_SIZE_MIN = 6;
  private readonly TEXT_SIZE_MAX = 300;
  private readonly TEXT_SIZE_STEP = 1;
  private readonly ROTATION_STEP = 1;
  private readonly SNAP_GRID_SIZE = 16;
  private readonly NORMALIZE_RATIO_TOLERANCE_LOG = 0.12;
  private snapEnabled = false;
  private readonly LAYOUT_STORAGE_KEY = 'sc2:layout:v1';
  private readonly LAYERS_MIN_W = 220;
  private readonly LAYERS_MAX_W = 520;
  private readonly ASSETS_MIN_W = 220;
  private readonly ASSETS_MAX_W = 560;
  private readonly TOOLBAR_MIN_H = 44;
  private readonly TOOLBAR_MAX_H = 140;
  private readonly RENDER_SIZE_PRESETS = [1024, 1536, 2048, 3072, 4096] as const;
  private readonly WEATHER_STRIP_FRAME_WIDTH = 256;
  private readonly DEFAULT_ANIM_FRAME_DELAY = 100;
  private toolbarHeight = 52;
  private layersWidth = 280;
  private assetsWidth = 260;
  private renderSize = 1024;
  private appRootEl: HTMLElement | null = null;
  private mobileModeQuery: MediaQueryList | null = null;
  private mobileModeChangeHandler: ((e: MediaQueryListEvent) => void) | null = null;

  // ── Text layer UI ──
  private textControls!: HTMLElement;     // text-layer-specific section (shown in drawer)
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
  private textRenderDebounce: ReturnType<typeof setTimeout> | null = null;
  private textRenderQueue = new Set<number>();

  // ── Scenes UI ──
  private scenesListEl!: HTMLElement;

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

  // ── Copy / paste clipboard ──
  private copiedSlot: Partial<Slot> | null = null;

  constructor(container: HTMLElement) {
    initTheme();
    this.loadLayoutSettings();
    container.innerHTML = '';
    this.buildUI(container);
    this.bindEvents();
    this.refreshSlots();
    this.render();
  }

  private buildUI(container: HTMLElement): void {
    // ── Toolbar ──
    const tb = buildToolbar();
    this.downloadBtn = tb.downloadBtn;

    tb.themeBtn.textContent = state.theme === 'dark' ? '☀' : '🌙';
    tb.themeBtn.addEventListener('click', () => {
      toggleTheme();
      tb.themeBtn.textContent = state.theme === 'dark' ? '☀' : '🌙';
    });
    tb.undoBtn.addEventListener('click', () => undo());
    tb.redoBtn.addEventListener('click', () => redo());
    tb.downloadBtn.addEventListener('click', () => this.download());
    tb.clearSlotBtn.addEventListener('click', () => clearSlot(state.activeSlotIndex));
    tb.resetAllBtn.addEventListener('click', () => {
      if (confirm('Reset all slots?')) {
        for (let i = 0; i < state.slots.length; i++) clearSlot(i);
      }
    });
    tb.addTextBtn.addEventListener('click', () => this.addTextLayer());
    tb.addCardBtn.addEventListener('click', () => this.showCardTypePicker('layers'));
    tb.addFullCardBtn.addEventListener('click', () => this.showCardTypePicker('full'));
    tb.addBloblingBtn.addEventListener('click', () => this.addBloblingLayer());

    tb.uploadInput.addEventListener('change', async () => {
      const file = tb.uploadInput.files?.[0];
      if (!file) return;
      const name = file.name.replace(/\.[^.]+$/, '');
      if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) {
        const buffer = await file.arrayBuffer();
        const decoded = decodeGif(buffer);
        const firstFrameBlob = await new Promise<Blob>((resolve) =>
          decoded.frames[0].canvas.toBlob((b) => resolve(b!), 'image/png'),
        );
        const url = URL.createObjectURL(firstFrameBlob);
        updateSlot(state.activeSlotIndex, { type: 'custom', spriteKey: name, spriteUrl: url, gifFrames: decoded.frames, isAnimated: true });
        this.startGifPreview();
      } else {
        const url = URL.createObjectURL(file);
        updateSlot(state.activeSlotIndex, { type: 'custom', spriteKey: name, spriteUrl: url, gifFrames: undefined, isAnimated: false });
        this.stopGifPreview();
      }
      tb.uploadInput.value = '';
    });

    tb.sceneSaveBtn.addEventListener('click', () => {
      const name = tb.sceneNameInput.value.trim();
      tb.sceneSaveBtn.disabled = true;
      const thumbnail = this.captureSceneThumbnail();
      saveNamedScene(name || 'Untitled', thumbnail)
        .then(() => { tb.sceneNameInput.value = ''; this.refreshScenesList(); })
        .catch(err => console.error('[MG] Save scene failed:', err))
        .finally(() => { tb.sceneSaveBtn.disabled = false; });
    });

    tb.sceneLoadInput.addEventListener('change', () => {
      const file = tb.sceneLoadInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const scene = importSceneJson(reader.result as string);
        if (!scene) { alert('Invalid scene file'); return; }
        pushUndo();
        this.clearMultiSelection();
        state.slots = scene.slots;
        state.activeSlotIndex = Math.min(scene.activeSlotIndex, state.slots.length - 1);
        bus.emit(Events.SLOT_CHANGED, null);
        bus.emit(Events.SLOT_SELECTED, state.activeSlotIndex);
        bus.emit(Events.RENDER_REQUEST, null);
        this.rerenderAllSpecialSlots().catch(err => console.error('[MG] Scene re-render failed:', err));
      };
      reader.readAsText(file);
      tb.sceneLoadInput.value = '';
    });

    // ── Category + Sprite dropdowns (hidden singletons — browser grid renders from their data) ──
    this.categoryDropdown = new CustomDropdown({
      showThumbs: false,
      placeholder: 'Select category\u2026',
      onSelect: (item: DropdownItem) => {
        state.selectedCategory = item.id;
        this.browserSearchInput.value = '';
        this.populateSprites(false);
      },
    });

    this.spriteDropdown = new CustomDropdown({
      showThumbs: true,
      placeholder: 'Select sprite\u2026',
      onThumbVisible: (url) => spriteLoader.preloadUrls([url]),
      onSelect: (item: DropdownItem) => this.applySpriteItem(item),
    });

    // ── Drawer content: text / full-card / blobling ──
    this.textControls = el('div', { className: 'text-controls-section' });
    this.buildTextControls();
    this.fullCardControls = this.buildFullCardControls();
    this.bloblingControls = this.buildBloblingControls();

    // ── Inspector control elements (created once, reparented by syncInspector) ──
    this.mutationList = el('div', { className: 'mutation-chips' });
    this.tintLabel = el('label', { textContent: 'Custom Tint' }) as HTMLElement;
    this.customColor = el('input', { type: 'color', id: 'customColor', value: '#ffffff' }) as HTMLInputElement;
    this.customOpacity = el('input', { type: 'range', id: 'customOpacity', min: '0', max: '1', step: '0.05', value: '0' }) as HTMLInputElement;
    this.customTintControls = el('div', { id: 'customTintControls' }, [
      el('div', {}, [el('label', { textContent: 'Color' }), this.customColor]),
      el('div', {}, [el('label', { textContent: 'Opacity' }), this.customOpacity]),
    ]);

    const optIcons = el('input', { type: 'checkbox', id: 'optIcons' }) as HTMLInputElement;
    optIcons.checked = true;
    const optOverlays = el('input', { type: 'checkbox', id: 'optOverlays' }) as HTMLInputElement;
    optOverlays.checked = true;
    this.optionsDiv = el('div', { className: 'toggles' }, [
      this.makeCheckLabel('Icons', optIcons),
      this.makeCheckLabel('Tall overlays', optOverlays),
    ]);
    const applySharedOptions = (): void => {
      beginBatchUpdate();
      const next = { icons: optIcons.checked, overlays: optOverlays.checked };
      this.applyToSelection((slot) => {
        slot.options = { ...next };
      });
      bus.emit(Events.SLOT_CHANGED, null);
      bus.emit(Events.RENDER_REQUEST, null);
    };
    optIcons.addEventListener('change', applySharedOptions);
    optOverlays.addEventListener('change', applySharedOptions);

    this.scaleLabel = el('label', { textContent: 'Scale' });
    this.scaleInput = el('input', {
      id: 'scale',
      type: 'range',
      min: String(this.VISUAL_SCALE_MIN),
      max: String(this.VISUAL_SCALE_MAX),
      step: String(this.VISUAL_SCALE_STEP),
      value: '1',
    }) as HTMLInputElement;
    this.rotationInput = el('input', {
      id: 'rotation',
      type: 'range',
      min: '0',
      max: '360',
      step: String(this.ROTATION_STEP),
      value: '0',
    }) as HTMLInputElement;

    this.timelinePlayBtn = el('button', { className: 'btn-sm', textContent: 'Play' });
    this.timelineScrubber = el('input', { type: 'range', min: '0', max: '0', value: '0', className: 'timeline-scrubber' }) as HTMLInputElement;
    this.timelineLabel = el('span', { className: 'frame-label', textContent: '0/0' });
    this.timelineBar = el('div', { className: 'timeline-bar' }, [this.timelinePlayBtn, this.timelineScrubber, this.timelineLabel]);
    this.timelineBar.style.display = 'none';
    this.downloadProgress = el('div', { className: 'download-progress' });

    this.timelinePlayBtn.addEventListener('click', () => this.toggleGifPlay());
    this.timelineScrubber.addEventListener('input', () => { this.frameScheduler.seek(parseInt(this.timelineScrubber.value)); });

    this.scaleInput.addEventListener('input', () => {
      const parsed = parseFloat(this.scaleInput.value);
      const textIndexes: number[] = [];
      let hasSpriteLikeChange = false;
      this.applyToSelection((slot, index) => {
        if (slot.type === 'text') {
          const current = slot.textData?.fontSize ?? 36;
          const fontSize = this.clampTextSize(Number.isFinite(parsed) ? parsed : current);
          if (slot.textData) {
            slot.textData = { ...slot.textData, fontSize };
            textIndexes.push(index);
          }
        } else {
          slot.scale = this.clampScale(Number.isFinite(parsed) ? parsed : slot.scale);
          hasSpriteLikeChange = true;
        }
      });
      if (textIndexes.length > 0) this.scheduleTextRerender(textIndexes);
      if (hasSpriteLikeChange) bus.emit(Events.RENDER_REQUEST, null);
    });
    this.scaleInput.addEventListener('change', () => {
      const parsed = parseFloat(this.scaleInput.value);
      const textIndexes: number[] = [];
      beginBatchUpdate();
      this.applyToSelection((slot, index) => {
        if (slot.type === 'text') {
          const current = slot.textData?.fontSize ?? 36;
          const fontSize = this.clampTextSize(Number.isFinite(parsed) ? parsed : current);
          if (slot.textData) {
            slot.textData = { ...slot.textData, fontSize };
            textIndexes.push(index);
          }
          return;
        }
        const scale = this.clampScale(Number.isFinite(parsed) ? parsed : slot.scale);
        slot.scale = scale;
      });
      bus.emit(Events.SLOT_CHANGED, null);
      bus.emit(Events.RENDER_REQUEST, null);
      if (textIndexes.length > 0) this.scheduleTextRerender(textIndexes);
    });
    this.rotationInput.addEventListener('input', () => {
      const parsed = parseFloat(this.rotationInput.value);
      this.applyToSelection((slot) => {
        slot.rotation = this.normalizeRotation(Number.isFinite(parsed) ? parsed : slot.rotation);
      });
      bus.emit(Events.RENDER_REQUEST, null);
    });
    this.rotationInput.addEventListener('change', () => {
      const parsed = parseFloat(this.rotationInput.value);
      beginBatchUpdate();
      this.applyToSelection((slot) => {
        slot.rotation = this.normalizeRotation(Number.isFinite(parsed) ? parsed : slot.rotation);
      });
      bus.emit(Events.SLOT_CHANGED, null);
      bus.emit(Events.RENDER_REQUEST, null);
    });

    const previewTint = () => {
      const opacity = parseFloat(this.customOpacity.value);
      const textIndexes: number[] = [];
      let hasSpriteLikeChange = false;
      this.applyToSelection((slot, index) => {
        slot.customTint = { color: this.customColor.value, opacity };
        if (slot.type === 'text') textIndexes.push(index);
        else hasSpriteLikeChange = true;
      });
      if (textIndexes.length > 0) this.scheduleTextRerender(textIndexes);
      if (hasSpriteLikeChange) bus.emit(Events.RENDER_REQUEST, null);
    };
    const commitTint = () => {
      const opacity = parseFloat(this.customOpacity.value);
      const textIndexes: number[] = [];
      beginBatchUpdate();
      this.applyToSelection((slot, index) => {
        slot.customTint = { color: this.customColor.value, opacity };
        if (slot.type === 'text') textIndexes.push(index);
      });
      bus.emit(Events.SLOT_CHANGED, null);
      bus.emit(Events.RENDER_REQUEST, null);
      if (textIndexes.length > 0) this.scheduleTextRerender(textIndexes);
    };
    this.customColor.addEventListener('input', previewTint);
    this.customColor.addEventListener('change', commitTint);
    this.customOpacity.addEventListener('input', commitTint);

    bus.on(Events.SLOT_SELECTED, () => {
      const slot = getActiveSlot();
      optIcons.checked = slot.options.icons;
      optOverlays.checked = slot.options.overlays;
      this.rotationInput.value = String(slot.rotation);
      this.customColor.value = slot.customTint.color;
      this.customOpacity.value = String(slot.customTint.opacity);
      this.syncTextSlotUI(slot);
      if (slot.isAnimated && slot.gifFrames) { this.startGifPreview(); } else { this.stopGifPreview(); }
    });

    // ── Layout ──
    this.applyLayoutCssVars();
    this.slotContainer = el('div', { className: 'slot-grid' });
    this.inspectorEl   = el('div', { className: 'inspector' });
    this.scenesListEl  = el('div', { className: 'scenes-list' });
    const scenesPanel = el('div', { className: 'scenes-section' }, [
      el('h3', { className: 'scenes-heading', textContent: 'Scenes' }),
      this.scenesListEl,
    ]);
    this.refreshScenesList();

    const layersCol = el('div', { className: 'sc2-col-layers' }, [
      el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Layers' }),
        this.slotContainer,
      ]),
      this.inspectorEl,
      scenesPanel,
    ]);

    // Browser column
    const { el: browserEl, tabsEl, searchInput: bsInput, gridEl } = buildAssetBrowser();
    this.browserTabsEl     = tabsEl;
    this.browserGridEl     = gridEl;
    this.browserSearchInput = bsInput;
    bsInput.addEventListener('input', () => this.updateBrowserGrid(bsInput.value));

    // Canvas column
    this.previewCanvas = document.createElement('canvas');
    this.previewCanvas.id     = 'previewCanvas';
    this.previewCanvas.width  = this.renderSize;
    this.previewCanvas.height = this.renderSize;
    const renderSizeSelect = el('select', {
      className: 'preview-size-select',
      title: 'Internal render size',
    }) as HTMLSelectElement;
    for (const size of this.RENDER_SIZE_PRESETS) {
      renderSizeSelect.append(el('option', { value: String(size), textContent: `${size}px` }));
    }
    renderSizeSelect.value = String(this.renderSize);
    renderSizeSelect.addEventListener('change', () => {
      const next = parseInt(renderSizeSelect.value, 10);
      this.applyRenderSize(next);
      renderSizeSelect.value = String(this.renderSize);
    });
    const previewStage = el('div', { className: 'preview-stage' }, [
      el('div', { className: 'preview-controls' }, [renderSizeSelect]),
      this.previewCanvas,
    ]);
    this.metaEl = el('div', { className: 'meta', id: 'meta' });
    const canvasCol = el('div', { className: 'sc2-col-canvas' }, [previewStage, this.metaEl]);

    // Card type picker overlay (hidden until Add Card is clicked)
    this.buildCardTypePicker();

    // Drawer
    this.drawer  = new Drawer();
    this.mainEl  = el('div', { className: 'sc2-main' });
    this.drawer.attachMain(this.mainEl);
    const layersSplitter = el('div', { className: 'sc2-col-splitter sc2-col-splitter--layers', title: 'Resize layers panel' }) as HTMLDivElement;
    const browserSplitter = el('div', { className: 'sc2-col-splitter sc2-col-splitter--browser', title: 'Resize assets panel' }) as HTMLDivElement;
    this.setupColumnResize(layersSplitter, 'layers', this.LAYERS_MIN_W, this.LAYERS_MAX_W);
    this.setupColumnResize(browserSplitter, 'assets', this.ASSETS_MIN_W, this.ASSETS_MAX_W, browserEl);
    this.mainEl.append(layersCol, layersSplitter, browserEl, browserSplitter, canvasCol, this.drawer.el);

    const toolbarResize = el('div', { className: 'sc2-toolbar-resize', title: 'Resize toolbar' }) as HTMLDivElement;
    this.setupToolbarResize(toolbarResize);

    const appEl = el('div', { className: 'sc2-app' }, [tb.el, toolbarResize, this.mainEl]);
    this.appRootEl = appEl;
    container.append(appEl);
    this.setupMobileModeGate();
  }

  private bindEvents(): void {
    // Render on changes
    bus.on(Events.SLOT_CHANGED, () => {
      this.sanitizeSelection();
      this.refreshSlots();
      this.updateMeta();
      this.syncDownloadBtn();
      this.render();
      const slot = getActiveSlot();
      this.syncTextSlotUI(slot);
      this.syncInspector(slot);
    });
    bus.on(Events.SLOT_SELECTED, () => {
      this.sanitizeSelection();
      this.refreshSlots();
      this.refreshMutations();
      this.updateMeta();
      this.syncDownloadBtn();
      const slot = getActiveSlot();
      if (slot.type !== 'text' && slot.type !== 'full-card' && slot.type !== 'cosmetic') this.spriteDropdown.selectById(slot.spriteKey);
      this.syncTextSlotUI(slot);
      this.syncInspector(slot);
    });
    bus.on(Events.RENDER_REQUEST, () => this.render());
    bus.on(Events.DATA_LOADED, () => {
      this.populateCategories();
      this.refreshMutations();
      const slot = getActiveSlot();
      if (slot.type === 'full-card') this.syncFullCardUI(slot);
      this.rerenderAllSpecialSlots().catch(err => console.error('[MG] Restore re-render failed:', err));
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      // Never fire when typing in an input / textarea / contenteditable
      const active = document.activeElement;
      const inInput = active instanceof HTMLInputElement
        || active instanceof HTMLTextAreaElement
        || (active instanceof HTMLElement && active.isContentEditable);

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') { e.preventDefault(); undo(); }
        if (e.key === 'y') { e.preventDefault(); redo(); }
        if (!inInput) {
          if (e.key === 'c') { e.preventDefault(); this.copyActiveSlot(); }
          if (e.key === 'v') { e.preventDefault(); this.pasteCopiedSlot(); }
          if (e.key === 'd') { e.preventDefault(); this.duplicateActiveSlot(); }
        }
      }

      // Delete active slot — only when no text input is focused
      if (!inInput && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        clearSlot(state.activeSlotIndex);
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
      onSelect: (item) => this.onFontGroupSelect(item.id, false),
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

    // Initialise font list for MG group (default) without mutating restored text slots.
    this.onFontGroupSelect('mg', true);
  }

  /** Called when the font group dropdown changes. Repopulates the font item dropdown. */
  private onFontGroupSelect(groupId: string, suppressApply = false): void {
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

    this.fontItemDropdown.setItems(
      items,
      undefined,
      { suppressAutoSelectOnMissingRestore: suppressApply },
    );
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

  /** Open the appropriate drawer for the active slot type, and sync content from slot state. */
  private syncTextSlotUI(slot: Slot): void {
    const isText     = slot.type === 'text';
    const isFullCard = slot.type === 'full-card';
    const isCosmetic = slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:';

    // Open/close drawer
    if (isText) {
      this.drawer.open('Text Editor', this.textControls);
    } else if (isFullCard) {
      this.drawer.open('Card Editor', this.fullCardControls);
    } else if (isCosmetic) {
      this.drawer.open('Blobling Rig', this.bloblingControls);
    } else {
      // Close drawer only if it was showing a special-slot panel
      const cur = this.drawer.currentContent();
      if (cur === this.textControls || cur === this.fullCardControls || cur === this.bloblingControls) {
        this.drawer.close();
      }
    }

    if (isCosmetic) {
      this.syncBloblingUI(slot);
    } else if (isText) {
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
        // Sync font group + item dropdowns from saved textData (silent restore).
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
    } else if (isFullCard) {
      this.syncFullCardUI(slot);
    }
  }

  /** Rebuild the inspector panel based on the active slot type. */
  private syncInspector(slot: Slot): void {
    const isText     = slot.type === 'text';
    const isFullCard = slot.type === 'full-card';
    const isCosmetic = slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:';
    const isSprite   = !isText && !isFullCard && !isCosmetic;

    this.inspectorEl.innerHTML = '';

    // Scale + rotation section (always present)
    if (isText) {
      this.scaleLabel.textContent = 'Font Size';
      this.scaleInput.min = String(this.TEXT_SIZE_MIN);
      this.scaleInput.max = String(this.TEXT_SIZE_MAX);
      this.scaleInput.step = String(this.TEXT_SIZE_STEP);
      this.scaleInput.value = String(this.clampTextSize(slot.textData?.fontSize ?? 36));
    } else {
      this.scaleLabel.textContent = 'Scale';
      this.scaleInput.min = String(this.VISUAL_SCALE_MIN);
      this.scaleInput.max = String(this.VISUAL_SCALE_MAX);
      this.scaleInput.step = String(this.VISUAL_SCALE_STEP);
      this.scaleInput.value = this.clampScale(slot.scale).toFixed(3);
    }
    this.rotationInput.step = String(this.ROTATION_STEP);
    this.rotationInput.value = String(this.normalizeRotation(slot.rotation));

    const transformChildren: Node[] = [
      this.scaleLabel, this.scaleInput,
      el('span', { className: 'inspector-section-title', textContent: 'Rotation' }),
      this.rotationInput,
    ];
    const snapToggle = el('input', { type: 'checkbox' }) as HTMLInputElement;
    snapToggle.checked = this.snapEnabled;
    snapToggle.addEventListener('change', () => {
      this.snapEnabled = snapToggle.checked;
      this.syncInspector(getActiveSlot());
      bus.emit(Events.RENDER_REQUEST, null);
    });
    transformChildren.push(this.makeCheckLabel('Snap to grid', snapToggle));
    if (!isText && this.snapEnabled) {
      const normalizeBtn = el('button', {
        className: 'btn-sm',
        textContent: 'Normalize Similar',
        title: 'Normalize similarly-shaped assets to a shared visual size',
      }) as HTMLButtonElement;
      normalizeBtn.addEventListener('click', () => {
        this.normalizeSimilarSlots().catch(err => console.error('[Transform] Normalize failed:', err));
      });
      transformChildren.push(normalizeBtn);
    }
    const transformSection = el('div', { className: 'inspector-section' }, transformChildren);

    if (isText) {
      this.tintLabel.textContent = 'Text Tint';
      const editBtn = el('button', { className: 'inspector-edit-btn', textContent: 'Edit Text' }) as HTMLButtonElement;
      editBtn.addEventListener('click', () => this.drawer.open('Text Editor', this.textControls));
      const mutSection = el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Mutations' }),
        this.mutationList,
      ]);
      const tintSection = el('div', { className: 'inspector-section' }, [this.tintLabel, this.customTintControls]);
      this.inspectorEl.append(editBtn, mutSection, tintSection, transformSection);
    } else if (isFullCard) {
      this.tintLabel.textContent = 'Card Tint';
      const editBtn = el('button', { className: 'inspector-edit-btn', textContent: 'Edit Card' }) as HTMLButtonElement;
      editBtn.addEventListener('click', () => this.drawer.open('Card Editor', this.fullCardControls));
      const mutSection = el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Mutations' }),
        this.mutationList,
      ]);
      const tintSection = el('div', { className: 'inspector-section' }, [this.tintLabel, this.customTintControls]);
      this.inspectorEl.append(editBtn, mutSection, tintSection, transformSection);
    } else if (isCosmetic) {
      this.tintLabel.textContent = 'Custom Tint';
      const editBtn = el('button', { className: 'inspector-edit-btn', textContent: 'Edit Blobling' }) as HTMLButtonElement;
      editBtn.addEventListener('click', () => this.drawer.open('Blobling Rig', this.bloblingControls));
      const mutSection  = el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Mutations' }),
        this.mutationList,
      ]);
      const tintSection = el('div', { className: 'inspector-section' }, [this.tintLabel, this.customTintControls]);
      this.inspectorEl.append(editBtn, mutSection, tintSection, transformSection);
    } else if (isSprite) {
      this.tintLabel.textContent = 'Custom Tint';
      const mutSection  = el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Mutations' }),
        this.mutationList,
      ]);
      const tintSection = el('div', { className: 'inspector-section' }, [this.tintLabel, this.customTintControls]);
      const optSection  = el('div', { className: 'inspector-section' }, [
        el('span', { className: 'inspector-section-title', textContent: 'Options' }),
        this.optionsDiv,
      ]);
      this.inspectorEl.append(mutSection, tintSection, transformSection, optSection, this.timelineBar);
    }
    this.inspectorEl.append(this.downloadProgress);
  }

  /** Apply a DropdownItem selection to the active slot (shared by dropdown + browser grid). */
  private applySpriteItem(item: DropdownItem): void {
    if (item.id === 'blobling-new') {
      this.addBloblingLayer();
    } else if (item.cardPresetUrls && item.cardPresetUrls.length > 0) {
      // Route through addCardLayers so all elements appear pixel-perfectly positioned.
      // item.id is 'cardpreset/{Type}' (e.g. 'cardpreset/Pet').
      const cardType = item.id.split('/')[1] as FullCardType | undefined;
      if (cardType) {
        this.addCardLayers(cardType).catch(err => console.error('[Card] Layer load failed:', err));
      } else {
        this.addCardUrlsAsLayers(item.cardPresetUrls, item.label)
          .catch(err => console.error('[Card] Layer load failed:', err));
      }
    } else if (item.animFrameUrls && item.animFrameUrls.length > 0) {
      const firstUrl = item.animFrameUrls[0];
      updateSlot(state.activeSlotIndex, { type: 'sprite', spriteKey: item.id, spriteUrl: firstUrl, gifFrames: undefined, isAnimated: false });
      this.stopGifPreview();
      this.loadAtlasAnimation(state.activeSlotIndex, item.id, item.animFrameUrls);
    } else if (item.sheetAnim && item.thumbUrl) {
      updateSlot(state.activeSlotIndex, { type: 'sprite', spriteKey: item.id, spriteUrl: item.thumbUrl, gifFrames: undefined, isAnimated: false });
      this.stopGifPreview();
      this.loadSheetAnimation(state.activeSlotIndex, item.id, item.thumbUrl, item.sheetAnim);
    } else {
      const url = item.thumbUrl ?? '';
      updateSlot(state.activeSlotIndex, { type: 'sprite', spriteKey: item.id, spriteUrl: url, gifFrames: undefined, isAnimated: false });
      this.stopGifPreview();
    }
  }

  /** Rebuild the browser grid from current cached items, optionally filtered by query. */
  private updateBrowserGrid(query?: string): void {
    const q = query ?? this.browserSearchInput.value ?? '';
    this.browserCleanup?.();
    this.browserCleanup = populateBrowserGrid(
      this.browserGridEl,
      this.browserItems,
      q,
      (item) => this.applySpriteItem(item),
    );
  }

  /** Highlight the currently active alignment button. */
  private syncAlignBtns(align: TextData['align']): void {
    for (const btn of this.alignBtns) {
      btn.classList.toggle('active', btn.dataset.align === align);
    }
  }

  /** Add a new text layer slot on the currently selected layer. */
  private addTextLayer(): void {
    const targetIdx = state.activeSlotIndex;

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
  // BLOBLING_LAYER_ORDER imported from './drawers/blobling-drawer':
  // ['Banner', 'Bottom', 'Mid', 'Top', 'Expression', 'Status', 'FaceProp']

  /** Build the blobling rig controls panel (called once in buildUI). */
  private buildBloblingControls(): HTMLElement {
    const rows: HTMLElement[] = [];

    for (const cat of BLOBLING_LAYER_ORDER) {
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
      dropdown.setItems(
        [{ id: 'none', label: 'None' }],
        'none',
        { suppressAutoSelectOnMissingRestore: true },
      );
      this.bloblingCatDropdowns.set(cat as BloblingLayerKey, dropdown);

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
    this.bloblingAnimDropdown.setItems(
      [{ id: 'none', label: 'None (static)' }],
      'none',
      { suppressAutoSelectOnMissingRestore: true },
    );

    return el('div', { className: 'blobling-controls-section' }, [
      el('h3', { className: 'blobling-heading', textContent: 'Blobling Rig' }),
      el('p', { className: 'blobling-hint', textContent: 'Layer cosmetics to build your blobling.' }),
      ...rows,
      el('div', { className: 'blobling-anim-section' }, [
        el('label', { textContent: 'Animation' }),
        this.bloblingAnimDropdown.element,
      ]),
    ]);
  }

  /** Add a new blobling rig slot with random starter cosmetics. */
  private addBloblingLayer(): void {
    const targetIdx = state.activeSlotIndex;

    // Seed with random cosmetics for a non-blank default look
    const cosmeticLayers: Record<string, string> = {};
    if (state.cosmeticsData) {
      for (const cat of ['Bottom', 'Mid', 'Top', 'Expression'] as const) {
        const catData = state.cosmeticsData.categories.find(c => c.cat === cat);
        if (catData && catData.items.length > 0) {
          const pick = catData.items[Math.floor(Math.random() * catData.items.length)];
          cosmeticLayers[cat] = pick.id;
        }
      }
    }

    updateSlot(targetIdx, {
      type: 'cosmetic',
      spriteKey: 'blobling',
      spriteUrl: 'blobling:',
      cosmeticLayers,
      bloblingAnimId: undefined,
      gifFrames: undefined,
      isAnimated: false,
      scale: 1,
      customTint: { color: '#ffffff', opacity: 0 },
      mutations: [],
    });
    setActiveSlot(targetIdx);
    const slot = state.slots[targetIdx];
    this.syncBloblingUI(slot);
    this.drawer.open('Blobling Rig', this.bloblingControls);
    this.scheduleBloblingRerender();
  }

  /** Sync blobling rig controls UI from the slot's current state. */
  private syncBloblingUI(slot: Slot): void {
    if (slot.type !== 'cosmetic') return;
    const cosData = state.cosmeticsData;

    for (const cat of BLOBLING_LAYER_ORDER) {
      const dropdown = this.bloblingCatDropdowns.get(cat as BloblingLayerKey);
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
      dropdown.setItems(items, selectedId, { suppressAutoSelectOnMissingRestore: true });
    }

    // Populate animation dropdown from the static known list (no async needed).
    const animItems: DropdownItem[] = [{ id: 'none', label: 'None (static)' }];
    for (const anim of BLOBLING_ANIMATIONS) {
      animItems.push({ id: String(anim.id), label: anim.name });
    }
    const selectedAnimId = slot.bloblingAnimId ?? 'none';
    this.bloblingAnimDropdown.setItems(
      animItems,
      selectedAnimId,
      { suppressAutoSelectOnMissingRestore: true },
    );

    // Pre-load the Rive file in the background so it's ready when the user picks an animation.
    const rivUrl = getRiveFileUrl();
    if (rivUrl) {
      getBloblingAnimations(rivUrl).catch((err: unknown) => {
        console.error('[Blobling] Failed to pre-load Rive:', err);
      });
    }
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

    // Resolve cosmetic URLs per layer role:
    //   Rive image assets: Bottom, Mid, Top
    //   Expression SM input: Expression
    //   PNG overlays (behind Rive): Banner
    //   PNG overlays (above Rive): Status, FaceProp
    const riveCosmeticUrls: Record<string, string> = {};
    let expressionUrl: string | undefined;
    let bannerUrl: string | undefined;
    let statusUrl: string | undefined;
    let facePropUrl: string | undefined;

    for (const cat of BLOBLING_LAYER_ORDER) {
      const cosmeticId = slot.cosmeticLayers?.[cat];
      if (!cosmeticId || !cosData) continue;
      const catData = cosData.categories.find(c => c.cat === cat);
      const item = catData?.items.find(i => i.id === cosmeticId);
      if (!item?.url) continue;
      if (cat === 'Expression') {
        expressionUrl = item.url;
      } else if (cat === 'Banner') {
        bannerUrl = item.url;
      } else if (cat === 'Status') {
        statusUrl = item.url;
      } else if (cat === 'FaceProp') {
        facePropUrl = item.url;
      } else {
        riveCosmeticUrls[cat] = item.url; // Bottom, Mid, Top
      }
    }

    const expressionIndex = expressionUrl ? getExpressionIndex(expressionUrl) : 0;
    const animId = slot.bloblingAnimId;

    if (animId && animId !== 'none') {
      // Animated: render Rive animation with cosmetics + expression.
      const rivUrl = getRiveFileUrl();
      if (!rivUrl) { console.warn('[Blobling] No Rive URL'); return; }

      const animIndex = parseInt(animId, 10);
      if (isNaN(animIndex)) { console.warn('[Blobling] Invalid animIndex:', animId); return; }

      const riveFrames = await renderBloblingFrames(rivUrl, animIndex, riveCosmeticUrls, expressionIndex);
      if (riveFrames.length === 0) return;

      // Composite Banner (behind) and Status/FaceProp (above) onto each Rive frame.
      const overlayUrls = [bannerUrl, statusUrl, facePropUrl].filter((u): u is string => !!u);
      if (overlayUrls.length > 0 || bannerUrl) {
        const [bannerImg, ...aboveImgs] = await Promise.all(
          [bannerUrl, statusUrl, facePropUrl]
            .map(u => u ? spriteLoader.load(u) : Promise.resolve(null)),
        );
        for (const frame of riveFrames) {
          const src = frame.canvas;
          const out = document.createElement('canvas');
          out.width  = src.width;
          out.height = src.height;
          const ctx = out.getContext('2d')!;
          if (bannerImg) ctx.drawImage(bannerImg, 0, 0, out.width, out.height);
          ctx.drawImage(src, 0, 0);
          for (const overlay of aboveImgs) {
            if (overlay) ctx.drawImage(overlay, 0, 0, out.width, out.height);
          }
          frame.canvas = out;
        }
      }

      // Guard: bail if slot changed while rendering.
      const s = state.slots[idx];
      if (s.type !== 'cosmetic' || s.bloblingAnimId !== animId) return;

      s.gifFrames  = riveFrames;
      s.isAnimated = true;
      s.spriteUrl  = 'blobling:';
      bus.emit(Events.RENDER_REQUEST, null);
      this.refreshSlots();
      if (idx === state.activeSlotIndex) this.startGifPreview();
    } else {
      // Static: composite all PNG layers in order.
      // Banner first (behind), then Bottom/Mid/Top/Expression, then Status/FaceProp (above).
      const orderedUrls: (string | undefined)[] = [
        bannerUrl,
        riveCosmeticUrls['Bottom'],
        riveCosmeticUrls['Mid'],
        riveCosmeticUrls['Top'],
        expressionUrl,
        statusUrl,
        facePropUrl,
      ];
      const allUrls = orderedUrls.filter((u): u is string => !!u);

      if (allUrls.length === 0) {
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

      const cosmeticImages = await Promise.all(allUrls.map(url => spriteLoader.load(url)));
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
  private scheduleTextRerender(targetIndexes?: number[]): void {
    if (targetIndexes && targetIndexes.length > 0) {
      for (const index of targetIndexes) this.textRenderQueue.add(index);
    } else {
      this.textRenderQueue.add(state.activeSlotIndex);
    }
    if (this.textRenderDebounce !== null) clearTimeout(this.textRenderDebounce);
    this.textRenderDebounce = setTimeout(() => {
      this.textRenderDebounce = null;
      const indexes = Array.from(this.textRenderQueue);
      this.textRenderQueue.clear();
      this.rerenderTextLayers(indexes).catch((err) => console.error('[MG] Text render failed:', err));
    }, 80);
  }

  /** Re-render one or more text slots and store each result in gifFrames[0]. */
  private async rerenderTextLayers(targetIndexes: number[]): Promise<void> {
    const uniqueTargets = Array.from(new Set(targetIndexes.filter((idx) => idx >= 0 && idx < state.slots.length)));
    if (uniqueTargets.length === 0) return;
    await Promise.all(uniqueTargets.map(async (index) => {
      const slot = state.slots[index];
      if (!slot || slot.type !== 'text' || !slot.textData) return;
      const snapshot = slot.textData;
      const canvas = await renderTextToCanvas(snapshot, slot.customTint.color);
      const currentSlot = state.slots[index];
      if (!currentSlot || currentSlot.type !== 'text' || currentSlot.textData !== snapshot) return;
      currentSlot.gifFrames = [{ canvas, delay: 0 }];
      currentSlot.isAnimated = true;
      currentSlot.spriteUrl = 'text:'; // keep sentinel URL
    }));
    bus.emit(Events.RENDER_REQUEST, null);
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
        const activeMutations = Array.from(
          this.fullCardItemMutationsContainer.querySelectorAll<HTMLElement>('.full-card-mutation-chip.active'),
        )
          .map(c => c.dataset.mutationId ?? '')
          .filter(Boolean);
        if (getActiveSlot().type === 'full-card') {
          updateSlotSilent(state.activeSlotIndex, { mutations: activeMutations });
          this.refreshMutations();
        }
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

    const section = el('div', { className: 'full-card-controls-section' });
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
    this.fullCardNameInput.value = data.itemName ?? data.cardType;
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

  /** Build the card-type selection overlay with canvas previews (appended to body once). */
  private buildCardTypePicker(): void {
    const CARD_TYPES: FullCardType[] = ['Pet', 'Plant', 'Crop', 'Seed', 'Egg', 'Tool', 'Decor'];
    const pickerTitle = el('div', { className: 'card-type-picker-title', textContent: 'Choose card type' });
    const tiles = CARD_TYPES.map((type) => {
      // Canvas placeholder — filled async by renderCardPickerThumbs()
      const canvas = document.createElement('canvas');
      canvas.width  = 180;
      canvas.height = 240;
      this.cardPickerCanvases.set(type, canvas);

      const tile = el('button', { className: 'card-type-tile' }) as HTMLButtonElement;
      tile.append(canvas, el('span', { className: 'card-type-tile-label', textContent: type }));
      tile.addEventListener('click', () => {
        this.cardTypePickerEl.style.display = 'none';
        if (this.cardPickerMode === 'full') {
          this.addFullCardLayer(type).catch(err => console.error('[Card] Full-card add failed:', err));
        } else {
          this.addCardLayers(type).catch(err => console.error('[Card] Layer load failed:', err));
        }
      });
      return tile;
    });

    const cancelBtn = el('button', {
      className: 'card-type-picker-cancel',
      textContent: 'Cancel',
    }) as HTMLButtonElement;
    cancelBtn.addEventListener('click', () => {
      this.cardTypePickerEl.style.display = 'none';
    });

    this.cardTypePickerEl = el('div', { className: 'card-type-picker', style: 'display:none' }, [
      el('div', { className: 'card-type-picker-inner' }, [
        pickerTitle,
        el('div', { className: 'card-type-tiles' }, tiles),
        cancelBtn,
      ]),
    ]);
    this.cardTypePickerEl.addEventListener('click', (e) => {
      if (e.target === this.cardTypePickerEl) this.cardTypePickerEl.style.display = 'none';
    });
    document.body.appendChild(this.cardTypePickerEl);
  }

  /** Show the card type picker in the given mode and (async) fill preview canvases. */
  private showCardTypePicker(mode: 'layers' | 'full'): void {
    this.cardPickerMode = mode;
    const titleEl = this.cardTypePickerEl.querySelector('.card-type-picker-title');
    if (titleEl) {
      titleEl.textContent = mode === 'full'
        ? 'Choose card type (full editor)'
        : 'Choose card type';
    }
    this.cardTypePickerEl.style.display = 'flex';
    this.renderCardPickerThumbs().catch(() => {/* best effort */});
  }

  /**
   * Async: load Bottom + Middle for each card type and composite into the picker canvas.
   * Only runs if the canvas is still blank (avoids re-fetching on repeat opens).
   */
  private async renderCardPickerThumbs(): Promise<void> {
    const CARD_TYPES: FullCardType[] = ['Pet', 'Plant', 'Crop', 'Seed', 'Egg', 'Tool', 'Decor'];
    const version = this.getUiSpriteVersion();
    const v = version ? `?v=${version}` : '';
    const base = 'https://mg-api.ariedam.fr/assets/sprites/ui';

    await Promise.allSettled(CARD_TYPES.map(async (type) => {
      const canvas = this.cardPickerCanvases.get(type);
      if (!canvas) return;
      // Skip if already rendered (non-blank)
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const existing = ctx.getImageData(0, 0, 1, 1);
      if (existing.data[3] > 0) return;

      const bottomUrl = `${base}/${type}CardBottom.png${v}`;
      const middleUrl = `${base}/${type}CardMiddle.png${v}`;

      const [botResult, midResult] = await Promise.allSettled([
        this.loadSpriteLayer(`${type}CardBottom`, bottomUrl),
        this.loadSpriteLayer(`${type}CardMiddle`, middleUrl),
      ]);

      type LayerSrc = HTMLImageElement | HTMLCanvasElement;
      const layers: LayerSrc[] = [botResult, midResult]
        .filter((r): r is PromiseFulfilledResult<LayerSrc | null> => r.status === 'fulfilled')
        .map(r => r.value)
        .filter((v): v is LayerSrc => v !== null);

      if (layers.length === 0) return;

      const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
      const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;
      const srcW = Math.max(...layers.map(getW));
      const srcH = Math.max(...layers.map(getH));
      if (srcW === 0 || srcH === 0) return;

      const scale = Math.min(canvas.width / srcW, canvas.height / srcH);
      const dw = srcW * scale;
      const dh = srcH * scale;
      const dx = (canvas.width  - dw) / 2;
      const dy = (canvas.height - dh) / 2;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const layer of layers) {
        ctx.drawImage(layer as CanvasImageSource, dx, dy, dw, dh);
      }
    }));
  }

  /**
   * Load all individual sprite layers that make up a card, pixel-perfectly pre-positioned
   * using the exact layout constants from full-card-renderer.ts.
   *
   * All cards are 500×720.  Positions are offsets from canvas centre (same coord space as
   * full-card-renderer which does ctx.translate(cardW/2, cardH/2)).
   */
  /**
   * Add a single full-card slot (type='full-card') and open the card editor drawer.
   * Mirrors the old preset behavior for users who want the live-stats editor.
   */
  private async addFullCardLayer(type: FullCardType): Promise<void> {
    const targetIdx = this.resolveTargetSlotIndex(0);
    if (targetIdx < 0) return;

    const data = defaultFullCardData(type);
    updateSlot(targetIdx, {
      type:        'full-card',
      spriteKey:   `full-card/${type}`,
      spriteUrl:   'full-card:',
      fullCardData: data,
      mutations:   [],
      scale:       1,
      rotation:    0,
      position:    { x: 0, y: 0 },
      customTint:  { color: '#ffffff', opacity: 0 },
    });

    setActiveSlot(targetIdx);
    this.syncFullCardUI(state.slots[targetIdx]);
    this.drawer.open('Card Editor', this.fullCardControls);
    this.scheduleFullCardRerender();
  }

  private async addCardLayers(type: FullCardType): Promise<void> {
    // ── card dimensions (all types identical) ─────────────────────────────────
    const CW = 500, CH = 720;

    // ── layout constants (from full-card-renderer.ts) ─────────────────────────
    const G5          = 8;
    const AH          = 60,  KH = 65,  XH = 0.44, HZ = 0.78;
    const JH          = 25,  RH = 88,  QM = 22;
    const LOCK_SIZE   = 75;
    const RARITY_SIZE = 64;
    const ICON_SIZE   = 70;
    const ICON_NAT    = 88;   // all type icons are 88×88
    const CS          = 28;   // display size for bottom-row small icons
    const GAP         = 20;   // separator gap between bottom-row items
    const PART        = CS + 4; // space per icon+gap column

    // ── natural sprite dimensions (measured live from mg-api.ariedam.fr) ──────
    const NAT = {
      Locked:      { w: 64,  h: 84  },
      RarityCommon:{ w: 55,  h: 55  },
      StrengthStar:{ w: 53,  h: 55  },
      Coin:        { w: 87,  h: 95  },
      Weight:      { w: 29,  h: 34  },
      Age:         { w: 27,  h: 32  },
    };

    // ── exact positions (card-centre coords ≡ slot.position offsets from canvas centre) ──

    // Type icon — top-left: drawImage at (-CW/2+G5+10, -CH/2+G5+9), size ICON_SIZE
    const iconScale = ICON_SIZE / ICON_NAT;                   // 70/88 ≈ 0.7955
    const iconX     = (-CW / 2 + G5 + 10) + ICON_SIZE / 2;   // -232 + 35 = -197
    const iconY     = (-CH / 2 + G5 + 9)  + ICON_SIZE / 2;   // -343 + 35 = -308

    // Lock — top-right: drawImageCentered(cx, cy, LOCK_SIZE)
    const lockScale = LOCK_SIZE / Math.max(NAT.Locked.w, NAT.Locked.h);  // 75/84
    const lockX     = CW / 2 - 4 - LOCK_SIZE / 2;   //  208.5
    const lockY     = -CH / 2 + 4 + LOCK_SIZE / 2;  // -318.5

    // Rarity gem — bottom-left: drawImage at (x, y-dh, dw, dh) where
    //   x = -CW/2+G5+15, y = CH/2-G5-17, scale = RARITY_SIZE/max(w,h)
    const rarScale  = RARITY_SIZE / Math.max(NAT.RarityCommon.w, NAT.RarityCommon.h); // 64/55
    const rarDim    = NAT.RarityCommon.w * rarScale;                                   // ≈ 64
    const rarX      = (-CW / 2 + G5 + 15) + rarDim / 2;   // -227 + 32 = -195
    const rarY      = (CH  / 2 - G5 - 17) - rarDim / 2;   //  335 - 32 =  303

    // ── stats area positions ─────────────────────────────────────────────────
    // From renderer: r = -CH/2+AH+KH = -235; n = (CH-AH*2)*XH = 264
    // nameY = r+n+JH = 54;  detailsY = nameY+RH/2+QM = 120
    // bottomOffset = CH/2-detailsY-58 = 182;  bottomRowY = 302
    const detailsY  = (-CH / 2 + AH + KH) + (CH - AH * 2) * XH + JH + RH / 2 + QM; // 120
    const bottomY   = CH / 2 - detailsY - 58 + detailsY;                             // 302
    const rowWidth  = CW * HZ;         // 390
    // barRight (showMaxLabel, k=50): rowLeft+rowWidth-50 = -195+390-50 = 145
    const barRight  = -rowWidth / 2 + rowWidth - 50;                                  // 145

    // StrengthStar — right of strength bar, drawImageCentered(maxStarX, detailsY, 40)
    //   maxStarX = barRight + 36  (non-fully-grown: shows next + max)
    const strStarSize  = 40;
    const strStarScale = strStarSize / Math.max(NAT.StrengthStar.w, NAT.StrengthStar.h);
    const strStarX     = barRight + 36;  // 181

    // Bottom-row icons: for an empty-text card startX = −(3*PART + 2*GAP)/2 = −68
    //   Weight center: startX + dw/2
    //   Age    center: startX + PART + GAP + dw/2
    //   Coin   center: startX + PART*2 + GAP*2 + dw/2
    const scW = CS / Math.max(NAT.Weight.w, NAT.Weight.h);      // 28/34 ≈ 0.824
    const scA = CS / Math.max(NAT.Age.w,    NAT.Age.h);         // 28/32 = 0.875
    const scC = CS / Math.max(NAT.Coin.w,   NAT.Coin.h);        // 28/95 ≈ 0.295
    const wDw = NAT.Weight.w * scW;   // ≈ 23.9
    const aDw = NAT.Age.w    * scA;   // ≈ 23.6
    const cDw = NAT.Coin.w   * scC;   // ≈ 25.7

    // Pet row: weight | • | age | • | coin  (startX = −68)
    const PET_START   = -((PART * 3 + GAP * 2) / 2);
    const petWeightX  = PET_START + wDw / 2;
    const petAgeX     = PET_START + PART + GAP + aDw / 2;
    const petCoinX    = PET_START + PART * 2 + GAP * 2 + cDw / 2;

    // Plant/Crop row: weight | • | coin  (startX = −42)
    const PLT_START   = -((PART * 2 + GAP) / 2);
    const pltWeightX  = PLT_START + wDw / 2;
    const pltCoinX    = PLT_START + PART + GAP + cDw / 2;

    // ── URL builder ─────────────────────────────────────────────────────────
    const version = this.getUiSpriteVersion();
    const v   = version ? `?v=${version}` : '';
    const base = 'https://mg-api.ariedam.fr/assets/sprites/ui';
    const u   = (name: string) => `${base}/${name}.png${v}`;

    const ICON_NAME: Record<FullCardType, string> = {
      Pet: 'PetIcon', Plant: 'PlantIcon', Crop: 'CropIcon',
      Seed: 'SeedIcon', Egg: 'EggIcon', Tool: 'ToolIcon', Decor: 'DecorIcon',
    };

    type LayerSpec = { name: string; url: string; position: { x: number; y: number }; scale: number };

    // ── assemble layer specs ─────────────────────────────────────────────────
    const specs: LayerSpec[] = [
      // Card frame — always centered
      { name: `${type}CardBottom`, url: u(`${type}CardBottom`), position: { x: 0, y: 0 }, scale: 1 },
      { name: `${type}CardMiddle`, url: u(`${type}CardMiddle`), position: { x: 0, y: 0 }, scale: 1 },
      // Type icon — top-left
      { name: ICON_NAME[type], url: u(ICON_NAME[type]), position: { x: iconX, y: iconY }, scale: iconScale },
      // Lock — top-right
      { name: 'Locked', url: u('Locked'), position: { x: lockX, y: lockY }, scale: lockScale },
      // Rarity gem — bottom-left
      { name: 'RarityCommon', url: u('RarityCommon'), position: { x: rarX, y: rarY }, scale: rarScale },
    ];

    if (type === 'Pet') {
      specs.push(
        { name: 'StrengthStar', url: u('StrengthStar'), position: { x: strStarX, y: detailsY }, scale: strStarScale },
        { name: 'Weight',       url: u('Weight'),       position: { x: petWeightX, y: bottomY }, scale: scW },
        { name: 'Age',          url: u('Age'),          position: { x: petAgeX,    y: bottomY }, scale: scA },
        { name: 'Coin',         url: u('Coin'),         position: { x: petCoinX,   y: bottomY }, scale: scC },
      );
    } else if (type === 'Plant' || type === 'Crop') {
      specs.push(
        { name: 'Weight', url: u('Weight'), position: { x: pltWeightX, y: bottomY }, scale: scW },
        { name: 'Coin',   url: u('Coin'),   position: { x: pltCoinX,   y: bottomY }, scale: scC },
      );
    } else if (type === 'Seed' || type === 'Egg') {
      specs.push(
        { name: 'Coin', url: u('Coin'), position: { x: cDw / 2, y: bottomY }, scale: scC },
      );
    }

    await this.addPositionedCardLayers(specs, `${type} Card`);
  }

  /**
   * Load each layer spec as a separate independent slot, applying the pre-calculated
   * position and scale so the card elements appear at their correct in-game locations.
   */
  private async addPositionedCardLayers(
    specs: Array<{ name: string; url: string; position: { x: number; y: number }; scale: number }>,
    groupLabel: string,
  ): Promise<void> {
    this.stopGifPreview();
    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i];
      const targetIdx = this.resolveTargetSlotIndex(i);
      if (targetIdx < 0) break;

      const src = await this.loadSpriteLayer(spec.name, spec.url).catch(() => null);

      let gifFrames: { canvas: HTMLCanvasElement; delay: number }[] | undefined;
      let isAnimated = false;
      if (src) {
        const canvas = document.createElement('canvas');
        canvas.width  = getW(src);
        canvas.height = getH(src);
        canvas.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0);
        gifFrames = [{ canvas, delay: 0 }];
        isAnimated = true;
      }

    updateSlot(targetIdx, {
        type: 'custom',
        spriteKey: `${groupLabel} / ${spec.name}`,
        spriteUrl: spec.url,
        gifFrames,
        isAnimated,
        scale:    spec.scale,
        position: spec.position,
        rotation: 0,
        customTint: { color: '#ffffff', opacity: 0 },
        mutations: [],
      });
    }
  }

  /**
   * Load each URL as a separate independent slot (no compositing, default position/scale).
   * Used by browser-grid card items and card preset URLs from dropdown items.
   */
  private async addCardUrlsAsLayers(urls: string[], baseLabel: string): Promise<void> {
    this.stopGifPreview();
    type LayerSrc = HTMLImageElement | HTMLCanvasElement;
    const getW = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.width : s.naturalWidth;
    const getH = (s: LayerSrc) => s instanceof HTMLCanvasElement ? s.height : s.naturalHeight;

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const targetIdx = this.resolveTargetSlotIndex(i);
      if (targetIdx < 0) break;

      const layerName = url.split('/').pop()?.split('?')[0].replace('.png', '') ?? '';
      const src = await this.loadSpriteLayer(layerName, url).catch(() => null);

      let gifFrames: { canvas: HTMLCanvasElement; delay: number }[] | undefined;
      let isAnimated = false;
      if (src) {
        const canvas = document.createElement('canvas');
        canvas.width  = getW(src);
        canvas.height = getH(src);
        canvas.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0);
        gifFrames = [{ canvas, delay: 0 }];
        isAnimated = true;
      }

    updateSlot(targetIdx, {
        type: 'custom',
        spriteKey: `${baseLabel} / ${layerName}`,
        spriteUrl: url,
        gifFrames,
        isAnimated,
        scale: 1,
        rotation: 0,
        customTint: { color: '#ffffff', opacity: 0 },
        mutations: [],
      });
    }
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

    // Blobling individual cosmetic categories
    if (state.cosmeticsData && state.cosmeticsData.categories.length > 0) {
      for (const cat of state.cosmeticsData.categories) {
        items.push({ id: `cosmetic:${cat.cat}`, label: `Blobling: ${cat.cat}` });
      }
    }

    // setItems fires onSelect (→ populateSprites) if it has to auto-select.
    // We also call populateSprites() unconditionally to handle the silent-restore case.
    this.categoryDropdown.setItems(
      items,
      state.selectedCategory || undefined,
      { suppressAutoSelectOnMissingRestore: true },
    );

    // Populate browser tab strip with same categories
    populateBrowserTabs(
      this.browserTabsEl,
      items.map(i => ({ id: i.id, label: i.label })),
      state.selectedCategory || items[0]?.id || '',
      (catId) => {
        state.selectedCategory = catId;
        this.categoryDropdown.selectById(catId);
        this.browserSearchInput.value = '';
        this.populateSprites(false);
      },
    );

    this.populateSprites(true);
  }

  private populateSprites(suppressAutoSelectOnMissingRestore: boolean): void {
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
            const isWeatherStripAnim = cat === 'weather' && /Animation$/i.test(name);
            if (isWeatherStripAnim) {
              const frameCount = Math.max(1, Math.floor(item.frame.w / this.WEATHER_STRIP_FRAME_WIDTH));
              items.push({
                id: item.id,
                label: `${item.name} (animated)`,
                thumbUrl: url,
                sheetAnim: {
                  direction: 'x',
                  frameWidth: this.WEATHER_STRIP_FRAME_WIDTH,
                  frameCount,
                  frameDelay: this.DEFAULT_ANIM_FRAME_DELAY,
                },
              });
            } else {
              items.push({ id: item.id, label: item.name, thumbUrl: url });
            }
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
    const slot = getActiveSlot();
    let restoreId: string | undefined;
    if (cat === 'full-cards') {
      restoreId = slot.type === 'full-card'
        ? `full-card/${slot.fullCardData?.cardType}`
        : (items[0]?.id ?? undefined);
    } else if (cat === 'blobling-rig') {
      restoreId = items[0]?.id ?? undefined;
    } else {
      restoreId = slot.spriteKey || undefined;
    }
    this.spriteDropdown.setItems(
      items,
      restoreId,
      { suppressAutoSelectOnMissingRestore },
    );

    // Cache items for browser grid + rebuild grid
    this.browserItems = items;
    this.updateBrowserGrid();

    // Asynchronously generate composited thumbnails for card categories
    if (cat === 'cards' || cat === 'full-cards') this.generateCardListThumbnails(items);

    // Pre-warm SpriteLoader for the entire category at low priority.
    const thumbUrls = items.map(i => i.thumbUrl).filter((u): u is string => !!u);
    spriteLoader.preloadUrls(thumbUrls);
  }

  // ── Slots ──

  private refreshSlots(): void {
    this.sanitizeSelection();
    this.slotContainer.innerHTML = '';
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i];
      const hasContent = !!slot.spriteUrl;
      const isActive   = i === state.activeSlotIndex;
      const isSelected = this.isSlotSelected(i);

      // Type badge color
      const badgeColors: Record<string, string> = {
        sprite: 'var(--badge-sprite)',
        text: 'var(--badge-text)',
        'full-card': 'var(--badge-card)',
        cosmetic: 'var(--badge-blobling)',
        custom: 'var(--badge-custom)',
      };

      // Thumbnail canvas
      const thumb = document.createElement('canvas');
      thumb.className = 'slot-thumb';
      thumb.width  = 64;
      thumb.height = 64;

      if (hasContent && slot.spriteUrl) {
        const gifCanvas = slot.gifFrames?.[0]?.canvas;
        if (gifCanvas instanceof HTMLCanvasElement && gifCanvas.width > 0) {
          const ctx = thumb.getContext('2d')!;
          const scale = Math.min(64 / gifCanvas.width, 64 / gifCanvas.height);
          ctx.drawImage(gifCanvas,
            (64 - gifCanvas.width * scale) / 2, (64 - gifCanvas.height * scale) / 2,
            gifCanvas.width * scale, gifCanvas.height * scale,
          );
        } else if (slot.type !== 'full-card' && slot.type !== 'text' && slot.type !== 'cosmetic') {
          renderThumb(slot.spriteUrl, thumb);
        }
      }

      // Type badge dot
      const badge = el('span', { className: 'slot-type-badge' }) as HTMLElement;
      badge.style.background = badgeColors[slot.type] ?? 'var(--badge-custom)';

      // Slot number
      const numEl = el('span', { className: 'slot-num', textContent: String(i + 1) });

      // Delete button
      const delBtn = el('button', { className: 'slot-delete', textContent: '×', title: 'Remove slot' }) as HTMLButtonElement;
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); clearSlot(i); });

      const tile = el('div', {
        className: `slot-tile${isActive ? ' active' : ''}${isSelected ? ' selected' : ''}${hasContent ? '' : ' empty'}`,
        draggable: 'true',
        title: hasContent ? (slot.spriteKey.split('/').pop() ?? String(i + 1)) : String(i + 1),
      });
      tile.append(thumb, badge, numEl, delBtn);
      if (!hasContent) {
        const plus = el('span', { className: 'slot-empty-plus', textContent: '+' });
        tile.append(plus);
      }

      tile.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey) {
          this.toggleSlotInSelection(i);
          setActiveSlot(i);
          return;
        }
        this.clearMultiSelection();
        setActiveSlot(i);
      });

      tile.addEventListener('dragstart', () => {
        this.clearMultiSelection();
        this.dragIdx = i;
        tile.classList.add('dragging');
      });
      tile.addEventListener('dragend', () => {
        this.dragIdx = null;
        this.dragInsertBefore = null;
        this.clearDropIndicators();
      });
      tile.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.dragIdx === null) return;
        const rect = tile.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        this.clearDropIndicators();
        if (e.clientY < midY) {
          tile.classList.add('drop-before');
          this.dragInsertBefore = i;
        } else {
          tile.classList.add('drop-after');
          this.dragInsertBefore = i + 1;
        }
      });
      tile.addEventListener('dragleave', (e) => {
        if (!tile.contains(e.relatedTarget as Node)) tile.classList.remove('drop-before', 'drop-after');
      });
      tile.addEventListener('drop', (e) => {
        e.preventDefault();
        this.clearDropIndicators();
        if (this.dragIdx !== null && this.dragInsertBefore !== null) {
          reorderSlots(this.dragIdx, this.dragInsertBefore);
        }
        this.dragIdx = null;
        this.dragInsertBefore = null;
      });

      this.slotContainer.append(tile);
    }

    if (state.slots.length < MAX_SLOTS) {
      const addTile = el('div', { className: 'slot-tile slot-add-tile', title: 'Add layer' });
      addTile.textContent = '+';
      addTile.addEventListener('click', () => addSlot());
      this.slotContainer.append(addTile);
    }
  }

  private clearDropIndicators(): void {
    for (const tile of this.slotContainer.querySelectorAll('.slot-tile')) {
      tile.classList.remove('drop-before', 'drop-after', 'dragging');
    }
  }

  // ── Mutations ──

  private refreshMutations(): void {
    this.mutationList.innerHTML = '';
    const slot = getActiveSlot();
    const selectedIndexes = this.getEffectiveSelectionIndexes();

    for (const id of Object.keys(FILTERS)) {
      const isActive = slot.mutations.includes(id);
      const chip = el('span', {
        className: `mutation-chip${isActive ? ' active' : ''}`,
        textContent: id,
        title: id,
      }) as HTMLElement;
      chip.style.background = MUTATION_CHIP_COLORS[id] ?? '#555';
      chip.addEventListener('click', () => {
        const activeSlot = getActiveSlot();
        const shouldEnable = !activeSlot.mutations.includes(id);
        beginBatchUpdate();
        this.applyToSelection((targetSlot) => {
          const next = new Set(targetSlot.mutations);
          if (shouldEnable) next.add(id);
          else next.delete(id);
          targetSlot.mutations = Array.from(next);
        }, selectedIndexes);
        bus.emit(Events.SLOT_CHANGED, null);
        bus.emit(Events.RENDER_REQUEST, null);
      });
      this.mutationList.append(chip);
    }

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
      const animName = slot.bloblingAnimId != null ? BLOBLING_ANIMATIONS[parseInt(slot.bloblingAnimId)]?.name : null;
      const animLabel = animName ? ` &middot; ${animName}` : '';
      this.metaEl.innerHTML = `<strong>Blobling Rig</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; ${layerCount} cosmetic${layerCount !== 1 ? 's' : ''}${animLabel}`;
    } else {
      const displayName = slot.spriteKey.split('/').pop() ?? slot.spriteKey;
      this.metaEl.innerHTML = `<strong>${displayName}</strong> &middot; Slot ${state.activeSlotIndex + 1} &middot; Mutations: ${muts} &middot; Scale: ${slot.scale}x`;
    }
  }

  // ── Render ──

  private async render(): Promise<void> {
    await renderAll(this.previewCanvas);
    this.drawSnapGridOverlay();
  }

  // ── Canvas Drag ──

  // ── Copy / paste / duplicate ──────────────────────────────────────────────

  private clampToolbarHeight(value: number): number {
    return Math.max(this.TOOLBAR_MIN_H, Math.min(this.TOOLBAR_MAX_H, Math.round(value)));
  }

  private clampLayersWidth(value: number): number {
    return Math.max(this.LAYERS_MIN_W, Math.min(this.LAYERS_MAX_W, Math.round(value)));
  }

  private clampAssetsWidth(value: number): number {
    return Math.max(this.ASSETS_MIN_W, Math.min(this.ASSETS_MAX_W, Math.round(value)));
  }

  private normalizeRenderSize(value: number): number {
    if (!Number.isFinite(value)) return this.RENDER_SIZE_PRESETS[0];
    let closest: number = this.RENDER_SIZE_PRESETS[0];
    let bestDelta = Math.abs(value - closest);
    for (const preset of this.RENDER_SIZE_PRESETS) {
      const delta = Math.abs(value - preset);
      if (delta < bestDelta) {
        bestDelta = delta;
        closest = preset;
      }
    }
    return closest;
  }

  private applyLayoutCssVars(): void {
    const root = document.documentElement.style;
    root.setProperty('--toolbar-h', `${this.toolbarHeight}px`);
    root.setProperty('--col-layers-w', `${this.layersWidth}px`);
    root.setProperty('--col-browser-w', `${this.assetsWidth}px`);
  }

  private applyRenderSize(size: number): void {
    const next = this.normalizeRenderSize(size);
    this.renderSize = next;
    if (this.previewCanvas) {
      this.previewCanvas.width = next;
      this.previewCanvas.height = next;
      bus.emit(Events.RENDER_REQUEST, null);
    }
    this.saveLayoutSettings();
  }

  private isMobileMode(): boolean {
    return !!this.mobileModeQuery?.matches;
  }

  private syncMobileMode(): void {
    if (!this.appRootEl) return;
    this.appRootEl.classList.toggle('mobile', this.isMobileMode());
  }

  private setupMobileModeGate(): void {
    if (typeof window.matchMedia !== 'function') return;

    if (this.mobileModeQuery && this.mobileModeChangeHandler) {
      this.mobileModeQuery.removeEventListener('change', this.mobileModeChangeHandler);
    }

    this.mobileModeQuery = window.matchMedia('(hover: none) and (pointer: coarse)');
    if (!this.mobileModeChangeHandler) {
      this.mobileModeChangeHandler = () => this.syncMobileMode();
    }
    this.mobileModeQuery.addEventListener('change', this.mobileModeChangeHandler);
    this.syncMobileMode();
  }

  private loadLayoutSettings(): void {
    try {
      const raw = localStorage.getItem(this.LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        toolbarHeight?: number;
        layersWidth?: number;
        assetsWidth?: number;
        renderSize?: number;
      };
      if (typeof parsed.toolbarHeight === 'number') this.toolbarHeight = this.clampToolbarHeight(parsed.toolbarHeight);
      if (typeof parsed.layersWidth === 'number') this.layersWidth = this.clampLayersWidth(parsed.layersWidth);
      if (typeof parsed.assetsWidth === 'number') this.assetsWidth = this.clampAssetsWidth(parsed.assetsWidth);
      if (typeof parsed.renderSize === 'number') this.renderSize = this.normalizeRenderSize(parsed.renderSize);
    } catch {
      // Ignore invalid persisted layout payloads
    }
  }

  private saveLayoutSettings(): void {
    try {
      localStorage.setItem(this.LAYOUT_STORAGE_KEY, JSON.stringify({
        toolbarHeight: this.toolbarHeight,
        layersWidth: this.layersWidth,
        assetsWidth: this.assetsWidth,
        renderSize: this.renderSize,
      }));
    } catch {
      // Ignore storage failures
    }
  }

  private resolveTargetSlotIndex(offsetFromSelection: number): number {
    const baseIndex = Math.max(0, state.activeSlotIndex);
    const offset = Math.max(0, Math.floor(offsetFromSelection));
    const target = baseIndex + offset;

    while (state.slots.length <= target) {
      const before = state.slots.length;
      addSlot();
      if (state.slots.length === before) return -1;
    }

    return target;
  }

  private clearMultiSelection(): void {
    this.selectedSlotIndexes.clear();
  }

  private sanitizeSelection(): void {
    for (const index of Array.from(this.selectedSlotIndexes)) {
      if (index < 0 || index >= state.slots.length) this.selectedSlotIndexes.delete(index);
    }
  }

  private getEffectiveSelectionIndexes(): number[] {
    this.sanitizeSelection();
    if (this.selectedSlotIndexes.size > 0) {
      return Array.from(this.selectedSlotIndexes).sort((a, b) => a - b);
    }
    if (state.activeSlotIndex < 0 || state.activeSlotIndex >= state.slots.length) return [];
    return [state.activeSlotIndex];
  }

  private isSlotSelected(index: number): boolean {
    return this.selectedSlotIndexes.size > 0 && this.selectedSlotIndexes.has(index);
  }

  private toggleSlotInSelection(index: number): void {
    if (this.selectedSlotIndexes.has(index)) this.selectedSlotIndexes.delete(index);
    else this.selectedSlotIndexes.add(index);
  }

  private applyToSelection(
    updater: (slot: Slot, index: number) => void,
    indexes = this.getEffectiveSelectionIndexes(),
  ): number[] {
    for (const index of indexes) {
      const slot = state.slots[index];
      if (!slot) continue;
      updater(slot, index);
    }
    return indexes;
  }

  private setupColumnResize(
    handle: HTMLDivElement,
    panel: 'layers' | 'assets',
    min: number,
    max: number,
    visibilityEl?: HTMLElement,
  ): void {
    let dragging = false;
    let pointerId = -1;
    let startX = 0;
    let startW = 0;
    let prevUserSelect = '';
    let prevCursor = '';

    const endDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      this.saveLayoutSettings();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (this.isMobileMode()) return;
      if (visibilityEl && getComputedStyle(visibilityEl).display === 'none') return;
      dragging = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startW = panel === 'layers' ? this.layersWidth : this.assetsWidth;
      prevUserSelect = document.body.style.userSelect;
      prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ew-resize';
      handle.classList.add('dragging');
      handle.setPointerCapture(pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const nextW = Math.max(min, Math.min(max, startW + (e.clientX - startX)));
      if (panel === 'layers') this.layersWidth = this.clampLayersWidth(nextW);
      else this.assetsWidth = this.clampAssetsWidth(nextW);
      this.applyLayoutCssVars();
      e.preventDefault();
    });

    handle.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pointerId) return;
      handle.releasePointerCapture(pointerId);
      endDrag();
    });
    handle.addEventListener('pointercancel', endDrag);
  }

  private setupToolbarResize(handle: HTMLDivElement): void {
    let dragging = false;
    let pointerId = -1;
    let startY = 0;
    let startH = 0;
    let prevUserSelect = '';
    let prevCursor = '';

    const endDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      this.saveLayoutSettings();
    };

    handle.addEventListener('pointerdown', (e) => {
      if (this.isMobileMode()) return;
      dragging = true;
      pointerId = e.pointerId;
      startY = e.clientY;
      startH = this.toolbarHeight;
      prevUserSelect = document.body.style.userSelect;
      prevCursor = document.body.style.cursor;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'ns-resize';
      handle.classList.add('dragging');
      handle.setPointerCapture(pointerId);
      e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      this.toolbarHeight = this.clampToolbarHeight(startH + (e.clientY - startY));
      this.applyLayoutCssVars();
      e.preventDefault();
    });

    handle.addEventListener('pointerup', (e) => {
      if (e.pointerId !== pointerId) return;
      handle.releasePointerCapture(pointerId);
      endDrag();
    });
    handle.addEventListener('pointercancel', endDrag);
  }

  private clampScale(value: number): number {
    return Math.max(this.VISUAL_SCALE_MIN, Math.min(this.VISUAL_SCALE_MAX, value));
  }

  private clampTextSize(value: number): number {
    return Math.max(this.TEXT_SIZE_MIN, Math.min(this.TEXT_SIZE_MAX, value));
  }

  private normalizeRotation(value: number): number {
    return ((value % 360) + 360) % 360;
  }

  private snapAxis(value: number): number {
    if (!this.snapEnabled) return value;
    return Math.round(value / this.SNAP_GRID_SIZE) * this.SNAP_GRID_SIZE;
  }

  private drawSnapGridOverlay(): void {
    if (!this.snapEnabled) return;
    const ctx = this.previewCanvas.getContext('2d');
    if (!ctx) return;

    const size = this.SNAP_GRID_SIZE;
    const borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#666666';
    const width = this.previewCanvas.width;
    const height = this.previewCanvas.height;

    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let x = 0.5; x <= width; x += size) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0.5; y <= height; y += size) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }

    ctx.stroke();
    ctx.restore();
  }

  private async normalizeSimilarSlots(): Promise<void> {
    const activeIndex = state.activeSlotIndex;
    const activeSlot = state.slots[activeIndex];
    if (!activeSlot || activeSlot.type === 'text' || !activeSlot.spriteUrl) return;

    interface Normalizable {
      index: number;
      ratio: number;
      visibleMaxDim: number;
      worldSize: number;
    }

    const candidates: Normalizable[] = [];

    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i];
      if (slot.type === 'text' || !slot.spriteUrl) continue;

      const gifIdx = slot.isAnimated && slot.gifFrames ? (slot._gifFrameIdx ?? 0) : undefined;
      const rendered = await renderSlot(slot, gifIdx);
      if (!rendered || rendered.width <= 0 || rendered.height <= 0) continue;

      const hb = scanContentBounds(rendered);
      const width = hb ? Math.max(1, hb.hw * 2) : rendered.width;
      const height = hb ? Math.max(1, hb.hv * 2) : rendered.height;
      if (width <= 0 || height <= 0) continue;

      const ratio = width / height;
      const visibleMaxDim = Math.max(width, height);
      const worldSize = visibleMaxDim * slot.scale;
      candidates.push({ index: i, ratio, visibleMaxDim, worldSize });
    }

    const active = candidates.find(c => c.index === activeIndex);
    if (!active) return;

    const matched = candidates.filter(c => Math.abs(Math.log(c.ratio / active.ratio)) <= this.NORMALIZE_RATIO_TOLERANCE_LOG);
    if (matched.length < 2) return;

    const sortedWorldSizes = matched.map(c => c.worldSize).sort((a, b) => a - b);
    const mid = Math.floor(sortedWorldSizes.length / 2);
    const targetWorldSize = sortedWorldSizes.length % 2 === 0
      ? (sortedWorldSizes[mid - 1] + sortedWorldSizes[mid]) / 2
      : sortedWorldSizes[mid];

    beginBatchUpdate();
    for (const item of matched) {
      state.slots[item.index].scale = this.clampScale(targetWorldSize / item.visibleMaxDim);
    }
    bus.emit(Events.SLOT_CHANGED, null);
    bus.emit(Events.RENDER_REQUEST, null);
  }

  /** Snapshot the active slot's data into the clipboard. */
  private copyActiveSlot(): void {
    const slot = getActiveSlot();
    if (!slot.spriteUrl && slot.type !== 'text' && slot.type !== 'cosmetic') return;
    // Keep gifFrames by reference (canvas elements are reused read-only).
    this.copiedSlot = {
      type:          slot.type,
      spriteKey:     slot.spriteKey,
      spriteUrl:     slot.spriteUrl,
      mutations:     [...slot.mutations],
      options:       { ...slot.options },
      customTint:    { ...slot.customTint },
      position:      { ...slot.position },
      scale:         slot.scale,
      rotation:      slot.rotation,
      visible:       slot.visible,
      gifFrames:     slot.gifFrames,
      isAnimated:    slot.isAnimated,
      fullCardData:  slot.fullCardData  ? { ...slot.fullCardData }  : undefined,
      textData:      slot.textData      ? { ...slot.textData }      : undefined,
      cosmeticLayers:slot.cosmeticLayers? { ...slot.cosmeticLayers }: undefined,
    };
  }

  /** Paste the clipboard slot into the selected layer (or offset from it), with a slight position offset. */
  private pasteCopiedSlot(offsetFromSelection = 0): void {
    if (!this.copiedSlot) return;
    const targetIdx = this.resolveTargetSlotIndex(offsetFromSelection);
    if (targetIdx < 0) return;
    updateSlot(targetIdx, {
      ...this.copiedSlot,
      position: {
        x: (this.copiedSlot.position?.x ?? 0) + 20,
        y: (this.copiedSlot.position?.y ?? 0) + 20,
      },
    });
    setActiveSlot(targetIdx);
  }

  /** Copy active slot then immediately paste it (Ctrl+D). */
  private duplicateActiveSlot(): void {
    this.copyActiveSlot();
    this.pasteCopiedSlot(1);
  }

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
            const ctx2d = rendered.getContext('2d', { willReadFrequently: true });
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
      const hitWasSelected = this.isSlotSelected(hitIdx);
      if (!hitWasSelected) this.clearMultiSelection();
      if (hitIdx !== state.activeSlotIndex) setActiveSlot(hitIdx);

      const dragIndexes = hitWasSelected ? this.getEffectiveSelectionIndexes() : [hitIdx];
      if (dragIndexes.length === 0) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      this.groupDragIndexes = dragIndexes;
      this.groupDragStartPos.clear();
      for (const index of dragIndexes) {
        const slot = state.slots[index];
        if (!slot) continue;
        this.groupDragStartPos.set(index, { x: slot.position.x, y: slot.position.y });
      }
      const activeStart = this.groupDragStartPos.get(state.activeSlotIndex);
      if (activeStart) {
        slotStartX = activeStart.x;
        slotStartY = activeStart.y;
      }
      this.previewCanvas.classList.add('dragging');
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const rect = this.previewCanvas.getBoundingClientRect();
      const cssScale = rect.width / this.previewCanvas.width;
      const dx = (e.clientX - startX) / cssScale;
      const dy = (e.clientY - startY) / cssScale;
      for (const index of this.groupDragIndexes) {
        const slot = state.slots[index];
        const startPos = this.groupDragStartPos.get(index);
        if (!slot || !startPos) continue;
        slot.position.x = this.snapAxis(startPos.x + dx);
        slot.position.y = this.snapAxis(startPos.y + dy);
      }
      this.render();
    });

    window.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        this.groupDragIndexes = [];
        this.groupDragStartPos.clear();
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
        slot.position.x = this.snapAxis(slotStartX + (touch.clientX - startX) / cssScale);
        slot.position.y = this.snapAxis(slotStartY + (touch.clientY - startY) / cssScale);
        this.render();
      } else if (e.touches.length === 2) {
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dx = t1.clientX - t0.clientX;
        const dy = t1.clientY - t0.clientY;
        const slot = getActiveSlot();

        // Pinch → scale (clamped to slider range)
        const dist = Math.hypot(dx, dy);
        slot.scale = this.clampScale(pinchStartScale * (dist / pinchStartDist));
        this.scaleInput.value = slot.scale.toFixed(3);

        // Twist → rotation
        const angle = Math.atan2(dy, dx);
        slot.rotation = this.normalizeRotation(pinchStartRotation + (angle - pinchStartAngle) * (180 / Math.PI));
        this.rotationInput.value = slot.rotation.toFixed(1);

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
      const FULL = this.renderSize;
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

    const animatedFramesBySlot = new Map<Slot, { canvas: HTMLCanvasElement; delay: number }[]>();
    let primaryFrames: { canvas: HTMLCanvasElement; delay: number }[] = [];
    for (const slot of state.slots) {
      if (!slot.visible || !slot.isAnimated || !slot.gifFrames || slot.gifFrames.length === 0) continue;
      const validFrames = slot.gifFrames.filter((frame): frame is { canvas: HTMLCanvasElement; delay: number } => {
        return !!frame
          && frame.canvas instanceof HTMLCanvasElement
          && frame.canvas.width > 0
          && frame.canvas.height > 0;
      });
      if (validFrames.length === 0) continue;
      animatedFramesBySlot.set(slot, validFrames);
      if (validFrames.length > primaryFrames.length) {
        primaryFrames = validFrames;
      }
    }

    if (primaryFrames.length === 0) {
      this.downloadProgress.textContent = '';
      this.downloadBtn.disabled = false;
      return;
    }

      // Composite is built at the selected square render size, then cropped to bounds with padding.
      // If the result is larger than EXPORT_MAX, it is scaled down preserving aspect.
      const FULL = this.renderSize;
      const EXPORT_MAX = 512;
      const SAFE_PAD = 24;

    // Pre-render all static (non-animated) slots once before the frame loop.
    // Even though renderSlot caches its output, calling it N times per static slot
    // inside the loop adds N async yields and N cache-key computations per slot.
    this.downloadProgress.textContent = 'Preparing static layers...';
      const staticCanvases = new Map<Slot, HTMLCanvasElement>();
      for (const slot of state.slots) {
      if (!slot.visible || !slot.spriteUrl) continue;
      if (animatedFramesBySlot.has(slot)) continue;
        const rendered = await renderSlot(slot);
        if (rendered) staticCanvases.set(slot, rendered);
      }

      // Precompute bounds from slot sizes (use max frame size for animated slots)
      const sizeMap = new Map<Slot, { w: number; h: number }>();
      for (const slot of state.slots) {
        if (!slot.visible || !slot.spriteUrl) continue;
        const animFrames = animatedFramesBySlot.get(slot);
        if (animFrames && animFrames.length > 0) {
          let maxW = 0;
          let maxH = 0;
          for (const f of animFrames) {
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

          const animFrames = animatedFramesBySlot.get(slot);
          if (animFrames && animFrames.length > 0) {
          const fi = i % animFrames.length;
          const src = animFrames[fi].canvas;
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
        const frameDelay = Number.isFinite(primaryFrames[i]?.delay) ? primaryFrames[i].delay : this.DEFAULT_ANIM_FRAME_DELAY;
        renderedFrames.push({ canvas: frameOut, delay: frameDelay });
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
    const FRAME_DELAY = this.DEFAULT_ANIM_FRAME_DELAY; // ms ~10fps; sprite-data carries no timing metadata
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

  private frameHasVisibleAlpha(canvas: HTMLCanvasElement): boolean {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    try {
      const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < alpha.length; i += 4) {
        if (alpha[i] > 10) return true;
      }
      return false;
    } catch {
      // If inspection fails (e.g. tainted canvas), keep the frame.
      return true;
    }
  }

  private async loadSheetAnimation(
    slotIndex: number,
    spriteKey: string,
    sheetUrl: string,
    sheetAnim: NonNullable<DropdownItem['sheetAnim']>,
  ): Promise<void> {
    const direction = sheetAnim.direction ?? 'x';
    const frameStep = Math.max(1, Math.floor(sheetAnim.frameWidth));
    const requestedFrames = Math.max(1, Math.floor(sheetAnim.frameCount));
    const frameDelay = Math.max(20, Math.floor(sheetAnim.frameDelay ?? this.DEFAULT_ANIM_FRAME_DELAY));

    try {
      const sheet = await spriteLoader.load(sheetUrl);
      const maxFrames = direction === 'x'
        ? Math.max(1, Math.floor(sheet.naturalWidth / frameStep))
        : Math.max(1, Math.floor(sheet.naturalHeight / frameStep));
      const totalFrames = Math.min(requestedFrames, maxFrames);
      const gifFrames: Array<{ canvas: HTMLCanvasElement; delay: number }> = [];

      for (let i = 0; i < totalFrames; i++) {
        const sx = direction === 'x' ? i * frameStep : 0;
        const sy = direction === 'y' ? i * frameStep : 0;
        const sw = direction === 'x' ? Math.min(frameStep, sheet.naturalWidth - sx) : sheet.naturalWidth;
        const sh = direction === 'y' ? Math.min(frameStep, sheet.naturalHeight - sy) : sheet.naturalHeight;
        if (sw <= 0 || sh <= 0) break;

        const frameCanvas = document.createElement('canvas');
        frameCanvas.width = sw;
        frameCanvas.height = sh;
        const ctx = frameCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(sheet, sx, sy, sw, sh, 0, 0, sw, sh);

        // Skip fully transparent frames so weather strips don't include blank tail columns.
        if (this.frameHasVisibleAlpha(frameCanvas)) {
          gifFrames.push({ canvas: frameCanvas, delay: frameDelay });
        }
      }

      if (gifFrames.length === 0) {
        const fallbackCanvas = document.createElement('canvas');
        fallbackCanvas.width = direction === 'x' ? Math.min(frameStep, sheet.naturalWidth) : sheet.naturalWidth;
        fallbackCanvas.height = direction === 'y' ? Math.min(frameStep, sheet.naturalHeight) : sheet.naturalHeight;
        const fallbackCtx = fallbackCanvas.getContext('2d');
        if (fallbackCtx) {
          fallbackCtx.drawImage(sheet, 0, 0, fallbackCanvas.width, fallbackCanvas.height, 0, 0, fallbackCanvas.width, fallbackCanvas.height);
          gifFrames.push({ canvas: fallbackCanvas, delay: frameDelay });
        }
      }

      // Guard: abort if the user already switched to a different sprite
      if (state.slots[slotIndex].spriteKey !== spriteKey) return;

      updateSlot(slotIndex, { spriteUrl: sheetUrl, gifFrames, isAnimated: gifFrames.length > 1 });
      if (slotIndex === state.activeSlotIndex) {
        if (gifFrames.length > 1) this.startGifPreview();
        else this.stopGifPreview();
      }
    } catch (err) {
      console.error('[MG] Failed to splice sprite-sheet animation:', err);
    }
  }

  private getWeatherSheetAnimationMeta(slot: Slot): NonNullable<DropdownItem['sheetAnim']> | null {
    if (slot.type === 'text' || slot.type === 'full-card' || slot.type === 'cosmetic') return null;
    if (!slot.spriteUrl || !/\/assets\/sprites\/weather\//i.test(slot.spriteUrl)) return null;

    const keyName = slot.spriteKey.split('/').pop() ?? '';
    const urlName = slot.spriteUrl.match(/\/weather\/([^/?]+)\.png/i)?.[1] ?? '';
    const animName = /Animation$/i.test(keyName) ? keyName : urlName;
    if (!/Animation$/i.test(animName)) return null;

    let frameCount = 0;
    const weatherCat = state.spriteData?.categories.find(c => c.cat === 'weather');
    const entry = weatherCat?.items.find(i =>
      i.type === 'frame' && (
        i.id === slot.spriteKey
        || (i.id.split('/').pop() ?? '') === animName
      ),
    );
    if (entry?.type === 'frame') {
      frameCount = Math.max(1, Math.floor(entry.frame.w / this.WEATHER_STRIP_FRAME_WIDTH));
    }
    if (frameCount <= 1) frameCount = 9;

    return {
      direction: 'x',
      frameWidth: this.WEATHER_STRIP_FRAME_WIDTH,
      frameCount,
      frameDelay: this.DEFAULT_ANIM_FRAME_DELAY,
    };
  }

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

      const weatherSheetAnim = this.getWeatherSheetAnimationMeta(slot);
      if (weatherSheetAnim) {
        return this.loadSheetAnimation(idx, slot.spriteKey, slot.spriteUrl, weatherSheetAnim);
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
        this.clearMultiSelection();
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

  private makeCheckLabel(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = el('label', {}, []) as HTMLLabelElement;
    label.append(input, ` ${text}`);
    return label;
  }
}
