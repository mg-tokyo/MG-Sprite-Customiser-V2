/**
 * Renders a TextData config to an HTMLCanvasElement.
 * Handles: word-wrap, alignment, bold/italic, MG textSlapper shadow,
 * stroke/outline, and LingoJam Unicode transformations.
 *
 * The fill colour comes from `fillColor` (slot.customTint.color).
 * Mutations (hue, grayscale, etc.) are applied by canvas-renderer after this
 * returns, just like any other slot canvas.
 */
import type { TextData } from '../state/store';
import { ensureFontLoaded, applyUnicodeStyle, MG_FONTS, GOOGLE_FONTS_CURATED } from './font-data';

/** Extra canvas padding (px) on each side to prevent shadow/stroke clipping. */
const EDGE_PAD = 12;

/**
 * Split text into wrapped lines respecting the canvas context's current font.
 * Returns a single-element array if wordWrap is disabled.
 */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') { lines.push(''); continue; }
    const words = paragraph.split(' ');
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        // If a single word is wider than maxWidth, push it as-is (no infinite loop)
        current = word;
      }
    }
    if (current) lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}

/** Compute the x position for a line given alignment and canvas width. */
function alignX(align: TextData['align'], canvasWidth: number, pad: number): number {
  if (align === 'center') return canvasWidth / 2;
  if (align === 'right')  return canvasWidth - pad;
  return pad; // left
}

/** Canvas textAlign value from TextData align. */
function ctxAlign(align: TextData['align']): CanvasTextAlign {
  return align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
}

/**
 * Render TextData to a fresh canvas. `fillColor` should be slot.customTint.color.
 * Awaits font loading before drawing so the correct glyphs are used.
 */
export async function renderTextToCanvas(
  textData: TextData,
  fillColor: string,
): Promise<HTMLCanvasElement> {
  // ── 1. Load font if needed ──────────────────────────────────────────────────
  const allFonts = [...MG_FONTS, ...GOOGLE_FONTS_CURATED];
  const fontDef = allFonts.find(f =>
    f.family === textData.fontFamily &&
    (f.weight === textData.fontWeight || (!textData.fontWeight)),
  );
  if (fontDef?.needsLoad) await ensureFontLoaded(fontDef);

  // ── 2. Apply Unicode transformation if any ─────────────────────────────────
  const rawText = textData.content || ' ';
  const displayText = textData.unicodeStyle
    ? applyUnicodeStyle(rawText, textData.unicodeStyle)
    : rawText;

  // ── 3. Build CSS font string ───────────────────────────────────────────────
  const italic   = (textData.italic  || textData.fontStyle === 'italic')  ? 'italic '  : '';
  const boldW    = textData.bold ? '700' : textData.fontWeight;
  const cssFontSize = `${textData.fontSize}px`;
  const cssFont = `${italic}${boldW} ${cssFontSize} "${textData.fontFamily}", sans-serif`;

  // ── 4. Measure on a scratch canvas ─────────────────────────────────────────
  const scratch = document.createElement('canvas');
  scratch.width = 1;
  scratch.height = 1;
  const sctx = scratch.getContext('2d')!;
  sctx.font = cssFont;

  const maxWrap = textData.wordWrap ? textData.wordWrapWidth : Infinity;
  const lines = wrapLines(sctx, displayText, maxWrap);

  const metrics = sctx.measureText('M');
  const capHeight  = metrics.actualBoundingBoxAscent ?? textData.fontSize * 0.75;
  const lineHeight = textData.fontSize * 1.3;
  const totalTextH = lines.length * lineHeight;

  const maxLineW = lines.reduce((max, line) => {
    const w = sctx.measureText(line).width;
    return w > max ? w : max;
  }, 0);

  // ── 5. Compute canvas dimensions ───────────────────────────────────────────
  const strokePad = textData.strokeEnabled ? textData.strokeWidth + 2 : 0;
  // MG textSlapper shadow: offset -3px X, +5px Y, 0 blur → extend right/bottom by shadow bounds
  const shadowPadX = textData.mgShadow ? 8  : 0; // enough room for the -3px leftward shadow
  const shadowPadY = textData.mgShadow ? 10 : 0; // enough room for the +5px downward shadow

  const canvasW = Math.ceil(maxLineW) + (EDGE_PAD + strokePad) * 2 + shadowPadX;
  const canvasH = Math.ceil(totalTextH) + (EDGE_PAD + strokePad) * 2 + shadowPadY;

  const canvas = document.createElement('canvas');
  canvas.width  = Math.max(1, canvasW);
  canvas.height = Math.max(1, canvasH);

  // ── 6. Draw ────────────────────────────────────────────────────────────────
  const ctx = canvas.getContext('2d')!;
  ctx.font = cssFont;
  ctx.textAlign = ctxAlign(textData.align);
  ctx.textBaseline = 'top';

  // Shadow
  if (textData.mgShadow) {
    ctx.shadowOffsetX = -3;
    ctx.shadowOffsetY =  5;
    ctx.shadowBlur    =  0;
    ctx.shadowColor   = 'rgba(0,0,0,0.25)';
  }

  const drawPad = EDGE_PAD + strokePad;
  const xPos = alignX(textData.align, canvas.width - shadowPadX, drawPad);
  // Vertically center the text block in the canvas (excluding shadow pad at bottom)
  const yStart = drawPad + Math.max(0, (canvas.height - shadowPadY - totalTextH - drawPad * 2) / 2);

  // Stroke pass (drawn underneath fill)
  if (textData.strokeEnabled && textData.strokeWidth > 0) {
    ctx.strokeStyle = textData.strokeColor;
    ctx.lineWidth   = textData.strokeWidth * 2;
    ctx.lineJoin    = 'round';
    for (let i = 0; i < lines.length; i++) {
      ctx.strokeText(lines[i], xPos, yStart + i * lineHeight);
    }
  }

  // Fill pass
  ctx.fillStyle = fillColor;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], xPos, yStart + i * lineHeight);
  }

  void capHeight; // used for future descender-aware positioning
  return canvas;
}

/** Default TextData for a newly created text slot. */
export function defaultTextData(): TextData {
  return {
    content: '',
    fontFamily: 'Shrikhand',
    fontLabel: 'textSlapper ★',
    fontWeight: '400',
    fontStyle: 'normal',
    fontSize: 60,
    align: 'center',
    wordWrap: false,
    wordWrapWidth: 400,
    bold: false,
    italic: false,
    mgShadow: true,
    strokeEnabled: false,
    strokeColor: '#000000',
    strokeWidth: 3,
    unicodeStyle: undefined,
    gfFamily: 'Shrikhand',
  };
}
