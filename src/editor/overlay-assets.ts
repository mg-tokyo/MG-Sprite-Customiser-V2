export const OVERLAY_ALL_CATEGORY_ID = 'overlays-all';
export const OVERLAY_LEGACY_CATEGORY_ID = 'overlays-local';

export type OverlayGroupKey =
  | 'arrows'
  | 'shapes'
  | 'bubbles'
  | 'styles'
  | 'symbols'
  | 'panels'
  | 'frames'
  | 'connectors'
  | 'tech'
  | 'patterns';

const OVERLAY_GROUP_ORDER: OverlayGroupKey[] = [
  'arrows',
  'shapes',
  'bubbles',
  'styles',
  'symbols',
  'panels',
  'frames',
  'connectors',
  'tech',
  'patterns',
];

const OVERLAY_GROUP_LABELS: Record<OverlayGroupKey, string> = {
  arrows: 'Arrows',
  shapes: 'Shapes',
  bubbles: 'Bubbles',
  styles: 'Styles',
  symbols: 'Symbols',
  panels: 'Panels & Labels',
  frames: 'Frames & Borders',
  connectors: 'Connectors & Callouts',
  tech: 'Tech HUD',
  patterns: 'Patterns & Textures',
};

export interface OverlayCategory {
  id: string;
  label: string;
  group: OverlayGroupKey | 'all';
}

export const LOCAL_OVERLAY_CATEGORIES: ReadonlyArray<OverlayCategory> = [
  { id: OVERLAY_ALL_CATEGORY_ID, label: 'Overlays: All', group: 'all' },
  ...OVERLAY_GROUP_ORDER.map((group) => ({
    id: `overlays-${group}`,
    label: `Overlays: ${OVERLAY_GROUP_LABELS[group]}`,
    group,
  })),
];

const LOCAL_OVERLAY_FILES = [
  'ui/PolaroidBackground.png',
  'overlays/arrow-bidirectional-horizontal.svg',
  'overlays/arrow-bidirectional-vertical.svg',
  'overlays/arrow-bold-down.svg',
  'overlays/arrow-bold-left.svg',
  'overlays/arrow-bold-right.svg',
  'overlays/arrow-bold-up.svg',
  'overlays/arrow-chevron-down.svg',
  'overlays/arrow-chevron-left.svg',
  'overlays/arrow-chevron-right.svg',
  'overlays/arrow-chevron-up.svg',
  'overlays/arrow-curve-left.svg',
  'overlays/arrow-curve-right.svg',
  'overlays/arrow-dashed-down.svg',
  'overlays/arrow-dashed-left.svg',
  'overlays/arrow-dashed-right.svg',
  'overlays/arrow-dashed-up.svg',
  'overlays/arrow-doubleline-down.svg',
  'overlays/arrow-doubleline-left.svg',
  'overlays/arrow-doubleline-right.svg',
  'overlays/arrow-doubleline-up.svg',
  'overlays/arrow-hollow-down.svg',
  'overlays/arrow-hollow-left.svg',
  'overlays/arrow-hollow-right.svg',
  'overlays/arrow-hollow-up.svg',
  'overlays/arrow-solid-down.svg',
  'overlays/arrow-solid-left.svg',
  'overlays/arrow-solid-right.svg',
  'overlays/arrow-solid-up.svg',
  'overlays/arrow-split-left.svg',
  'overlays/arrow-split-right.svg',
  'overlays/arrow-swirl-left.svg',
  'overlays/arrow-swirl-right.svg',
  'overlays/arrow-thin-down.svg',
  'overlays/arrow-thin-left.svg',
  'overlays/arrow-thin-right.svg',
  'overlays/arrow-thin-up.svg',
  'overlays/arrow-uturn-left.svg',
  'overlays/arrow-uturn-right.svg',
  'overlays/arrow-zigzag-left.svg',
  'overlays/arrow-zigzag-right.svg',
  'overlays/bubble-caption-box.svg',
  'overlays/bubble-caption-round.svg',
  'overlays/bubble-chat-down.svg',
  'overlays/bubble-chat-left.svg',
  'overlays/bubble-chat-right.svg',
  'overlays/bubble-chat-round-left.svg',
  'overlays/bubble-chat-round-right.svg',
  'overlays/bubble-chat-spiky-left.svg',
  'overlays/bubble-chat-spiky-right.svg',
  'overlays/bubble-chat-up.svg',
  'overlays/bubble-shout-left.svg',
  'overlays/bubble-shout-right.svg',
  'overlays/bubble-thought-down.svg',
  'overlays/bubble-thought-left.svg',
  'overlays/bubble-thought-right.svg',
  'overlays/bubble-thought-up.svg',
  'overlays/bubble-whisper-left.svg',
  'overlays/bubble-whisper-right.svg',
  'overlays/connector-callout-number-1.svg',
  'overlays/connector-callout-number-2.svg',
  'overlays/connector-curve-left.svg',
  'overlays/connector-curve-right.svg',
  'overlays/connector-elbow-left.svg',
  'overlays/connector-elbow-right.svg',
  'overlays/connector-leader-down.svg',
  'overlays/connector-leader-left.svg',
  'overlays/connector-leader-right.svg',
  'overlays/connector-leader-up.svg',
  'overlays/frame-corners-luxe.svg',
  'overlays/frame-dashed-rounded.svg',
  'overlays/frame-double-line.svg',
  'overlays/frame-grunge.svg',
  'overlays/frame-neon-glow.svg',
  'overlays/frame-ornate-1.svg',
  'overlays/frame-ornate-2.svg',
  'overlays/frame-photo-corners.svg',
  'overlays/frame-stitched-rect.svg',
  'overlays/frame-vintage.svg',
  'overlays/panel-chip-badge.svg',
  'overlays/panel-label-pill.svg',
  'overlays/panel-label-ribbon.svg',
  'overlays/panel-nameplate-luxe.svg',
  'overlays/panel-price-tag.svg',
  'overlays/panel-sticky-note.svg',
  'overlays/panel-tape-strip-horizontal.svg',
  'overlays/panel-tape-strip-vertical.svg',
  'overlays/panel-ticket.svg',
  'overlays/panel-torn-paper.svg',
  'overlays/pattern-blocks.svg',
  'overlays/pattern-checker.svg',
  'overlays/pattern-crosshatch-light.svg',
  'overlays/pattern-diagonal-lines.svg',
  'overlays/pattern-dot-grid.svg',
  'overlays/pattern-grain-speckle.svg',
  'overlays/pattern-halftone-radial.svg',
  'overlays/pattern-mesh.svg',
  'overlays/pattern-stripes-diagonal.svg',
  'overlays/pattern-waveform-fill.svg',
  'overlays/shape-banner.svg',
  'overlays/shape-bracket-round.svg',
  'overlays/shape-bracket-square.svg',
  'overlays/shape-cloud.svg',
  'overlays/shape-frame-rounded.svg',
  'overlays/shape-frame-square.svg',
  'overlays/shape-heart.svg',
  'overlays/shape-pill-fill.svg',
  'overlays/shape-pill-outline.svg',
  'overlays/shape-plus-bold.svg',
  'overlays/shape-polygon-03-fill.svg',
  'overlays/shape-polygon-03-outline.svg',
  'overlays/shape-polygon-04-fill.svg',
  'overlays/shape-polygon-04-outline.svg',
  'overlays/shape-polygon-05-fill.svg',
  'overlays/shape-polygon-05-outline.svg',
  'overlays/shape-polygon-06-fill.svg',
  'overlays/shape-polygon-06-outline.svg',
  'overlays/shape-polygon-07-fill.svg',
  'overlays/shape-polygon-07-outline.svg',
  'overlays/shape-polygon-08-fill.svg',
  'overlays/shape-polygon-08-outline.svg',
  'overlays/shape-polygon-09-fill.svg',
  'overlays/shape-polygon-09-outline.svg',
  'overlays/shape-polygon-10-fill.svg',
  'overlays/shape-polygon-10-outline.svg',
  'overlays/shape-polygon-11-fill.svg',
  'overlays/shape-polygon-11-outline.svg',
  'overlays/shape-polygon-12-fill.svg',
  'overlays/shape-polygon-12-outline.svg',
  'overlays/shape-ribbon.svg',
  'overlays/shape-ring-double.svg',
  'overlays/shape-star-04.svg',
  'overlays/shape-star-05.svg',
  'overlays/shape-star-06.svg',
  'overlays/shape-star-07.svg',
  'overlays/shape-star-08.svg',
  'overlays/shape-star-10.svg',
  'overlays/shape-tag.svg',
  'overlays/shape-x-bold.svg',
  'overlays/style-brush-stroke-1.svg',
  'overlays/style-brush-stroke-2.svg',
  'overlays/style-brush-stroke-3.svg',
  'overlays/style-circle-scribble.svg',
  'overlays/style-confetti.svg',
  'overlays/style-crosshatch.svg',
  'overlays/style-dot-grid.svg',
  'overlays/style-frame-corners-thick.svg',
  'overlays/style-frame-corners-thin.svg',
  'overlays/style-highlight-swipe-1.svg',
  'overlays/style-highlight-swipe-2.svg',
  'overlays/style-highlight-swipe-3.svg',
  'overlays/style-oval-scribble.svg',
  'overlays/style-rays-sunburst.svg',
  'overlays/style-speed-lines-down.svg',
  'overlays/style-speed-lines-left.svg',
  'overlays/style-speed-lines-right.svg',
  'overlays/style-speed-lines-up.svg',
  'overlays/style-stars-cluster.svg',
  'overlays/style-underline-double.svg',
  'overlays/style-underline-swoop.svg',
  'overlays/style-wave-line.svg',
  'overlays/style-zigzag-wide.svg',
  'overlays/symbol-check-circle.svg',
  'overlays/symbol-eye.svg',
  'overlays/symbol-info-circle.svg',
  'overlays/symbol-lightning.svg',
  'overlays/symbol-lock.svg',
  'overlays/symbol-music-note.svg',
  'overlays/symbol-question-circle.svg',
  'overlays/symbol-unlock.svg',
  'overlays/symbol-warning-triangle.svg',
  'overlays/symbol-x-circle.svg',
  'overlays/tech-bracket-target.svg',
  'overlays/tech-crosshair.svg',
  'overlays/tech-data-chip.svg',
  'overlays/tech-hex-grid.svg',
  'overlays/tech-hud-arc.svg',
  'overlays/tech-loading-ring.svg',
  'overlays/tech-reticle-round.svg',
  'overlays/tech-reticle-square.svg',
  'overlays/tech-scanlines.svg',
  'overlays/tech-signal-bars.svg',
] as const;

export interface LocalOverlayAsset {
  id: string;
  label: string;
  file: string;
  group: OverlayGroupKey;
}

function toOverlayLabel(file: string): string {
  const basename = file.split('/').pop() ?? file;
  const withoutExt = basename.replace(/\.[^.]+$/, '');
  const withSpaces = withoutExt
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return withSpaces.replace(/\b\w/g, (char) => char.toUpperCase());
}

function toOverlayId(file: string): string {
  const basename = (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '');
  const slug = basename.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return `overlay/${slug}`;
}

function detectOverlayGroup(file: string): OverlayGroupKey {
  const basename = (file.split('/').pop() ?? file).toLowerCase();
  if (basename.includes('polaroid')) return 'panels';
  if (basename.startsWith('arrow-')) return 'arrows';
  if (basename.startsWith('shape-')) return 'shapes';
  if (basename.startsWith('bubble-')) return 'bubbles';
  if (basename.startsWith('style-')) return 'styles';
  if (basename.startsWith('symbol-')) return 'symbols';
  if (basename.startsWith('panel-')) return 'panels';
  if (basename.startsWith('frame-')) return 'frames';
  if (basename.startsWith('connector-')) return 'connectors';
  if (basename.startsWith('tech-')) return 'tech';
  if (basename.startsWith('pattern-')) return 'patterns';
  return 'styles';
}

export const LOCAL_OVERLAY_ASSETS: ReadonlyArray<LocalOverlayAsset> = LOCAL_OVERLAY_FILES.map((file) => ({
  id: toOverlayId(file),
  label: toOverlayLabel(file),
  file,
  group: detectOverlayGroup(file),
}));

export function normalizeOverlayCategoryId(catId: string): string {
  return catId === OVERLAY_LEGACY_CATEGORY_ID ? OVERLAY_ALL_CATEGORY_ID : catId;
}

export function isOverlayCategoryId(catId: string): boolean {
  const normalized = normalizeOverlayCategoryId(catId);
  return LOCAL_OVERLAY_CATEGORIES.some((cat) => cat.id === normalized);
}

export function getOverlayAssetsForCategory(catId: string): ReadonlyArray<LocalOverlayAsset> {
  const normalized = normalizeOverlayCategoryId(catId);
  if (normalized === OVERLAY_ALL_CATEGORY_ID) return LOCAL_OVERLAY_ASSETS;
  const category = LOCAL_OVERLAY_CATEGORIES.find((item) => item.id === normalized);
  if (!category || category.group === 'all') return LOCAL_OVERLAY_ASSETS;
  return LOCAL_OVERLAY_ASSETS.filter((asset) => asset.group === category.group);
}
