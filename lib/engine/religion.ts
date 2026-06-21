import { FAITH_SYMBOLS, religionName, schismName } from "./names";
import { pick, RNG } from "./prng";
import { Religion, Settlement, World } from "./types";

const SPREAD_RANGE = 26; // how far a faith reaches to convert neighbours
const MAX_RELIGIONS = 8;

function logEvent(world: World, text: string): void {
  world.events.push({
    tick: world.tick,
    year: 1 + Math.floor(world.tick / 12),
    kind: "religion",
    text,
  });
  if (world.events.length > 200) world.events.shift();
}

// Reuse the kingdom golden-angle palette but offset so faiths read distinctly.
function faithColor(id: number): string {
  const hue = (id * 137.508 + 60) % 360;
  return `hsl(${hue.toFixed(0)}, 55%, 64%)`;
}

function dist(a: Settlement, b: Settlement): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function foundReligion(
  world: World,
  holy: Settlement,
  rng: RNG,
  parent = -1,
): Religion {
  const id = world.nextReligionId++;
  const baseName =
    parent >= 0 && world.religions[parent]
      ? schismName(rng, world.religions[parent].name)
      : religionName(rng);
  const religion: Religion = {
    id,
    name: baseName,
    symbol: pick(rng, FAITH_SYMBOLS),
    color: faithColor(id),
    holyCity: holy.id,
    founded: world.tick,
    followers: holy.population,
    members: [holy.id],
    parent,
    alive: true,
  };
  world.religions[id] = religion;
  holy.religionId = id;
  const year = 1 + Math.floor(world.tick / 12);
  if (parent >= 0) {
    logEvent(
      world,
      `In the Year ${year}, ${religion.name} broke from ${world.religions[parent].name} in bitter schism, raising new temples in ${holy.name}.`,
    );
  } else {
    logEvent(
      world,
      `In the Year ${year}, prophets in ${holy.name} proclaimed ${religion.name}, and the faithful began to gather.`,
    );
  }
  return religion;
}

export function religionTick(world: World, rng: RNG): void {
  if (world.tick % 40 !== 0) return;

  const live = world.religions.filter((r) => r && r.alive);

  // --- found a new faith in a notable, irreligious city ---
  if (live.length < MAX_RELIGIONS) {
    for (const s of world.settlements) {
      if (!s || s.religionId >= 0) continue;
      if (s.tier !== "city" && s.tier !== "town") continue;
      if (rng() < 0.25) {
        foundReligion(world, s, rng);
        break;
      }
    }
  }

  // --- spread: faiths convert nearby weaker-believing settlements ---
  for (const r of live) {
    const holy = world.settlements[r.holyCity];
    if (!holy) continue;
    for (const s of world.settlements) {
      if (!s || s.religionId === r.id) continue;
      // Spread from any current adherent that is close enough.
      let near = false;
      for (const mid of r.members) {
        const m = world.settlements[mid];
        if (m && dist(m, s) < SPREAD_RANGE) {
          near = true;
          break;
        }
      }
      if (!near) continue;
      // Larger faiths and shared kingdoms convert more readily.
      let p = 0.08 + Math.min(0.25, r.followers / 4000);
      if (holy.kingdomId >= 0 && holy.kingdomId === s.kingdomId) p += 0.2;
      if (s.religionId >= 0) p *= 0.4; // displacing an existing faith is hard
      if (rng() < p) {
        s.religionId = r.id;
      }
    }
  }

  // --- recompute membership + followers; retire dead faiths ---
  for (const r of live) {
    const members = world.settlements.filter((s) => s && s.religionId === r.id);
    r.members = members.map((m) => m.id);
    r.followers = members.reduce((sum, m) => sum + m.population, 0);
    if (members.length === 0) {
      r.alive = false;
      logEvent(world, `${r.name} fades into obscurity, its last temple abandoned.`);
      continue;
    }
    // Holy city lost? Move the seat to the largest remaining congregation.
    if (!members.some((m) => m.id === r.holyCity)) {
      let seat = members[0];
      for (const m of members) if (m.population > seat.population) seat = m;
      r.holyCity = seat.id;
    }
  }

  // --- schism: a large, far-flung faith fractures ---
  for (const r of live) {
    if (!r.alive || r.members.length < 6) continue;
    if (rng() < 0.1) {
      // A distant congregation breaks away.
      const holy = world.settlements[r.holyCity];
      let farthest: Settlement | null = null;
      let far = 0;
      for (const mid of r.members) {
        const m = world.settlements[mid];
        if (!m || m.id === r.holyCity || !holy) continue;
        const d = dist(holy, m);
        if (d > far) {
          far = d;
          farthest = m;
        }
      }
      if (farthest && far > SPREAD_RANGE) {
        const splinter = foundReligion(world, farthest, rng, r.id);
        // Nearby members defect to the new sect.
        for (const mid of r.members) {
          const m = world.settlements[mid];
          if (m && dist(farthest, m) < SPREAD_RANGE && rng() < 0.6) {
            m.religionId = splinter.id;
          }
        }
      }
    }
  }

  // --- conflict: realms of different faiths distrust one another ---
  for (const k of world.kingdoms) {
    if (!k || !k.alive) continue;
    const cap = world.settlements[k.capital];
    if (!cap || cap.religionId < 0) continue;
    for (const o of world.kingdoms) {
      if (!o || !o.alive || o.id === k.id) continue;
      const oc = world.settlements[o.capital];
      if (!oc || oc.religionId < 0) continue;
      if (oc.religionId !== cap.religionId && k.relations[o.id] !== undefined) {
        // Religious difference nudges relations toward hostility.
        k.relations[o.id] = Math.max(-100, (k.relations[o.id] ?? 0) - 1);
        o.relations[k.id] = k.relations[o.id];
      }
    }
  }
}
