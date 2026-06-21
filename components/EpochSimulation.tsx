"use client";

import { useEffect, useRef, useState } from "react";
import { createWorld, step } from "@/lib/engine/world";
import { paintTerrain, RESOURCE_COLOR } from "@/lib/engine/render";
import { renderTerritoryOverlay } from "@/lib/engine/kingdoms";
import { ResourceType, World, WorldEvent } from "@/lib/engine/types";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

interface Stats {
  year: number;
  population: number;
  settlements: number;
  kingdoms: number;
  religions: number;
  wars: number;
  routes: number;
}

type SelKind = "city" | "kingdom" | "religion" | "person";
interface Selection {
  kind: SelKind;
  id: number;
}

const BASE_TPS = 30;
const SPEEDS = [0.5, 1, 2, 4] as const;

// Ink tones tuned to read on parchment.
const EVENT_COLOR: Record<string, string> = {
  settlement: "#5b4a2a",
  kingdom: "#876214",
  ruler: "#7a5418",
  war: "#8a2d1c",
  battle: "#9a4521",
  capture: "#7c241c",
  collapse: "#5e3470",
  diplomacy: "#1f5a6b",
  religion: "#2f6a52",
  trade: "#7a5a1e",
};

const MAJOR = new Set(["kingdom", "war", "capture", "collapse", "religion", "ruler"]);

// ---- detail snapshots (read live data for the inspect panel) ---------------

interface Detail {
  kind: SelKind;
  title: string;
  accent: string;
  rows: { label: string; value: string }[];
  links: { label: string; sel: Selection }[];
  extra?: string[];
}

function yearOf(tick: number): number {
  return 1 + Math.floor(tick / 12);
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function buildDetail(world: World, sel: Selection): Detail | null {
  if (sel.kind === "city") {
    const s = world.settlements[sel.id];
    if (!s) return null;
    const k = s.kingdomId >= 0 ? world.kingdoms[s.kingdomId] : null;
    const rel = s.religionId >= 0 ? world.religions[s.religionId] : null;
    const routes = world.tradeRoutes.filter((r) => r.a === s.id || r.b === s.id);
    const partners = routes
      .map((r) => {
        const other = world.settlements[r.a === s.id ? r.b : r.a];
        return other ? `${other.name} (${r.good})` : null;
      })
      .filter(Boolean) as string[];
    const topGoods = (Object.entries(s.stock) as [ResourceType, number][])
      .filter(([, v]) => v > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([g, v]) => `${g} ${Math.round(v)}`);

    const links: Detail["links"] = [];
    if (k) links.push({ label: `⚑ ${k.name}`, sel: { kind: "kingdom", id: k.id } });
    if (rel) links.push({ label: `${rel.symbol} ${rel.name}`, sel: { kind: "religion", id: rel.id } });

    return {
      kind: "city",
      title: s.name,
      accent: k?.color ?? "#e9cf93",
      rows: [
        { label: "Type", value: s.tier },
        { label: "Population", value: fmt(s.population) },
        { label: "Wealth", value: fmt(s.wealth) },
        { label: "Loyalty", value: `${Math.round(s.loyalty)}%` },
        { label: "Defense", value: fmt(s.defense) },
        { label: "Founded", value: `Year ${yearOf(s.founded)}` },
        { label: "Trade routes", value: String(routes.length) },
      ],
      links,
      extra: [
        topGoods.length ? `Stores: ${topGoods.join(", ")}` : "",
        partners.length ? `Trades with: ${partners.join(", ")}` : "",
      ].filter(Boolean),
    };
  }

  if (sel.kind === "kingdom") {
    const k = world.kingdoms[sel.id];
    if (!k || !k.alive) return null;
    const cap = world.settlements[k.capital];
    const rel = cap && cap.religionId >= 0 ? world.religions[cap.religionId] : null;
    const warNames = k.wars
      .map((id) => world.kingdoms[id]?.name)
      .filter(Boolean) as string[];
    const allyNames = k.allies
      .map((id) => world.kingdoms[id]?.name)
      .filter(Boolean) as string[];

    const links: Detail["links"] = [];
    if (cap) links.push({ label: `★ ${cap.name}`, sel: { kind: "city", id: cap.id } });
    if (rel) links.push({ label: `${rel.symbol} ${rel.name}`, sel: { kind: "religion", id: rel.id } });

    return {
      kind: "kingdom",
      title: k.name,
      accent: k.color,
      rows: [
        { label: "Ruler", value: k.ruler },
        { label: "Reign", value: `${yearOf(world.tick) - yearOf(k.rulerSince)} yrs` },
        { label: "Capital", value: cap?.name ?? "—" },
        { label: "Cities", value: String(k.members.length) },
        { label: "Population", value: fmt(k.population) },
        { label: "Military", value: fmt(k.military) },
        { label: "Wealth", value: fmt(k.wealth) },
        { label: "Stability", value: `${Math.round(k.stability)}%` },
        { label: "Founded", value: `Year ${yearOf(k.founded)}` },
      ],
      links,
      extra: [
        warNames.length ? `At war with: ${warNames.join(", ")}` : "At peace",
        allyNames.length ? `Allied with: ${allyNames.join(", ")}` : "",
      ].filter(Boolean),
    };
  }

  if (sel.kind === "religion") {
    const r = world.religions[sel.id];
    if (!r || !r.alive) return null;
    const holy = world.settlements[r.holyCity];
    const parent = r.parent >= 0 ? world.religions[r.parent] : null;
    const links: Detail["links"] = [];
    if (holy) links.push({ label: `★ ${holy.name}`, sel: { kind: "city", id: holy.id } });
    if (parent) links.push({ label: `↩ ${parent.name}`, sel: { kind: "religion", id: parent.id } });

    return {
      kind: "religion",
      title: `${r.symbol} ${r.name}`,
      accent: r.color,
      rows: [
        { label: "Holy city", value: holy?.name ?? "—" },
        { label: "Followers", value: fmt(r.followers) },
        { label: "Congregations", value: String(r.members.length) },
        { label: "Founded", value: `Year ${yearOf(r.founded)}` },
        { label: "Origin", value: parent ? "Schism" : "Original faith" },
      ],
      links,
    };
  }

  // person
  const p = world.settlers[sel.id];
  if (!p) return null;
  const home = p.home >= 0 ? world.settlements[p.home] : null;
  return {
    kind: "person",
    title: p.name,
    accent: "#cfe8ff",
    rows: [
      { label: "Age", value: String(p.age) },
      { label: "Job", value: p.job },
      { label: "Doing", value: p.state },
      { label: "Home", value: home?.name ?? "wandering" },
      {
        label: "Carrying",
        value: p.carryType ? `${Math.round(p.carrying)} ${p.carryType}` : "nothing",
      },
    ],
    links: home ? [{ label: `★ ${home.name}`, sel: { kind: "city", id: home.id } }] : [],
  };
}

// ---- atmospheric canvas helpers -------------------------------------------

function drawClouds(
  ctx: CanvasRenderingContext2D,
  mw: number,
  mh: number,
  t: number,
): void {
  for (let i = 0; i < 7; i++) {
    const seed = i * 131.1;
    const speed = 0.5 + (i % 3) * 0.22;
    const cx = (((t * speed + seed) % (mw + 80)) + (mw + 80)) % (mw + 80) - 40;
    const cy = (i * 53.7) % mh;
    const r = 16 + (i % 4) * 7;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, "rgba(232,226,210,0.10)");
    g.addColorStop(0.5, "rgba(214,206,188,0.055)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSelectionRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  t: number,
): void {
  const pulse = 0.9 + 0.12 * Math.sin(t * 3);
  ctx.save();
  ctx.strokeStyle = "rgba(255,248,224,0.95)";
  ctx.lineWidth = 0.32;
  ctx.setLineDash([1.4, 1.0]);
  ctx.lineDashOffset = -t * 4;
  ctx.beginPath();
  ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWavingBanner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  t: number,
): void {
  const poleH = 3.2;
  ctx.strokeStyle = "rgba(40,28,14,0.9)";
  ctx.lineWidth = 0.16;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - poleH);
  ctx.stroke();

  const top = y - poleH;
  const w = 2.3;
  const h = 1.3;
  const seg = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i <= seg; i++) {
    const fx = x + (i / seg) * w;
    const wave = Math.sin(t * 4 + i * 1.1) * 0.22 * (i / seg);
    if (i === 0) ctx.moveTo(fx, top + wave);
    else ctx.lineTo(fx, top + wave);
  }
  for (let i = seg; i >= 0; i--) {
    const fx = x + (i / seg) * w;
    const wave = Math.sin(t * 4 + i * 1.1) * 0.22 * (i / seg);
    ctx.lineTo(fx, top + h + wave);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(40,28,14,0.45)";
  ctx.lineWidth = 0.07;
  ctx.stroke();
}

function drawHouse(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  w: number,
  roof: string,
): void {
  ctx.fillStyle = "#cdb079";
  ctx.fillRect(hx - w / 2, hy - w / 2, w, w);
  ctx.strokeStyle = "rgba(46,33,18,0.8)";
  ctx.lineWidth = 0.07;
  ctx.strokeRect(hx - w / 2, hy - w / 2, w, w);
  ctx.fillStyle = roof;
  ctx.beginPath();
  ctx.moveTo(hx - w / 2 - 0.12, hy - w / 2);
  ctx.lineTo(hx, hy - w);
  ctx.lineTo(hx + w / 2 + 0.12, hy - w / 2);
  ctx.closePath();
  ctx.fill();
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.strokeStyle = "rgba(46,33,18,0.7)";
  ctx.lineWidth = 0.06;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI / 4) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    const px = x + Math.cos(ang) * rad;
    const py = y + Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

interface MarkerOpts {
  isCapital: boolean;
  isHoly: boolean;
  relColor: string | null;
  selected: boolean;
  id: number;
  t: number;
}

// A settlement drawn as an evolving landmark — from a lone tent to a
// walled, bannered capital — so size and grandeur read at a glance.
function drawSettlement(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tier: string,
  color: string,
  o: MarkerOpts,
): void {
  const size =
    tier === "city" ? 2.4 : tier === "town" ? 1.8 : tier === "village" ? 1.3 : 0.95;
  const grand = o.isCapital ? size * 1.25 : size;

  // Living glow that gently flickers like hearth-light.
  const flick = 0.16 + 0.05 * Math.sin(o.t * 2 + o.id * 1.7);
  ctx.globalAlpha = flick;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, grand * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Ground shadow.
  ctx.fillStyle = "rgba(25,16,8,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + grand * 0.35, grand * 0.95, grand * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Holy aura.
  if (o.isHoly && o.relColor) {
    ctx.strokeStyle = o.relColor;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = grand * 0.14;
    ctx.beginPath();
    ctx.arc(x, y, grand * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // City / capital walls.
  if (tier === "city" || o.isCapital) {
    ctx.strokeStyle = "rgba(58,42,22,0.85)";
    ctx.lineWidth = grand * 0.16;
    ctx.beginPath();
    ctx.arc(x, y, grand * 0.98, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(208,186,130,0.9)";
    ctx.lineWidth = grand * 0.07;
    ctx.beginPath();
    ctx.arc(x, y, grand * 0.98, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Buildings clustered in the centre.
  const n = tier === "camp" ? 1 : tier === "village" ? 2 : tier === "town" ? 3 : 4;
  const hw = grand * 0.42;
  if (n === 1) {
    // A lone tent.
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(46,33,18,0.8)";
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    ctx.moveTo(x, y - grand * 0.5);
    ctx.lineTo(x + grand * 0.45, y + grand * 0.3);
    ctx.lineTo(x - grand * 0.45, y + grand * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + 0.4;
      const rr = grand * 0.45;
      drawHouse(ctx, x + Math.cos(ang) * rr, y + Math.sin(ang) * rr, hw, color);
    }
    // Central keep for towns and larger.
    ctx.fillStyle = "#bfa06a";
    ctx.strokeStyle = "rgba(46,33,18,0.85)";
    ctx.lineWidth = 0.08;
    const tw = grand * 0.4;
    const th = grand * 0.85;
    ctx.fillRect(x - tw / 2, y - th * 0.5, tw, th);
    ctx.strokeRect(x - tw / 2, y - th * 0.5, tw, th);
  }

  if (o.isCapital) {
    drawStar(ctx, x, y - grand * 1.5, grand * 0.5, "#f4e2b8");
    drawWavingBanner(ctx, x + grand * 0.5, y - grand * 0.9, color, o.t);
  }

  if (o.selected) drawSelectionRing(ctx, x, y, grand + 1.6, o.t);
}

export default function EpochSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const territoryRef = useRef<HTMLCanvasElement | null>(null);
  const territoryVersionRef = useRef(-1);
  const cameraRef = useRef<Camera>({ x: 110, y: 75, zoom: 4 });
  const seedRef = useRef(0);

  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const selectionRef = useRef<Selection | null>(null);

  const milestonesRef = useRef<WorldEvent[]>([]);
  const lastSampleTickRef = useRef(0);

  const [stats, setStats] = useState<Stats>({
    year: 0,
    population: 0,
    settlements: 0,
    kingdoms: 0,
    religions: 0,
    wars: 0,
    routes: 0,
  });
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [timeline, setTimeline] = useState<WorldEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);

  function selectEntity(sel: Selection | null) {
    selectionRef.current = sel;
    const world = worldRef.current;
    setDetail(sel && world ? buildDetail(world, sel) : null);
  }

  function bakeTerritory(world: World) {
    const off = territoryRef.current ?? document.createElement("canvas");
    off.width = world.map.width;
    off.height = world.map.height;
    const octx = off.getContext("2d")!;
    octx.clearRect(0, 0, off.width, off.height);
    octx.putImageData(renderTerritoryOverlay(world), 0, 0);
    territoryRef.current = off;
    territoryVersionRef.current = world.territoryVersion;
  }

  function buildWorld(seed: number) {
    seedRef.current = seed;
    const world = createWorld(seed);
    worldRef.current = world;
    terrainRef.current = paintTerrain(world.map);
    territoryVersionRef.current = -1;
    milestonesRef.current = [];
    lastSampleTickRef.current = 0;
    selectEntity(null);
    setTimeline([]);
    setEvents([]);
  }

  function newWorld() {
    buildWorld((Math.random() * 1e9) | 0);
  }
  function resetWorld() {
    buildWorld(seedRef.current);
  }
  function togglePause() {
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }
  function changeSpeed(s: number) {
    speedRef.current = s;
    setSpeed(s);
  }
  function zoomBy(factor: number) {
    const cam = cameraRef.current;
    cam.zoom = Math.max(1.5, Math.min(26, cam.zoom * factor));
  }

  useEffect(() => {
    buildWorld((Math.random() * 1e9) | 0);

    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    function frame(now: number) {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const t = now / 1000;

      const world = worldRef.current!;
      if (!pausedRef.current) {
        acc += dt * BASE_TPS * speedRef.current;
        let steps = 0;
        const cap = 8 * Math.ceil(speedRef.current);
        while (acc >= 1 && steps < cap) {
          step(world);
          acc -= 1;
          steps++;
        }
      } else {
        acc = 0;
      }

      if (world.territoryVersion !== territoryVersionRef.current) {
        bakeTerritory(world);
      }

      draw(ctx, canvas, world, t);

      if (world.tick % 12 === 0) {
        let pop = 0;
        for (const s of world.settlements) if (s) pop += s.population;
        setStats({
          year: yearOf(world.tick),
          population: pop || world.settlers.length,
          settlements: world.settlements.filter(Boolean).length,
          kingdoms: world.kingdoms.filter((k) => k && k.alive).length,
          religions: world.religions.filter((r) => r && r.alive).length,
          wars: world.wars.length,
          routes: world.tradeRoutes.length,
        });
        setEvents(world.events.slice(-16).reverse());

        const since = lastSampleTickRef.current;
        const fresh = world.events.filter((e) => e.tick > since && MAJOR.has(e.kind));
        if (fresh.length) {
          milestonesRef.current.push(...fresh);
          if (milestonesRef.current.length > 80) {
            milestonesRef.current.splice(0, milestonesRef.current.length - 80);
          }
          setTimeline([...milestonesRef.current]);
        }
        lastSampleTickRef.current = world.tick;

        if (selectionRef.current) {
          const d = buildDetail(world, selectionRef.current);
          if (!d) selectEntity(null);
          else setDetail(d);
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // --- pan / zoom / click-to-inspect -----------------------------------
    let dragging = false;
    let moved = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;

    function toWorld(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      const cam = cameraRef.current;
      return {
        x: (clientX - rect.left - rect.width / 2) / cam.zoom + cam.x,
        y: (clientY - rect.top - rect.height / 2) / cam.zoom + cam.y,
      };
    }

    function pick(clientX: number, clientY: number) {
      const world = worldRef.current!;
      const { x, y } = toWorld(clientX, clientY);

      let bestCity = -1;
      let bestCityD = Infinity;
      for (const s of world.settlements) {
        if (!s) continue;
        const radius =
          s.tier === "city" ? 3.4 : s.tier === "town" ? 2.6 : s.tier === "village" ? 2 : 1.5;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < radius && d < bestCityD) {
          bestCityD = d;
          bestCity = s.id;
        }
      }
      if (bestCity >= 0) {
        selectEntity({ kind: "city", id: bestCity });
        return;
      }

      let bestP = -1;
      let bestPD = 1.1;
      for (const p of world.settlers) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestPD) {
          bestPD = d;
          bestP = p.id;
        }
      }
      if (bestP >= 0) {
        selectEntity({ kind: "person", id: bestP });
        return;
      }

      const map = world.map;
      const tx = Math.floor(x);
      const ty = Math.floor(y);
      if (tx >= 0 && ty >= 0 && tx < map.width && ty < map.height) {
        const kid = world.territory[ty * map.width + tx];
        if (kid >= 0) {
          selectEntity({ kind: "kingdom", id: kid });
          return;
        }
      }
      selectEntity(null);
    }

    const onDown = (e: MouseEvent) => {
      dragging = true;
      moved = false;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
    };
    const onUp = (e: MouseEvent) => {
      dragging = false;
      if (!moved && Math.hypot(e.clientX - downX, e.clientY - downY) < 5) {
        pick(e.clientX, e.clientY);
      }
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
      const cam = cameraRef.current;
      cam.x -= (e.clientX - lastX) / cam.zoom;
      cam.y -= (e.clientY - lastY) / cam.zoom;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    world: World,
    t: number,
  ) {
    const cam = cameraRef.current;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pps = cam.zoom;
    const sel = selectionRef.current;
    const mw = world.map.width;
    const mh = world.map.height;

    ctx.fillStyle = "#0b0704";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 - cam.x * pps, h / 2 - cam.y * pps);
    ctx.scale(pps, pps);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainRef.current!, 0, 0, mw, mh);
    if (territoryRef.current) ctx.drawImage(territoryRef.current, 0, 0, mw, mh);

    // Drifting clouds — alive even while paused (driven by real time).
    drawClouds(ctx, mw, mh, t);

    // Trade caravans glide along glowing roads.
    for (const r of world.tradeRoutes) {
      const a = world.settlements[r.a];
      const b = world.settlements[r.b];
      if (!a || !b) continue;
      ctx.strokeStyle = "#9a7636";
      ctx.globalAlpha = 0.22 + Math.min(0.28, r.volume * 0.04);
      ctx.setLineDash([1.5, 1.2]);
      ctx.lineDashOffset = -t * 3;
      ctx.lineWidth = 0.22 + r.volume * 0.05;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const f = (((t * 0.06 + r.phase) % 1) + 1) % 1;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = RESOURCE_COLOR[r.good] ?? "#e7b94a";
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Resource nodes — faint cartographer's marks.
    for (const r of world.map.resources) {
      if (r.amount < 1) continue;
      ctx.fillStyle = RESOURCE_COLOR[r.type];
      ctx.globalAlpha = 0.3 + 0.3 * (r.amount / r.capacity);
      ctx.beginPath();
      ctx.arc(r.x + 0.5, r.y + 0.5, 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Settlers — tiny glowing folk.
    for (const s of world.settlers) {
      const glow =
        s.state === "gather" ? "#ffe39a" : s.carrying > 0 ? "#ffcaa0" : "#cfe8ff";
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (sel?.kind === "person") {
      const p = world.settlers[sel.id];
      if (p) drawSelectionRing(ctx, p.x, p.y, 1.4, t);
    }

    // Armies.
    for (const army of world.armies) {
      const k = world.kingdoms[army.kingdomId];
      if (!k) continue;
      const size = 0.8 + Math.min(1.6, army.strength * 0.01);
      ctx.save();
      ctx.translate(army.x, army.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = k.color;
      ctx.strokeStyle = "#120c06";
      ctx.lineWidth = 0.25;
      ctx.beginPath();
      ctx.rect(-size / 2, -size / 2, size, size);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      if (army.state === "siege") {
        ctx.globalAlpha = 0.25 + 0.1 * Math.sin(t * 6);
        ctx.fillStyle = "#c4452a";
        ctx.beginPath();
        ctx.arc(army.x, army.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Settlements as evolving landmarks.
    for (const st of world.settlements) {
      if (!st) continue;
      const k = st.kingdomId >= 0 ? world.kingdoms[st.kingdomId] : null;
      const rel = st.religionId >= 0 ? world.religions[st.religionId] : null;
      const color = k && k.alive ? k.color : "#c9a96a";
      drawSettlement(ctx, st.x, st.y, st.tier, color, {
        isCapital: !!(k && k.capital === st.id),
        isHoly: !!(rel && rel.alive && rel.holyCity === st.id),
        relColor: rel?.color ?? null,
        selected: sel?.kind === "city" && sel.id === st.id,
        id: st.id,
        t,
      });

      if (cam.zoom > 4.5 && (st.tier === "city" || st.tier === "town")) {
        ctx.textAlign = "center";
        if (rel && rel.alive) {
          ctx.fillStyle = rel.color;
          ctx.font = "3.4px serif";
          ctx.fillText(rel.symbol, st.x, st.y - 4.4);
        }
        const label = st.name.toUpperCase();
        ctx.font = `600 ${st.tier === "city" ? 3.2 : 2.7}px Cinzel, serif`;
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = "rgba(244,232,200,0.85)";
        ctx.strokeText(label, st.x, st.y - 2.6);
        ctx.fillStyle = "#3a2a12";
        ctx.fillText(label, st.x, st.y - 2.6);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  const era =
    stats.wars > 0
      ? "Age of War"
      : stats.religions > 0
        ? "Age of Faith"
        : stats.kingdoms > 0
          ? "Age of Kingdoms"
          : "Age of Tribes";
  const maxYear = Math.max(1, stats.year);

  const btn =
    "rounded-sm px-2.5 py-1 text-[13px] text-[#2a1d0e] transition-colors hover:bg-[#3a2a12]/10";

  return (
    <div className="relative h-full w-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* Aged-map frame, vignette and corner flourishes (non-interactive). */}
      <div className="pointer-events-none absolute inset-0 z-20">
        <div className="absolute inset-2 rounded-sm border border-[#b8954e]/45 shadow-[inset_0_0_0_2px_rgba(18,10,4,0.7),inset_0_0_160px_55px_rgba(8,4,2,0.78)]" />
        <div className="absolute inset-[10px] rounded-sm border border-[#8a6a2e]/30" />
        {[
          "left-2 top-2",
          "right-2 top-2 scale-x-[-1]",
          "left-2 bottom-2 scale-y-[-1]",
          "right-2 bottom-2 -scale-100",
        ].map((pos) => (
          <div key={pos} className={`absolute ${pos} font-title text-2xl text-[#b8954e]/55`}>
            ❧
          </div>
        ))}
        {/* Compass rose */}
        <svg
          className="absolute bottom-7 right-7 h-24 w-24 text-[#caa765]/55"
          viewBox="0 0 100 100"
          fill="none"
        >
          <circle cx="50" cy="50" r="34" stroke="currentColor" strokeWidth="1" />
          <circle cx="50" cy="50" r="26" stroke="currentColor" strokeWidth="0.5" />
          <polygon points="50,8 56,50 50,46 44,50" fill="currentColor" />
          <polygon points="50,92 44,50 50,54 56,50" fill="currentColor" opacity="0.5" />
          <polygon points="8,50 50,44 46,50 50,56" fill="currentColor" opacity="0.5" />
          <polygon points="92,50 50,56 54,50 50,44" fill="currentColor" opacity="0.5" />
          <text x="50" y="6" textAnchor="middle" fontSize="9" fill="currentColor" fontFamily="Cinzel, serif">N</text>
        </svg>
      </div>

      {/* Title cartouche + realm tally */}
      <div className="absolute left-5 top-5 z-30 w-60">
        <div className="parchment brass-frame px-5 py-4">
          <div className="font-title text-3xl leading-none tracking-wide text-[#2a1d0e]">
            Epoch
          </div>
          <div className="mt-1 font-script text-sm italic text-[#6b4a1c]">
            {era} · Year {stats.year}
          </div>
          <div className="rule my-3" />
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-display text-[12px] uppercase tracking-wide text-[#46340f]">
            <Stat label="Souls" value={stats.population.toLocaleString()} />
            <Stat label="Cities" value={String(stats.settlements)} />
            <Stat label="Realms" value={String(stats.kingdoms)} />
            <Stat label="Faiths" value={String(stats.religions)} />
            <Stat label="Routes" value={String(stats.routes)} />
            <Stat label="Wars" value={String(stats.wars)} danger={stats.wars > 0} />
          </div>
        </div>

        {detail && (
          <div className="parchment brass-frame mt-3 max-h-[52vh] overflow-y-auto thin-scroll px-5 py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-black/30"
                    style={{ background: detail.accent }}
                  />
                  <span className="font-display text-[10px] uppercase tracking-[0.2em] text-[#6b4a1c]">
                    {detail.kind}
                  </span>
                </div>
                <div className="mt-1 font-title text-xl leading-tight text-[#2a1d0e]">
                  {detail.title}
                </div>
              </div>
              <button
                onClick={() => selectEntity(null)}
                className="rounded px-1.5 text-[#6b4a1c] hover:bg-black/10"
              >
                ✕
              </button>
            </div>
            <div className="rule my-3" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
              {detail.rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-2">
                  <span className="font-display text-[10px] uppercase tracking-wide text-[#7a5a2e]">
                    {r.label}
                  </span>
                  <span className="text-right text-[#2a1d0e]">{r.value}</span>
                </div>
              ))}
            </div>
            {detail.extra?.map((x, i) => (
              <div key={i} className="mt-2 font-script text-[13px] leading-snug text-[#4a3416]">
                {x}
              </div>
            ))}
            {detail.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.links.map((l) => (
                  <button
                    key={l.label}
                    onClick={() => selectEntity(l.sel)}
                    className="rounded-sm border border-[#8a6a2e]/50 bg-[#3a2a12]/5 px-2 py-0.5 text-[12px] text-[#46340f] hover:bg-[#3a2a12]/12"
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Brass control bar */}
      <div className="absolute left-1/2 top-5 z-30 -translate-x-1/2">
        <div className="parchment brass-frame flex items-center gap-0.5 px-2 py-1.5">
          <button onClick={togglePause} className={`${btn} font-display`} title="Play / pause (space)">
            {paused ? "▶ Play" : "❙❙ Pause"}
          </button>
          <span className="mx-1 h-4 w-px bg-[#8a6a2e]/40" />
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              className={`rounded-sm px-2 py-1 text-[12px] ${
                speed === s
                  ? "bg-[#3a2a12] text-[#e9d4a0]"
                  : "text-[#2a1d0e] hover:bg-[#3a2a12]/10"
              }`}
            >
              {s}×
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[#8a6a2e]/40" />
          <button onClick={() => zoomBy(1.25)} className={btn} title="Zoom in">＋</button>
          <button onClick={() => zoomBy(1 / 1.25)} className={btn} title="Zoom out">－</button>
          <span className="mx-1 h-4 w-px bg-[#8a6a2e]/40" />
          <button onClick={resetWorld} className={`${btn} font-display`} title="Restart this world">↻ Reset</button>
          <button onClick={newWorld} className="rounded-sm bg-[#3a2a12] px-2.5 py-1 font-display text-[13px] text-[#e9d4a0] hover:bg-[#4a3618]" title="Forge a new world">
            ✦ New World
          </button>
        </div>
      </div>

      {/* The Chronicle */}
      <div className="absolute right-5 top-5 bottom-32 z-30 w-72">
        <div className="parchment brass-frame flex h-full flex-col">
          <div className="px-5 pt-4">
            <div className="font-title text-lg text-[#2a1d0e]">The Chronicle</div>
            <div className="font-script text-[12px] italic text-[#6b4a1c]">
              as recorded by the keepers of years
            </div>
          </div>
          <div className="rule mx-5 my-2" />
          <div className="thin-scroll flex-1 space-y-2.5 overflow-y-auto px-5 pb-5 font-script text-[13.5px] leading-snug">
            {events.length === 0 && (
              <div className="italic text-[#6b4a1c]">History has yet to be written…</div>
            )}
            {events.map((e, i) => (
              <div key={`${e.tick}-${i}`} className="border-l-2 pl-2.5" style={{ borderColor: EVENT_COLOR[e.kind] ?? "#5b4a2a" }}>
                <span className="font-display text-[10px] uppercase tracking-wide text-[#8a6a36]">
                  Year {e.year}
                </span>
                <div style={{ color: EVENT_COLOR[e.kind] ?? "#3a2a12" }}>{e.text}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline of ages */}
      <div className="absolute bottom-9 left-5 right-5 z-30">
        <div className="parchment brass-frame px-5 py-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-title text-[13px] tracking-wide text-[#2a1d0e]">
              The Ages of the World
            </span>
            <span className="font-script text-[12px] italic text-[#6b4a1c]">
              {era}
            </span>
          </div>
          <div className="relative h-7">
            <div className="absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-[#7a5a2e]/40" />
            {timeline.map((e, i) => {
              const leftPct = Math.min(100, (e.year / maxYear) * 100);
              return (
                <div
                  key={`${e.tick}-${i}`}
                  className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${leftPct}%` }}
                >
                  <div
                    className="h-3.5 w-[3px] rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: EVENT_COLOR[e.kind] ?? "#5b4a2a" }}
                  />
                  <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 hidden w-52 -translate-x-1/2 rounded-sm border border-[#8a6a2e]/50 bg-[#efe0bb] px-2 py-1 text-[11px] leading-snug text-[#3a2a12] shadow-lg group-hover:block">
                    <span className="font-display text-[9px] uppercase tracking-wide text-[#8a6a36]">
                      Year {e.year}
                    </span>
                    <div>{e.text}</div>
                  </div>
                </div>
              );
            })}
            <div className="absolute bottom-0 left-0 font-display text-[9px] tracking-wide text-[#7a5a2e]">
              Year 1
            </div>
            <div className="absolute bottom-0 right-0 font-display text-[9px] tracking-wide text-[#7a5a2e]">
              Year {stats.year}
            </div>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-2.5 left-1/2 z-30 -translate-x-1/2 font-script text-[12px] italic text-[#caa765]/70">
        drag to wander the map · scroll to draw nearer · touch any city, soul, or realm to read its tale
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[10px] text-[#7a5a2e]">{label}</span>
      <span className={`font-display text-[13px] tabular-nums ${danger ? "text-[#8a2d1c]" : "text-[#2a1d0e]"}`}>
        {value}
      </span>
    </div>
  );
}
