import { ValueNoise } from "./noise";
import { mulberry32, RNG, randInt } from "./prng";
import { Biome, MapData, ResourceNode, ResourceType } from "./types";

const SEA_LEVEL = 0.38;
const BEACH_LEVEL = 0.42;
const MOUNTAIN_LEVEL = 0.72;
const SNOW_LEVEL = 0.85;

// Map elevation + moisture + temperature into a biome. Temperature carries
// latitude, so the same height reads as tundra in the cold north, desert in
// the arid south, and forest or marsh in the temperate, wet middle.
function classify(elevation: number, moisture: number, temp: number): Biome {
  if (elevation < SEA_LEVEL - 0.12) return Biome.DeepWater;
  if (elevation < SEA_LEVEL) return Biome.Water;
  if (elevation < BEACH_LEVEL) return Biome.Sand;

  // Highlands.
  if (elevation > SNOW_LEVEL) return Biome.Snow;
  if (elevation > MOUNTAIN_LEVEL) return temp < 0.22 ? Biome.Snow : Biome.Mountain;
  if (elevation > MOUNTAIN_LEVEL - 0.1) return Biome.Hills;

  // Lowlands, governed by climate.
  if (temp < 0.26) return Biome.Tundra;
  if (temp > 0.7 && moisture < 0.38) return Biome.Desert;
  if (elevation < BEACH_LEVEL + 0.07 && moisture > 0.66) return Biome.Swamp;
  if (moisture > 0.54) return Biome.Forest;
  return Biome.Grass;
}

// Apply a radial falloff so the world is an island surrounded by water,
// which reads much better than noise clamped at the edges.
function islandFalloff(x: number, y: number, w: number, h: number): number {
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  const d = Math.sqrt(nx * nx + ny * ny);
  // Smooth gradient toward the edges.
  return Math.max(0, 1 - Math.pow(d * 1.05, 2.4));
}

const RESOURCE_BY_BIOME: Partial<Record<Biome, ResourceType[]>> = {
  [Biome.Grass]: ["food", "food", "stone"],
  [Biome.Forest]: ["wood", "wood", "food"],
  [Biome.Hills]: ["stone", "iron", "gold"],
  [Biome.Mountain]: ["iron", "iron", "gold", "stone"],
  [Biome.Sand]: ["spice"],
  [Biome.Desert]: ["spice", "spice", "gold"],
  [Biome.Swamp]: ["food", "wood"],
  [Biome.Tundra]: ["stone", "iron"],
  [Biome.Volcano]: ["iron", "gold", "stone"],
};

export function generateMap(seed: number, width: number, height: number): MapData {
  const rng: RNG = mulberry32(seed);
  const elevNoise = new ValueNoise(mulberry32(seed ^ 0x1234));
  const moistNoise = new ValueNoise(mulberry32(seed ^ 0xabcd));
  const tempNoise = new ValueNoise(mulberry32(seed ^ 0x77fa));

  const biome = new Uint8Array(width * height);
  const elevation = new Float32Array(width * height);
  const moisture = new Float32Array(width * height);
  const temperature = new Float32Array(width * height);
  const river = new Uint8Array(width * height);

  const scale = 4.5; // noise zoom — lower = larger continents

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const nx = (x / width) * scale;
      const ny = (y / height) * scale;
      let e = elevNoise.fbm(nx, ny, 6, 0.5, 2.0);
      // fbm returns ~[0,1]; sharpen and apply island mask.
      e = Math.pow(e, 1.15);
      e *= islandFalloff(x, y, width, height);
      const m = moistNoise.fbm(nx * 1.7 + 11, ny * 1.7 + 7, 4, 0.55, 2.0);

      // Temperature: warm south, cold north, banded by drifting noise and
      // chilled by altitude.
      let t = y / height; // 0 north .. 1 south
      t = t * 0.78 + tempNoise.fbm(nx * 1.3 + 5, ny * 1.3 + 19, 3, 0.5, 2.0) * 0.22;
      t -= Math.max(0, e - 0.42) * 0.7;
      t = Math.max(0, Math.min(1, t));

      elevation[i] = e;
      moisture[i] = m;
      temperature[i] = t;
      biome[i] = classify(e, m, t);
    }
  }

  carveRivers(width, height, elevation, biome, river, rng);
  placeVolcanoes(width, height, elevation, biome, rng);

  const { resources, resourceAt } = placeResources(
    width,
    height,
    biome,
    river,
    rng,
  );

  return {
    width,
    height,
    biome,
    elevation,
    moisture,
    temperature,
    river,
    resources,
    resourceAt,
  };
}

// Scatter one or two volcanic regions across the tallest peaks, marking a
// small cluster of tiles so the world has a smouldering, dangerous corner.
function placeVolcanoes(
  width: number,
  height: number,
  elevation: Float32Array,
  biome: Uint8Array,
  rng: RNG,
): void {
  const count = randInt(rng, 1, 2);
  for (let v = 0; v < count; v++) {
    let bx = -1;
    let by = -1;
    let best = MOUNTAIN_LEVEL;
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = randInt(rng, 4, width - 5);
      const y = randInt(rng, 4, height - 5);
      const e = elevation[y * width + x];
      if (e > best) {
        best = e;
        bx = x;
        by = y;
      }
    }
    if (bx < 0) continue;
    const radius = randInt(rng, 3, 5);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        if (Math.hypot(dx, dy) > radius) continue;
        const i = y * width + x;
        const b = biome[i] as Biome;
        if (b === Biome.Mountain || b === Biome.Hills || b === Biome.Snow) {
          biome[i] = Biome.Volcano;
        }
      }
    }
  }
}

// Trace rivers from high, wet sources by always stepping to the lowest
// neighbour until we reach water. Marks tiles and nudges them wetter.
function carveRivers(
  width: number,
  height: number,
  elevation: Float32Array,
  biome: Uint8Array,
  river: Uint8Array,
  rng: RNG,
): void {
  const sources = randInt(rng, 14, 22);
  for (let s = 0; s < sources; s++) {
    // Pick a high starting tile.
    let bx = 0;
    let by = 0;
    let best = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      const x = randInt(rng, 2, width - 3);
      const y = randInt(rng, 2, height - 3);
      const e = elevation[y * width + x];
      if (e > best && e > MOUNTAIN_LEVEL - 0.08) {
        best = e;
        bx = x;
        by = y;
      }
    }
    if (best < 0) continue;

    let x = bx;
    let y = by;
    for (let step = 0; step < 400; step++) {
      const i = y * width + x;
      river[i] = 1;
      if (biome[i] === Biome.Water || biome[i] === Biome.DeepWater) break;

      // Find lowest neighbour.
      let lx = x;
      let ly = y;
      let lowest = elevation[i];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nxp = x + dx;
          const nyp = y + dy;
          if (nxp < 0 || nyp < 0 || nxp >= width || nyp >= height) continue;
          const e = elevation[nyp * width + nxp];
          if (e < lowest) {
            lowest = e;
            lx = nxp;
            ly = nyp;
          }
        }
      }
      if (lx === x && ly === y) break; // stuck in a basin
      x = lx;
      y = ly;
    }
  }
}

function placeResources(
  width: number,
  height: number,
  biome: Uint8Array,
  river: Uint8Array,
  rng: RNG,
): { resources: ResourceNode[]; resourceAt: Int32Array } {
  const resources: ResourceNode[] = [];
  const resourceAt = new Int32Array(width * height).fill(-1);
  let id = 0;

  // Sample a fraction of land tiles to host resource nodes.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const b = biome[i] as Biome;
      const options = RESOURCE_BY_BIOME[b];
      if (!options) continue;

      // Rivers and grass are food-rich; bias node density by biome.
      let density = 0.012;
      if (b === Biome.Forest) density = 0.02;
      if (b === Biome.Mountain) density = 0.03;
      if (river[i]) density += 0.02;
      if (rng() > density) continue;

      const type = options[Math.floor(rng() * options.length)];
      const capacity =
        type === "food"
          ? randInt(rng, 60, 140)
          : type === "gold"
            ? randInt(rng, 20, 50)
            : randInt(rng, 40, 100);
      resources.push({ id: id++, x, y, type, amount: capacity, capacity });
      resourceAt[i] = resources.length - 1;
    }
  }

  return { resources, resourceAt };
}
