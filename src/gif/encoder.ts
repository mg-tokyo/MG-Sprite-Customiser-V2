/**
 * GIF encoder using gif.js (loaded from same-origin static assets).
 * gif.js requires a Web Worker, so we load it dynamically.
 */

// gif.js global type
interface GifJSInstance {
  addFrame(canvas: HTMLCanvasElement, options: { delay: number; copy: boolean }): void;
  on(event: 'finished', handler: (blob: Blob) => void): void;
  on(event: 'progress', handler: (p: number) => void): void;
  render(): void;
}

interface GifJSConstructor {
  new (options: {
    workers: number;
    quality: number;
    width: number;
    height: number;
    workerScript: string;
    transparent?: number;
  }): GifJSInstance;
}

declare const GIF: GifJSConstructor | undefined;

const GIF_JS_LOCAL = `${import.meta.env.BASE_URL}vendor/gif.js`;
const GIF_WORKER_LOCAL = `${import.meta.env.BASE_URL}vendor/gif.worker.js`;

let gifJsLoaded = false;

async function loadGifJs(): Promise<void> {
  if (gifJsLoaded) return;
  if (typeof GIF !== 'undefined') {
    gifJsLoaded = true;
    return;
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIF_JS_LOCAL;
    script.onload = () => {
      gifJsLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load gif.js'));
    document.head.append(script);
  });
}

export interface EncodeOptions {
  frames: { canvas: HTMLCanvasElement; delay: number }[];
  width: number;
  height: number;
  quality?: number;
  onProgress?: (progress: number) => void;
}

export async function encodeGif(options: EncodeOptions): Promise<Blob> {
  await loadGifJs();

  if (typeof GIF === 'undefined') {
    throw new Error('gif.js not loaded');
  }

  return new Promise((resolve, reject) => {
    try {
      const gif = new GIF({
        workers: 4,
        quality: options.quality ?? 10,
        width: options.width,
        height: options.height,
        workerScript: GIF_WORKER_LOCAL,
        transparent: 0x000000,
      });

      for (const frame of options.frames) {
        gif.addFrame(frame.canvas, { delay: frame.delay, copy: true });
      }

      gif.on('finished', (blob: Blob) => resolve(blob));
      if (options.onProgress) {
        gif.on('progress', options.onProgress);
      }

      gif.render();
    } catch (err) {
      reject(err);
    }
  });
}
