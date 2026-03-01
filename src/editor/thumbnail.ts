import { spriteLoader } from '../api/sprite-loader';

/**
 * Cached content bounding box per original URL.
 * Stored as [srcX, srcY, srcW, srcH] in original image pixels, or null = fully transparent.
 */
const boundsCache = new Map<string, [number, number, number, number] | null>();

/**
 * Find the tight axis-aligned bounding box of non-transparent pixels.
 * Scans a downscaled copy (max 128×128) for speed; bounds are scaled back to original coords.
 */
function getContentBounds(img: HTMLImageElement, url: string): [number, number, number, number] | null {
  const cached = boundsCache.get(url);
  if (cached !== undefined) return cached;

  // Downsample to at most 128×128 for fast scanning
  const SCAN = 128;
  const scanW = Math.min(img.naturalWidth, SCAN);
  const scanH = Math.min(img.naturalHeight, SCAN);
  const scaleX = img.naturalWidth / scanW;
  const scaleY = img.naturalHeight / scanH;

  const tmp = document.createElement('canvas');
  tmp.width = scanW;
  tmp.height = scanH;
  const tmpCtx = tmp.getContext('2d')!;
  tmpCtx.drawImage(img, 0, 0, scanW, scanH);
  const { data } = tmpCtx.getImageData(0, 0, scanW, scanH);

  let minX = scanW, minY = scanH, maxX = -1, maxY = -1;
  for (let y = 0; y < scanH; y++) {
    for (let x = 0; x < scanW; x++) {
      if (data[(y * scanW + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const result: [number, number, number, number] | null = maxX >= minX
    ? [
        Math.floor(minX * scaleX),
        Math.floor(minY * scaleY),
        Math.ceil((maxX - minX + 1) * scaleX),
        Math.ceil((maxY - minY + 1) * scaleY),
      ]
    : null;

  boundsCache.set(url, result);
  return result;
}

/**
 * Load a sprite URL and render it into a canvas, automatically cropped to
 * its non-transparent pixel content and scaled to fill the canvas.
 *
 * This makes expression/face cosmetics (which are full-body PNGs with only
 * a small face region filled in) appear large and clear in thumbnails.
 */
export async function renderThumb(url: string, canvas: HTMLCanvasElement): Promise<void> {
  let img: HTMLImageElement;
  try {
    img = await spriteLoader.load(url, -1);
  } catch {
    return;
  }

  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const bounds = getContentBounds(img, url);
  if (!bounds) return;

  const [bx, by, bw, bh] = bounds;

  // Square region centered on content, with 12% padding so the sprite doesn't touch the edge.
  // Important: keep this square even when it extends outside image bounds, otherwise clamping
  // to a non-square source rectangle will stretch/squash the thumbnail.
  const maxDim = Math.max(bw, bh);
  const side = Math.max(1, Math.ceil(maxDim * 1.12));
  const cx = bx + bw / 2;
  const cy = by + bh / 2;
  const srcLeft = cx - side / 2;
  const srcTop = cy - side / 2;

  const crop = document.createElement('canvas');
  crop.width = side;
  crop.height = side;
  const cropCtx = crop.getContext('2d');
  if (!cropCtx) return;

  // Draw into a square intermediate canvas with transparent padding outside image bounds.
  cropCtx.clearRect(0, 0, side, side);
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.imageSmoothingQuality = 'high';
  cropCtx.drawImage(img, -srcLeft, -srcTop);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(crop, 0, 0, side, side, 0, 0, canvas.width, canvas.height);
}
