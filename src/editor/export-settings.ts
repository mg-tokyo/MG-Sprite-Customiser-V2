export type SizeMode = 'preset' | 'custom';

export const SIZE_PRESETS = [128, 256, 512, 1024, 2048, 4096] as const;
export const SIZE_MIN_DIM = 16;
export const SIZE_MAX_DIM = 4096;

export interface ExportSettings {
  mode: SizeMode;
  preset: number;
  customW: number;
  customH: number;
  autoFit: boolean;
}

export const exportSettings: ExportSettings = {
  mode: 'preset',
  preset: 1024,
  customW: 1024,
  customH: 1024,
  autoFit: true,
};

export function clampDim(v: number): number {
  if (!Number.isFinite(v)) return 1024;
  return Math.max(SIZE_MIN_DIM, Math.min(SIZE_MAX_DIM, Math.round(v)));
}

function nearestPreset(v: number): number {
  let best = SIZE_PRESETS[0] as number;
  let bestDelta = Math.abs(v - best);
  for (const p of SIZE_PRESETS) {
    const d = Math.abs(v - p);
    if (d < bestDelta) { best = p; bestDelta = d; }
  }
  return best;
}

/**
 * Load persisted settings, migrating older shapes:
 *   - { sizeMode: 'preset' | 'match' | 'custom', sizePreset, ... }   (v1, prior release)
 *   - top-level `renderSize` (the old separate render-size dropdown)
 */
export function applyPersistedExportSettings(
  parsed: Partial<ExportSettings> & {
    sizeMode?: string;
    sizePreset?: number;
  } | undefined,
  legacyRenderSize?: number,
): void {
  if (parsed && typeof parsed === 'object') {
    if (parsed.mode === 'preset' || parsed.mode === 'custom') {
      exportSettings.mode = parsed.mode;
    } else if (parsed.sizeMode === 'preset' || parsed.sizeMode === 'custom') {
      exportSettings.mode = parsed.sizeMode;
    } else if (parsed.sizeMode === 'match' && typeof legacyRenderSize === 'number') {
      exportSettings.mode = 'preset';
      exportSettings.preset = nearestPreset(legacyRenderSize);
    }
    if (typeof parsed.preset === 'number') exportSettings.preset = nearestPreset(parsed.preset);
    else if (typeof parsed.sizePreset === 'number') exportSettings.preset = nearestPreset(parsed.sizePreset);
    if (typeof parsed.customW === 'number') exportSettings.customW = clampDim(parsed.customW);
    if (typeof parsed.customH === 'number') exportSettings.customH = clampDim(parsed.customH);
    if (typeof parsed.autoFit === 'boolean') exportSettings.autoFit = parsed.autoFit;
  } else if (typeof legacyRenderSize === 'number') {
    exportSettings.mode = 'preset';
    exportSettings.preset = nearestPreset(legacyRenderSize);
  }
}

export function serializeExportSettings(): ExportSettings {
  return {
    mode: exportSettings.mode,
    preset: exportSettings.preset,
    customW: exportSettings.customW,
    customH: exportSettings.customH,
    autoFit: exportSettings.autoFit,
  };
}

/** Output dimensions (PNG/GIF). For custom this can be non-square. */
export function getOutputSize(): { w: number; h: number } {
  if (exportSettings.mode === 'custom') {
    return { w: clampDim(exportSettings.customW), h: clampDim(exportSettings.customH) };
  }
  return { w: exportSettings.preset, h: exportSettings.preset };
}

/** Editor/preview canvas dimension. Always square so existing renderAll() math works. */
export function getRenderSize(): number {
  if (exportSettings.mode === 'custom') {
    return clampDim(Math.max(exportSettings.customW, exportSettings.customH));
  }
  return exportSettings.preset;
}

/**
 * Build the final export canvas from a fully-rendered composition source.
 *
 * - autoFit ON: crop to `bounds`, scale to fit the chosen output size preserving aspect.
 *   Output dimensions reflect the scaled content bounds (not the chosen size box exactly).
 * - autoFit OFF: scale the entire source canvas to the chosen output size, letterboxing
 *   when the target aspect doesn't match the source. Output dimensions == chosen size.
 *
 * Smoothing is disabled on upscale to preserve pixel-art sharpness.
 */
export function buildExportCanvas(
  source: HTMLCanvasElement,
  bounds: { x: number; y: number; w: number; h: number },
): HTMLCanvasElement {
  const target = getOutputSize();

  if (exportSettings.autoFit) {
    const scale = Math.min(target.w / bounds.w, target.h / bounds.h);
    const outW = Math.max(1, Math.round(bounds.w * scale));
    const outH = Math.max(1, Math.round(bounds.h * scale));
    const out = document.createElement('canvas');
    out.width = outW;
    out.height = outH;
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, outW, outH);
    return out;
  }

  const scale = Math.min(target.w / source.width, target.h / source.height);
  const drawW = Math.max(1, Math.round(source.width * scale));
  const drawH = Math.max(1, Math.round(source.height * scale));
  const drawX = Math.round((target.w - drawW) / 2);
  const drawY = Math.round((target.h - drawH) / 2);
  const out = document.createElement('canvas');
  out.width = target.w;
  out.height = target.h;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(source, drawX, drawY, drawW, drawH);
  return out;
}

/** True if current settings would produce a valid output. */
export function isExportSettingsValid(): boolean {
  if (exportSettings.mode !== 'custom') return true;
  const w = exportSettings.customW;
  const h = exportSettings.customH;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return false;
  if (w < SIZE_MIN_DIM || w > SIZE_MAX_DIM) return false;
  if (h < SIZE_MIN_DIM || h > SIZE_MAX_DIM) return false;
  return true;
}
