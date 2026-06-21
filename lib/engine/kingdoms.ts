import { kingdomName, rulerName } from "./names";
import { RNG, randInt } from "./prng";
import { Army, Kingdom, Settlement, War, World } from "./types";
import { isWalkable } from "./world";

const ABSORB_RANGE = 32; // how far an independent town joins a kingdom
const TERRITORY_RANGE = 28; // how far a settlement projects ownership over land
const WAR_THRESHOLD = -45; // relations below this can trigger war
const ALLY_THRESHOLD = 65; // relations above this can form an alliance
const MAX_WARS = 6; // cap concurrent wars so the world stays legible
const ARMY_SPEED = 0.22; // tiles per tick
const SIEGE_RATE = 0.5; // defense drained per tick during a siege

// Distinct, saturated colors via the golden angle so kingdoms never clash.
function kingdomColor(id: number): { css: string; rgb: [number, number, number] } {
  const hue = (id * 137.508) % 360;
  const sat = 62;
  const light = 56;
  const css = `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
  const rgb = hslToRgb(hue / 360, sat / 100, light / 100);
  return { css, rgb };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (t: number) => {
    let tc = t;
    if (tc < 0) tc += 1;
    if (tc > 1) tc -= 1;
    if (tc < 1 / 6) return p + (q - p) * 6 * tc;
    if (tc < 1 / 2) return q;
    if (tc < 2 / 3) return p + (q - p) * (2 / 3 - tc) * 6;
    return p;
  };
  return [
    Math.round(hk(h + 1 / 3) * 255),
    Math.round(hk(h) * 255),
    Math.round(hk(h - 1 / 3) * 255),
  ];
}

function logEvent(
  world: World,
  kind: World["events"][number]["kind"],
  text: string,
): void {
  world.events.push({
    tick: world.tick,
    year: 1 + Math.floor(world.tick / 12),
    kind,
    text,
  });
  if (world.events.length > 200) world.events.shift();
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

function aliveMembers(world: World, k: Kingdom): Settlement[] {
  return k.members
    .map((id) => world.settlements[id])
    .filter((s) => s && s.kingdomId === k.id);
}

// ---- formation & territory -------------------------------------------------

function foundKingdom(world: World, seed: Settlement, rng: RNG): Kingdom {
  const id = world.nextKingdomId++;
  const { css, rgb } = kingdomColor(id);
  const k: Kingdom = {
    id,
    name: kingdomName(rng),
    ruler: rulerName(rng),
    rulerSince: world.tick,
    color: css,
    rgb,
    capital: seed.id,
    founded: world.tick,
    members: [seed.id],
    population: seed.population,
    military: 0,
    wealth: seed.wealth,
    stability: 65,
    relations: {},
    wars: [],
    allies: [],
    alive: true,
  };
  world.kingdoms[id] = k;
  seed.kingdomId = id;
  logEvent(world, "kingdom", `${k.name} is founded, ruled by ${k.ruler} from ${seed.name}.`);
  return k;
}

// Towns/cities form or join kingdoms; smaller places get absorbed nearby.
function formAndAbsorb(world: World, rng: RNG): void {
  for (const s of world.settlements) {
    if (!s) continue;
    if (s.kingdomId >= 0) {
      const k = world.kingdoms[s.kingdomId];
      if (!k || !k.alive) s.kingdomId = -1;
      else continue;
    }

    // Find the nearest living kingdom-owned settlement.
    let nearestK = -1;
    let nearestD = Infinity;
    for (const other of world.settlements) {
      if (!other || other.kingdomId < 0 || other.id === s.id) continue;
      const d = dist(s.x, s.y, other.x, other.y);
      if (d < nearestD) {
        nearestD = d;
        nearestK = other.kingdomId;
      }
    }

    if (nearestK >= 0 && nearestD < ABSORB_RANGE) {
      s.kingdomId = nearestK;
      if (s.tier === "city" || s.tier === "town") {
        logEvent(
          world,
          "kingdom",
          `${s.name} swears fealty to ${world.kingdoms[nearestK].name}.`,
        );
      }
    } else if (s.tier === "town" || s.tier === "city") {
      foundKingdom(world, s, rng);
    }
  }
}

// Rebuild member lists, choose capitals, and aggregate kingdom-wide stats.
function recomputeKingdoms(world: World): void {
  for (const k of world.kingdoms) {
    if (!k || !k.alive) continue;
    const members = aliveMembers(world, k);
    k.members = members.map((m) => m.id);

    if (members.length === 0) {
      k.alive = false;
      logEvent(world, "collapse", `${k.name} collapses into ruin.`);
      // Scrub references from everyone else.
      for (const o of world.kingdoms) {
        if (!o) continue;
        delete o.relations[k.id];
        o.wars = o.wars.filter((w) => w !== k.id);
        o.allies = o.allies.filter((a) => a !== k.id);
      }
      world.wars = world.wars.filter((w) => w.attacker !== k.id && w.defender !== k.id);
      world.armies = world.armies.filter((a) => a.kingdomId !== k.id);
      continue;
    }

    // Capital = most populous holding.
    let cap = members[0];
    for (const m of members) if (m.population > cap.population) cap = m;
    k.capital = cap.id;

    let pop = 0;
    let wealth = 0;
    let military = 0;
    for (const m of members) {
      pop += m.population;
      wealth += m.wealth;
      military += m.population * 0.6 + m.defense + m.wealth * 0.02;
    }
    k.population = pop;
    k.wealth = wealth;
    k.military = military;

    // Stability erodes with each active war and with sprawling size.
    let stab = 70 + Math.min(20, wealth * 0.01) - k.wars.length * 14;
    stab -= Math.max(0, members.length - 6) * 2;
    k.stability = Math.max(0, Math.min(100, stab));
  }
}

// Paint each land tile with the nearest owning settlement's kingdom.
function recomputeTerritory(world: World): void {
  const { map } = world;
  const terr = world.territory;
  terr.fill(-1);

  const owned = world.settlements.filter((s) => s && s.kingdomId >= 0);
  if (owned.length === 0) {
    world.territoryVersion++;
    return;
  }

  const r2 = TERRITORY_RANGE * TERRITORY_RANGE;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      if (!isWalkable(map, x, y)) continue;
      let best = -1;
      let bestD = r2;
      for (const s of owned) {
        const dx = s.x - x;
        const dy = s.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = s.kingdomId;
        }
      }
      terr[i] = best;
    }
  }
  world.territoryVersion++;
}

// ---- diplomacy -------------------------------------------------------------

function rel(k: Kingdom, other: number): number {
  return k.relations[other] ?? 0;
}

function setRel(world: World, a: Kingdom, b: Kingdom, value: number): void {
  const v = Math.max(-100, Math.min(100, value));
  a.relations[b.id] = v;
  b.relations[a.id] = v;
}

function diplomacyTick(world: World, rng: RNG): void {
  const live = world.kingdoms.filter((k) => k && k.alive);
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const atWar = a.wars.includes(b.id);
      let r = rel(a, b.id);
      if (atWar) continue;

      // Neighbours rub each other the wrong way; distant realms drift neutral.
      const capA = world.settlements[a.capital];
      const capB = world.settlements[b.capital];
      const d = capA && capB ? dist(capA.x, capA.y, capB.x, capB.y) : 999;
      const pressure = d < 60 ? -2 : 1;
      r += pressure + (rng() - 0.5) * 6;
      setRel(world, a, b, r);

      // Alliances form between friendly neighbours.
      if (r > ALLY_THRESHOLD && !a.allies.includes(b.id)) {
        a.allies.push(b.id);
        b.allies.push(a.id);
        logEvent(world, "diplomacy", `${a.name} and ${b.name} forge an alliance.`);
      }
      if (r < 0) {
        a.allies = a.allies.filter((x) => x !== b.id);
        b.allies = b.allies.filter((x) => x !== a.id);
      }
    }
  }
}

function declareWars(world: World, rng: RNG): void {
  if (world.wars.length >= MAX_WARS) return;
  const live = world.kingdoms.filter((k) => k && k.alive);
  for (const a of live) {
    if (a.stability < 35) continue; // unstable realms don't pick fights
    // Find the weakest hostile neighbour.
    let target: Kingdom | null = null;
    let bestScore = Infinity;
    for (const b of live) {
      if (b.id === a.id) continue;
      if (a.wars.includes(b.id) || a.allies.includes(b.id)) continue;
      const r = rel(a, b.id);
      if (r > WAR_THRESHOLD) continue;
      const capA = world.settlements[a.capital];
      const capB = world.settlements[b.capital];
      if (!capA || !capB) continue;
      const d = dist(capA.x, capA.y, capB.x, capB.y);
      if (d > 90) continue;
      // Prefer close, weaker enemies.
      const score = b.military * 0.6 + d;
      if (score < bestScore && a.military > b.military * 0.75) {
        bestScore = score;
        target = b;
      }
    }
    if (target && rng() < 0.6) {
      const war: War = { attacker: a.id, defender: target.id, started: world.tick };
      world.wars.push(war);
      a.wars.push(target.id);
      target.wars.push(a.id);
      setRel(world, a, target, -80);
      logEvent(world, "war", `${a.name} declares war on ${target.name}.`);
      if (world.wars.length >= MAX_WARS) return;
    }
  }
}

function makePeace(world: World, a: Kingdom, b: Kingdom): void {
  a.wars = a.wars.filter((x) => x !== b.id);
  b.wars = b.wars.filter((x) => x !== a.id);
  world.wars = world.wars.filter(
    (w) =>
      !(
        (w.attacker === a.id && w.defender === b.id) ||
        (w.attacker === b.id && w.defender === a.id)
      ),
  );
  setRel(world, a, b, -10);
  world.armies = world.armies.filter(
    (ar) => !(ar.kingdomId === a.id && b.members.includes(ar.target)) &&
            !(ar.kingdomId === b.id && a.members.includes(ar.target)),
  );
  logEvent(world, "diplomacy", `${a.name} and ${b.name} sign a peace.`);
}

// ---- armies & battles ------------------------------------------------------

function spawnArmies(world: World, rng: RNG): void {
  for (const war of world.wars) {
    const attacker = world.kingdoms[war.attacker];
    const defender = world.kingdoms[war.defender];
    if (!attacker?.alive || !defender?.alive) continue;

    const existing = world.armies.filter((a) => a.kingdomId === attacker.id).length;
    if (existing >= 2) continue;

    const cap = world.settlements[attacker.capital];
    if (!cap) continue;

    // March on the defender's nearest settlement.
    let target: Settlement | null = null;
    let bestD = Infinity;
    for (const id of defender.members) {
      const s = world.settlements[id];
      if (!s) continue;
      const d = dist(cap.x, cap.y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        target = s;
      }
    }
    if (!target) continue;
    if (rng() > 0.5) continue; // stagger spawns

    world.armies.push({
      id: world.nextArmyId++,
      kingdomId: attacker.id,
      x: cap.x,
      y: cap.y,
      strength: Math.max(10, attacker.military * 0.4),
      target: target.id,
      state: "march",
    });
  }
}

function moveArmies(world: World): void {
  const { map } = world;
  for (const army of world.armies) {
    const k = world.kingdoms[army.kingdomId];
    if (!k || !k.alive || army.strength <= 0) {
      army.strength = 0;
      continue;
    }

    if (army.state === "return") {
      const cap = world.settlements[k.capital];
      if (!cap) {
        army.strength = 0;
        continue;
      }
      stepArmyToward(map, army, cap.x, cap.y);
      if (dist(army.x, army.y, cap.x, cap.y) < 1.5) army.strength = 0; // disband
      continue;
    }

    const target = world.settlements[army.target];
    // Target gone or no longer enemy → head home.
    if (!target || target.kingdomId === army.kingdomId) {
      army.state = "return";
      continue;
    }

    if (dist(army.x, army.y, target.x, target.y) > 1.4) {
      army.state = "march";
      stepArmyToward(map, army, target.x, target.y);
      continue;
    }

    // --- siege ---
    army.state = "siege";
    target.defense -= SIEGE_RATE;
    target.loyalty -= 0.3;
    if (target.defense <= 0) {
      captureSettlement(world, army, target);
    }
  }

  resolveBattles(world);
  world.armies = world.armies.filter((a) => a.strength > 0);
}

function stepArmyToward(
  map: World["map"],
  army: Army,
  tx: number,
  ty: number,
): void {
  const dx = tx - army.x;
  const dy = ty - army.y;
  const d = Math.hypot(dx, dy) || 1;
  const nx = army.x + (dx / d) * ARMY_SPEED;
  const ny = army.y + (dy / d) * ARMY_SPEED;
  if (isWalkable(map, nx, ny)) {
    army.x = nx;
    army.y = ny;
  } else if (isWalkable(map, nx, army.y)) {
    army.x = nx;
  } else if (isWalkable(map, army.x, ny)) {
    army.y = ny;
  } else {
    army.x = nx; // allow crossing narrow straits rather than getting stuck
    army.y = ny;
  }
}

function captureSettlement(world: World, army: Army, target: Settlement): void {
  const old = world.kingdoms[target.kingdomId];
  const conqueror = world.kingdoms[army.kingdomId];
  const wasCapital = old && old.capital === target.id;

  target.kingdomId = army.kingdomId;
  target.loyalty = 25;
  target.defense = 8;
  target.population = Math.max(1, Math.floor(target.population * 0.7));

  logEvent(
    world,
    "capture",
    `${conqueror?.name ?? "An army"} captures ${target.name}` +
      (old ? ` from ${old.name}` : "") + ".",
  );

  if (wasCapital && old) {
    // Losing the capital can shatter a kingdom's will.
    old.stability -= 30;
    old.ruler = rulerName(() => Math.random());
    old.rulerSince = world.tick;
  }

  army.state = "return";
}

// Enemy armies that meet clash; the weaker is destroyed.
function resolveBattles(world: World): void {
  const armies = world.armies.filter((a) => a.strength > 0);
  for (let i = 0; i < armies.length; i++) {
    for (let j = i + 1; j < armies.length; j++) {
      const a = armies[i];
      const b = armies[j];
      if (a.strength <= 0 || b.strength <= 0) continue;
      const ka = world.kingdoms[a.kingdomId];
      const kb = world.kingdoms[b.kingdomId];
      if (!ka || !kb || !ka.wars.includes(b.kingdomId)) continue;
      if (dist(a.x, a.y, b.x, b.y) > 2) continue;

      // Trade blows proportional to strength with a dash of luck.
      const total = a.strength + b.strength;
      const aWins = Math.random() < a.strength / total;
      if (aWins) {
        b.strength = 0;
        a.strength *= 0.7;
        logEvent(world, "battle", `${ka.name} routs an army of ${kb.name}.`);
      } else {
        a.strength = 0;
        b.strength *= 0.7;
        logEvent(world, "battle", `${kb.name} routs an army of ${ka.name}.`);
      }
    }
  }
}

// ---- rebellion -------------------------------------------------------------

function rebellionCheck(world: World, rng: RNG): void {
  for (const k of world.kingdoms) {
    if (!k || !k.alive || k.stability > 30) continue;
    const members = aliveMembers(world, k);
    for (const m of members) {
      if (m.id === k.capital) continue;
      if (m.loyalty < 25 && rng() < 0.3) {
        m.kingdomId = -1;
        m.loyalty = 55;
        logEvent(world, "diplomacy", `${m.name} breaks away from ${k.name} in revolt.`);
        break;
      }
    }
  }
}

// ---- succession ------------------------------------------------------------

// Rulers eventually die (or are deposed) and a successor takes the throne.
function successionTick(world: World, rng: RNG): void {
  for (const k of world.kingdoms) {
    if (!k || !k.alive) continue;
    const reign = world.tick - k.rulerSince;
    // Longer reigns and instability raise the odds each check.
    const odds = 0.02 + reign * 0.00005 + (k.stability < 40 ? 0.04 : 0);
    if (rng() < odds) {
      const old = k.ruler;
      k.ruler = rulerName(rng);
      k.rulerSince = world.tick;
      const deposed = k.stability < 40 && rng() < 0.5;
      k.stability = Math.max(0, k.stability + (deposed ? -10 : -3));
      logEvent(
        world,
        "ruler",
        deposed
          ? `${old} of ${k.name} is overthrown; ${k.ruler} seizes power.`
          : `${old} of ${k.name} dies; ${k.ruler} ascends the throne.`,
      );
    }
  }
}

// ---- public entry point ----------------------------------------------------

export function kingdomsTick(world: World, rng: RNG): void {
  // Armies animate every tick.
  moveArmies(world);

  // Strategic cadence keeps the heavier passes cheap.
  if (world.tick % 30 === 0) {
    formAndAbsorb(world, rng);
    recomputeKingdoms(world);
    recomputeTerritory(world);
  }
  if (world.tick % 45 === 0) {
    diplomacyTick(world, rng);
    rebellionCheck(world, rng);
    successionTick(world, rng);
  }
  if (world.tick % 60 === 0) {
    declareWars(world, rng);
    spawnArmies(world, rng);

    // Long, army-less wars peter out into peace.
    for (const war of [...world.wars]) {
      if (world.tick - war.started > 240 && rng() < 0.3) {
        const a = world.kingdoms[war.attacker];
        const b = world.kingdoms[war.defender];
        if (a?.alive && b?.alive) makePeace(world, a, b);
      }
    }
  }
}

// Build a translucent overlay (1px/tile) of territory fills + bright borders.
export function renderTerritoryOverlay(world: World): ImageData {
  const { map, territory, kingdoms } = world;
  const img = new ImageData(map.width, map.height);
  const data = img.data;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const kid = territory[i];
      if (kid < 0) continue;
      const k = kingdoms[kid];
      if (!k || !k.alive) continue;

      // Border = neighbour belongs to a different (or no) kingdom.
      let edge = false;
      if (x > 0 && territory[i - 1] !== kid) edge = true;
      else if (x < map.width - 1 && territory[i + 1] !== kid) edge = true;
      else if (y > 0 && territory[i - map.width] !== kid) edge = true;
      else if (y < map.height - 1 && territory[i + map.width] !== kid) edge = true;

      const o = i * 4;
      data[o] = k.rgb[0];
      data[o + 1] = k.rgb[1];
      data[o + 2] = k.rgb[2];
      data[o + 3] = edge ? 235 : 60;
    }
  }
  return img;
}
