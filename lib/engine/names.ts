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

export const JOBS = [
  "Forager", "Hunter", "Woodcutter", "Miner", "Farmer", "Wanderer",
] as const;

export type Job = (typeof JOBS)[number];

export function jobName(rng: RNG): Job {
  return pick(rng, JOBS);
}
