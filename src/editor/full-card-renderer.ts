/**
 * Full card stats renderer.
 * Draws text/bar overlays in-place on an already-composited 500×720 card canvas.
 */
import type { FullCardData, FullCardType, FullCardRarity } from '../state/store';
import { MG_FONTS, ensureFontLoaded } from './font-data';

// ── Color constants (from game source) ───────────────────────────────────────

const RARITY_BG: Record<FullCardRarity, string> = {
  Common:    '#D2D2D2',
  Uncommon:  '#5EAC46',
  Rare:      '#0067B4',
  Legendary: '#E9B52F',
  Mythic:    '#8B3E98',
  Divine:    '#FC6D30',
  Celestial: '#7C2AE8',
};

const RARITY_FG: Record<FullCardRarity, string> = {
  Common:    '#201D1D',
  Uncommon:  '#ffffff',
  Rare:      '#ffffff',
  Legendary: '#201D1D',
  Mythic:    '#ffffff',
  Divine:    '#ffffff',
  Celestial: '#ffffff',
};

const HUNGER_COLOR = '#5EAC46';   // Green.Magic
const STR_COLOR    = '#0067B4';   // Blue.Magic
const NEUTRAL_GREY = '#A3A3A3';
const GREYCLIFF    = '"Greycliff CF", sans-serif';

// ── Canvas helpers ────────────────────────────────────────────────────────────

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawProgressBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  progress: number,
  fillColor: string,
): void {
  // Border
  roundedRect(ctx, x, y, w, h, 3);
  ctx.strokeStyle = NEUTRAL_GREY;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Fill — progress = fraction 0..1
  const fillW = Math.max(0, Math.min(progress, 1)) * w;
  if (fillW > 0) {
    roundedRect(ctx, x + 0.5, y + 0.5, fillW - 1, h - 1, 2.5);
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

/**
 * Word-wrap text onto the canvas.
 * Respects ctx.textAlign for positioning.
 * @param maxLines - Maximum lines before truncating with '…'. Default: unlimited.
 * @returns The y position of the last line drawn.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  maxLines = Infinity,
): number {
  const words = text.split(' ');
  let line = '';
  let lineY = y;
  let lineCount = 0;

  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      if (lineCount >= maxLines - 1) {
        ctx.fillText(line + '\u2026', x, lineY);
        return lineY;
      }
      ctx.fillText(line, x, lineY);
      line = word;
      lineY += lineH;
      lineCount++;
    } else {
      line = test;
    }
  }
  if (line && lineCount < maxLines) ctx.fillText(line, x, lineY);
  return lineY;
}

// ── Pet card stats (y:390–720) ────────────────────────────────────────────────

function drawPetStats(ctx: CanvasRenderingContext2D, data: FullCardData): void {
  const rarity  = data.rarity ?? 'Common';
  const bgColor = RARITY_BG[rarity];
  const fgColor = RARITY_FG[rarity];

  // ── Name banner (y:390, h:44, r:5) ──
  ctx.fillStyle = bgColor;
  roundedRect(ctx, 32, 390, 436, 44, 5);
  ctx.fill();

  ctx.fillStyle = fgColor;
  ctx.font = `700 18px ${GREYCLIFF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.itemName, 249, 390 + 22, 420);

  // ── Age + Max STR line (y:448) ──
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `700 13px ${GREYCLIFF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`Age: ${data.petAge ?? '\u2014'}   \u00b7   MAX STR: ${data.petMaxStr ?? '\u2014'}`, 32, 448);

  // ── Hunger bar (y:468) ──
  const hungerPct = (data.petHunger ?? 100) / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `700 12px ${GREYCLIFF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hunger', 96, 468 + 5);
  drawProgressBar(ctx, 102, 468, 366, 10, hungerPct, HUNGER_COLOR);

  // ── STR bar (y:492) ──
  // Label shows the current STR level (e.g., "50").
  // Bar fills with XP progress toward the next STR level (petStrPct / 100).
  // petMaxStr (header line) is the pet's overall max STR — separate.
  const strLabel = data.petStr ?? '0';
  const strPct   = (data.petStrPct ?? 0) / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `700 12px ${GREYCLIFF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`STR ${strLabel}`, 96, 492 + 5);
  drawProgressBar(ctx, 102, 492, 366, 10, strPct, STR_COLOR);

  // ── Weight (y:515) ──
  if (data.petWeight) {
    ctx.fillStyle = NEUTRAL_GREY;
    ctx.font = `400 12px ${GREYCLIFF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(data.petWeight, 32, 515);
  }
}

// ── Simple card stats (Seed/Tool/Decor/Egg/Plant/Crop, y:390–720) ─────────────

function drawSimpleStats(ctx: CanvasRenderingContext2D, data: FullCardData): void {
  const cardType = data.cardType;

  // ── Item name (y:408, 26px bold, white, word-wrap, max 2 lines) ──
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 26px ${GREYCLIFF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  wrapText(ctx, data.itemName, 249, 408, 400, 34, 2);

  // ── Count / weight (y:470) ──
  ctx.font = `700 18px ${GREYCLIFF}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (cardType === 'Crop' && data.cropWeight) {
    ctx.fillText(`${data.cropWeight} kg`, 249, 470);
  } else if (data.itemCount) {
    ctx.fillText(`\u00d7${data.itemCount}`, 249, 470);
  }

  // ── Seed rarity chip (Seed only, y:500) ──
  if (cardType === 'Seed' && data.seedRarity) {
    const rarityBg = RARITY_BG[data.seedRarity];
    const rarityFg = RARITY_FG[data.seedRarity];
    ctx.font = `700 14px ${GREYCLIFF}`;
    const chipW = Math.min(ctx.measureText(data.seedRarity).width + 32, 200);
    const chipX = 249 - chipW / 2;
    ctx.fillStyle = rarityBg;
    roundedRect(ctx, chipX, 500, chipW, 28, 6);
    ctx.fill();
    ctx.fillStyle = rarityFg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.seedRarity, 249, 500 + 14);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Draw stats overlay in-place on an already-composited 500×720 card canvas.
 * Ensures Greycliff CF is loaded before drawing.
 */
export async function drawFullCardStats(canvas: HTMLCanvasElement, data: FullCardData): Promise<void> {
  const boldFont   = MG_FONTS.find(f => f.id === 'mg-bold-heading');
  const mediumFont = MG_FONTS.find(f => f.id === 'mg-subheading');
  if (boldFont)   await ensureFontLoaded(boldFont);
  if (mediumFont) await ensureFontLoaded(mediumFont);

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.save();
  if (data.cardType === 'Pet') {
    drawPetStats(ctx, data);
  } else {
    drawSimpleStats(ctx, data);
  }
  ctx.restore();
}

/**
 * Return sensible placeholder values for a given card type.
 */
export function defaultFullCardData(cardType: FullCardType): FullCardData {
  const base: FullCardData = { cardType, itemName: 'Item Name' };
  switch (cardType) {
    case 'Pet':
      return {
        ...base,
        itemName:  'Pet Name',
        rarity:    'Common',
        petAge:    '1',
        petMaxStr: '10',
        petHunger: 75,
        petStr:    '1',
        petStrPct: 50,
        petWeight: '12.5 kg',
      };
    case 'Seed':
      return { ...base, itemCount: '5', seedRarity: 'Common' };
    case 'Crop':
      return { ...base, itemName: 'Crop Name', cropWeight: '1.0' };
    default:
      return { ...base, itemCount: '1' };
  }
}
