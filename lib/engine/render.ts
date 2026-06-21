import { Biome, MapData } from "./types";

// Dark-fantasy palette, keyed by biome. Slightly desaturated and moody.
const BIOME_COLOR: Record<Biome, [number, number, number]> = {
  [Biome.DeepWater]: [10, 22, 40],
  [Biome.Water]: [19, 49, 79],
  [Biome.Sand]: [150, 132, 92],
  [Biome.Grass]: [58, 84, 50],
  [Biome.Forest]: [32, 54, 33],
  [Biome.Hills]: [92, 80, 54],
  [Biome.Mountain]: [74, 70, 70],
  [Biome.Snow]: [206, 212, 218],
};

const RIVER_COLOR: [number, number, number] = [44, 96, 150];

// Bake the static terrain into an ImageData (1 pixel per tile) so we can
// blit + smooth-scale it cheaply every frame instead of redrawing tiles.
export function renderTerrain(map: MapData): ImageData {
  const { width, height, biome, elevation, river } = map;
  const img = new ImageData(width, height);
  const data = img.data;

  for (let i = 0; i < width * height; i++) {
    const b = biome[i] as Biome;
    let [r, g, bl] = river[i] ? RIVER_COLOR : BIOME_COLOR[b];

    // Shade land by elevation for a sense of relief.
    if (b !== Biome.DeepWater && b !== Biome.Water && !river[i]) {
      const shade = 0.78 + elevation[i] * 0.5;
      r = Math.min(255, r * shade);
      g = Math.min(255, g * shade);
      bl = Math.min(255, bl * shade);
    }

    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = bl;
    data[o + 3] = 255;
  }
  return img;
}

export const RESOURCE_COLOR: Record<string, string> = {
  food: "#7fd36b",
  wood: "#9a6b3f",
  stone: "#b9b9b9",
  iron: "#c8d2dc",
  gold: "#f2cf52",
  spice: "#e06a4f",
};
