import { RNG } from "./prng";

// Value noise with fractal Brownian motion. Lightweight and dependency-free,
// good enough for terrain heightmaps. Built from a seeded permutation table.
export class ValueNoise {
  private perm: Float32Array;

  constructor(rng: RNG, size = 256) {
    // A grid of random gradients/values indexed via a hashed lattice.
    this.perm = new Float32Array(size * size);
    for (let i = 0; i < this.perm.length; i++) this.perm[i] = rng();
    this.size = size;
  }

  private size: number;

  private valueAt(ix: number, iy: number): number {
    const s = this.size;
    const x = ((ix % s) + s) % s;
    const y = ((iy % s) + s) % s;
    return this.perm[y * s + x];
  }

  private smooth(t: number): number {
    // Quintic smoothstep for continuous derivatives.
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  // Single-octave value noise sampled at (x, y).
  noise2(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = this.smooth(x - x0);
    const fy = this.smooth(y - y0);

    const v00 = this.valueAt(x0, y0);
    const v10 = this.valueAt(x0 + 1, y0);
    const v01 = this.valueAt(x0, y0 + 1);
    const v11 = this.valueAt(x0 + 1, y0 + 1);

    const top = v00 + (v10 - v00) * fx;
    const bottom = v01 + (v11 - v01) * fx;
    return top + (bottom - top) * fy;
  }

  // Fractal Brownian motion: layered octaves of decreasing amplitude.
  fbm(x: number, y: number, octaves = 5, persistence = 0.5, lacunarity = 2): number {
    let amplitude = 1;
    let frequency = 1;
    let sum = 0;
    let max = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise2(x * frequency, y * frequency) * amplitude;
      max += amplitude;
      amplitude *= persistence;
      frequency *= lacunarity;
    }
    return sum / max;
  }
}
