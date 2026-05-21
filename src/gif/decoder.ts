import { GifReader } from 'omggif';

export interface GifFrame {
  canvas: HTMLCanvasElement;
  delay: number; // ms
}

export interface DecodedGif {
  width: number;
  height: number;
  frames: GifFrame[];
  loopCount: number; // 0 = infinite
}

export interface DecodeGifOptions {
  maxFrames?: number;
  maxWidth?: number;
  maxHeight?: number;
  maxPixels?: number;
}

/**
 * Decode a GIF file buffer into individual frames.
 * Follows GIF89a spec: disposal methods, local palettes, transparency.
 */
export function decodeGif(buffer: ArrayBuffer, options: DecodeGifOptions = {}): DecodedGif {
  const data = new Uint8Array(buffer);
  const reader = new GifReader(data as unknown as number[]);
  const width = reader.width;
  const height = reader.height;
  const numFrames = reader.numFrames();
  const maxFrames = options.maxFrames ?? 180;
  const maxWidth = options.maxWidth ?? 2048;
  const maxHeight = options.maxHeight ?? 2048;
  const maxPixels = options.maxPixels ?? 4_194_304;

  if (width <= 0 || height <= 0) {
    throw new Error('GIF has invalid dimensions.');
  }
  if (width > maxWidth || height > maxHeight || width * height > maxPixels) {
    throw new Error(`GIF dimensions exceed supported limits (${maxWidth}x${maxHeight}).`);
  }
  if (numFrames <= 0 || numFrames > maxFrames) {
    throw new Error(`GIF frame count exceeds supported limit (${maxFrames}).`);
  }

  // Compositing canvas (carries state between frames per disposal rules)
  const compCanvas = document.createElement('canvas');
  compCanvas.width = width;
  compCanvas.height = height;
  const compCtx = compCanvas.getContext('2d')!;

  const frames: GifFrame[] = [];

  for (let i = 0; i < numFrames; i++) {
    const info = reader.frameInfo(i);
    const delay = Math.max(info.delay * 10, 20); // GIF delay is in 1/100s, minimum 20ms

    // Decode frame pixels into RGBA
    const pixels = new Uint8ClampedArray(width * height * 4);
    reader.decodeAndBlitFrameRGBA(i, pixels);

    // Create ImageData for this frame
    const frameData = new ImageData(pixels, width, height);

    // Temp canvas for this frame's raw data
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext('2d')!;
    tempCtx.putImageData(frameData, 0, 0);

    // Apply disposal from PREVIOUS frame before drawing current
    // (handled by compositing order — we draw onto compCanvas)

    // Handle disposal method for current frame
    const disposal = info.disposal;

    // Save state before drawing (for restorePrevious)
    let savedData: ImageData | null = null;
    if (disposal === 3) {
      savedData = compCtx.getImageData(0, 0, width, height);
    }

    // Draw current frame onto composite
    if (disposal === 2) {
      // Clear the frame area before drawing
      compCtx.clearRect(info.x, info.y, info.width, info.height);
    }

    compCtx.drawImage(tempCanvas, 0, 0);

    // Capture the composited frame
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = width;
    outputCanvas.height = height;
    const outputCtx = outputCanvas.getContext('2d')!;
    outputCtx.drawImage(compCanvas, 0, 0);

    frames.push({ canvas: outputCanvas, delay });

    // Post-frame disposal
    if (disposal === 2) {
      compCtx.clearRect(info.x, info.y, info.width, info.height);
    } else if (disposal === 3 && savedData) {
      compCtx.putImageData(savedData, 0, 0);
    }
  }

  return { width, height, frames, loopCount: 0 };
}
