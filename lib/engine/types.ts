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

export type SettlementTier = "camp" | "village" | "town" | "city";

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  population: number;
  founded: number; // tick
  // Stockpiles by resource.
  stock: Record<ResourceType, number>;
  tier: SettlementTier;
  kingdomId: number; // -1 if independent
  wealth: number; // accumulated gold-equivalent
  loyalty: number; // 0-100, to its kingdom
  defense: number; // siege resistance
}

export interface Kingdom {
  id: number;
  name: string;
  ruler: string;
  color: string; // css color for UI
  rgb: [number, number, number]; // for border/territory rendering
  capital: number; // settlement id
  founded: number; // tick
  members: number[]; // settlement ids
  population: number;
  military: number;
  wealth: number;
  stability: number; // 0-100
  relations: Record<number, number>; // kingdomId -> -100..100
  wars: number[]; // kingdom ids currently at war with
  allies: number[]; // kingdom ids allied with
  alive: boolean;
}

export type ArmyState = "march" | "siege" | "return";

export interface Army {
  id: number;
  kingdomId: number;
  x: number;
  y: number;
  strength: number;
  target: number; // settlement id being marched on
  state: ArmyState;
}

export interface War {
  attacker: number; // kingdom id
  defender: number; // kingdom id
  started: number; // tick
}

export type EventKind =
  | "settlement"
  | "kingdom"
  | "war"
  | "battle"
  | "capture"
  | "collapse"
  | "diplomacy";

export interface WorldEvent {
  tick: number;
  year: number;
  kind: EventKind;
  text: string;
}

export interface World {
  seed: number;
  tick: number;
  map: MapData;
  settlers: Settler[];
  settlements: Settlement[];
  nextSettlementId: number;

  kingdoms: Kingdom[];
  armies: Army[];
  wars: War[];
  nextKingdomId: number;
  nextArmyId: number;

  // Per-land-tile kingdom ownership, -1 if unclaimed. Recomputed periodically.
  territory: Int16Array;
  territoryVersion: number; // bumps when territory changes so the view rebakes

  events: WorldEvent[];
}
