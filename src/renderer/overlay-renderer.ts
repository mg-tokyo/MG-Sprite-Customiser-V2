import { calcOverlayPosition } from '../../mg-sprite-render/src';

/**
 * Composite a tall plant overlay onto the base sprite canvas.
 * The overlay is masked by the base sprite's silhouette (destination-in).
 */
export function compositeOverlay(
  baseCanvas: HTMLCanvasElement,
  overlayImg: HTMLImageElement,
  anchorX = 0.5,
  anchorY = 1.0,
): void {
  const ctx = baseCanvas.getContext('2d')!;
  const { width: baseW, height: baseH } = baseCanvas;
  const overlayW = overlayImg.naturalWidth;
  const overlayH = overlayImg.naturalHeight;

  const pos = calcOverlayPosition(baseW, baseH, overlayW, overlayH, anchorX, anchorY);

  // Create masked overlay
  const temp = document.createElement('canvas');
  temp.width = baseW;
  temp.height = baseH;
  const tctx = temp.getContext('2d')!;

  // Draw overlay at position
  tctx.drawImage(overlayImg, pos.x, pos.y);

  // Mask by base sprite silhouette
  tctx.globalCompositeOperation = 'destination-in';
  tctx.drawImage(baseCanvas, 0, 0);

  // Composite onto base
  ctx.drawImage(temp, 0, 0);
}
