import { generateMap } from "./mapgen";
import { kingdomsTick } from "./kingdoms";
import { religionTick } from "./religion";
import { tradeTick } from "./trade";
import { jobName, personName, settlementName } from "./names";
import { mulberry32, RNG, randInt } from "./prng";
import {
  Biome,
  MapData,
  ResourceType,
  Settlement,
  Settler,
  World,
} from "./types";

export const MAP_WIDTH = 220;
export const MAP_HEIGHT = 150;
export const SETTLER_COUNT = 500;

const SPEED = 0.18; // tiles per tick
const CARRY_CAP = 12;
const GATHER_RATE = 0.6;
const SETTLE_RADIUS = 14; // min distance between settlements
const SCAN_RADIUS = 18; // how far a settler looks for resources

// ---- terrain helpers -------------------------------------------------------

export function isWater(b: number): boolean {
  return b === Biome.DeepWater || b === Biome.Water;
}

export function isWalkable(map: MapData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  const b = map.biome[(y | 0) * map.width + (x | 0)];
  return (
    !isWater(b) &&
    b !== Biome.Mountain &&
    b !== Biome.Snow &&
    b !== Biome.Volcano
  );
}

function findLandSpawn(map: MapData, rng: RNG): { x: number; y: number } {
  for (let i = 0; i < 2000; i++) {
    // Bias toward the centre of the island where land is likeliest.
    const x = randInt(rng, map.width * 0.25, map.width * 0.75);
    const y = randInt(rng, map.height * 0.25, map.height * 0.75);
    const b = map.biome[y * map.width + x];
    if (b === Biome.Grass || b === Biome.Forest || b === Biome.Hills) {
      return { x: x + 0.5, y: y + 0.5 };
    }
  }
  return { x: map.width / 2, y: map.height / 2 };
}

// ---- world creation --------------------------------------------------------

export function createWorld(seed: number): World {
  const map = generateMap(seed, MAP_WIDTH, MAP_HEIGHT);
  const rng = mulberry32(seed ^ 0x55aa55);

  const settlers: Settler[] = [];
  for (let i = 0; i < SETTLER_COUNT; i++) {
    const spawn = findLandSpawn(map, rng);
    settlers.push({
      id: i,
      name: personName(rng),
      job: jobName(rng),
      age: randInt(rng, 14, 48),
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      state: "wander",
      carrying: 0,
      carryType: null,
      targetResource: -1,
      home: -1,
      cooldown: randInt(rng, 0, 30),
    });
  }

  return {
    seed,
    tick: 0,
    map,
    settlers,
    settlements: [],
    nextSettlementId: 0,
    kingdoms: [],
    armies: [],
    wars: [],
    nextKingdomId: 0,
    nextArmyId: 0,
    religions: [],
    tradeRoutes: [],
    nextReligionId: 0,
    nextTradeId: 0,
    territory: new Int16Array(map.width * map.height).fill(-1),
    territoryVersion: 0,
    events: [],
  };
}

// ---- resource lookup -------------------------------------------------------

// Linear scan within a bounding box for the nearest resource with stock.
// Cheap enough at this scale and keeps the engine dependency-free.
function findNearestResource(
  world: World,
  x: number,
  y: number,
  radius: number,
): number {
  const { resources } = world.map;
  let best = -1;
  let bestDist = radius * radius;
  for (let i = 0; i < resources.length; i++) {
    const r = resources[i];
    if (r.amount < 1) continue;
    const dx = r.x + 0.5 - x;
    const dy = r.y + 0.5 - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function nearestSettlement(world: World, x: number, y: number): Settlement | null {
  let best: Settlement | null = null;
  let bestDist = Infinity;
  for (const s of world.settlements) {
    const dx = s.x - x;
    const dy = s.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

function emptyStock(): Record<ResourceType, number> {
  return { food: 0, wood: 0, stone: 0, iron: 0, gold: 0, spice: 0 };
}

// ---- movement --------------------------------------------------------------

function moveToward(map: MapData, s: Settler, tx: number, ty: number): boolean {
  const dx = tx - s.x;
  const dy = ty - s.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.4) return true;
  const nx = s.x + (dx / dist) * SPEED;
  const ny = s.y + (dy / dist) * SPEED;
  // Slide along blocked terrain instead of stopping dead.
  if (isWalkable(map, nx, ny)) {
    s.x = nx;
    s.y = ny;
  } else if (isWalkable(map, nx, s.y)) {
    s.x = nx;
  } else if (isWalkable(map, s.x, ny)) {
    s.y = ny;
  }
  return false;
}

function wanderStep(map: MapData, s: Settler, rng: RNG): void {
  // Momentum-based random walk so motion looks organic.
  s.vx += (rng() - 0.5) * 0.08;
  s.vy += (rng() - 0.5) * 0.08;
  const mag = Math.hypot(s.vx, s.vy) || 1;
  s.vx = (s.vx / mag) * SPEED;
  s.vy = (s.vy / mag) * SPEED;
  const nx = s.x + s.vx;
  const ny = s.y + s.vy;
  if (isWalkable(map, nx, ny)) {
    s.x = nx;
    s.y = ny;
  } else {
    // Bounce off the obstacle.
    s.vx = -s.vx + (rng() - 0.5) * 0.1;
    s.vy = -s.vy + (rng() - 0.5) * 0.1;
  }
}

// ---- main step -------------------------------------------------------------

export function step(world: World): void {
  world.tick++;
  const rng = mulberry32((world.seed ^ world.tick) >>> 0);
  const { map } = world;

  // Resource regeneration (food regrows faster than minerals).
  for (const r of map.resources) {
    if (r.amount < r.capacity) {
      r.amount += r.type === "food" ? 0.05 : 0.008;
      if (r.amount > r.capacity) r.amount = r.capacity;
    }
  }

  for (const s of world.settlers) {
    if (s.cooldown > 0) s.cooldown--;

    switch (s.state) {
      case "wander": {
        wanderStep(map, s, rng);
        if (s.cooldown <= 0) {
          const found = findNearestResource(world, s.x, s.y, SCAN_RADIUS);
          if (found >= 0) {
            s.targetResource = found;
            s.state = "seek";
          }
          s.cooldown = randInt(rng, 8, 24);
        }
        break;
      }

      case "seek": {
        const r = map.resources[s.targetResource];
        if (!r || r.amount < 1) {
          s.state = "wander";
          s.targetResource = -1;
          break;
        }
        if (moveToward(map, s, r.x + 0.5, r.y + 0.5)) {
          s.state = "gather";
        }
        break;
      }

      case "gather": {
        const r = map.resources[s.targetResource];
        if (!r || r.amount < 1 || s.carrying >= CARRY_CAP) {
          s.state = "return";
          break;
        }
        if (s.carryType && s.carryType !== r.type && s.carrying > 0) {
          s.state = "return";
          break;
        }
        const take = Math.min(GATHER_RATE, r.amount, CARRY_CAP - s.carrying);
        r.amount -= take;
        s.carrying += take;
        s.carryType = r.type;
        break;
      }

      case "return": {
        let home = s.home >= 0 ? world.settlements[s.home] : null;
        if (!home) home = nearestSettlement(world, s.x, s.y);

        if (!home) {
          // No settlement nearby — found a camp here if the area is clear.
          tryFoundSettlement(world, s, rng);
          home = s.home >= 0 ? world.settlements[s.home] : null;
        }
        if (!home) {
          // Still nothing (too close to another camp) — keep wandering.
          s.state = "wander";
          s.carrying = 0;
          s.carryType = null;
          break;
        }
        if (moveToward(map, s, home.x, home.y)) {
          if (s.carryType) home.stock[s.carryType] += s.carrying;
          s.carrying = 0;
          s.carryType = null;
          s.home = home.id;
          s.state = "wander";
        }
        break;
      }
    }

    // Aging is purely cosmetic for inspection panels later.
    if (world.tick % 200 === 0) s.age++;
  }

  growSettlements(world, rng);
  kingdomsTick(world, rng);
  religionTick(world, rng);
  tradeTick(world, rng);
}

// Found a settlement at a settler's position if far enough from existing ones.
function tryFoundSettlement(world: World, s: Settler, rng: RNG): void {
  const near = nearestSettlement(world, s.x, s.y);
  if (near) {
    const d = Math.hypot(near.x - s.x, near.y - s.y);
    if (d < SETTLE_RADIUS) {
      // Join the nearby settlement instead.
      s.home = near.id;
      return;
    }
  }
  // Only found if carrying something worthwhile (proves the area is viable).
  if (s.carrying < 4) return;

  const id = world.nextSettlementId++;
  const settlement: Settlement = {
    id,
    name: settlementName(rng),
    x: s.x,
    y: s.y,
    population: 1,
    founded: world.tick,
    stock: emptyStock(),
    tier: "camp",
    kingdomId: -1,
    religionId: -1,
    wealth: 0,
    loyalty: 60,
    defense: 5,
  };
  world.settlements[id] = settlement;
  s.home = id;
  world.events.push({
    tick: world.tick,
    year: 1 + Math.floor(world.tick / 12),
    kind: "settlement",
    text: `A camp is founded at ${settlement.name}.`,
  });
  if (world.events.length > 200) world.events.shift();
}

// Convert stockpiled food into population growth, accrue wealth from traded
// goods, and update tiers. Settlements inside a kingdom grow a little faster.
function growSettlements(world: World, rng: RNG): void {
  if (world.tick % 30 !== 0) return;
  for (const s of world.settlements) {
    if (!s) continue;

    // Consume food proportional to population; surplus grows the settlement.
    const upkeep = s.population * 0.4;
    s.stock.food -= upkeep;
    const protectedBonus = s.kingdomId >= 0 ? 8 : 10;
    if (s.stock.food > protectedBonus) {
      s.population += 1;
      s.stock.food -= 8;
    } else if (s.stock.food < -6 && s.population > 1) {
      // Famine — people leave or die.
      s.population -= 1;
      s.stock.food = 0;
      s.loyalty = Math.max(0, s.loyalty - 4);
    }
    if (s.stock.food < 0) s.stock.food = 0;

    // Wealth comes from valuable goods; minerals convert into treasure.
    const yield_ =
      s.stock.gold * 3 + s.stock.spice * 2 + s.stock.iron * 1.2 + s.stock.stone * 0.4;
    s.wealth += yield_ * 0.25;
    s.stock.gold *= 0.6;
    s.stock.spice *= 0.6;
    s.stock.iron *= 0.7;
    s.stock.stone *= 0.7;
    s.wealth *= 0.995; // slow upkeep decay

    // Defenses scale with size and wealth; loyalty drifts toward content.
    s.defense = Math.max(s.defense, 4 + s.population * 0.25 + s.wealth * 0.01);
    s.loyalty += (70 - s.loyalty) * 0.05;
    s.loyalty = Math.max(0, Math.min(100, s.loyalty));

    const prevTier = s.tier;
    s.tier =
      s.population >= 60
        ? "city"
        : s.population >= 25
          ? "town"
          : s.population >= 8
            ? "village"
            : "camp";

    if (prevTier !== s.tier && (s.tier === "town" || s.tier === "city")) {
      world.events.push({
        tick: world.tick,
        year: 1 + Math.floor(world.tick / 12),
        kind: "settlement",
        text: `${s.name} grows into a ${s.tier}.`,
      });
      if (world.events.length > 200) world.events.shift();
    }
  }
}
