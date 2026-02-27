/**
 * Full card stats renderer.
 * Draws text/bar overlays AND UI sprite icons in-place on an already-composited
 * 500×720 card canvas.
 */
import type { FullCardData, FullCardType, FullCardRarity } from '../state/store';
import { state } from '../state/store';
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

// ── UI sprite image loader ────────────────────────────────────────────────────

const imgCache = new Map<string, HTMLImageElement>();

function loadImg(url: string): Promise<HTMLImageElement | null> {
  const cached = imgCache.get(url);
  if (cached) return Promise.resolve(cached);
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { imgCache.set(url, img); resolve(img); };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function uiUrl(name: string): string {
  const v = state.gameVersion ?? '49';
  return `https://mg-api.ariedam.fr/assets/sprites/ui/${name}.png?v=${v}`;
}

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
  roundedRect(ctx, x, y, w, h, 3);
  ctx.strokeStyle = NEUTRAL_GREY;
  ctx.lineWidth = 1;
  ctx.stroke();

  const fillW = Math.max(0, Math.min(progress, 1)) * w;
  if (fillW > 0) {
    roundedRect(ctx, x + 0.5, y + 0.5, fillW - 1, h - 1, 2.5);
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

/**
 * Word-wrap text onto the canvas.
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

// UI sprite positions on a 500×720 pet card:
//   Lock icon        — portrait top-right corner:      x=428, y=26
//   Rarity icon      — portrait/stats boundary left:   x=22,  y=346
//   StrengthStar     — below weight row, left:         x=32,  y=528
//   ProgressStar     — right of StrengthStar:          x=90,  y=531
//   PetSlots         — right column, 68×160:           x=424, y=525
//   MutationFrame    — lower-left:                     x=32,  y=628

async function drawPetStats(ctx: CanvasRenderingContext2D, data: FullCardData): Promise<void> {
  const rarity  = data.rarity ?? 'Common';
  const bgColor = RARITY_BG[rarity];
  const fgColor = RARITY_FG[rarity];

  // Pre-load all UI sprites in parallel before drawing anything
  const [lockImg, rarityImg, strStarImg, progStarImg, petSlotsImg, mutFrameImg] = await Promise.all([
    loadImg(uiUrl(data.isLocked ? 'Locked' : 'Unlocked')),
    loadImg(uiUrl(`Rarity${rarity}`)),
    loadImg(uiUrl('StrengthStar')),
    loadImg(uiUrl('ProgressStar')),
    loadImg(uiUrl('PetSlots')),
    loadImg(uiUrl('MutationFrame')),
  ]);

  // ── Sprite icons (drawn first, text on top) ──
  if (lockImg)     ctx.drawImage(lockImg,     428, 26);
  if (rarityImg)   ctx.drawImage(rarityImg,   22,  346);
  if (strStarImg)  ctx.drawImage(strStarImg,  32,  528);
  if (progStarImg) ctx.drawImage(progStarImg, 90,  531);
  if (petSlotsImg) ctx.drawImage(petSlotsImg, 424, 525);
  if (mutFrameImg) ctx.drawImage(mutFrameImg, 32,  628);

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
  // Label = current STR level; bar = XP progress toward next level (petStrPct / 100).
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

// UI sprite positions on simple cards:
//   Lock icon    — portrait top-right corner: x=428, y=26
//   Rarity icon  — Seed only, same position as pet: x=22, y=346

async function drawSimpleStats(ctx: CanvasRenderingContext2D, data: FullCardData): Promise<void> {
  const cardType = data.cardType;
  const isSeed = cardType === 'Seed';

  // Pre-load sprites
  const [lockImg, rarityImg] = await Promise.all([
    loadImg(uiUrl(data.isLocked ? 'Locked' : 'Unlocked')),
    isSeed && data.seedRarity ? loadImg(uiUrl(`Rarity${data.seedRarity}`)) : Promise.resolve(null),
  ]);

  // ── Sprite icons ──
  if (lockImg)   ctx.drawImage(lockImg,   428, 26);
  if (rarityImg) ctx.drawImage(rarityImg, 22,  346);

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
  if (isSeed && data.seedRarity) {
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
 * Draw stats overlay + UI sprite icons in-place on an already-composited 500×720 card canvas.
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
    await drawPetStats(ctx, data);
  } else {
    await drawSimpleStats(ctx, data);
  }
  ctx.restore();
}

/**
 * Return sensible placeholder values for a given card type.
 */
export function defaultFullCardData(cardType: FullCardType): FullCardData {
  const base: FullCardData = { cardType, itemName: 'Item Name', isLocked: false };
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
        isLocked:  false,
      };
    case 'Seed':
      return { ...base, itemCount: '5', seedRarity: 'Common' };
    case 'Crop':
      return { ...base, itemName: 'Crop Name', cropWeight: '1.0' };
    default:
      return { ...base, itemCount: '1' };
  }
}
