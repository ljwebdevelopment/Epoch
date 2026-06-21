import { Job } from "./names";

export enum Biome {
  DeepWater = 0,
  Water = 1,
  Sand = 2,
  Grass = 3,
  Forest = 4,
  Hills = 5,
  Mountain = 6,
  Snow = 7,
}

export type ResourceType = "food" | "wood" | "stone" | "iron" | "gold" | "spice";

export interface ResourceNode {
  id: number;
  x: number; // tile coords
  y: number;
  type: ResourceType;
  amount: number; // current
  capacity: number; // max, regenerates toward this
}

export interface MapData {
  width: number;
  height: number;
  // Per-tile arrays, indexed y * width + x.
  biome: Uint8Array;
  elevation: Float32Array;
  moisture: Float32Array;
  river: Uint8Array; // 1 if a river tile
  resources: ResourceNode[];
  // Spatial lookup: tile index -> resource node index (or -1).
  resourceAt: Int32Array;
}

export type SettlerState = "wander" | "seek" | "gather" | "return";

export interface Settler {
  id: number;
  name: string;
  job: Job;
  age: number;
  x: number; // tile coords (float)
  y: number;
  vx: number;
  vy: number;
  state: SettlerState;
  carrying: number; // resource units carried
  carryType: ResourceType | null;
  targetResource: number; // index into resources, or -1
  home: number; // settlement id, or -1
  cooldown: number; // ticks until next decision
}

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  population: number;
  founded: number; // tick
  // Stockpiles by resource.
  stock: Record<ResourceType, number>;
  tier: "camp" | "village" | "town";
}

export interface World {
  seed: number;
  tick: number;
  map: MapData;
  settlers: Settler[];
  settlements: Settlement[];
  nextSettlementId: number;
}
