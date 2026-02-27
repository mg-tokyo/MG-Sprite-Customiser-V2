
import type { FullCardData, FullCardType, FullCardRarity, Slot } from '../state/store';
import { state } from '../state/store';
import { spriteLoader } from '../api/sprite-loader';
import type { SpriteFrame } from '../api/types';
import { ensureFontLoaded, MG_FONTS } from './font-data';
import { applyMutations, spriteToCanvas } from '../renderer/mutation-engine';
import { renderSlot } from '../renderer/canvas-renderer';

// ---- Layout constants (from live bundle: main.txt) ----
const RH = 88;
const AH = 60;
const KH = 65;
const XH = 0.44;
const HZ = 0.78;
const JH = 25;
const QM = 22;
const CS = 28;
const DZ = 34;
const VA = 60;
const ZH = -5;
const EG = 5;
const LOCK_SIZE = 75;
const RARITY_SIZE = 64;
const ICON_SIZE = 70;
const G5 = 8;
const TG = 20;
const MUT_ICON_SIZE = 34;
const BAR_INSET = 22;

const NAME_FONT_SIZE = 34;
const NAME_LINE_HEIGHT = 28;

const BAR_HEIGHT = 18;
const BAR_RADIUS = 15;
const BAR_TRACK = '#545454';

const COLOR_TEXT = '#FFFFFF';
const COLOR_STRENGTH_TEXT = '#FFFB6D';
const COLOR_STRENGTH_STROKE = '#E08B3A';
const COLOR_PROGRESS_STROKE = '#D97220';
const COLOR_PROGRESS_STROKE_ALT = '#C9590A';
const COLOR_SIZE_STROKE = '#EA7726';

const HUNGER_LOW_THRESHOLD = 0.1;
const HUNGER_LOW_COLOR = '#F48620';

// Portrait window from card-analyze.cjs (500x720 base)
const PORTRAIT = {
  baseW: 500,
  baseH: 720,
  x: 28,
  y: 42,
  w: 442,
  h: 337,
};

// ---- Game math constants (from live bundle: main.txt) ----
const BASE_STRENGTH_MIN = 80;
const BASE_STRENGTH_MAX = 100;
const STRENGTH_RANGE = 30;
const XP_PER_HOUR = 3600;

// Size range for crops
const SIZE_MIN = 50;
const SIZE_MAX = 100;

// ---- Sprite maps (from live bundle: main.txt) ----
const TYPE_ICONS: Record<FullCardType, string | null> = {
  Seed:  'sprite/ui/SeedIcon',
  Crop:  'sprite/ui/CropIcon',
  Plant: 'sprite/ui/PlantIcon',
  Tool:  'sprite/ui/ToolIcon',
  Pet:   'sprite/ui/PetIcon',
  Egg:   'sprite/ui/EggIcon',
  Decor: 'sprite/ui/DecorIcon',
};

const RARITY_ICONS: Record<FullCardRarity, string> = {
  Common: 'sprite/ui/RarityCommon',
  Uncommon: 'sprite/ui/RarityUncommon',
  Rare: 'sprite/ui/RarityRare',
  Legendary: 'sprite/ui/RarityLegendary',
  Mythic: 'sprite/ui/RarityMythic',
  Divine: 'sprite/ui/RarityDivine',
  Celestial: 'sprite/ui/RarityCelestial',
};

const MUTATION_UI_SPRITES: Record<string, string> = {
  Gold: 'sprite/ui/MutationGold',
  Rainbow: 'sprite/ui/MutationRainbow',
  Wet: 'sprite/ui/MutationWet',
  Chilled: 'sprite/ui/MutationChilled',
  Frozen: 'sprite/ui/MutationFrozen',
  Thunderstruck: 'sprite/ui/MutationThunderstruck',
  Dawnlit: 'sprite/ui/MutationDawnlit',
  Ambershine: 'sprite/ui/MutationAmberlit',
  Dawncharged: 'sprite/ui/MutationDawncharged',
  Ambercharged: 'sprite/ui/MutationAmbercharged',
};

// Ability colors (from live bundle: main.txt)
export function abilityColor(id: string): string {
  switch (id) {
    case 'MoonKisser': return '#FAA623';
    case 'DawnKisser': return '#A25CF2';
    case 'ProduceScaleBoost':
    case 'ProduceScaleBoostII':
    case 'SnowyCropSizeBoost':
      return '#228B22';
    case 'PlantGrowthBoost':
    case 'PlantGrowthBoostII':
    case 'SnowyPlantGrowthBoost':
    case 'DawnPlantGrowthBoost':
    case 'AmberPlantGrowthBoost':
      return '#008080';
    case 'EggGrowthBoost':
    case 'EggGrowthBoostII_NEW':
    case 'EggGrowthBoostII':
    case 'SnowyEggGrowthBoost':
      return '#B45AF0';
    case 'PetAgeBoost':
    case 'PetAgeBoostII':
      return '#9370DB';
    case 'PetHatchSizeBoost':
    case 'PetHatchSizeBoostII':
      return '#800080';
    case 'PetXpBoost':
    case 'PetXpBoostII':
    case 'SnowyPetXpBoost':
      return '#1E90FF';
    case 'HungerBoost':
    case 'HungerBoostII':
    case 'SnowyHungerBoost':
      return '#FF1493';
    case 'SellBoostI':
    case 'SellBoostII':
    case 'SellBoostIII':
    case 'SellBoostIV':
      return '#DC143C';
    case 'CoinFinderI':
    case 'CoinFinderII':
    case 'CoinFinderIII':
    case 'SnowyCoinFinder':
      return '#B49600';
    case 'ProduceMutationBoost':
    case 'ProduceMutationBoostII':
    case 'SnowyCropMutationBoost':
    case 'DawnBoost':
    case 'AmberMoonBoost':
      return '#8C0F46';
    case 'DoubleHarvest':
      return '#0078B4';
    case 'DoubleHatch':
      return '#3C5AB4';
    case 'ProduceEater':
      return '#FF4500';
    case 'ProduceRefund':
      return '#FF6347';
    case 'PetMutationBoost':
    case 'PetMutationBoostII':
      return '#A03264';
    case 'HungerRestore':
    case 'HungerRestoreII':
    case 'SnowyHungerRestore':
      return '#FF69B4';
    case 'PetRefund':
    case 'PetRefundII':
      return '#005078';
    case 'Copycat':
      return '#FF8C00';
    case 'GoldGranter':
      return 'linear-gradient(135deg, #DCC846 0%, #D2AF05 40%, #D2B937 70%, #C8AF1E 100%)';
    case 'RainbowGranter':
      return 'linear-gradient(45deg, #C80000, #C87800, #A0AA1E, #3CAA3C, #32AAAA, #2896B4, #145AB4, #461E96)';
    case 'RainDance':
      return '#4CCCCC';
    case 'SnowGranter':
      return '#90B8CC';
    case 'FrostGranter':
      return '#94A0CC';
    case 'DawnlitGranter':
      return '#C47CB4';
    case 'AmberlitGranter':
      return '#CC9060';
    case 'SeedFinderI':
    case 'SeedFinderII':
    case 'SeedFinderIII':
    case 'SeedFinderIV':
      return '#A86626';
    default:
      return '#969696';
  }
}

function contrastColor(color: string): string {
  if (color.startsWith('linear-gradient')) return '#FFFFFF';
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16) / 255;
    const g = parseInt(color.slice(3, 5), 16) / 255;
    const b = parseInt(color.slice(5, 7), 16) / 255;
    return 0.299 * r + 0.587 * g + 0.114 * b < 0.5 ? '#FFFFFF' : '#000000';
  }
  const match = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return '#FFFFFF';
  const r = parseInt(match[1], 10) / 255;
  const g = parseInt(match[2], 10) / 255;
  const b = parseInt(match[3], 10) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 0.5 ? '#FFFFFF' : '#000000';
}

function parseGradientStops(gradient: string): string[] {
  const matches = gradient.match(/#[0-9a-fA-F]{6}/g);
  return matches ?? [];
}

function toHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function formatWeight(value: number | string | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value < 1) return Math.max(value, 0.01).toFixed(2);
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toString();
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 0) return '0s';
  const hours = seconds / 3600;
  const minutes = (seconds % 3600) / 60;
  const secs = seconds % 60;
  const h = Math.floor(hours);
  const m = Math.floor(minutes);
  const s = Math.floor(secs);
  if (h > 0) {
    const parts = [`${h}h`];
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.join(' ');
  }
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  if (s > 0) return `${s}s`;
  if (secs !== 0) return '<1s';
  return '0s';
}

function cropSize(speciesId: string, scale: number): number {
  const crop = state.gameData?.plants?.[speciesId]?.crop;
  const maxScale = crop?.maxScale ?? 1;
  if (scale <= 1) return SIZE_MIN;
  if (scale >= maxScale) return SIZE_MAX;
  const t = (scale - 1) / (maxScale - 1);
  return Math.floor(SIZE_MIN + (SIZE_MAX - SIZE_MIN) * t);
}

function maxStrength(speciesId: string, targetScale: number): number {
  const pet = state.gameData?.pets?.[speciesId];
  const maxScale = pet?.maxScale ?? 1;
  if (targetScale <= 1) return BASE_STRENGTH_MIN;
  if (targetScale >= maxScale) return BASE_STRENGTH_MAX;
  const t = (targetScale - 1) / (maxScale - 1);
  return Math.floor(BASE_STRENGTH_MIN + (BASE_STRENGTH_MAX - BASE_STRENGTH_MIN) * t);
}

function baseStrength(speciesId: string, targetScale: number): number {
  return maxStrength(speciesId, targetScale) - STRENGTH_RANGE;
}

function strengthPerHour(speciesId: string): number {
  const pet = state.gameData?.pets?.[speciesId];
  const hours = pet?.hoursToMature ?? 1;
  return STRENGTH_RANGE / Math.max(1, hours);
}

function currentStrength(speciesId: string, xpSeconds: number, targetScale: number): number {
  const s = baseStrength(speciesId, targetScale);
  const perHour = strengthPerHour(speciesId);
  const hours = xpSeconds / XP_PER_HOUR;
  const gain = Math.min(perHour * hours, STRENGTH_RANGE);
  return Math.floor(s + gain);
}

function xpForStrength(strength: number, speciesId: string, targetScale: number): number {
  const s = baseStrength(speciesId, targetScale);
  const n = strength - s;
  if (n <= 0) return 0;
  const perHour = strengthPerHour(speciesId);
  return (n / perHour) * XP_PER_HOUR;
}

function weightScale(speciesId: string, xpSeconds: number, targetScale: number): number {
  const s = currentStrength(speciesId, xpSeconds, targetScale);
  const max = maxStrength(speciesId, targetScale);
  return (s / max) * targetScale;
}

function mutationMultiplier(mutations: string[]): number {
  const gd = state.gameData;
  if (!gd?.mutations) return 1;
  const gold = mutations.find(m => m === 'Gold' || m === 'Rainbow');
  const others = mutations.filter(m => m !== 'Gold' && m !== 'Rainbow');
  const base = gold ? (gd.mutations[gold]?.coinMultiplier ?? 1) : 1;
  const sum = others.reduce((acc, m) => acc + (gd.mutations[m]?.coinMultiplier ?? 1), 0);
  const count = others.length;
  return base * (1 + sum - count);
}

function normalizeScale(value: number): number {
  if (value > 1) return 1 + (value - 1) * 0.3;
  if (value < 1) return 1 - (1 - value) * 0.7;
  return value;
}

async function ensureCardFontsLoaded(): Promise<void> {
  const fonts = MG_FONTS.filter(f =>
    f.family === 'Greycliff CF' || f.family === 'Shrikhand',
  );
  for (const font of fonts) {
    await ensureFontLoaded(font);
  }
}

function setFont(
  ctx: CanvasRenderingContext2D,
  size: number,
  weight: number | string,
  family: string,
): void {
  ctx.font = `${weight} ${size}px "${family}", sans-serif`;
}

function measureTextWidth(ctx: CanvasRenderingContext2D, text: string): number {
  return ctx.measureText(text).width;
}

function measureTextHeight(ctx: CanvasRenderingContext2D, size: number): number {
  const metrics = ctx.measureText('M');
  const h = (metrics.actualBoundingBoxAscent ?? size * 0.75) +
    (metrics.actualBoundingBoxDescent ?? size * 0.25);
  return h > 0 ? h : size;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measureTextWidth(ctx, candidate) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      if (measureTextWidth(ctx, word) <= maxWidth) {
        current = word;
      } else {
        // break long word
        let slice = '';
        for (const ch of word) {
          const next = slice + ch;
          if (measureTextWidth(ctx, next) > maxWidth && slice) {
            lines.push(slice);
            slice = ch;
          } else {
            slice = next;
          }
        }
        current = slice;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function truncateToTwoLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  const ellipsis = '...';
  let lines = wrapText(ctx, text, maxWidth);
  if (lines.length <= 2) return text;
  const words = text.split(/\s+/).filter(Boolean);
  while (words.length > 0) {
    words.pop();
    let candidate = words.join(' ');
    candidate = candidate ? `${candidate} ${ellipsis}` : ellipsis;
    lines = wrapText(ctx, candidate, maxWidth);
    if (lines.length <= 2) return candidate;
  }
  return ellipsis;
}

function getSpriteUrlFromId(spriteId: string): string | null {
  if (!spriteId) return null;
  if (
    spriteId.startsWith('http://')
    || spriteId.startsWith('https://')
    || spriteId.startsWith('blob:')
    || spriteId.startsWith('data:')
  ) return spriteId;
  const sd = state.spriteData;
  if (sd) {
    for (const cat of sd.categories) {
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
  }
  if (spriteId.startsWith('sprite/')) {
    const [, cat, ...rest] = spriteId.split('/');
    const name = rest.join('/');
    if (cat && name) {
      const version = state.gameVersion ?? '';
      return `https://mg-api.ariedam.fr/assets/sprites/${cat}/${name}.png${version ? `?v=${version}` : ''}`;
    }
  }
  return null;
}

async function loadSprite(spriteId: string | undefined | null): Promise<HTMLImageElement | null> {
  if (!spriteId) return null;
  const url = getSpriteUrlFromId(spriteId);
  if (!url) return null;
  try {
    return await spriteLoader.load(url);
  } catch {
    return null;
  }
}

async function renderItemCanvas(
  spriteId: string | null,
  mutations: string[],
  itemTint: { color: string; opacity: number },
  options: { icons: boolean; overlays: boolean },
): Promise<HTMLCanvasElement | null> {
  if (!spriteId) return null;
  const url = getSpriteUrlFromId(spriteId);
  if (!url) return null;

  const slot: Slot = {
    id: 'item-preview',
    type: 'sprite',
    spriteKey: spriteId,
    spriteUrl: url,
    mutations,
    options,
    customTint: itemTint,
    position: { x: 0, y: 0 },
    scale: 1,
    rotation: 0,
    visible: true,
    locked: false,
  };

  const rendered = await renderSlot(slot);
  if (rendered) return rendered;

  const img = await loadSprite(spriteId);
  if (!img) return null;
  const canvas = spriteToCanvas(img);
  applyMutations(canvas, mutations, isTallSprite(spriteId), itemTint);
  return canvas;
}

function drawImageCentered(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  cx: number,
  cy: number,
  size: number,
): void {
  const w = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth;
  const h = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight;
  if (w === 0 || h === 0) return;
  const scale = size / Math.max(w, h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
}

function drawIconLeft(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  x: number,
  y: number,
  size: number,
): void {
  const w = img instanceof HTMLCanvasElement ? img.width : img.naturalWidth;
  const h = img instanceof HTMLCanvasElement ? img.height : img.naturalHeight;
  if (w === 0 || h === 0) return;
  const scale = size / Math.max(w, h);
  const dw = w * scale;
  const dh = h * scale;
  ctx.drawImage(img, x, y - dh / 2, dw, dh);
}

function itemTypeScale(cardType: FullCardType, scale: number, petScale?: number): number {
  switch (cardType) {
    case 'Pet': {
      const n = petScale ?? 1;
      return Math.min(normalizeScale(n * 0.5), 0.8);
    }
    case 'Crop':
      return Math.max(0.6, normalizeScale(scale));
    case 'Seed':
      return 0.65;
    case 'Tool':
      return 0.6;
    case 'Decor':
      return 0.6;
    case 'Egg':
      return 0.7;
    case 'Plant':
      return 0.9;
    default:
      return 0.8;
  }
}

function mutationSortOrder(): Map<string, number> {
  const order = new Map<string, number>();
  const keys = Object.keys(state.gameData?.mutations ?? {});
  keys.forEach((k, i) => order.set(k, i));
  return order;
}

function sortMutations(list: string[]): string[] {
  const order = mutationSortOrder();
  return [...list].sort((a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER));
}

function drawProgressBarRow(
  ctx: CanvasRenderingContext2D,
  options: {
    label: string;
    value: number;
    max: number;
    color: string | number;
    y: number;
    rowWidth: number;
    showMaxLabel?: boolean;
    maxLabelValue?: string;
    nextLabelValue?: string;
    currentLabelValue?: string;
    fullyGrown?: boolean;
    barLabel?: string;
    leftPad?: number;
    rightPad?: number;
    colorByPct?: (pct: number) => string;
  },
  icons: {
    progressStar?: HTMLImageElement | null;
    strengthStar?: HTMLImageElement | null;
  },
): void {
  const rowLeft = -options.rowWidth / 2;
  const widthScale = 1;
  const x = widthScale * options.rowWidth;
  const P = 50;
  const k = (options.showMaxLabel || (options.barLabel && !options.showMaxLabel)) ? P : 0;
  const R = widthScale * 55;
  let barLeft: number;
  let barRight: number;
  let barWidth: number;
  if (options.leftPad != null && options.rightPad != null) {
    barLeft = rowLeft + options.leftPad;
    barRight = rowLeft + options.rowWidth - options.rightPad;
    barWidth = barRight - barLeft;
  } else {
    barWidth = x * 0.65 + R - k;
    barRight = (options.showMaxLabel || (options.barLabel && !options.showMaxLabel)) ? rowLeft + x - k : rowLeft + x;
    barLeft = barRight - barWidth;
  }

  const labelMax = Math.max(20, barLeft - rowLeft - 8);
  let labelSize = 18;
  setFont(ctx, labelSize, 'bold', 'Greycliff CF');
  let labelText = truncateToTwoLines(ctx, options.label, labelMax);
  let labelLines = wrapText(ctx, labelText, labelMax);
  if (labelLines.length > 1) {
    labelSize = 16;
    setFont(ctx, labelSize, 'bold', 'Greycliff CF');
    labelText = truncateToTwoLines(ctx, options.label, labelMax);
    labelLines = wrapText(ctx, labelText, labelMax);
  }
  const lineHeight = labelSize + 2;
  const labelBlockH = labelLines.length * lineHeight;
  const labelStartY = options.y - labelBlockH / 2 + lineHeight / 2;
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  labelLines.forEach((line, idx) => {
    ctx.fillText(line, rowLeft, labelStartY + idx * lineHeight);
  });

  // Current strength star (left of bar)
  if (options.showMaxLabel && options.currentLabelValue && !options.fullyGrown && icons.progressStar) {
    const starX = barLeft + 12;
    const starY = options.y;
    drawImageCentered(ctx, icons.progressStar, starX, starY, 45);
    setFont(ctx, 24, 'bold', 'Greycliff CF');
    ctx.fillStyle = COLOR_STRENGTH_TEXT;
    ctx.strokeStyle = COLOR_PROGRESS_STROKE_ALT;
    ctx.lineWidth = 5;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText(options.currentLabelValue, starX, starY - 5);
    ctx.fillText(options.currentLabelValue, starX, starY - 5);
  }

  // Progress bar
  const pct = options.max > 0 && Number.isFinite(options.value) && Number.isFinite(options.max)
    ? Math.min(1, Math.max(0, options.value / options.max))
    : 0;
  const color = typeof options.color === 'number' ? toHex(options.color) : options.color;
  const barInset = (options.showMaxLabel && !options.fullyGrown) ? BAR_INSET : 0;
  const innerWidth = Math.max(0, barWidth - barInset * 2);
  const barX = barLeft + barInset;
  const barY = options.y - BAR_HEIGHT / 2;

  ctx.save();
  roundRectPath(ctx, barX, barY, innerWidth, BAR_HEIGHT, BAR_RADIUS);
  ctx.fillStyle = BAR_TRACK;
  ctx.fill();
  const fillWidth = innerWidth * pct;
  if (fillWidth > 0) {
    const fillColor = options.colorByPct ? options.colorByPct(pct) : color;
    ctx.save();
    roundRectPath(ctx, barX, barY, innerWidth, BAR_HEIGHT, BAR_RADIUS);
    ctx.clip();
    ctx.fillStyle = fillColor;
    ctx.fillRect(barX, barY, fillWidth, BAR_HEIGHT);
    ctx.restore();
  }
  ctx.restore();

  // Right-side markers
  if (options.showMaxLabel && options.maxLabelValue && icons.strengthStar) {
    const rightY = options.y;
    if (options.nextLabelValue && options.nextLabelValue !== options.maxLabelValue && icons.progressStar) {
      const textX = barRight + 8;
      setFont(ctx, 24, 'bold', 'Greycliff CF');
      ctx.fillStyle = COLOR_STRENGTH_TEXT;
      ctx.strokeStyle = COLOR_PROGRESS_STROKE;
      ctx.lineWidth = 5;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const textWidth = measureTextWidth(ctx, options.nextLabelValue);
      const starX = textX - textWidth / 2;
      drawImageCentered(ctx, icons.progressStar, starX, rightY, 45);
      ctx.strokeText(options.nextLabelValue, textX, rightY - 5);
      ctx.fillText(options.nextLabelValue, textX, rightY - 5);

      const maxStarX = barRight + 36;
      drawImageCentered(ctx, icons.strengthStar, maxStarX, rightY, 40);
      setFont(ctx, 24, 'bold', 'Greycliff CF');
      ctx.fillStyle = COLOR_STRENGTH_TEXT;
      ctx.strokeStyle = COLOR_STRENGTH_STROKE;
      ctx.lineWidth = 5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(options.maxLabelValue, maxStarX, rightY - 5);
      ctx.fillText(options.maxLabelValue, maxStarX, rightY - 5);
    } else {
      const maxStarX = barRight + 8;
      drawImageCentered(ctx, icons.strengthStar, maxStarX, rightY, 40);
      setFont(ctx, 24, 'bold', 'Greycliff CF');
      ctx.fillStyle = COLOR_STRENGTH_TEXT;
      ctx.strokeStyle = COLOR_STRENGTH_STROKE;
      ctx.lineWidth = 5;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeText(options.maxLabelValue, maxStarX, rightY - 5);
      ctx.fillText(options.maxLabelValue, maxStarX, rightY - 5);
    }
  } else if (options.barLabel && !options.showMaxLabel && icons.strengthStar) {
    drawImageCentered(ctx, icons.strengthStar, barRight + 8, options.y, 45);
  }
}

function drawWeightSellRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  weightText: string,
  sellText: string,
  icons: {
    weight?: HTMLImageElement | null;
    coin?: HTMLImageElement | null;
  },
): void {
  setFont(ctx, 18, '400', 'Greycliff CF');
  const weightWidth = measureTextWidth(ctx, weightText);
  const sellWidth = measureTextWidth(ctx, sellText);
  const part1 = CS + 4 + weightWidth;
  const part2 = CS + 4 + sellWidth;
  const gap = 20;
  const total = part1 + gap + part2;
  const startX = -total / 2;
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (icons.weight) drawIconLeft(ctx, icons.weight, startX, y, CS);
  ctx.fillText(weightText, startX + CS + 4, y);

  setFont(ctx, 24, '400', 'Greycliff CF');
  ctx.globalAlpha = 0.3;
  ctx.textAlign = 'center';
  ctx.fillText('•', startX + part1 + gap / 2, y);
  ctx.globalAlpha = 1;

  if (icons.coin) drawIconLeft(ctx, icons.coin, startX + part1 + gap, y, CS);
  setFont(ctx, 18, '400', 'Greycliff CF');
  ctx.textAlign = 'left';
  ctx.fillText(sellText, startX + part1 + gap + CS + 4, y);
}

function drawWeightAgeRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  weightText: string,
  ageText: string,
  sellText: string,
  icons: {
    weight?: HTMLImageElement | null;
    age?: HTMLImageElement | null;
    coin?: HTMLImageElement | null;
  },
): void {
  setFont(ctx, 18, '400', 'Greycliff CF');
  const weightWidth = measureTextWidth(ctx, weightText);
  const ageWidth = measureTextWidth(ctx, ageText);
  const sellWidth = measureTextWidth(ctx, sellText);
  const part1 = CS + 4 + weightWidth;
  const part2 = CS + 4 + ageWidth;
  const part3 = CS + 4 + sellWidth;
  const gap = 20;
  const total = part1 + gap + part2 + gap + part3;
  const startX = -total / 2;

  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  if (icons.weight) drawIconLeft(ctx, icons.weight, startX, y, CS);
  ctx.fillText(weightText, startX + CS + 4, y);

  setFont(ctx, 24, '400', 'Greycliff CF');
  ctx.globalAlpha = 0.3;
  ctx.textAlign = 'center';
  ctx.fillText('•', startX + part1 + gap / 2, y);
  ctx.globalAlpha = 1;

  if (icons.age) drawIconLeft(ctx, icons.age, startX + part1 + gap, y, CS);
  setFont(ctx, 18, '400', 'Greycliff CF');
  ctx.textAlign = 'left';
  ctx.fillText(ageText, startX + part1 + gap + CS + 4, y);

  setFont(ctx, 24, '400', 'Greycliff CF');
  ctx.globalAlpha = 0.3;
  ctx.textAlign = 'center';
  ctx.fillText('•', startX + part1 + gap + part2 + gap / 2, y);
  ctx.globalAlpha = 1;

  if (icons.coin) drawIconLeft(ctx, icons.coin, startX + part1 + gap + part2 + gap, y, CS);
  setFont(ctx, 18, '400', 'Greycliff CF');
  ctx.textAlign = 'left';
  ctx.fillText(sellText, startX + part1 + gap + part2 + gap + CS + 4, y);
}

function drawCountRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  label: string,
  value: string,
  rowWidth: number,
): void {
  const left = -rowWidth / 2;
  const right = rowWidth / 2;
  setFont(ctx, 18, 'bold', 'Greycliff CF');
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelText = truncateToTwoLines(ctx, label, rowWidth * 0.6);
  ctx.fillText(labelText, left, y);
  ctx.textAlign = 'right';
  ctx.fillText(value, right, y);
}

function drawSizeRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  sizeText: string,
  rowWidth: number,
  icons: { size?: HTMLImageElement | null },
): number {
  const startX = -rowWidth / 2;
  if (icons.size) {
    const iconSize = DZ;
    const w = icons.size.naturalWidth;
    const h = icons.size.naturalHeight;
    const scale = iconSize / Math.max(w, h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(icons.size, startX, y - dh / 2, dw, dh);
    setFont(ctx, 26, '800', 'Greycliff CF');
    ctx.fillStyle = COLOR_TEXT;
    ctx.strokeStyle = COLOR_SIZE_STROKE;
    ctx.lineWidth = 5;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.strokeText(sizeText, startX + dw + 4, y);
    ctx.fillText(sizeText, startX + dw + 4, y);
  }
  return 38;
}

function drawMatureCropsRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  rowWidth: number,
  label: string,
  crops: HTMLImageElement[],
): number {
  const left = -rowWidth / 2;
  const iconSize = 48;
  const overlap = -22;
  const textGap = 12;
  const step = iconSize + overlap;

  setFont(ctx, 18, 'bold', 'Greycliff CF');
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const maxTextWidth = Math.max(80, rowWidth - (step * 2 + iconSize) - textGap);
  const text = truncateToTwoLines(ctx, label, maxTextWidth);
  const textLines = wrapText(ctx, text, maxTextWidth);
  const textWidth = Math.min(maxTextWidth, Math.max(...textLines.map(l => measureTextWidth(ctx, l))));
  const textBlockH = textLines.length * 20;
  const textStartY = y - textBlockH / 2 + 10;
  textLines.forEach((line, idx) => ctx.fillText(line, left, textStartY + idx * 20));

  let cursorX = left + textWidth + textGap;
  let rowOffsetY = 0;
  let wrapped = false;
  for (const img of crops) {
    if (cursorX + iconSize > left + rowWidth && cursorX > left + textWidth + textGap) {
      cursorX = left + textWidth + textGap;
      rowOffsetY += iconSize + overlap;
      wrapped = true;
    }
    drawIconLeft(ctx, img, cursorX, y + rowOffsetY, iconSize);
    cursorX += step;
  }
  if (wrapped) return iconSize * 2 + overlap;
  return crops.length > 0 ? iconSize : textBlockH + 10;
}

function drawEggHatchesRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  rowWidth: number,
  label: string,
  icons: HTMLImageElement[],
): number {
  const left = -rowWidth / 2;
  setFont(ctx, 18, 'bold', 'Greycliff CF');
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, left, y);
  const labelWidth = measureTextWidth(ctx, label);
  const iconSize = 56;
  const gap = 12;
  let cursorX = left + labelWidth + gap;
  for (const icon of icons) {
    drawIconLeft(ctx, icon, cursorX, y, iconSize);
    cursorX += iconSize + gap;
  }
  return 56;
}

function drawEggGoldRainbowRatesRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  goldText: string,
  rainbowText: string,
  icons: {
    frame?: HTMLImageElement | null;
    gold?: HTMLImageElement | null;
    rainbow?: HTMLImageElement | null;
  },
): void {
  const entries = [
    { key: 'Gold', text: goldText, icon: icons.gold },
    { key: 'Rainbow', text: rainbowText, icon: icons.rainbow },
  ];

  setFont(ctx, 18, '400', 'Greycliff CF');
  const widths = entries.map(entry => MUT_ICON_SIZE + 4 + measureTextWidth(ctx, entry.text));
  const total = widths[0] + 20 + widths[1];
  const startX = -total / 2;
  let cursorX = startX;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (icons.frame) {
      drawIconLeft(ctx, icons.frame, cursorX, y, MUT_ICON_SIZE);
    }
    if (entry.icon) {
      drawImageCentered(ctx, entry.icon, cursorX + MUT_ICON_SIZE / 2, y, MUT_ICON_SIZE * 0.6);
    }
    ctx.fillStyle = COLOR_TEXT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(entry.text, cursorX + MUT_ICON_SIZE + 4, y);
    cursorX += widths[i];
    if (i === 0) {
      setFont(ctx, 24, '400', 'Greycliff CF');
      ctx.globalAlpha = 0.3;
      ctx.textAlign = 'center';
      ctx.fillText('•', cursorX + 10, y);
      ctx.globalAlpha = 1;
      setFont(ctx, 18, '400', 'Greycliff CF');
      cursorX += 20;
    }
  }
}

function drawDietSpritesOnly(
  ctx: CanvasRenderingContext2D,
  y: number,
  rowWidth: number,
  icons: HTMLImageElement[],
): void {
  const iconSize = 40;
  const overlap = -18;
  const step = iconSize + overlap;
  const totalWidth = icons.length * step + 12;
  const start = rowWidth / 2 - totalWidth + 12;
  let cursorX = start;
  for (const icon of icons) {
    drawIconLeft(ctx, icon, cursorX, y, iconSize);
    cursorX += step;
  }
}

function drawAbilitiesRow(
  ctx: CanvasRenderingContext2D,
  baseY: number,
  rowWidth: number,
  abilities: { id: string; name: string; color: string; disabled: boolean }[],
): number {
  const pad = 8;
  const gap = 7;
  const radius = 5;
  const topPad = 8;
  const rowGap = 8;
  const shadowAlpha = 0.25;
  const shadowOffset = 6;

  setFont(ctx, 16, 'bold', 'Greycliff CF');

  const boxes = abilities.map(a => {
    const width = measureTextWidth(ctx, a.name) + pad * 2;
    const height = measureTextHeight(ctx, 16) + pad * 2;
    return { ...a, width, height };
  });

  let maxH = 0;
  for (const box of boxes) maxH = Math.max(maxH, box.height);

  const rows: number[][] = [];
  let currentRow: number[] = [];
  let currentW = 0;
  for (let i = 0; i < boxes.length; i++) {
    const box = boxes[i];
    const addW = box.width + (currentRow.length > 0 ? gap : 0);
    if (currentW + addW > rowWidth && currentRow.length > 0) {
      rows.push(currentRow);
      currentRow = [];
      currentW = 0;
    }
    currentRow.push(i);
    currentW += addW;
  }
  if (currentRow.length > 0) rows.push(currentRow);

  let y = baseY + topPad;
  for (const row of rows) {
    const rowWidthSum = row.reduce((acc, idx) => acc + boxes[idx].width, 0) + (row.length - 1) * gap;
    let x = -rowWidthSum / 2;
    for (const idx of row) {
      const box = boxes[idx];
      const top = y - box.height / 2;
      // shadow
      ctx.save();
      ctx.globalAlpha = shadowAlpha;
      roundRectPath(ctx, x, top + shadowOffset, box.width, box.height, radius);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.restore();

      // background
      ctx.save();
      ctx.globalAlpha = box.disabled ? 0.6 : 1;
      const color = box.color;
      if (color.startsWith('linear-gradient')) {
        const stops = parseGradientStops(color);
        const grad = ctx.createLinearGradient(x, top, x + box.width, top + box.height);
        if (stops.length === 0) {
          grad.addColorStop(0, '#646464');
          grad.addColorStop(1, '#646464');
        } else {
          stops.forEach((stop, i) => {
            const t = stops.length === 1 ? 1 : i / (stops.length - 1);
            grad.addColorStop(t, stop);
          });
        }
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = color;
      }
      roundRectPath(ctx, x, top, box.width, box.height, radius);
      ctx.fill();
      ctx.restore();

      // text
      ctx.fillStyle = box.disabled ? '#FFFFFF' : contrastColor(box.color);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(box.name, x + box.width / 2, top + box.height / 2);

      x += box.width + gap;
    }
    y += maxH + rowGap;
  }
  return rows.length > 0 ? rows.length * maxH + (rows.length - 1) * rowGap + 8 + topPad : 0;
}

function resolveItemName(cardType: FullCardType, data: FullCardData): string {
  const gd = state.gameData;
  if (!gd) return data.itemName || cardType;
  switch (cardType) {
    case 'Pet': {
      const pet = data.itemId ? gd.pets?.[data.itemId] : null;
      return pet?.name ?? data.itemName ?? 'Pet';
    }
    case 'Plant': {
      const plant = data.itemId ? gd.plants?.[data.itemId] : null;
      return plant?.plant?.name ?? data.itemName ?? 'Plant';
    }
    case 'Crop': {
      const plant = data.itemId ? gd.plants?.[data.itemId] : null;
      return plant?.crop?.name ?? data.itemName ?? 'Crop';
    }
    case 'Seed': {
      const plant = data.itemId ? gd.plants?.[data.itemId] : null;
      return plant?.seed?.name ?? data.itemName ?? 'Seed';
    }
    case 'Egg': {
      const egg = data.itemId ? gd.eggs?.[data.itemId] : null;
      return egg?.name ?? data.itemName ?? 'Egg';
    }
    case 'Tool': {
      const tool = data.itemId ? gd.items?.[data.itemId] : null;
      return tool?.name ?? data.itemName ?? 'Tool';
    }
    case 'Decor': {
      const decor = data.itemId ? gd.decor?.[data.itemId] : null;
      return decor?.name ?? data.itemName ?? 'Decor';
    }
    default:
      return data.itemName || cardType;
  }
}

function resolveRarity(cardType: FullCardType, data: FullCardData): FullCardRarity | null {
  const gd = state.gameData;
  if (!gd) return data.rarity ?? data.seedRarity ?? null;
  if (cardType === 'Pet') return (data.rarity ?? gd.pets?.[data.itemId ?? '']?.rarity) as FullCardRarity ?? null;
  if (cardType === 'Seed') return (data.seedRarity ?? gd.plants?.[data.itemId ?? '']?.seed?.rarity) as FullCardRarity ?? null;
  if (cardType === 'Plant' || cardType === 'Crop') return gd.plants?.[data.itemId ?? '']?.seed?.rarity as FullCardRarity ?? null;
  if (cardType === 'Tool') return gd.items?.[data.itemId ?? '']?.rarity as FullCardRarity ?? null;
  if (cardType === 'Decor') return gd.decor?.[data.itemId ?? '']?.rarity as FullCardRarity ?? null;
  if (cardType === 'Egg') return gd.eggs?.[data.itemId ?? '']?.rarity as FullCardRarity ?? null;
  return null;
}

function resolveItemSpriteId(cardType: FullCardType, data: FullCardData): string | null {
  if (data.itemSpriteOverride && data.itemSpriteOverride.trim()) return data.itemSpriteOverride.trim();
  const gd = state.gameData;
  if (!gd) return null;
  switch (cardType) {
    case 'Pet':
      return data.itemId ? gd.pets?.[data.itemId]?.sprite ?? null : null;
    case 'Plant':
      return data.itemId ? gd.plants?.[data.itemId]?.plant?.sprite ?? null : null;
    case 'Crop':
      return data.itemId ? gd.plants?.[data.itemId]?.crop?.sprite ?? null : null;
    case 'Seed':
      return data.itemId ? gd.plants?.[data.itemId]?.seed?.sprite ?? null : null;
    case 'Egg':
      return data.itemId ? gd.eggs?.[data.itemId]?.sprite ?? null : null;
    case 'Tool':
      return data.itemId ? gd.items?.[data.itemId]?.sprite ?? null : null;
    case 'Decor':
      return data.itemId ? gd.decor?.[data.itemId]?.sprite ?? null : null;
    default:
      return null;
  }
}

function isTallSprite(spriteId: string | null): boolean {
  if (!spriteId) return false;
  return /tall-?plant/i.test(spriteId);
}

export async function drawFullCardStats(
  canvas: HTMLCanvasElement,
  data: FullCardData,
  mutations: string[] = [],
): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  await ensureCardFontsLoaded();

  const cardW = canvas.width;
  const cardH = canvas.height;
  const rowWidth = cardW * HZ;

  // Base positions
  const r = -cardH / 2 + AH + KH;
  const n = (cardH - AH * 2) * XH;
  const nameY = r + n + JH;
  const detailsY = nameY + RH / 2 + QM;
  const bottomOffset = cardH / 2 - detailsY - 58;

  // Prepare images
  const itemSpriteId = resolveItemSpriteId(data.cardType, data);
  const itemMutations = data.itemMutations ?? mutations;
  const itemTint = data.itemTint ?? { color: '#ffffff', opacity: 0 };
  const itemOptions = data.itemOptions ?? { icons: true, overlays: true };
  const itemSpriteCanvas = itemSpriteId
    ? await renderItemCanvas(itemSpriteId, itemMutations, itemTint, itemOptions)
    : null;
  const typeIcon = TYPE_ICONS[data.cardType] ? await loadSprite(TYPE_ICONS[data.cardType]!) : null;
  const lockIcon = await loadSprite(data.isLocked ? 'sprite/ui/Locked' : 'sprite/ui/Unlocked');
  const rarity = resolveRarity(data.cardType, data);
  const rarityIcon = rarity ? await loadSprite(RARITY_ICONS[rarity]) : null;

  const weightIcon = await loadSprite('sprite/ui/Weight');
  const ageIcon = await loadSprite('sprite/ui/Age');
  const coinIcon = await loadSprite('sprite/ui/Coin');
  const sizeIcon = await loadSprite('sprite/ui/Size');

  const mutationFrame = await loadSprite('sprite/ui/MutationFrame');
  const progressStar = await loadSprite('sprite/ui/ProgressStar');
  const strengthStar = await loadSprite('sprite/ui/StrengthStar');

  const mutationIcons: Record<string, HTMLImageElement | null> = {};
  for (const [key, spriteId] of Object.entries(MUTATION_UI_SPRITES)) {
    mutationIcons[key] = await loadSprite(spriteId);
  }

  ctx.save();
  ctx.translate(cardW / 2, cardH / 2);

  // ---- Item sprite (clipped to portrait window) ----
  if (itemSpriteCanvas) {
    const scale = data.itemScale ?? 1;
    const petScale = data.cardType === 'Pet' && data.petTargetScale != null
      ? data.petTargetScale
      : undefined;

    const typeScale = itemTypeScale(data.cardType, scale, petScale);
    const maxDim = Math.max(itemSpriteCanvas.width, itemSpriteCanvas.height);
    const baseScale = n * typeScale / Math.max(1, maxDim);
    const itemVisualScale = data.itemVisualScale ?? 1;
    const drawScale = baseScale * 1.35 * itemVisualScale;

    const drawW = itemSpriteCanvas.width * drawScale;
    const drawH = itemSpriteCanvas.height * drawScale;
    const anchorX = 0.5 * drawW;
    const isBottom = data.cardType === 'Pet' || data.cardType === 'Plant' || data.cardType === 'Crop';
    const extra = data.cardType === 'Pet' ? 120 : data.cardType === 'Crop' ? 175 : data.cardType === 'Plant' ? 135 : 0;
    const anchorY = (isBottom ? 1 : 0.5) * drawH;
    const posY = isBottom ? (r + n / 2 + extra) : (r + n / 2);
    const rotation = ((data.itemRotation ?? 0) * Math.PI) / 180;

    // Clip to portrait window
    const scaleX = cardW / PORTRAIT.baseW;
    const scaleY = cardH / PORTRAIT.baseH;
    const clipX = -cardW / 2 + PORTRAIT.x * scaleX;
    const clipY = -cardH / 2 + PORTRAIT.y * scaleY;
    const clipW = PORTRAIT.w * scaleX;
    const clipH = PORTRAIT.h * scaleY;
    ctx.save();
    ctx.beginPath();
    ctx.rect(clipX, clipY, clipW, clipH);
    ctx.clip();
    ctx.translate(0, posY);
    if (rotation !== 0) ctx.rotate(rotation);
    ctx.drawImage(itemSpriteCanvas, -anchorX, -anchorY, drawW, drawH);
    ctx.restore();
  }

  // ---- Name ----
  const rawName = resolveItemName(data.cardType, data);
  let displayName = rawName;
  if (data.cardType === 'Pet') {
    const petName = state.gameData?.pets?.[data.itemId ?? '']?.name;
    if (!petName || rawName === petName) {
      displayName = rawName.toUpperCase();
    }
  } else {
    displayName = rawName.toUpperCase();
  }

  setFont(ctx, NAME_FONT_SIZE, '400', 'Shrikhand');
  ctx.fillStyle = COLOR_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const nameWrap = cardW - AH * 2 - TG;
  const truncated = truncateToTwoLines(ctx, displayName, nameWrap);
  const nameLines = wrapText(ctx, truncated, nameWrap);
  const nameBlockH = nameLines.length * NAME_LINE_HEIGHT;
  const nameStartY = nameY - nameBlockH / 2 + NAME_LINE_HEIGHT / 2;
  nameLines.forEach((line, idx) => {
    ctx.fillText(line, 0, nameStartY + idx * NAME_LINE_HEIGHT);
  });

  // ---- Mutation icons above name ----
  if (mutations.length > 0 && mutationFrame) {
    const ordered = sortMutations(mutations);
    const totalWidth = ordered.length * VA + (ordered.length - 1) * ZH;
    const startX = rowWidth / 2 - totalWidth;
    const baseY = nameY - RH / 2 + EG - VA / 2;
    ordered.forEach((mut, idx) => {
      const icon = mutationIcons[mut];
      const cx = startX + VA / 2 + idx * (VA + ZH);
      const cy = baseY + VA / 2;
      drawImageCentered(ctx, mutationFrame, cx, cy, VA);
      if (icon) drawImageCentered(ctx, icon, cx, cy, VA * 0.6);
    });
  }

  // ---- Details rows ----
  let cursorY = 0;

  if (data.cardType === 'Plant') {
    const plant = state.gameData?.plants?.[data.itemId ?? ''];
    const slotCount = Math.max(1, data.plantSlotCount ?? 1);
    const maturedSlots = Math.max(0, Math.min(slotCount, data.plantMaturedSlots ?? 0));
    const maturityPct = Math.max(0, Math.min(100, data.plantMaturityPct ?? 0));
    const secondsToMature = plant?.plant?.secondsToMature ?? 0;
    const totalMs = Math.max(1, secondsToMature * 1000);
    const elapsed = totalMs * (maturityPct / 100);
    const remaining = totalMs - elapsed;
    const fullyGrown = maturityPct >= 100;
    const barLabel = fullyGrown ? 'Fully grown' : formatDuration(remaining);

    if (slotCount === 1) {
      drawProgressBarRow(ctx, {
        label: 'Maturity',
        value: elapsed,
        max: totalMs,
        color: '#9FC12B',
        y: detailsY + cursorY,
        rowWidth,
        barLabel,
      }, { strengthStar });
      cursorY += 32 + 12;
    } else {
      drawProgressBarRow(ctx, {
        label: 'Maturity',
        value: elapsed,
        max: totalMs,
        color: '#9FC12B',
        y: detailsY + cursorY,
        rowWidth,
        barLabel,
      }, { strengthStar });
      cursorY += 32 + 12;

      const label = maturedSlots > 0
        ? `Harvestable crops: ${maturedSlots}/${slotCount}`
        : 'No harvestable crops';
      const cropIconPromises = Array.from({ length: maturedSlots }, async () => {
        const cropSpriteId = plant?.crop?.sprite ?? null;
        return cropSpriteId ? await loadSprite(cropSpriteId) : null;
      });
      const cropIcons = (await Promise.all(cropIconPromises)).filter((img): img is HTMLImageElement => !!img);
      const rowH = drawMatureCropsRow(ctx, detailsY + cursorY, rowWidth, label, cropIcons);
      cursorY += rowH;
      cursorY += -rowH / 2 + 15;
    }

    // Size row for produce if single-slot and fully grown
    if (slotCount === 1 && plant?.crop) {
      const sizeVal = cropSize(data.itemId ?? '', data.itemScale ?? 1);
      drawSizeRow(ctx, detailsY + cursorY, `${Math.round(sizeVal)}`, rowWidth, { size: sizeIcon });
      cursorY += 38 + 8;
    }
  }

  if (data.cardType === 'Crop') {
    const sizeVal = cropSize(data.itemId ?? '', data.itemScale ?? 1);
    drawSizeRow(ctx, detailsY + cursorY, `${Math.round(sizeVal)}`, rowWidth, { size: sizeIcon });
    cursorY += 38 + 8;
  }

  // Abilities (non-pet)
  if (data.cardType !== 'Pet') {
    const abilities: string[] = [];
    if (data.cardType === 'Plant' || data.cardType === 'Seed') {
      const plant = state.gameData?.plants?.[data.itemId ?? ''] as any;
      if (plant?.plant?.abilities && Array.isArray(plant.plant.abilities)) {
        abilities.push(...plant.plant.abilities);
      }
    }
    if (abilities.length > 0) {
      const abilityDefs = abilities.map(id => {
        const def = state.gameData?.abilities?.[id];
        return {
          id,
          name: def?.name ?? id,
          color: abilityColor(id),
          disabled: false,
        };
      });
      const h = drawAbilitiesRow(ctx, detailsY + cursorY, rowWidth, abilityDefs);
      cursorY += h + 8;
    }
  }

  // Crop weight/sell row
  if (data.cardType === 'Crop') {
    const crop = state.gameData?.plants?.[data.itemId ?? '']?.crop;
    if (crop) {
      const weight = (data.itemScale ?? 1) * crop.baseWeight;
      const sell = Math.round(crop.baseSellPrice * (data.itemScale ?? 1) * mutationMultiplier(mutations));
      drawWeightSellRow(ctx, detailsY + bottomOffset, formatWeight(weight), sell.toLocaleString(), {
        weight: weightIcon,
        coin: coinIcon,
      });
    }
  }

  // Plant weight/sell row for single-slot mature crops
  if (data.cardType === 'Plant') {
    const plant = state.gameData?.plants?.[data.itemId ?? ''];
    const slotCount = Math.max(1, data.plantSlotCount ?? 1);
    const maturityPct = Math.max(0, Math.min(100, data.plantMaturityPct ?? 0));
    if (plant?.crop && slotCount === 1 && maturityPct >= 100) {
      const weight = (data.itemScale ?? 1) * plant.crop.baseWeight;
      const sell = Math.round(plant.crop.baseSellPrice * (data.itemScale ?? 1) * mutationMultiplier(mutations));
      drawWeightSellRow(ctx, detailsY + bottomOffset, formatWeight(weight), sell.toLocaleString(), {
        weight: weightIcon,
        coin: coinIcon,
      });
    }
  }

  // Egg rows
  if (data.cardType === 'Egg') {
    const egg = state.gameData?.eggs?.[data.itemId ?? ''];
    if (egg) {
      cursorY += 30;
      const species = Object.keys(egg.faunaSpawnWeights ?? {});
      const hatchIcons = (await Promise.all(species.map(async id => {
        const sprite = state.gameData?.pets?.[id]?.sprite ?? null;
        return sprite ? await loadSprite(sprite) : null;
      }))).filter((img): img is HTMLImageElement => !!img);
      cursorY += drawEggHatchesRow(ctx, detailsY + cursorY, rowWidth, 'Hatches', hatchIcons);

      const goldChance = (state.gameData?.mutations?.Gold?.baseChance ?? 0) * 100;
      const rainbowChance = (state.gameData?.mutations?.Rainbow?.baseChance ?? 0) * 100;
      const goldText = Number.isInteger(goldChance) ? `${goldChance}%` : `${goldChance.toFixed(1)}%`;
      const rainbowText = Number.isInteger(rainbowChance) ? `${rainbowChance}%` : `${rainbowChance.toFixed(1)}%`;
      drawEggGoldRainbowRatesRow(ctx, detailsY + bottomOffset, goldText, rainbowText, {
        frame: mutationFrame,
        gold: mutationIcons.Gold,
        rainbow: mutationIcons.Rainbow,
      });
    }
  }

  

  // Pet rows
  if (data.cardType === 'Pet') {
    const pet = state.gameData?.pets?.[data.itemId ?? ''];
    if (pet) {
      const xp = data.petXp ?? 0;
      const targetScale = data.petTargetScale ?? 1;
      const hunger = data.petHunger ?? pet.coinsToFullyReplenishHunger ?? 0;
      const strength = currentStrength(data.itemId ?? '', xp, targetScale);
      const maxStr = maxStrength(data.itemId ?? '', targetScale);
      const isMax = strength >= maxStr;
      const nextStrength = strength + 1;
      const nextXp = xpForStrength(nextStrength, data.itemId ?? '', targetScale);
      const nextLabel = isMax || nextStrength === maxStr ? String(maxStr) : String(nextStrength);

      const barColor = isMax ? '#25AAE2' : '#0067B4';
      drawProgressBarRow(ctx, {
        label: 'Strength',
        value: xp,
        max: isMax ? xp : nextXp,
        color: barColor,
        y: detailsY + cursorY,
        rowWidth,
        showMaxLabel: true,
        maxLabelValue: String(maxStr),
        nextLabelValue: nextLabel,
        currentLabelValue: String(strength),
        fullyGrown: isMax,
      }, { progressStar, strengthStar });
      cursorY += 32 + 14;

      const dietIds = data.petDietIds ?? pet.diet ?? [];
      const leftPad = rowWidth * 0.35 - 55;
      const rightPad = dietIds.length * 22 + 12; // step = iconSize(40) + overlap(-18) = 22
      drawProgressBarRow(ctx, {
        label: 'Hunger',
        value: hunger,
        max: pet.coinsToFullyReplenishHunger ?? 0,
        color: '#5EAC46',
        y: detailsY + cursorY,
        rowWidth,
        leftPad,
        rightPad,
        colorByPct: (pct) => pct <= HUNGER_LOW_THRESHOLD ? HUNGER_LOW_COLOR : '#5EAC46',
      }, { strengthStar });

      // Diet sprites aligned with hunger row
      const dietIcons = (await Promise.all(dietIds.map(async id => {
        const sprite = state.gameData?.plants?.[id]?.crop?.sprite ?? null;
        return sprite ? await loadSprite(sprite) : null;
      }))).filter((img): img is HTMLImageElement => !!img);
      drawDietSpritesOnly(ctx, detailsY + cursorY, rowWidth, dietIcons);
      cursorY += 32 + 9;

      // Weight / Age / Sell row
      const weight = weightScale(data.itemId ?? '', xp, targetScale) * pet.matureWeight;
      const sell = Math.round(pet.maturitySellPrice * weightScale(data.itemId ?? '', xp, targetScale) * mutationMultiplier(mutations));
      const ageHours = Math.floor(xp / XP_PER_HOUR);
      drawWeightAgeRow(ctx, detailsY + bottomOffset, formatWeight(weight), ageHours.toLocaleString(), sell.toLocaleString(), {
        weight: weightIcon,
        age: ageIcon,
        coin: coinIcon,
      });

      // Abilities row
      const weatherId = data.petWeatherId ?? '';
      const entryFallback = data.petAbilities
        ? data.petAbilities.map(id => ({ kind: 'game' as const, id }))
        : Object.keys(pet.innateAbilityWeights ?? {}).map(id => ({ kind: 'game' as const, id }));
      const abilityEntries = data.petAbilityEntries ?? entryFallback;
      const abilityDefs = abilityEntries.map(entry => {
        if (entry.kind === 'custom') {
          const name = (entry.name ?? '').trim();
          if (!name) return null;
          const color = entry.color ?? '#969696';
          return {
            id: `custom:${name}`,
            name,
            color,
            disabled: false,
          };
        }
        const id = entry.id ?? '';
        if (!id) return null;
        const def = state.gameData?.abilities?.[id];
        const requiredWeather = (def?.baseParameters as any)?.requiredWeather;
        const requiresWeather = requiredWeather != null && requiredWeather !== '';
        const weatherMismatch = requiresWeather && (!weatherId || String(requiredWeather) !== weatherId);
        return {
          id,
          name: def?.name ?? id,
          color: abilityColor(id),
          disabled: weatherMismatch,
        };
      }).filter((def): def is { id: string; name: string; color: string; disabled: boolean } => !!def);
      if (abilityDefs.length > 0) {
        const h = drawAbilitiesRow(ctx, detailsY + cursorY, rowWidth, abilityDefs);
        cursorY += h + 8;
      }
    }
  }

  // ---- Top-left type icon ----
  if (typeIcon) {
    const x = -cardW / 2 + G5 + 10;
    const y = -cardH / 2 + G5 + 9;
    const w = typeIcon.naturalWidth;
    const h = typeIcon.naturalHeight;
    const scale = ICON_SIZE / Math.max(w, h);
    ctx.drawImage(typeIcon, x, y, w * scale, h * scale);
  }

  // ---- Lock icon ----
  if (lockIcon) {
    const r = -3;
    const a = -4;
    const cx = cardW / 2 - r - LOCK_SIZE / 2;
    const cy = -cardH / 2 + a + LOCK_SIZE / 2;
    drawImageCentered(ctx, lockIcon, cx, cy, LOCK_SIZE);
  }

  // ---- Rarity gem ----
  if (rarityIcon) {
    const x = -cardW / 2 + G5 + 15;
    const y = cardH / 2 - G5 - 17;
    const w = rarityIcon.naturalWidth;
    const h = rarityIcon.naturalHeight;
    const scale = RARITY_SIZE / Math.max(w, h);
    const dw = w * scale;
    const dh = h * scale;
    ctx.drawImage(rarityIcon, x, y - dh, dw, dh);
  }

  ctx.restore();
}

export function defaultFullCardData(cardType: FullCardType): FullCardData {
  const gd = state.gameData;
  const pickFirst = <T extends Record<string, any>>(obj: T | undefined): string | undefined => {
    if (!obj) return undefined;
    const keys = Object.keys(obj);
    return keys.length > 0 ? keys[0] : undefined;
  };

  const data: FullCardData = {
    cardType,
    itemName: cardType,
  };

  if (!gd) return data;

  switch (cardType) {
    case 'Pet': {
      const id = pickFirst(gd.pets);
      const pet = id ? gd.pets[id] : undefined;
      data.itemId = id;
      data.itemName = pet?.name ?? 'Pet';
      data.rarity = pet?.rarity as FullCardRarity ?? 'Common';
      data.petXp = 0;
      data.petTargetScale = 1;
      data.petHunger = pet?.coinsToFullyReplenishHunger ?? 0;
      data.petAbilities = pet ? Object.keys(pet.innateAbilityWeights ?? {}) : [];
      data.petAbilityEntries = pet
        ? Object.keys(pet.innateAbilityWeights ?? {}).map(id => ({ kind: 'game' as const, id }))
        : [];
      return data;
    }
    case 'Plant': {
      const id = pickFirst(gd.plants);
      const plant = id ? gd.plants[id] : undefined;
      data.itemId = id;
      data.itemName = plant?.plant?.name ?? 'Plant';
      data.itemScale = 1;
      const slots = plant?.plant?.slotOffsets?.length;
      data.plantSlotCount = slots && slots > 0 ? slots : 1;
      data.plantMaturedSlots = 0;
      data.plantMaturityPct = 0;
      return data;
    }
    case 'Crop': {
      const id = pickFirst(gd.plants);
      const plant = id ? gd.plants[id] : undefined;
      data.itemId = id;
      data.itemName = plant?.crop?.name ?? 'Crop';
      data.itemScale = 1;
      return data;
    }
    case 'Seed': {
      const id = pickFirst(gd.plants);
      const plant = id ? gd.plants[id] : undefined;
      data.itemId = id;
      data.itemName = plant?.seed?.name ?? 'Seed';
      data.seedRarity = plant?.seed?.rarity as FullCardRarity ?? 'Common';
      return data;
    }
    case 'Egg': {
      const id = pickFirst(gd.eggs);
      const egg = id ? gd.eggs[id] : undefined;
      data.itemId = id;
      data.itemName = egg?.name ?? 'Egg';
      return data;
    }
    case 'Tool': {
      const id = pickFirst(gd.items);
      const tool = id ? gd.items[id] : undefined;
      data.itemId = id;
      data.itemName = tool?.name ?? 'Tool';
      return data;
    }
    case 'Decor': {
      const id = pickFirst(gd.decor);
      const decor = id ? gd.decor[id] : undefined;
      data.itemId = id;
      data.itemName = decor?.name ?? 'Decor';
      return data;
    }
    default:
      return data;
  }
}
