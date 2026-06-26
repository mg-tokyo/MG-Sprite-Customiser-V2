export type ExportSizeMode = 'preset' | 'match' | 'custom';

export const EXPORT_SIZE_PRESETS = [512, 1024, 2048, 4096] as const;
export const EXPORT_MIN_DIM = 16;
export const EXPORT_MAX_DIM = 4096;

export interface ExportSettings {
  sizeMode: ExportSizeMode;
  sizePreset: number;
  customW: number;
  customH: number;
  autoFit: boolean;
}

export const exportSettings: ExportSettings = {
  sizeMode: 'preset',
  sizePreset: 1024,
  customW: 1024,
  customH: 1024,
  autoFit: true,
};

export function clampExportDim(v: number): number {
  if (!Number.isFinite(v)) return 1024;
  return Math.max(EXPORT_MIN_DIM, Math.min(EXPORT_MAX_DIM, Math.round(v)));
}

export function applyPersistedExportSettings(parsed: Partial<ExportSettings> | undefined): void {
  if (!parsed || typeof parsed !== 'object') return;
  if (parsed.sizeMode === 'preset' || parsed.sizeMode === 'match' || parsed.sizeMode === 'custom') {
    exportSettings.sizeMode = parsed.sizeMode;
  }
  if (typeof parsed.sizePreset === 'number' && (EXPORT_SIZE_PRESETS as readonly number[]).includes(parsed.sizePreset)) {
    exportSettings.sizePreset = parsed.sizePreset;
  }
  if (typeof parsed.customW === 'number') exportSettings.customW = clampExportDim(parsed.customW);
  if (typeof parsed.customH === 'number') exportSettings.customH = clampExportDim(parsed.customH);
  if (typeof parsed.autoFit === 'boolean') exportSettings.autoFit = parsed.autoFit;
}

export function serializeExportSettings(): ExportSettings {
  return {
    sizeMode: exportSettings.sizeMode,
    sizePreset: exportSettings.sizePreset,
    customW: exportSettings.customW,
    customH: exportSettings.customH,
    autoFit: exportSettings.autoFit,
  };
}

export function getEffectiveExportSize(renderSize: number): { w: number; h: number } {
  if (exportSettings.sizeMode === 'match') return { w: renderSize, h: renderSize };
  if (exportSettings.sizeMode === 'custom') {
    return {
      w: clampExportDim(exportSettings.customW),
      h: clampExportDim(exportSettings.customH),
    };
  }
  return { w: exportSettings.sizePreset, h: exportSettings.sizePreset };
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
  renderSize: number,
): HTMLCanvasElement {
  const target = getEffectiveExportSize(renderSize);

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

/** True if export settings would produce a valid output (used to gate export buttons). */
export function isExportSettingsValid(): boolean {
  if (exportSettings.sizeMode !== 'custom') return true;
  const w = exportSettings.customW;
  const h = exportSettings.customH;
  if (!Number.isInteger(w) || !Number.isInteger(h)) return false;
  if (w < EXPORT_MIN_DIM || w > EXPORT_MAX_DIM) return false;
  if (h < EXPORT_MIN_DIM || h > EXPORT_MAX_DIM) return false;
  return true;
}
