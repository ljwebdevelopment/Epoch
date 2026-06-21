import { RNG, pick } from "./prng";

const SYLL_START = [
  "Aro", "Vel", "Kor", "Tyr", "Mor", "El", "Bran", "Dun", "Fen", "Gal",
  "Hal", "Ith", "Jor", "Kel", "Lor", "Mar", "Nor", "Oth", "Per", "Quy",
  "Ras", "Sel", "Tor", "Ux", "Vor", "Wyn", "Xan", "Yr", "Zel", "Cae",
];

const SYLL_END = [
  "wyn", "dor", "ath", "mir", "gard", "heim", "fall", "mere", "wick", "burg",
  "stead", " holm", "vale", "reach", "moor", "crest", "ford", "haven", "spire", "gate",
];

const PERSON_FIRST = [
  "Aldric", "Bryn", "Cael", "Dara", "Eira", "Faro", "Gwen", "Hael", "Iona", "Joren",
  "Kira", "Lonn", "Maeve", "Nael", "Orin", "Pell", "Rhea", "Soren", "Tavi", "Vesna",
  "Yara", "Zorin", "Mira", "Doran", "Selka", "Brannoc", "Liraz", "Othen", "Cassia", "Varo",
];

export function settlementName(rng: RNG): string {
  return pick(rng, SYLL_START) + pick(rng, SYLL_END).trim();
}

export function personName(rng: RNG): string {
  return pick(rng, PERSON_FIRST);
}

const REALM_FORMS = [
  "Kingdom of {n}",
  "Realm of {n}",
  "Dominion of {n}",
  "Empire of {n}",
  "{n}an League",
  "Crown of {n}",
  "{n}mark",
];

const RULER_TITLES = [
  "King", "Queen", "High King", "Warlord", "Matriarch", "Patriarch",
  "Chieftain", "Emperor", "Empress", "Archon",
];

export function kingdomName(rng: RNG): string {
  const root = pick(rng, SYLL_START) + pick(rng, ["a", "or", "en", "ia", "oth", "ar"]);
  return pick(rng, REALM_FORMS).replace("{n}", root);
}

export function rulerName(rng: RNG): string {
  const numerals = ["I", "II", "III", "IV", "V"];
  const regnal = rng() < 0.5 ? " " + pick(rng, numerals) : "";
  return `${pick(rng, RULER_TITLES)} ${pick(rng, PERSON_FIRST)}${regnal}`;
}

const FAITH_ROOTS = [
  "Sol", "Lun", "Vael", "Orin", "Thal", "Myr", "Aza", "Kael", "Ner", "Quor",
  "Sere", "Vyr", "Eth", "Drael", "Oss", "Pyr", "Aether", "Umbra", "Ignis",
];

const FAITH_FORMS = [
  "The Way of {n}",
  "Church of {n}",
  "The {n} Covenant",
  "Cult of {n}",
  "The {n}ite Faith",
  "Order of {n}",
  "The {n} Light",
];

const SCHISM_PREFIX = [
  "Reformed", "Orthodox", "Old", "True", "Ascendant", "Hidden",
];

export const FAITH_SYMBOLS = [
  "☥", "☼", "☾", "✶", "⚚", "☯", "✠", "⟁", "♆", "☩", "❂", "⌖", "✺", "⚜",
];

export function religionName(rng: RNG): string {
  const root = pick(rng, FAITH_ROOTS);
  return pick(rng, FAITH_FORMS).replace("{n}", root);
}

export function schismName(rng: RNG, base: string): string {
  return `The ${pick(rng, SCHISM_PREFIX)} ${base.replace(/^(The |Church of |Cult of |Order of )/, "")}`;
}

export const JOBS = [
  "Forager", "Hunter", "Woodcutter", "Miner", "Farmer", "Wanderer",
] as const;

export type Job = (typeof JOBS)[number];

export function jobName(rng: RNG): Job {
  return pick(rng, JOBS);
}
