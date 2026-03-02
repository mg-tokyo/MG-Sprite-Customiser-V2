export function drawExportHoloOverlay(
  ctx: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  _timeMs: number,
  lightIntensity: number,
  holoIntensity: number,
  tiltXDeg = 0,
  tiltYDeg = 0,
): void {
  const lightStrength = Math.max(0, lightIntensity);
  const holoStrength = Math.max(0, holoIntensity);
  const lightClamped = Math.min(1, lightStrength);
  const holoClamped = Math.min(1, holoStrength);
  if (lightStrength <= 0 && holoStrength <= 0) return;

  const width = baseCanvas.width;
  const height = baseCanvas.height;
  if (width <= 0 || height <= 0) return;

  const scratch = getScratchCanvas(width, height);
  const octx = scratch.getContext('2d');
  if (!octx) return;

  const tx = tiltXDeg * (Math.PI / 180);
  const ty = tiltYDeg * (Math.PI / 180);

  // Card normal from tilt.
  const nx = -Math.sin(ty);
  const ny = Math.sin(tx);
  const nz = Math.max(0.001, Math.cos(tx) * Math.cos(ty));

  // Fixed light and view vectors.
  const lx = -0.42;
  const ly = -0.48;
  const lz = 0.77;
  const ll = Math.hypot(lx, ly, lz);
  const lnx = lx / ll;
  const lny = ly / ll;
  const lnz = lz / ll;
  const vx = 0;
  const vy = 0;
  const vz = 1;

  const hx = lnx + vx;
  const hy = lny + vy;
  const hz = lnz + vz;
  const hl = Math.hypot(hx, hy, hz);
  const hnx = hx / hl;
  const hny = hy / hl;
  const hnz = hz / hl;

  const ndotl = Math.max(0, nx * lnx + ny * lny + nz * lnz);
  const ndotv = Math.max(0, nx * vx + ny * vy + nz * vz);
  const ndoth = Math.max(0, nx * hnx + ny * hny + nz * hnz);
  const fresnel = Math.pow(1 - ndotv, 2.0);
  const spec = Math.pow(ndoth, 44);

  const hueBase = ((Math.atan2(ny, nx) * 180) / Math.PI + 360 + tiltYDeg * 1.6 - tiltXDeg * 1.2) % 360;

  // ---- Holo film layer ----
  if (holoStrength > 0) {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, width, height);
    octx.globalCompositeOperation = 'source-over';

    const filmStrength = (0.10 + 0.16 * fresnel) * holoClamped;

    const gradA = octx.createLinearGradient(0, 0, width, height);
    gradA.addColorStop(0.00, `hsla(${(hueBase + 8) % 360}, 88%, 56%, ${filmStrength})`);
    gradA.addColorStop(0.25, `hsla(${(hueBase + 74) % 360}, 86%, 58%, ${filmStrength * 0.92})`);
    gradA.addColorStop(0.50, `hsla(${(hueBase + 154) % 360}, 88%, 58%, ${filmStrength * 0.95})`);
    gradA.addColorStop(0.75, `hsla(${(hueBase + 238) % 360}, 86%, 58%, ${filmStrength * 0.92})`);
    gradA.addColorStop(1.00, `hsla(${(hueBase + 306) % 360}, 84%, 58%, ${filmStrength})`);
    octx.fillStyle = gradA;
    octx.fillRect(0, 0, width, height);

    const bandW = Math.max(72, width * 0.42);
    const bandX = width * (0.5 - nx * 0.36);
    const bandY = height * (0.48 + ny * 0.08);
    octx.save();
    octx.globalCompositeOperation = 'screen';
    octx.translate(bandX, bandY);
    octx.rotate((tiltYDeg * Math.PI) / 180 * 0.56 + (tiltXDeg * Math.PI) / 180 * 0.18);
    const band = octx.createLinearGradient(-bandW, 0, bandW, 0);
    band.addColorStop(0.00, `hsla(${(hueBase + 352) % 360}, 84%, 60%, ${filmStrength * 0.20})`);
    band.addColorStop(0.25, `hsla(${(hueBase + 42) % 360}, 88%, 62%, ${filmStrength * 0.28})`);
    band.addColorStop(0.50, `hsla(${(hueBase + 170) % 360}, 90%, 64%, ${filmStrength * 0.32})`);
    band.addColorStop(0.75, `hsla(${(hueBase + 248) % 360}, 88%, 62%, ${filmStrength * 0.26})`);
    band.addColorStop(1.00, `hsla(${(hueBase + 332) % 360}, 84%, 60%, ${filmStrength * 0.18})`);
    octx.fillStyle = band;
    octx.fillRect(-bandW, -height, bandW * 2, height * 2);
    octx.restore();

    // Hex foil lattice is anchored in card space (no screen-space sliding).
    const hex = getHexPatternCanvas();
    const hexPattern = octx.createPattern(hex, 'repeat');
    if (hexPattern) {
      octx.save();
      octx.globalCompositeOperation = 'overlay';
      octx.globalAlpha = (0.30 + 0.22 * fresnel) * holoClamped;
      octx.fillStyle = hexPattern;
      octx.fillRect(0, 0, width, height);
      octx.restore();

      octx.save();
      octx.globalCompositeOperation = 'soft-light';
      octx.globalAlpha = (0.13 + 0.11 * fresnel) * holoClamped;
      octx.fillStyle = hexPattern;
      octx.fillRect(0, 0, width, height);
      octx.restore();

      // Lightly screen the lattice so tile boundaries stay legible on dark art.
      octx.save();
      octx.globalCompositeOperation = 'screen';
      octx.globalAlpha = (0.08 + 0.10 * fresnel) * holoClamped;
      octx.fillStyle = hexPattern;
      octx.fillRect(0, 0, width, height);
      octx.restore();
    }

    // Mask film by silhouette.
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(baseCanvas, 0, 0, width, height);

    // Composite film.
    ctx.save();
    applyScaledComposite(ctx, scratch, width, height, 'soft-light', 0.42 + holoClamped * 0.18, 0.95 + (holoStrength - holoClamped) * 1.1);
    applyScaledComposite(ctx, scratch, width, height, 'overlay', 0.22 + holoClamped * 0.11, 0.9 + (holoStrength - holoClamped) * 1.0);
    ctx.restore();
  }

  // ---- Shine layer ----
  if (lightStrength > 0) {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, width, height);
    octx.globalCompositeOperation = 'source-over';

    const hotspotX = width * (0.5 - nx * 0.24 + lnx * 0.04);
    const hotspotY = height * (0.5 + ny * 0.20 + lny * 0.03);
    const hotspotR = Math.max(30, Math.min(width, height) * (0.18 + spec * 0.14));

    octx.globalCompositeOperation = 'lighter';
    octx.save();
    octx.translate(hotspotX, hotspotY);
    octx.rotate((-tiltYDeg * Math.PI) / 180 * 0.42);
    octx.scale(1.55, 0.94);
    const hot = octx.createRadialGradient(0, 0, 0, 0, 0, hotspotR);
    hot.addColorStop(0.00, `rgba(255,255,255,${(0.13 + spec * 0.50 + ndotl * 0.05) * lightClamped})`);
    hot.addColorStop(0.38, `rgba(255,255,255,${(0.08 + spec * 0.22) * lightClamped})`);
    hot.addColorStop(0.80, `rgba(255,255,255,${0.02 * lightClamped})`);
    hot.addColorStop(1.00, 'rgba(255,255,255,0)');
    octx.fillStyle = hot;
    octx.fillRect(-hotspotR, -hotspotR, hotspotR * 2, hotspotR * 2);
    octx.restore();

    // Soft ribbon around hotspot for premium inspect light band.
    const ribbonLen = Math.max(100, width * 0.84);
    const ribbonW = Math.max(18, Math.min(width, height) * 0.09);
    octx.save();
    octx.translate(hotspotX, hotspotY);
    octx.rotate((-tiltYDeg * Math.PI) / 180 * 0.56 + (tiltXDeg * Math.PI) / 180 * 0.12);
    octx.scale(1.0, 0.64);
    const ribbon = octx.createLinearGradient(-ribbonLen * 0.5, 0, ribbonLen * 0.5, 0);
    ribbon.addColorStop(0.00, 'rgba(255,255,255,0)');
    ribbon.addColorStop(0.35, `rgba(255,255,255,${(0.018 + spec * 0.09) * lightClamped})`);
    ribbon.addColorStop(0.50, `rgba(255,255,255,${(0.05 + spec * 0.18) * lightClamped})`);
    ribbon.addColorStop(0.65, `rgba(255,255,255,${(0.018 + spec * 0.09) * lightClamped})`);
    ribbon.addColorStop(1.00, 'rgba(255,255,255,0)');
    octx.fillStyle = ribbon;
    octx.fillRect(-ribbonLen * 0.5, -ribbonW * 0.5, ribbonLen, ribbonW);
    octx.restore();

    const secR = Math.max(22, hotspotR * 0.70);
    const secX = hotspotX + nx * width * 0.05;
    const secY = hotspotY + ny * height * 0.05;
    octx.save();
    octx.translate(secX, secY);
    octx.rotate((tiltYDeg * Math.PI) / 180 * 0.25);
    octx.scale(1.33, 0.90);
    const hot2 = octx.createRadialGradient(0, 0, 0, 0, 0, secR);
    hot2.addColorStop(0.00, `rgba(255,255,255,${(0.065 + spec * 0.19) * lightClamped})`);
    hot2.addColorStop(0.74, `rgba(255,255,255,${0.01 * lightClamped})`);
    hot2.addColorStop(1.00, 'rgba(255,255,255,0)');
    octx.fillStyle = hot2;
    octx.fillRect(-secR, -secR, secR * 2, secR * 2);
    octx.restore();

    const rim = octx.createRadialGradient(
      width * 0.5,
      height * 0.5,
      Math.min(width, height) * 0.2,
      width * 0.5,
      height * 0.5,
      Math.max(width, height) * 0.76,
    );
    rim.addColorStop(0.62, 'rgba(255,255,255,0)');
    rim.addColorStop(1.00, `rgba(200,225,255,${(0.055 + fresnel * 0.15) * lightClamped})`);
    octx.fillStyle = rim;
    octx.fillRect(0, 0, width, height);

    // Mask shine by silhouette.
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(baseCanvas, 0, 0, width, height);

    // Composite shine conservatively.
    ctx.save();
    applyScaledComposite(ctx, scratch, width, height, 'screen', 0.22 + lightClamped * 0.14, 0.9 + (lightStrength - lightClamped) * 1.3);
    ctx.restore();
  }
}

let scratchCanvas: HTMLCanvasElement | null = null;
let hexCanvas: HTMLCanvasElement | null = null;

function getScratchCanvas(width: number, height: number): HTMLCanvasElement {
  if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
  if (scratchCanvas.width !== width || scratchCanvas.height !== height) {
    scratchCanvas.width = width;
    scratchCanvas.height = height;
  }
  return scratchCanvas;
}

function getHexPatternCanvas(): HTMLCanvasElement {
  if (hexCanvas) return hexCanvas;

  const size = 168;
  const gridRadius = 8.8;
  const tileRadius = 7.1;
  const stepX = gridRadius * 1.5;
  const stepY = Math.sqrt(3) * gridRadius;

  hexCanvas = document.createElement('canvas');
  hexCanvas.width = size;
  hexCanvas.height = size;
  const hctx = hexCanvas.getContext('2d');
  if (!hctx) return hexCanvas;

  hctx.clearRect(0, 0, size, size);
  hctx.lineWidth = 1.35;

  const rows = Math.ceil(size / stepY) + 4;
  const cols = Math.ceil(size / stepX) + 4;
  for (let row = -2; row < rows; row++) {
    const y = row * stepY;
    const xOffset = (row & 1) ? stepX * 0.5 : 0;
    for (let col = -2; col < cols; col++) {
      const x = col * stepX + xOffset;
      const parity = (row + col) & 1;
      const fillAlpha = parity ? 0.16 : 0.10;
      const strokeAlpha = parity ? 0.60 : 0.46;

      hctx.fillStyle = `rgba(210,225,245,${fillAlpha})`;
      hctx.strokeStyle = `rgba(245,250,255,${strokeAlpha})`;
      drawHexPath(hctx, x, y, tileRadius);
      hctx.fill();
      hctx.stroke();

      // Subtle inner facet keeps tiles visible without turning into sparkles.
      hctx.fillStyle = `rgba(255,255,255,${parity ? 0.07 : 0.05})`;
      drawHexPath(hctx, x, y, tileRadius * 0.54);
      hctx.fill();
    }
  }

  return hexCanvas;
}

function drawHexPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const a = Math.PI / 3;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const px = cx + Math.cos(i * a) * r;
    const py = cy + Math.sin(i * a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function applyScaledComposite(
  ctx: CanvasRenderingContext2D,
  layer: HTMLCanvasElement,
  width: number,
  height: number,
  op: GlobalCompositeOperation,
  baseAlpha: number,
  gain: number,
): void {
  let remaining = Math.max(0, gain);
  if (remaining <= 0) return;

  while (remaining > 0) {
    const weight = Math.min(1, remaining);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = Math.min(1, baseAlpha * weight);
    ctx.drawImage(layer, 0, 0, width, height);
    remaining -= 1;
  }
}
