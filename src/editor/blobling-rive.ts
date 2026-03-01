/**
 * Rive-based blobling animation renderer.
 *
 * The game's avatar uses a Rive file (avatarelements) with:
 * - Artboard "AvatarElements"
 * - State machine "State Machine 1" with inputs: animation (num), expression (num), etc.
 * - Image assets "Bottom", "Mid", "Top" populated with cosmetic PNGs at runtime
 *
 * Only loaded on demand — the WASM runtime (~3 MB) is fetched the first time
 * the user picks an animation.
 */
import { state } from '../state/store';

const RIVE_FILE_NAME = 'avatarelements-svucgdqc.riv';
/** Target size for rendered blobling frames (px). */
const TARGET_SIZE = 256;
/** Render FPS for state machine animation capture. */
const RENDER_FPS = 12;
/** Frames captured per animation render (≈2.5 s at 12fps). */
const FRAME_COUNT = 30;

// ── Known game data ──────────────────────────────────────────────────────────

/** Animation indices sent to the state machine `animation` input. From game source. */
export const BLOBLING_ANIMATIONS = [
  { id: 0, name: 'Idle' },
  { id: 1, name: 'Deciding' },
  { id: 2, name: 'Locked' },
  { id: 3, name: 'Leading' },
  { id: 4, name: 'Losing' },
  { id: 5, name: 'Won' },
  { id: 6, name: 'Looking Up' },
  { id: 7, name: 'Looking Down' },
  { id: 8, name: 'Pop' },
  { id: 9, name: 'Holding' },
  { id: 10, name: 'Sitting' },
  { id: 11, name: 'Sleeping Left' },
  { id: 12, name: 'Sleeping Right' },
] as const;

/** Rive image asset names that correspond to cosmetic categories. */
const RIVE_IMAGE_LAYERS = ['Bottom', 'Mid', 'Top'] as const;

/**
 * Expression PNG filenames in order, matching the Rive state machine `expression` input (0–17).
 * From game source (avatarRiveConstants.ts).
 */
export const BLOBLING_EXPRESSIONS = [
  'Expression_Default.png',
  'Expression_Alarmed.png',
  'Expression_Annoyed.png',
  'Expression_Bashful.png',
  'Expression_Calm3.png',
  'Expression_Crying.png',
  'Expression_Cute.png',
  'Expression_Derpy.png',
  'Expression_Happy.png',
  'Expression_Mad.png',
  'Expression_Pouty.png',
  'Expression_Shocked.png',
  'Expression_Thinking.png',
  'Expression_Tired.png',
  'Expression_Loopy.png',
  'Expression_SoHappy.png',
  'Expression_Vampire.png',
  'Expression_Stressed.png',
] as const;

/**
 * Returns the Rive expression index (0–17) from a cosmetic URL like
 * `https://…/cosmetic/Expression_Happy.png`. Falls back to 0 (Default).
 */
export function getExpressionIndex(url: string): number {
  const filename = url.split('/').pop() ?? '';
  const idx = (BLOBLING_EXPRESSIONS as readonly string[]).indexOf(filename);
  return idx >= 0 ? idx : 0;
}

const ARTBOARD_NAME = 'AvatarElements';
const STATE_MACHINE_NAME = 'State Machine 1';

// ── Module singletons ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runtimePromise: Promise<any> | null = null;
/** Deduplicated file-load promises (prevents concurrent loads of the same URL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rivFilePromises = new Map<string, Promise<any>>();
/** Captured Rive ImageAsset references per .riv URL, keyed by asset name. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const imageAssetsCache = new Map<string, Map<string, any>>();
/** Track which cosmetic URL is currently loaded into each image asset. */
const loadedImageUrls = new Map<string, Map<string, string>>();

// ── Runtime loader ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRuntime(): Promise<any> {
  if (runtimePromise) return runtimePromise;

  runtimePromise = (async () => {
    const { default: RiveCanvas } = await import('@rive-app/canvas-advanced');
    const RIVE_VERSION = '2.35.0';
    const CDN = `https://unpkg.com/@rive-app/canvas-advanced@${RIVE_VERSION}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (RiveCanvas as any)({
      locateFile: (file: string) =>
        `${CDN}/${file.replace(/^canvas_advanced/, 'rive')}`,
    });
  })().catch((err) => {
    runtimePromise = null;
    throw err;
  });

  return runtimePromise;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

const IS_DEV = import.meta.env.DEV;

function toFetchUrl(url: string): string {
  const isLocal =
    IS_DEV ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
  if (isLocal && url.startsWith('https://magicgarden.gg/')) {
    return url.replace('https://magicgarden.gg/', '/mggg-proxy/');
  }
  return url;
}

/**
 * Returns the CDN URL for the Rive avatar-elements file, derived from the
 * currently loaded sprite-data's base URL (which contains the game version).
 */
export function getRiveFileUrl(): string | null {
  const baseUrl = state.spriteData?.baseUrl ?? '';
  const match = baseUrl.match(/\/version\/(\d+)/);
  if (!match) return null;
  return `https://magicgarden.gg/version/${match[1]}/assets/${RIVE_FILE_NAME}`;
}

// ── File loader (with asset capture) ─────────────────────────────────────────

/**
 * Load the .riv file and capture its image asset references so we can later
 * populate them with cosmetic PNGs via `loadImageAsset()`.
 *
 * Uses promise deduplication — concurrent calls for the same URL share one load.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRivFile(rivUrl: string): Promise<any> {
  const existing = rivFilePromises.get(rivUrl);
  if (existing) return existing;

  const promise = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rive: any = await getRuntime();
    const resp = await fetch(toFetchUrl(rivUrl));
    if (!resp.ok) throw new Error(`[Blobling] Rive fetch failed: ${resp.status}`);
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // Capture image assets during load so we can populate them later.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageAssets = new Map<string, any>();
    const assetLoader = new rive.CustomFileAssetLoader({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadContents: (asset: any, _bytes: any) => {
        if (asset.isImage) {
          const name = String(asset.name);
          imageAssets.set(name, asset);
          return true; // we'll load images ourselves
        }
        return false; // let runtime handle fonts/audio
      },
    });

    const file = await rive.load(bytes, assetLoader);
    imageAssetsCache.set(rivUrl, imageAssets);
    loadedImageUrls.set(rivUrl, new Map());
    return file;
  })().catch((err) => {
    // Allow retry on failure.
    rivFilePromises.delete(rivUrl);
    throw err;
  });

  rivFilePromises.set(rivUrl, promise);
  return promise;
}

// ── Image asset loading ──────────────────────────────────────────────────────

/**
 * Load a cosmetic PNG into one of the Rive file's image assets.
 * Skips if the same URL is already loaded into that asset.
 */
async function loadImageAsset(rivUrl: string, assetName: string, imageUrl: string): Promise<void> {
  // Skip if already loaded
  const loaded = loadedImageUrls.get(rivUrl);
  if (loaded?.get(assetName) === imageUrl) return;

  const assets = imageAssetsCache.get(rivUrl);
  if (!assets) {
    console.warn(`[Blobling] No image assets cached for ${rivUrl}`);
    return;
  }
  const asset = assets.get(assetName);
  if (!asset) {
    console.warn(`[Blobling] Image asset "${assetName}" not found. Available: ${[...assets.keys()].join(', ')}`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rive: any = await getRuntime();
  const resp = await fetch(toFetchUrl(imageUrl));
  if (!resp.ok) {
    console.warn(`[Blobling] Failed to fetch cosmetic image: ${resp.status} ${imageUrl}`);
    return;
  }
  const imgBytes = new Uint8Array(await resp.arrayBuffer());

  await new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rive.decodeImage(imgBytes, (image: any) => {
      if (image) {
        asset.setRenderImage(image);
        image.unref();
        loaded?.set(assetName, imageUrl);
        resolve();
      } else {
        reject(new Error(`[Blobling] Failed to decode image: ${imageUrl}`));
      }
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BloblingAnimation {
  id: number;
  name: string;
}

/**
 * Returns the list of known blobling animations. Also ensures the Rive file
 * is loaded (triggering image asset capture) as a side-effect.
 */
export async function getBloblingAnimations(rivUrl: string): Promise<BloblingAnimation[]> {
  await getRivFile(rivUrl); // ensure file + assets are loaded
  return BLOBLING_ANIMATIONS.map(a => ({ id: a.id, name: a.name }));
}

/**
 * Render animation frames for the blobling.
 *
 * 1. Loads cosmetic PNGs into the Rive file's image assets (Bottom/Mid/Top).
 * 2. Creates the AvatarElements artboard + State Machine 1.
 * 3. Sets the `animation` and `expression` inputs.
 * 4. Advances the state machine and captures frames.
 *
 * @param rivUrl           URL of the .riv file
 * @param animIndex        Animation index (0=Idle, 1=Deciding, etc.)
 * @param cosmeticUrls     Map of Bottom/Mid/Top category → image URL
 * @param expressionIndex  Expression index 0–17 (default 0 = Default)
 */
export async function renderBloblingFrames(
  rivUrl: string,
  animIndex: number,
  cosmeticUrls: Record<string, string>,
  expressionIndex = 0,
): Promise<{ canvas: HTMLCanvasElement; delay: number }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rive: any = await getRuntime();
  const file = await getRivFile(rivUrl);

  // Load cosmetic PNGs into Rive image assets (Bottom, Mid, Top).
  const loadPromises: Promise<void>[] = [];
  for (const layer of RIVE_IMAGE_LAYERS) {
    const url = cosmeticUrls[layer];
    if (url) {
      loadPromises.push(
        loadImageAsset(rivUrl, layer, url).catch(err =>
          console.warn(`[Blobling] Failed to load ${layer}:`, err),
        ),
      );
    }
  }
  if (loadPromises.length > 0) {
    await Promise.all(loadPromises);
  }

  // Use the AvatarElements artboard (NOT defaultArtboard).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let artboard: any;
  try {
    artboard = file.artboardByName(ARTBOARD_NAME);
  } catch (err) {
    console.warn(`[Blobling] Artboard "${ARTBOARD_NAME}" not found, using default:`, err);
    artboard = file.defaultArtboard();
  }

  // Set up state machine.
  const sm = artboard.stateMachineByName(STATE_MACHINE_NAME);
  if (!sm) {
    console.warn(`[Blobling] State machine "${STATE_MACHINE_NAME}" not found`);
    return [];
  }

  const smInstance = new rive.StateMachineInstance(sm, artboard);

  // Set animation and expression inputs.
  const inputCount: number = smInstance.inputCount();
  for (let i = 0; i < inputCount; i++) {
    const input = smInstance.input(i);
    if (input.type !== rive.SMIInput.number) continue;
    const name = String(input.name);
    if (name === 'animation') input.asNumber().value = animIndex;
    if (name === 'expression') input.asNumber().value = expressionIndex;
  }

  // Determine canvas dimensions from artboard bounds.
  const bounds = artboard.bounds;
  const artW = (bounds.maxX - bounds.minX) || TARGET_SIZE;
  const artH = (bounds.maxY - bounds.minY) || TARGET_SIZE;
  const scale = TARGET_SIZE / Math.max(artW, artH);
  const w = Math.max(1, Math.round(artW * scale));
  const h = Math.max(1, Math.round(artH * scale));

  const workCanvas = document.createElement('canvas');
  workCanvas.width = w;
  workCanvas.height = h;
  const renderer = rive.makeRenderer(workCanvas);

  const dt = 1 / RENDER_FPS;
  const delayMs = Math.round(1000 / RENDER_FPS);
  const frames: { canvas: HTMLCanvasElement; delay: number }[] = [];

  for (let i = 0; i < FRAME_COUNT; i++) {
    smInstance.advance(dt);
    artboard.advance(dt);

    renderer.clear();
    renderer.save();
    renderer.align(
      rive.Fit.contain,
      rive.Alignment.center,
      { minX: 0, minY: 0, maxX: w, maxY: h },
      bounds,
    );
    artboard.draw(renderer);
    renderer.restore();
    rive.resolveAnimationFrame(); // flush() is a no-op; this executes the deferred draw queue

    const fc = document.createElement('canvas');
    fc.width = w;
    fc.height = h;
    fc.getContext('2d')!.drawImage(workCanvas, 0, 0);
    frames.push({ canvas: fc, delay: delayMs });
  }

  return frames;
}
