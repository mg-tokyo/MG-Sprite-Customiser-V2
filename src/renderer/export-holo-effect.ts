interface LensGhostSpec {
  axis: number;
  lateral: number;
  scale: number;
  color: string;
  alpha: number;
}

const DEBUG_FX_PERF = false;
const DEBUG_FX_DRIFT = false;
const FLARE_BUFFER_SCALE = 0.5;
const FLARE_TILT_REF_DEG = 10;
const GHOST_SIZE_BUCKET = 8;
const GHOST_ALPHA_BUCKET = 0.02;
const GHOST_CACHE_MAX = 96;
const PERF_SAMPLE_WINDOW = 120;
const DRIFT_SAMPLE_WINDOW = 60;

const LENS_GHOST_SPECS: LensGhostSpec[] = [
  { axis: 0.62, lateral: 0.10, scale: 0.74, color: '255,220,180', alpha: 0.11 },
  { axis: 1.34, lateral: 0.20, scale: 1.12, color: '168,226,255', alpha: 0.14 },
  { axis: 2.18, lateral: 0.34, scale: 1.62, color: '196,156,255', alpha: 0.09 },
];

export function drawExportHoloOverlay(
  ctx: CanvasRenderingContext2D,
  baseCanvas: HTMLCanvasElement,
  timeMs: number,
  lightIntensity: number,
  holoIntensity: number,
  tiltXDeg = 0,
  tiltYDeg = 0,
  lensFlareEnabled = false,
  lensFlareIntensity = 0.3,
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
  const time = timeMs * 0.001;

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
    const hexPattern = getHexPattern(octx);
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

      // Subtle CS-style rainbow shimmer anchored to the hex lattice.
      const shimmerStrength = (0.06 + 0.10 * fresnel) * holoClamped;
      if (shimmerStrength > 0.001) {
        const shimmer = getShimmerCanvas(width, height);
        const sctx = shimmer.getContext('2d');
        if (sctx) {
          sctx.setTransform(1, 0, 0, 1, 0, 0);
          sctx.clearRect(0, 0, width, height);

          const angle = (time * 0.4 + hueBase * 0.01) * Math.PI * 2;
          const dx = Math.cos(angle);
          const dy = Math.sin(angle);
          const span = Math.max(width, height) * 0.7;
          const shift = ((time * 0.12) % 1) - 0.5;
          const cx = width * 0.5 + dx * shift * span * 0.35;
          const cy = height * 0.5 + dy * shift * span * 0.35;

          const grad = sctx.createLinearGradient(
            cx - dx * span,
            cy - dy * span,
            cx + dx * span,
            cy + dy * span,
          );
          const hueShift = (time * 18) % 360;
          grad.addColorStop(0.00, `hsla(${(hueShift + 320) % 360}, 80%, 58%, 0.20)`);
          grad.addColorStop(0.22, `hsla(${(hueShift + 20) % 360}, 82%, 60%, 0.22)`);
          grad.addColorStop(0.46, `hsla(${(hueShift + 90) % 360}, 78%, 60%, 0.20)`);
          grad.addColorStop(0.70, `hsla(${(hueShift + 190) % 360}, 80%, 62%, 0.22)`);
          grad.addColorStop(1.00, `hsla(${(hueShift + 260) % 360}, 80%, 60%, 0.20)`);
          sctx.fillStyle = grad;
          sctx.fillRect(0, 0, width, height);

          const shimmerPattern = getHexPattern(sctx);
          if (shimmerPattern) {
            sctx.globalCompositeOperation = 'destination-in';
            sctx.fillStyle = shimmerPattern;
            sctx.fillRect(0, 0, width, height);
          }

          ctx.save();
          applyScaledComposite(ctx, shimmer, width, height, 'screen', shimmerStrength, 1.0);
          ctx.restore();
        }
      }
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

    if (lensFlareEnabled && lensFlareIntensity > 0) {
      const perfStart = DEBUG_FX_PERF ? performance.now() : 0;
      const flareBase = Math.max(0, Math.min(1.6, lensFlareIntensity * 1.45));
      const flareStrength = Math.max(0, flareBase * (0.70 + ndotl * 0.22 + fresnel * 0.24 + spec * 0.30));
      const flareCanvas = getFlareCanvas(width, height);
      const fctx = flareCanvas.getContext('2d');
      if (fctx) {
        const sx = flareCanvas.width / width;
        const sy = flareCanvas.height / height;
        const s = 0.5 * (sx + sy);

        const hotspotFx = hotspotX * sx;
        // Flare chain uses a vertically mirrored source response so up/down tilt
        // follows the same perceived "far side" parity as horizontal tilt.
        const flareHotspotY = height * (0.5 - ny * 0.20 + lny * 0.03);
        const hotspotFy = flareHotspotY * sy;
        const centerFx = flareCanvas.width * 0.5;
        const centerFy = flareCanvas.height * 0.5;

        const toCenterX = centerFx - hotspotFx;
        const toCenterY = centerFy - hotspotFy;
        const rawAxisLen = Math.hypot(toCenterX, toCenterY);
        const axisLen = Math.max(Math.min(flareCanvas.width, flareCanvas.height) * 0.15, rawAxisLen);
        const ax = rawAxisLen > 0.001 ? toCenterX / rawAxisLen : 1;
        const ay = rawAxisLen > 0.001 ? toCenterY / rawAxisLen : 0;

        const t = Math.min(1, Math.hypot(tiltXDeg, tiltYDeg) / FLARE_TILT_REF_DEG);
        const response = t * t * (3 - 2 * t);
        // Slight low-tilt damping: keeps peak behavior but smooths subtle motion.
        const motionResponse = response * (0.90 + 0.10 * response);
        // Drift toward the side of the card that is farther from the user in screen space.
        // App tilt mapping: tiltY(+) => right side farther; tiltX(+) => top side farther.
        const farX = tiltYDeg;
        const farY = tiltXDeg;
        const farLen = Math.hypot(farX, farY);
        const fdx = farLen > 0.001 ? farX / farLen : 0;
        const fdy = farLen > 0.001 ? farY / farLen : 0;

        const coreR = Math.max(8, hotspotR * (0.48 + flareStrength * 0.40) * s);
        const ringSquash = 1 - Math.min(0.20, motionResponse * 0.16);
        const ringRot = Math.atan2(ay, ax);

        fctx.setTransform(1, 0, 0, 1, 0, 0);
        fctx.clearRect(0, 0, flareCanvas.width, flareCanvas.height);
        fctx.globalCompositeOperation = 'source-over';

        const core = fctx.createRadialGradient(hotspotFx, hotspotFy, 0, hotspotFx, hotspotFy, coreR);
        core.addColorStop(0.00, `rgba(255,248,228,${0.44 * flareStrength})`);
        core.addColorStop(0.35, `rgba(255,236,198,${0.24 * flareStrength})`);
        core.addColorStop(1.00, 'rgba(255,220,170,0)');
        fctx.fillStyle = core;
        fctx.fillRect(hotspotFx - coreR, hotspotFy - coreR, coreR * 2, coreR * 2);

        const haloR = coreR * (1.18 + flareStrength * 0.20);
        const halo = fctx.createRadialGradient(hotspotFx, hotspotFy, coreR * 0.30, hotspotFx, hotspotFy, haloR);
        halo.addColorStop(0.00, 'rgba(255,208,150,0)');
        halo.addColorStop(0.60, 'rgba(255,208,150,0)');
        halo.addColorStop(0.78, `rgba(255,208,150,${0.07 * flareStrength})`);
        halo.addColorStop(0.92, `rgba(168,226,255,${0.08 * flareStrength})`);
        halo.addColorStop(1.00, 'rgba(168,226,255,0)');
        fctx.fillStyle = halo;
        fctx.fillRect(hotspotFx - haloR, hotspotFy - haloR, haloR * 2, haloR * 2);

        for (const ghost of LENS_GHOST_SPECS) {
          const axisTravel = axisLen * ghost.axis * (0.88 + 0.95 * motionResponse);
          const baseX = hotspotFx - ax * axisTravel;
          const baseY = hotspotFy - ay * axisTravel;
          const drift = axisLen * ghost.lateral * (0.10 + 1.30 * motionResponse);
          const gx = baseX + fdx * drift;
          const gy = baseY + fdy * drift;
          const gr = Math.max(6, coreR * ghost.scale);

          const sizeBucket = quantizeBucket(Math.max(8, Math.round(gr * 2)), GHOST_SIZE_BUCKET);
          const alphaBucket = quantizeBucket(ghost.alpha * flareStrength, GHOST_ALPHA_BUCKET);
          const sprite = getGhostSprite(ghost.color, sizeBucket, alphaBucket);
          const drawSize = sizeBucket;

          fctx.save();
          fctx.translate(gx, gy);
          fctx.rotate(ringRot);
          fctx.scale(1, ringSquash);
          fctx.drawImage(sprite, -drawSize * 0.5, -drawSize * 0.5, drawSize, drawSize);
          fctx.restore();
        }

        if (DEBUG_FX_DRIFT) {
          const sampleAxisTravel = axisLen * LENS_GHOST_SPECS[0].axis * (0.88 + 0.95 * motionResponse);
          const sampleBaseX = hotspotFx - ax * sampleAxisTravel;
          const sampleBaseY = hotspotFy - ay * sampleAxisTravel;
          const sampleDrift = axisLen * LENS_GHOST_SPECS[0].lateral * (0.10 + 1.30 * motionResponse);
          const sampleDx = fdx * sampleDrift;
          const sampleDy = fdy * sampleDrift;
          recordDriftDebug(tiltXDeg, tiltYDeg, fdx, fdy, sampleBaseX, sampleBaseY, sampleDx, sampleDy);
        }

        fctx.save();
        fctx.globalCompositeOperation = 'screen';
        const streakLen = Math.max(56, axisLen * 2.4);
        const streakW = Math.max(8, coreR * (0.40 + 0.14 * response));
        const sx1 = hotspotFx - ax * streakLen * 1.10;
        const sy1 = hotspotFy - ay * streakLen * 1.10;
        const sx2 = hotspotFx + ax * streakLen * 0.55;
        const sy2 = hotspotFy + ay * streakLen * 0.55;
        const streak = fctx.createLinearGradient(sx1, sy1, sx2, sy2);
        streak.addColorStop(0.00, 'rgba(255,255,255,0)');
        streak.addColorStop(0.50, `rgba(255,236,198,${(0.05 + response * 0.06) * flareStrength})`);
        streak.addColorStop(1.00, 'rgba(255,255,255,0)');
        fctx.translate(hotspotFx, hotspotFy);
        fctx.rotate(Math.atan2(ay, ax));
        fctx.fillStyle = streak;
        fctx.fillRect(-streakLen * 1.10, -streakW * 0.5, streakLen * 1.65, streakW);
        fctx.restore();

        ctx.save();
        applyScaledComposite(ctx, flareCanvas, width, height, 'screen', Math.min(0.72, 0.50 * flareStrength), 1.0);
        ctx.restore();
      }
      if (DEBUG_FX_PERF) recordFlarePerf(performance.now() - perfStart);
    }
  }
}

let scratchCanvas: HTMLCanvasElement | null = null;
let hexCanvas: HTMLCanvasElement | null = null;
let shimmerCanvas: HTMLCanvasElement | null = null;
let flareCanvas: HTMLCanvasElement | null = null;
const hexPatternCache = new WeakMap<CanvasRenderingContext2D, CanvasPattern>();
const ghostSpriteCache = new Map<string, HTMLCanvasElement>();
let flarePerfSamples = 0;
let flarePerfAccumMs = 0;
let driftPerfSamples = 0;
let driftPerfAccumTiltX = 0;
let driftPerfAccumTiltY = 0;
let driftPerfAccumDirX = 0;
let driftPerfAccumDirY = 0;
let driftPerfAccumDeltaX = 0;
let driftPerfAccumDeltaY = 0;

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

function getHexPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const existing = hexPatternCache.get(ctx);
  if (existing) return existing;
  const pattern = ctx.createPattern(getHexPatternCanvas(), 'repeat');
  if (pattern) hexPatternCache.set(ctx, pattern);
  return pattern;
}

function getShimmerCanvas(width: number, height: number): HTMLCanvasElement {
  if (!shimmerCanvas) shimmerCanvas = document.createElement('canvas');
  if (shimmerCanvas.width !== width || shimmerCanvas.height !== height) {
    shimmerCanvas.width = width;
    shimmerCanvas.height = height;
  }
  return shimmerCanvas;
}

function getFlareCanvas(width: number, height: number): HTMLCanvasElement {
  if (!flareCanvas) flareCanvas = document.createElement('canvas');
  const flareW = Math.max(1, Math.floor(width * FLARE_BUFFER_SCALE));
  const flareH = Math.max(1, Math.floor(height * FLARE_BUFFER_SCALE));
  if (flareCanvas.width !== flareW || flareCanvas.height !== flareH) {
    flareCanvas.width = flareW;
    flareCanvas.height = flareH;
  }
  return flareCanvas;
}

function quantizeBucket(value: number, step: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return 0;
  return Math.round(value / step) * step;
}

function getGhostSprite(color: string, size: number, alpha: number): HTMLCanvasElement {
  const clampedSize = Math.max(8, Math.round(size));
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  const key = `${color}|${clampedSize}|${clampedAlpha.toFixed(2)}`;
  const cached = ghostSpriteCache.get(key);
  if (cached) return cached;

  if (ghostSpriteCache.size >= GHOST_CACHE_MAX) ghostSpriteCache.clear();

  const canvas = document.createElement('canvas');
  canvas.width = clampedSize;
  canvas.height = clampedSize;
  const gctx = canvas.getContext('2d');
  if (!gctx) return canvas;

  const c = clampedSize * 0.5;
  const r = c - 1;
  const grad = gctx.createRadialGradient(c, c, 0, c, c, r);
  grad.addColorStop(0.00, `rgba(${color},${0.03 * clampedAlpha})`);
  grad.addColorStop(0.44, 'rgba(255,255,255,0)');
  grad.addColorStop(0.76, `rgba(${color},${0.90 * clampedAlpha})`);
  grad.addColorStop(1.00, 'rgba(255,255,255,0)');
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, clampedSize, clampedSize);

  gctx.beginPath();
  gctx.arc(c, c, r * 0.82, 0, Math.PI * 2);
  gctx.strokeStyle = `rgba(${color},${0.72 * clampedAlpha})`;
  gctx.lineWidth = Math.max(1, clampedSize * 0.022);
  gctx.stroke();

  ghostSpriteCache.set(key, canvas);
  return canvas;
}

function recordFlarePerf(ms: number): void {
  flarePerfSamples += 1;
  flarePerfAccumMs += ms;
  if (flarePerfSamples < PERF_SAMPLE_WINDOW) return;
  const avg = flarePerfAccumMs / flarePerfSamples;
  console.log(`[FX] Lens flare avg ${avg.toFixed(2)}ms over ${flarePerfSamples} frames`);
  flarePerfSamples = 0;
  flarePerfAccumMs = 0;
}

function recordDriftDebug(
  tiltXDeg: number,
  tiltYDeg: number,
  dirX: number,
  dirY: number,
  baseX: number,
  baseY: number,
  driftX: number,
  driftY: number,
): void {
  driftPerfSamples += 1;
  driftPerfAccumTiltX += tiltXDeg;
  driftPerfAccumTiltY += tiltYDeg;
  driftPerfAccumDirX += dirX;
  driftPerfAccumDirY += dirY;
  driftPerfAccumDeltaX += driftX;
  driftPerfAccumDeltaY += driftY;
  if (driftPerfSamples < DRIFT_SAMPLE_WINDOW) return;

  const inv = 1 / driftPerfSamples;
  console.log(
    `[FX] Lens drift avg tilt=(${(driftPerfAccumTiltX * inv).toFixed(2)}, ${(driftPerfAccumTiltY * inv).toFixed(2)}) ` +
    `dir=(${(driftPerfAccumDirX * inv).toFixed(2)}, ${(driftPerfAccumDirY * inv).toFixed(2)}) ` +
    `delta=(${(driftPerfAccumDeltaX * inv).toFixed(2)}, ${(driftPerfAccumDeltaY * inv).toFixed(2)}) ` +
    `base=(${baseX.toFixed(1)}, ${baseY.toFixed(1)}) over ${driftPerfSamples} frames`,
  );

  driftPerfSamples = 0;
  driftPerfAccumTiltX = 0;
  driftPerfAccumTiltY = 0;
  driftPerfAccumDirX = 0;
  driftPerfAccumDirY = 0;
  driftPerfAccumDeltaX = 0;
  driftPerfAccumDeltaY = 0;
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
