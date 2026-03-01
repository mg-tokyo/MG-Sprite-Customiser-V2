import type { Slot } from '../state/store';
import { state } from '../state/store';

// Set window.__MG_DEBUG_RENDER = true in the browser console to enable positioning logs.
declare global { interface Window { __MG_DEBUG_RENDER?: boolean; } }
import { spriteLoader } from '../api/sprite-loader';
import { spriteToCanvas, applyMutations } from './mutation-engine';
import { renderCache, RenderCache } from './render-cache';
import { MUTATION_META, FILTERS } from './mutation-defs';
import { resolveActiveMutations } from './mutation-defs';
import {
  computeIconLayout,
  findIconKey,
  getIconAnchor,
  isTallKey,
} from './icon-layout';
import type { SpriteFrame } from '../api/types';

/**
 * Render a single slot to a canvas, applying mutations, icons, and overlays.
 */
export async function renderSlot(slot: Slot, gifFrameIndex?: number): Promise<HTMLCanvasElement | null> {
  if (!slot.spriteUrl) return null;
  // Text and full-card layers render from gifFrames only.
  // Skip icons/overlays/anchor logic — go straight to the gifFrames path.
  if (slot.type === 'text' || slot.type === 'full-card' || slot.spriteUrl === 'pet-bar:') {
    if (!slot.gifFrames || slot.gifFrames.length === 0) return null;
    const fi = slot.isAnimated && slot.gifFrames.length > 1
      ? Math.max(0, Math.min(gifFrameIndex ?? 0, slot.gifFrames.length - 1))
      : 0;
    const src = slot.gifFrames[fi].canvas;
    if (!(src instanceof HTMLCanvasElement) || src.width === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext('2d')!.drawImage(src, 0, 0);
    applyMutations(canvas, slot.mutations, false, slot.customTint);
    return canvas;
  }

  // Blobling rig (cosmetic slot pre-rendered to gifFrames).
  // The spriteUrl sentinel 'blobling:' cannot be fetched — always use gifFrames.
  if (slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:') {
    if (!slot.gifFrames || slot.gifFrames.length === 0) return null;
    const fi = Math.max(0, Math.min(gifFrameIndex ?? 0, slot.gifFrames.length - 1));
    const src = slot.gifFrames[fi].canvas;
    if (!(src instanceof HTMLCanvasElement) || src.width === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext('2d')!.drawImage(src, 0, 0);
    applyMutations(canvas, slot.mutations, false, slot.customTint);
    return canvas;
  }

  // For animated GIFs, use the specific frame
  const frameIdx = slot.isAnimated && slot.gifFrames ? (gifFrameIndex ?? 0) : -1;

  const cacheKey = RenderCache.makeKey(
    slot.spriteUrl,
    slot.mutations,
    slot.options,
    slot.scale,
    slot.rotation,
  ) + `|${slot.customTint.color}:${slot.customTint.opacity}|f${frameIdx}`;

  const cached = renderCache.get(cacheKey);
  if (cached) return cached;

  let canvas: HTMLCanvasElement;
  if (slot.isAnimated && slot.gifFrames && slot.gifFrames.length > 0) {
    const fi = Math.max(0, Math.min(frameIdx, slot.gifFrames.length - 1));
    const src = slot.gifFrames[fi].canvas;
    // Guard: after JSON undo/redo serialisation the canvas becomes a plain object.
    // Fall back to spriteUrl so a stale undo/redo entry degrades gracefully instead of crashing.
    if (src instanceof HTMLCanvasElement && src.width > 0 && src.height > 0) {
      canvas = document.createElement('canvas');
      canvas.width = src.width;
      canvas.height = src.height;
      canvas.getContext('2d')!.drawImage(src, 0, 0);
    } else {
      const img = await spriteLoader.load(slot.spriteUrl);
      canvas = spriteToCanvas(img);
    }
  } else {
    const img = await spriteLoader.load(slot.spriteUrl);
    canvas = spriteToCanvas(img);
  }

  // Detect tall plants before applying mutations — isTall affects Rainbow gradient angle
  const tall = isTallKey(slot.spriteKey);

  // Apply mutations + custom tint. Pass tall so Rainbow uses angTall (0°) on tall plants.
  // (Text slots return early above, so customTint here is always a sprite tint overlay.)
  applyMutations(canvas, slot.mutations, tall, slot.customTint);

  const origW = canvas.width;
  const origH = canvas.height;

  // Read the real anchor from sprite-data (defaults to 0.5 if not present).
  // Tall plant anchors are often non-centered — this is critical for overlay positioning.
  const spriteAnchor = getSpriteFrameAnchor(slot.spriteKey);
  const spriteAnchorX = spriteAnchor.x;
  const spriteAnchorY = spriteAnchor.y;

  // ── Unified icon + overlay rendering ──
  // Z-order (matches old customiser exactly):
  //   z = -1  tall plant icons (Puddle, ThunderstruckGround, etc.) — BEHIND sprite
  //   z =  0  base sprite (drawn implicitly)
  //   z =  2  regular plant icons — in FRONT of sprite
  //   z =  3  tall plant texture overlays (WetTallPlant etc.) — ON TOP, masked to silhouette
  //   z = 10  floating icons (Dawnlit/Ambershine etc.) — always topmost
  if (slot.options.icons || (tall && slot.options.overlays)) {
    interface DrawOp {
      img: HTMLCanvasElement | HTMLImageElement;
      x: number; y: number; w: number; h: number; z: number;
    }
    const ops: DrawOp[] = [];

    // ── Mutation icons ──
    if (slot.options.icons) {
      for (const mutId of resolveActiveMutations(slot.mutations)) {
        const meta = MUTATION_META[mutId];
        if (!meta) continue;

        // Tall plants with a texture overlay use the overlay instead of regular icons.
        // Skip icon rendering unless there's an explicit behind-icon override (Puddle, ThunderstruckGround).
        if (tall && meta.tallOverlayKey && !meta.tallPlantIconOverride) continue;

        const iconId = findIconKey(slot.spriteKey, mutId, tall, meta);
        if (!iconId) continue;

        const iconUrl = findSpriteUrl(iconId);
        if (!iconUrl) continue;

        const layout = computeIconLayout(origW, origH, spriteAnchorX, spriteAnchorY, slot.spriteKey, tall);
        const pivotX = layout.anchorX * layout.width;
        const pivotY = layout.anchorY * layout.height;

        try {
          const iconImg = await spriteLoader.load(iconUrl);
          const iconAnchor = getIconAnchor(iconId);
          const scaledW = iconImg.naturalWidth * layout.iconScale;
          const scaledH = iconImg.naturalHeight * layout.iconScale;
          const drawX = pivotX + layout.offset.x - iconAnchor.x * scaledW;
          const drawY = pivotY + layout.offset.y - iconAnchor.y * scaledH;
          // Floating icons always topmost; tall plant icons render behind the sprite
          const z = meta.floatingIcon ? 10 : (tall ? -1 : 2);
          ops.push({ img: iconImg, x: drawX, y: drawY, w: scaledW, h: scaledH, z });
        } catch {
          // Icon not available, skip
        }
      }
    }

    // ── Tall plant texture overlays (Wet/Chilled/Frozen/Thunderstruck) ──
    // Each overlay is masked to the sprite's silhouette via destination-in,
    // then composited ON TOP of the tinted base (z=3).
    // Positioning from game source (SpriteRenderingUtils.ts):
    //   posX = spriteAnchorX * (spriteW - overlayW)  — anchor X of overlay = anchor X of sprite
    //   posY = 0                                       — overlay starts at TOP of sprite
    // The overlay PNG's own content determines where the effect appears visually.
    if (tall && slot.options.overlays) {
      if (window.__MG_DEBUG_RENDER) {
        console.group(`[MG] Tall overlay debug — spriteKey="${slot.spriteKey}"`);
        console.log('sprite dimensions:', { origW, origH });
        console.log('sprite anchor (from sprite-data):', { spriteAnchorX, spriteAnchorY });
      }
      for (const mutId of resolveActiveMutations(slot.mutations)) {
        const meta = MUTATION_META[mutId];
        if (!meta?.tallOverlayKey) continue;

        const overlayUrl = findSpriteUrl(meta.tallOverlayKey);
        if (window.__MG_DEBUG_RENDER) {
          console.log(`mutation "${mutId}": tallOverlayKey="${meta.tallOverlayKey}", url=${overlayUrl ?? 'NOT FOUND'}`);
        }
        if (!overlayUrl) continue;

        try {
          const overlayImg = await spriteLoader.load(overlayUrl);
          const ow = overlayImg.naturalWidth;
          const oh = overlayImg.naturalHeight;
          // Two-case overlay positioning:
          //
          // A) Tinted mutations (Wet, Chilled, Frozen — FILTERS[mutId].a > 0):
          //    The colour tint already covers the full sprite, so the overlay only adds
          //    texture detail. Use top-anchor (posY=0) at natural size — no scaling needed.
          //    The API serves trimmed PNGs (~600-650px) for these; scaling them would
          //    distort the ice/water texture and misplace it on the plant.
          //
          // B) Untinted mutations (Thunderstruck — FILTERS[mutId].a === 0):
          //    No tint to hide gaps, so the overlay must cover the plant directly.
          //    Scale to 90% of sprite height and use bottom-anchor formula to fill
          //    from ~14% down to the sprite bottom with a 1.125× scale-up.
          const hasTint = (FILTERS[mutId]?.a ?? 0) > 0;
          let drawH: number, drawW: number, posX: number, posY: number;
          if (hasTint) {
            // Top-anchor, natural size — tint covers the rest
            drawH = oh;
            drawW = ow;
            posX = spriteAnchorX * origW - drawW * 0.5;
            posY = 0;
          } else {
            // Bottom-anchor + scale — must cover the plant without a tint
            drawH = Math.round(origH * 0.9);
            const overlayScale = drawH / oh;
            drawW = Math.round(ow * overlayScale);
            posX = spriteAnchorX * origW - drawW * 0.5;
            posY = spriteAnchorY * origH - drawH + 100;
          }

          if (window.__MG_DEBUG_RENDER) {
            console.log(`  overlay loaded: ${ow}×${oh}, drawn at ${drawW}×${drawH} (×${(drawH/oh).toFixed(3)}) hasTint=${hasTint}`);
            console.log(`  posX=${posX.toFixed(1)} posY=${posY.toFixed(1)}`);
            console.log(`  overlay covers sprite y=${posY.toFixed(1)} → ${(posY + drawH).toFixed(1)} (clipped to ${origH})`);
          }

          // Create a canvas containing only the pixels where overlay and sprite overlap.
          // destination-in keeps pixels from the overlay where the sprite is non-transparent.
          // The sprite is drawn at (-posX, -posY) so that the overlap region is captured
          // correctly inside the drawW×drawH masked canvas.
          const masked = document.createElement('canvas');
          masked.width = drawW;
          masked.height = drawH;
          const mctx = masked.getContext('2d')!;
          mctx.imageSmoothingEnabled = false;
          mctx.drawImage(overlayImg, 0, 0, drawW, drawH);
          mctx.globalCompositeOperation = 'destination-in';
          mctx.drawImage(canvas, -posX, -posY);

          ops.push({ img: masked, x: posX, y: posY, w: drawW, h: drawH, z: 3 });
        } catch (err) {
          if (window.__MG_DEBUG_RENDER) console.warn('  overlay load FAILED:', err);
        }
      }
      if (window.__MG_DEBUG_RENDER) console.groupEnd();
    }

    if (ops.length > 0) {
      // ── Compute bounding box and symmetric padding ──
      // Symmetric padding keeps canvas centre == sprite centre so renderAll's
      // drawImage(canvas, -W/2, -H/2) centering remains correct.
      let minX = 0, minY = 0, maxX = origW, maxY = origH;
      for (const op of ops) {
        minX = Math.min(minX, op.x);
        minY = Math.min(minY, op.y);
        maxX = Math.max(maxX, op.x + op.w);
        maxY = Math.max(maxY, op.y + op.h);
      }
      const padH = Math.max(Math.max(0, Math.ceil(-minX)), Math.max(0, Math.ceil(maxX - origW)));
      const padV = Math.max(Math.max(0, Math.ceil(-minY)), Math.max(0, Math.ceil(maxY - origH)));

      if (window.__MG_DEBUG_RENDER) {
        console.log(`[MG] Bounding box: minX=${minX} minY=${minY} maxX=${maxX} maxY=${maxY}`);
        console.log(`[MG] Padding: padH=${padH} padV=${padV}`);
        console.log(`[MG] Output canvas: ${origW + padH * 2}×${origH + padV * 2} (sprite was ${origW}×${origH})`);
        console.log('[MG] DrawOps (sorted by z):', [...ops].sort((a,b)=>a.z-b.z).map(o => `z=${o.z} x=${Math.round(o.x)} y=${Math.round(o.y)} w=${Math.round(o.w)} h=${Math.round(o.h)}`));
      }

      // Build output canvas (padded so nothing is clipped)
      const outCanvas = document.createElement('canvas');
      outCanvas.width  = origW + padH * 2;
      outCanvas.height = origH + padV * 2;
      const outCtx = outCanvas.getContext('2d')!;
      outCtx.imageSmoothingEnabled = false;

      const sorted = [...ops].sort((a, b) => a.z - b.z);

      // Draw ops with z < 0 first (behind sprite)
      for (const op of sorted) {
        if (op.z >= 0) break;
        outCtx.drawImage(op.img, op.x + padH, op.y + padV, op.w, op.h);
      }
      // Draw base sprite
      outCtx.drawImage(canvas, padH, padV);
      // Draw ops with z >= 0 on top of sprite (overlays, front icons, floating icons)
      for (const op of sorted) {
        if (op.z < 0) continue;
        outCtx.drawImage(op.img, op.x + padH, op.y + padV, op.w, op.h);
      }

      canvas = outCanvas;
    }
  }

  // Render cosmetic layers
  if (slot.type === 'cosmetic' && slot.cosmeticLayers) {
    const ctx = canvas.getContext('2d')!;
    const layerOrder = ['Default', 'Bottom', 'Mid', 'Top', 'Expression', 'FaceProp', 'Status', 'Banner'];
    for (const category of layerOrder) {
      const cosmeticId = slot.cosmeticLayers[category];
      if (!cosmeticId) continue;

      const cosmeticsData = state.cosmeticsData;
      if (!cosmeticsData) continue;

      const cat = cosmeticsData.categories.find(c => c.cat === category);
      const item = cat?.items.find(i => i.id === cosmeticId);
      if (!item?.url) continue;

      try {
        const layerImg = await spriteLoader.load(item.url);
        ctx.drawImage(layerImg, 0, 0, canvas.width, canvas.height);
      } catch {
        // Cosmetic layer not available, skip
      }
    }
  }

  renderCache.set(cacheKey, canvas);
  return canvas;
}

/**
 * Render all visible slots composited onto the output canvas.
 */
export async function renderAll(output: HTMLCanvasElement): Promise<void> {
  const ctx = output.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, output.width, output.height);

  for (const slot of state.slots) {
    if (!slot.visible) continue;
    if (slot.type === 'text' || slot.type === 'full-card' || slot.spriteUrl === 'pet-bar:' ||
        (slot.type === 'cosmetic' && slot.spriteUrl === 'blobling:')) {
      // These slot types render from gifFrames only — skip if not ready
      if (!slot.gifFrames || slot.gifFrames.length === 0) continue;
    } else {
      if (!slot.spriteUrl) continue;
    }

    const gifIdx = slot.isAnimated && slot.gifFrames ? (slot._gifFrameIdx ?? 0) : undefined;
    const rendered = await renderSlot(slot, gifIdx);
    if (!rendered) continue;

    const scale = slot.type === 'text' ? 1 : slot.scale;
    ctx.save();
    ctx.translate(
      output.width / 2 + slot.position.x,
      output.height / 2 + slot.position.y,
    );
    ctx.rotate((slot.rotation * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.drawImage(rendered, -rendered.width / 2, -rendered.height / 2);
    ctx.restore();
  }
}

/**
 * Find a sprite's individual PNG URL from the sprite data, by its id.
 */
function findSpriteUrl(spriteId: string): string | null {
  const spriteData = state.spriteData;
  if (!spriteData) return null;

  for (const cat of spriteData.categories) {
    for (const item of cat.items) {
      if (item.id === spriteId && item.type === 'frame') {
        const name = spriteId.split('/').pop();
        if (name) {
          const vMatch = (item as SpriteFrame).url.match(/[?&]v=([a-f0-9]+)/i)
            ?? (item as SpriteFrame).url.match(/\/version\/([a-f0-9]+)\//i);
          const version = vMatch?.[1] ?? state.gameVersion ?? '';
          return `https://mg-api.ariedam.fr/assets/sprites/${cat.cat}/${name}.png${version ? `?v=${version}` : ''}`;
        }
      }
    }
  }
  return null;
}

// Anchor values extracted from the old customiser's embedded atlas.
// The live API's sprite-data does not include anchor fields for tall-plant sprites,
// so we hardcode the known values here. All tall plants are bottom-anchored in-game.
const TALL_PLANT_ANCHORS: Record<string, { x: number; y: number }> = {
  'sprite/tall-plant/Bamboo': { x: 0.519573, y: 0.964063 },
  'sprite/tall-plant/Cactus': { x: 0.517937, y: 0.952344 },
};

/**
 * Look up a sprite frame's anchor point.
 * Checks hardcoded tall-plant anchors first, then sprite-data, then defaults.
 * Tall plants without a specific entry use (0.5, 0.96) — all are bottom-anchored.
 */
function getSpriteFrameAnchor(spriteId: string): { x: number; y: number } {
  // Hardcoded tall-plant anchors (API doesn't provide these)
  if (TALL_PLANT_ANCHORS[spriteId]) return TALL_PLANT_ANCHORS[spriteId];

  // Check sprite-data from API
  const sd = state.spriteData;
  if (sd) {
    for (const cat of sd.categories) {
      for (const item of cat.items) {
        if (item.id === spriteId && item.type === 'frame') {
          const frame = item as SpriteFrame;
          if (frame.anchor) return { x: frame.anchor.x, y: frame.anchor.y };
          break;
        }
      }
    }
  }

  // All tall-plant sprites are bottom-anchored — use safe approximation
  if (/tall-?plant/i.test(spriteId)) return { x: 0.5, y: 0.96 };

  return { x: 0.5, y: 0.5 };
}
