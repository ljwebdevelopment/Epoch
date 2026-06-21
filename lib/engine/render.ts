import { Biome, MapData } from "./types";

// ---------------------------------------------------------------------------
// Hand-painted cartography. Instead of one flat pixel per tile we bake the
// world onto a high-resolution offscreen canvas using old-atlas techniques:
// parchment-tinted biome washes, inked coastlines, painted mountains and
// forests, dune stipple, reed marks and smouldering volcanic embers. The
// result reads like a drawn campaign map rather than a heightmap.
// ---------------------------------------------------------------------------

const TILE = 8; // pixels per tile in the baked image

// Warm, aged palette. Land sits on parchment; sea is a faded atlas teal.
const COLOR: Record<Biome, [number, number, number]> = {
  [Biome.DeepWater]: [74, 104, 116],
  [Biome.Water]: [104, 138, 146],
  [Biome.Sand]: [222, 205, 156],
  [Biome.Grass]: [188, 178, 120],
  [Biome.Forest]: [150, 162, 104],
  [Biome.Hills]: [192, 170, 116],
  [Biome.Mountain]: [186, 170, 138],
  [Biome.Snow]: [231, 230, 222],
  [Biome.Desert]: [226, 205, 142],
  [Biome.Swamp]: [140, 150, 104],
  [Biome.Tundra]: [203, 203, 186],
  [Biome.Volcano]: [92, 74, 70],
};

// Deterministic per-tile jitter so decorations are stable across rebakes
// without needing to thread the world seed through here.
function hash(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function isSea(b: Biome): boolean {
  return b === Biome.DeepWater || b === Biome.Water;
}

function rgb(c: [number, number, number], k = 1): string {
  return `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${
    Math.min(255, c[2] * k) | 0
  })`;
}

export function paintTerrain(map: MapData): HTMLCanvasElement {
  const { width, height, biome, elevation, moisture, river } = map;
  const cv = document.createElement("canvas");
  cv.width = width * TILE;
  cv.height = height * TILE;
  const ctx = cv.getContext("2d")!;
  const at = (x: number, y: number) => biome[y * width + x] as Biome;

  // --- 1. base washes -----------------------------------------------------
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const b = biome[i] as Biome;
      const px = x * TILE;
      const py = y * TILE;

      if (river[i]) {
        ctx.fillStyle = rgb(COLOR[Biome.Water]);
        ctx.fillRect(px, py, TILE, TILE);
        continue;
      }

      let shade = 1;
      if (!isSea(b)) {
        // Faded relief shading + a little mottling for a painted wash.
        shade = 0.9 + elevation[i] * 0.28 + (hash(x, y, 7) - 0.5) * 0.06;
      } else {
        // Sea darkens with depth and shimmers very subtly.
        shade = 0.82 + elevation[i] * 0.5 + (hash(x, y, 3) - 0.5) * 0.04;
      }
      ctx.fillStyle = rgb(COLOR[b], shade);
      ctx.fillRect(px, py, TILE, TILE);
    }
  }

  // --- 2. inked, double coastline -----------------------------------------
  ctx.lineCap = "round";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = at(x, y);
      if (isSea(b)) continue;
      const px = x * TILE;
      const py = y * TILE;
      const edges: [number, number, number, number][] = [];
      if (y > 0 && isSea(at(x, y - 1))) edges.push([px, py, px + TILE, py]);
      if (y < height - 1 && isSea(at(x, y + 1)))
        edges.push([px, py + TILE, px + TILE, py + TILE]);
      if (x > 0 && isSea(at(x - 1, y))) edges.push([px, py, px, py + TILE]);
      if (x < width - 1 && isSea(at(x + 1, y)))
        edges.push([px + TILE, py, px + TILE, py + TILE]);
      if (!edges.length) continue;
      // Dark ink line.
      ctx.strokeStyle = "rgba(46,33,18,0.85)";
      ctx.lineWidth = 1.6;
      for (const e of edges) {
        ctx.beginPath();
        ctx.moveTo(e[0], e[1]);
        ctx.lineTo(e[2], e[3]);
        ctx.stroke();
      }
    }
  }

  // --- 3. biome decorations ----------------------------------------------
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const b = biome[i] as Biome;
      if (river[i] || isSea(b)) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;

      switch (b) {
        case Biome.Forest:
          paintTrees(ctx, x, y, cx, cy, moisture[i]);
          break;
        case Biome.Mountain:
          paintMountain(ctx, x, y, cx, cy, false);
          break;
        case Biome.Snow:
          if (elevation[i] > MOUNTAINISH) paintMountain(ctx, x, y, cx, cy, true);
          else paintFlecks(ctx, x, y, cx, cy, "rgba(255,255,255,0.7)");
          break;
        case Biome.Hills:
          paintHill(ctx, x, y, cx, cy);
          break;
        case Biome.Desert:
        case Biome.Sand:
          paintDunes(ctx, x, y, cx, cy);
          break;
        case Biome.Swamp:
          paintReeds(ctx, x, y, cx, cy);
          break;
        case Biome.Tundra:
          paintFlecks(ctx, x, y, cx, cy, "rgba(120,128,120,0.4)");
          break;
        case Biome.Volcano:
          paintVolcano(ctx, x, y, cx, cy);
          break;
      }
    }
  }

  // --- 4. rivers as inked, flowing strokes --------------------------------
  ctx.strokeStyle = "rgba(64,98,114,0.95)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!river[y * width + x]) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!river[ny * width + nx]) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(nx * TILE + TILE / 2, ny * TILE + TILE / 2);
        ctx.stroke();
      }
    }
  }

  // --- 5. parchment grain -------------------------------------------------
  ctx.fillStyle = "rgba(60,42,20,0.05)";
  for (let k = 0; k < (width * height) / 6; k++) {
    const x = Math.floor(hash(k, 11, 1) * cv.width);
    const y = Math.floor(hash(k, 29, 2) * cv.height);
    ctx.fillRect(x, y, 1, 1);
  }

  return cv;
}

const MOUNTAINISH = 0.78;

// A hand-drawn peak: shaded face, lit face, ink outline.
function paintMountain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
  snow: boolean,
): void {
  const w = TILE * (0.7 + hash(x, y, 1) * 0.3);
  const h = TILE * (0.8 + hash(x, y, 2) * 0.4);
  const baseY = cy + h * 0.4;
  const peakX = cx + (hash(x, y, 3) - 0.5) * 2;
  const peakY = cy - h * 0.5;
  // Right (shadow) face.
  ctx.fillStyle = "rgba(70,55,40,0.55)";
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(cx + w / 2, baseY);
  ctx.lineTo(peakX, baseY);
  ctx.closePath();
  ctx.fill();
  // Left (lit) face.
  ctx.fillStyle = snow ? "rgba(245,245,240,0.85)" : "rgba(214,198,160,0.8)";
  ctx.beginPath();
  ctx.moveTo(peakX, peakY);
  ctx.lineTo(cx - w / 2, baseY);
  ctx.lineTo(peakX, baseY);
  ctx.closePath();
  ctx.fill();
  // Ink ridge.
  ctx.strokeStyle = "rgba(46,33,18,0.7)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - w / 2, baseY);
  ctx.lineTo(peakX, peakY);
  ctx.lineTo(cx + w / 2, baseY);
  ctx.stroke();
  if (snow) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(peakX, peakY);
    ctx.lineTo(peakX - 1.2, peakY + 2);
    ctx.stroke();
  }
}

function paintHill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
): void {
  const r = TILE * (0.28 + hash(x, y, 4) * 0.12);
  ctx.strokeStyle = "rgba(70,55,34,0.45)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy + 1, r, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
}

function paintTrees(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
  moist: number,
): void {
  const count = 2 + Math.floor(hash(x, y, 5) * 2);
  for (let t = 0; t < count; t++) {
    const ox = (hash(x, y, t * 3 + 10) - 0.5) * TILE * 0.8;
    const oy = (hash(x, y, t * 3 + 11) - 0.5) * TILE * 0.8;
    const tx = cx + ox;
    const ty = cy + oy;
    const rr = 1 + hash(x, y, t * 3 + 12) * 1.1;
    // Canopy with a touch of shadow underneath.
    ctx.fillStyle = "rgba(40,52,30,0.55)";
    ctx.beginPath();
    ctx.arc(tx + 0.4, ty + 0.6, rr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = moist > 0.7 ? "rgba(58,82,44,0.85)" : "rgba(72,92,52,0.85)";
    ctx.beginPath();
    ctx.arc(tx, ty, rr, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintDunes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
): void {
  ctx.strokeStyle = "rgba(150,124,72,0.4)";
  ctx.lineWidth = 0.7;
  for (let d = 0; d < 2; d++) {
    const oy = (hash(x, y, d + 20) - 0.5) * TILE * 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy + oy + 2, 2.2, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
}

function paintReeds(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
): void {
  // Murky mottling.
  ctx.fillStyle = "rgba(60,72,44,0.35)";
  ctx.beginPath();
  ctx.arc(cx + (hash(x, y, 31) - 0.5) * 4, cy + (hash(x, y, 32) - 0.5) * 4, 1.6, 0, Math.PI * 2);
  ctx.fill();
  // Reed strokes.
  ctx.strokeStyle = "rgba(48,60,36,0.6)";
  ctx.lineWidth = 0.6;
  for (let r = 0; r < 3; r++) {
    const ox = (hash(x, y, r + 33) - 0.5) * TILE * 0.7;
    ctx.beginPath();
    ctx.moveTo(cx + ox, cy + 2);
    ctx.lineTo(cx + ox, cy - 2);
    ctx.stroke();
  }
}

function paintFlecks(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let f = 0; f < 3; f++) {
    const ox = (hash(x, y, f + 40) - 0.5) * TILE * 0.8;
    const oy = (hash(x, y, f + 41) - 0.5) * TILE * 0.8;
    ctx.fillRect(cx + ox, cy + oy, 0.9, 0.9);
  }
}

function paintVolcano(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cx: number,
  cy: number,
): void {
  // Dark cone.
  ctx.fillStyle = "rgba(50,38,36,0.8)";
  ctx.beginPath();
  ctx.moveTo(cx, cy - TILE * 0.5);
  ctx.lineTo(cx + TILE * 0.45, cy + TILE * 0.4);
  ctx.lineTo(cx - TILE * 0.45, cy + TILE * 0.4);
  ctx.closePath();
  ctx.fill();
  // Glowing embers / crater.
  ctx.fillStyle = "rgba(232,108,60,0.9)";
  ctx.beginPath();
  ctx.arc(cx, cy - TILE * 0.4, 1, 0, Math.PI * 2);
  ctx.fill();
  for (let e = 0; e < 2; e++) {
    ctx.fillStyle = e === 0 ? "rgba(245,170,80,0.8)" : "rgba(210,70,40,0.7)";
    ctx.fillRect(
      cx + (hash(x, y, e + 50) - 0.5) * 3,
      cy - TILE * 0.4 + (hash(x, y, e + 51) - 0.5) * 3,
      0.9,
      0.9,
    );
  }
}

export const RESOURCE_COLOR: Record<string, string> = {
  food: "#7fa64a",
  wood: "#9a6b3f",
  stone: "#a9a18c",
  iron: "#9fb0bd",
  gold: "#e7b94a",
  spice: "#cf5b3f",
};
