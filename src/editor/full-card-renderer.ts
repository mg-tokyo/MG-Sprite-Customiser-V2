/**
 * Full card stats renderer.
 * Draws text/bar overlays AND UI sprite icons in-place on an already-composited
 * 500×720 card canvas.
 *
 * Pixel-accurate layout (from card-analyze.cjs, all 7 types identical):
 *   Portrait window:  x:28-470, y:42-379  (442×337px, center 249,211)
 *   Name ribbon:      y:380-458  (Middle layer opaque band, text center y:419)
 *   Stats area:       y:459-679  (Middle layer transparent, 221px tall)
 *   Lock/Unlock:      draw at x:423, y:12
 *   Rarity badge:     draw RarityXxx (55×55) at x:41, y:609
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

// ── Pet card stats ────────────────────────────────────────────────────────────
//
// Ribbon (y:380-458, h:79): rarity-colored roundRect overlaid on card ribbon.
//   Name text centered at y:419.
//
// Stats area (y:459-679, h:221):
//   Age icon (25×32):      x=32,  y=471  — text at x=62, mid y=487
//   Hunger bar:            x=102, y=500, w=366, h=10
//   Hunger label:          right-align x=96, mid y=505
//   STR bar:               x=102, y=520, w=366, h=10
//   STR label:             right-align x=96, mid y=525
//   Weight icon (29×32):   x=32,  y=540  — text at x=66, mid y=556
//   StrengthStar (47×52):  x=32,  y=570
//   ProgressStar (34×33):  x=90,  y=574
//   PetSlots (68×160):     x=420, y=505  (right column)
//   MutationFrame (56×49): x=32,  y=624
//   Stats icon (56×74):    x=215, y=602
//
// Fixed anchors (drawn on top of all stats):
//   Lock/Unlock (64×84):   x=423, y=12
//   RarityXxx (55×55):     x=41,  y=609

async function drawPetStats(ctx: CanvasRenderingContext2D, data: FullCardData): Promise<void> {
  const rarity  = data.rarity ?? 'Common';
  const bgColor = RARITY_BG[rarity];
  const fgColor = RARITY_FG[rarity];

  // Pre-load all UI sprites in parallel
  const [
    lockImg, rarityImg, ageImg, weightImg,
    strStarImg, progStarImg, petSlotsImg, mutFrameImg, statsImg,
  ] = await Promise.all([
    loadImg(uiUrl(data.isLocked ? 'Locked' : 'Unlocked')),
    loadImg(uiUrl(`Rarity${rarity}`)),
    loadImg(uiUrl('Age')),
    loadImg(uiUrl('Weight')),
    loadImg(uiUrl('StrengthStar')),
    loadImg(uiUrl('ProgressStar')),
    loadImg(uiUrl('PetSlots')),
    loadImg(uiUrl('MutationFrame')),
    loadImg(uiUrl('Stats')),
  ]);

  // ── Ribbon: rarity-colored band over the card's ribbon section ──
  ctx.fillStyle = bgColor;
  roundedRect(ctx, 32, 380, 436, 79, 5);
  ctx.fill();

  // ── Name text (centered in ribbon, y:419) ──
  ctx.fillStyle = fgColor;
  ctx.font = `700 20px ${GREYCLIFF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.itemName, 249, 419, 400);

  // ── Stats area sprites (drawn before text, text renders on top) ──
  if (strStarImg)  ctx.drawImage(strStarImg,  32,  570);
  if (progStarImg) ctx.drawImage(progStarImg, 90,  574);
  if (petSlotsImg) ctx.drawImage(petSlotsImg, 420, 505);
  if (mutFrameImg) ctx.drawImage(mutFrameImg, 32,  624);
  if (statsImg)    ctx.drawImage(statsImg,    215, 602);
  if (ageImg)      ctx.drawImage(ageImg,      32,  471);
  if (weightImg)   ctx.drawImage(weightImg,   32,  540);

  // ── Age + MAX STR (x:62, mid y:487) ──
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.font = `700 13px ${GREYCLIFF}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${data.petAge ?? '\u2014'}   \u00b7   MAX STR: ${data.petMaxStr ?? '\u2014'}`,
    62, 487,
  );

  // ── Hunger bar (bar y:500, label mid y:505) ──
  const hungerPct = (data.petHunger ?? 100) / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 12px ${GREYCLIFF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText('Hunger', 96, 505);
  drawProgressBar(ctx, 102, 500, 366, 10, hungerPct, HUNGER_COLOR);

  // ── STR bar (bar y:520, label mid y:525) ──
  const strLabel = data.petStr ?? '0';
  const strPct   = (data.petStrPct ?? 0) / 100;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = `700 12px ${GREYCLIFF}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`STR ${strLabel}`, 96, 525);
  drawProgressBar(ctx, 102, 520, 366, 10, strPct, STR_COLOR);

  // ── Weight (x:66, mid y:556) ──
  if (data.petWeight) {
    ctx.fillStyle = NEUTRAL_GREY;
    ctx.font = `400 13px ${GREYCLIFF}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.petWeight, 66, 556);
  }

  // ── Fixed anchors (drawn last / on top) ──
  if (lockImg)   ctx.drawImage(lockImg,   423, 12);
  if (rarityImg) ctx.drawImage(rarityImg, 41,  609);
}

// ── Simple card stats (Seed/Plant/Crop/Egg/Tool/Decor) ───────────────────────
//
// Ribbon (y:380-458): card-layer ribbon is already the correct type color.
//   Name text (white, bold) centered at y:419.
//
// Stats area (y:459-679):
//   Count or weight: centered at x=249, y=490
//   Seed rarity chip: centered at x=249, y=520 (Seed only)
//   Rarity badge (Seed only): x=41, y=609
//
// Fixed anchors:
//   Lock/Unlock: x=423, y=12

async function drawSimpleStats(ctx: CanvasRenderingContext2D, data: FullCardData): Promise<void> {
  const cardType = data.cardType;
  const isSeed = cardType === 'Seed';

  const [lockImg, rarityImg] = await Promise.all([
    loadImg(uiUrl(data.isLocked ? 'Locked' : 'Unlocked')),
    isSeed && data.seedRarity ? loadImg(uiUrl(`Rarity${data.seedRarity}`)) : Promise.resolve(null),
  ]);

  // ── Name text (ribbon center y:419, white, word-wrap max 2 lines) ──
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 22px ${GREYCLIFF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, data.itemName, 249, 408, 400, 30, 2);

  // ── Count / weight (y:490) ──
  ctx.font = `700 18px ${GREYCLIFF}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (cardType === 'Crop' && data.cropWeight) {
    ctx.fillText(`${data.cropWeight} kg`, 249, 490);
  } else if (data.itemCount) {
    ctx.fillText(`\u00d7${data.itemCount}`, 249, 490);
  }

  // ── Seed rarity chip (Seed only, y:520) ──
  if (isSeed && data.seedRarity) {
    const rarityBg = RARITY_BG[data.seedRarity];
    const rarityFg = RARITY_FG[data.seedRarity];
    ctx.font = `700 14px ${GREYCLIFF}`;
    const chipW = Math.min(ctx.measureText(data.seedRarity).width + 32, 200);
    const chipX = 249 - chipW / 2;
    ctx.fillStyle = rarityBg;
    roundedRect(ctx, chipX, 520, chipW, 28, 6);
    ctx.fill();
    ctx.fillStyle = rarityFg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(data.seedRarity, 249, 534);
  }

  // ── Fixed anchors ──
  if (lockImg)   ctx.drawImage(lockImg,   423, 12);
  if (rarityImg) ctx.drawImage(rarityImg, 41,  609);
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
        petStr:    '3',
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
