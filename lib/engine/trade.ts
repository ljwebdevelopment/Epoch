import { RNG } from "./prng";
import { ResourceType, Settlement, TradeRoute, World } from "./types";

const TRADE_RANGE = 55; // max distance between trading partners
const MAX_ROUTES_PER_TOWN = 3;
const TRADED_GOODS: ResourceType[] = ["food", "wood", "stone", "iron", "gold", "spice"];

function logEvent(world: World, text: string): void {
  world.events.push({
    tick: world.tick,
    year: 1 + Math.floor(world.tick / 12),
    kind: "trade",
    text,
  });
  if (world.events.length > 200) world.events.shift();
}

function isTradeHub(s: Settlement): boolean {
  return s.tier === "town" || s.tier === "city";
}

// Two settlements may trade if neither pair is at war with the other's realm.
function canTrade(world: World, a: Settlement, b: Settlement): boolean {
  // Independent settlements trade freely; realms must not be at war.
  if (a.kingdomId < 0 || b.kingdomId < 0) return true;
  if (a.kingdomId === b.kingdomId) return true;
  const ka = world.kingdoms[a.kingdomId];
  if (!ka) return true;
  return !ka.wars.includes(b.kingdomId);
}

function routeExists(world: World, a: number, b: number): boolean {
  return world.tradeRoutes.some(
    (r) => (r.a === a && r.b === b) || (r.a === b && r.b === a),
  );
}

function countRoutes(world: World, id: number): number {
  return world.tradeRoutes.filter((r) => r.a === id || r.b === id).length;
}

// Pick the good the origin is richest in — that's what it exports.
function exportGood(s: Settlement): ResourceType {
  let best: ResourceType = "food";
  let bestAmt = -1;
  for (const g of TRADED_GOODS) {
    if (s.stock[g] > bestAmt) {
      bestAmt = s.stock[g];
      best = g;
    }
  }
  return best;
}

export function tradeTick(world: World, rng: RNG): void {
  // --- prune routes whose endpoints died or fell into war ---
  world.tradeRoutes = world.tradeRoutes.filter((r) => {
    const a = world.settlements[r.a];
    const b = world.settlements[r.b];
    if (!a || !b) return false;
    return canTrade(world, a, b);
  });

  // --- establish new routes between trade hubs ---
  if (world.tick % 50 === 0) {
    const hubs = world.settlements.filter((s) => s && isTradeHub(s));
    for (const a of hubs) {
      if (countRoutes(world, a.id) >= MAX_ROUTES_PER_TOWN) continue;
      // Find the nearest eligible partner without an existing route.
      let best: Settlement | null = null;
      let bestD = TRADE_RANGE;
      for (const b of hubs) {
        if (b.id === a.id) continue;
        if (routeExists(world, a.id, b.id)) continue;
        if (countRoutes(world, b.id) >= MAX_ROUTES_PER_TOWN) continue;
        if (!canTrade(world, a, b)) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (best && rng() < 0.7) {
        const good = exportGood(a);
        world.tradeRoutes.push({
          id: world.nextTradeId++,
          a: a.id,
          b: best.id,
          good,
          volume: 1,
          phase: rng(),
        });
        logEvent(
          world,
          `A ${good} trade route opens between ${a.name} and ${best.name}.`,
        );
      }
    }
  }

  // --- run the routes: move goods, enrich both ends, grow volume ---
  for (const r of world.tradeRoutes) {
    const a = world.settlements[r.a];
    const b = world.settlements[r.b];
    if (!a || !b) continue;

    const flow = Math.min(0.5, a.stock[r.good] * 0.05 + 0.1);
    a.stock[r.good] = Math.max(0, a.stock[r.good] - flow);
    b.stock[r.good] += flow * 0.7;

    // Both partners profit; prosperity compounds the route's volume.
    const profit = flow * (r.good === "gold" ? 3 : r.good === "spice" ? 2 : 1);
    a.wealth += profit * 0.6;
    b.wealth += profit * 0.6;
    a.stock.food += 0.02; // trade brings a trickle of surplus food
    b.stock.food += 0.02;
    r.volume = Math.min(8, r.volume + 0.01);
  }
}
