"use client";

import { useEffect, useRef, useState } from "react";
import { createWorld, step } from "@/lib/engine/world";
import { renderTerrain, RESOURCE_COLOR } from "@/lib/engine/render";
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

const EVENT_COLOR: Record<string, string> = {
  settlement: "#d8c79a",
  kingdom: "#f2cf52",
  ruler: "#e8b14c",
  war: "#e06a4f",
  battle: "#ff8c6b",
  capture: "#ff6b6b",
  collapse: "#b06bd8",
  diplomacy: "#6bc6e0",
  religion: "#8fd3c2",
  trade: "#d9b46a",
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

    const off = document.createElement("canvas");
    off.width = world.map.width;
    off.height = world.map.height;
    const octx = off.getContext("2d")!;
    octx.putImageData(renderTerrain(world.map), 0, 0);
    terrainRef.current = off;
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
    cam.zoom = Math.max(1.5, Math.min(24, cam.zoom * factor));
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

      draw(ctx, canvas, world);

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
        setEvents(world.events.slice(-14).reverse());

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

        // Refresh the open inspect panel with live values.
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
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      return {
        x: (sx - rect.width / 2) / cam.zoom + cam.x,
        y: (sy - rect.height / 2) / cam.zoom + cam.y,
      };
    }

    function pick(clientX: number, clientY: number) {
      const world = worldRef.current!;
      const { x, y } = toWorld(clientX, clientY);

      // Settlements (largest target priority).
      let bestCity = -1;
      let bestCityD = Infinity;
      for (const s of world.settlements) {
        if (!s) continue;
        const radius =
          s.tier === "city" ? 3.2 : s.tier === "town" ? 2.6 : s.tier === "village" ? 2 : 1.5;
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

      // Individual settlers (small targets — need to be zoomed in).
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

      // Otherwise the kingdom whose territory was clicked.
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
  ) {
    const cam = cameraRef.current;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const pps = cam.zoom;
    const sel = selectionRef.current;

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 - cam.x * pps, h / 2 - cam.y * pps);
    ctx.scale(pps, pps);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainRef.current!, 0, 0);
    if (territoryRef.current) ctx.drawImage(territoryRef.current, 0, 0);

    for (const r of world.tradeRoutes) {
      const a = world.settlements[r.a];
      const b = world.settlements[r.b];
      if (!a || !b) continue;
      ctx.strokeStyle = "#d9b46a";
      ctx.globalAlpha = 0.25 + Math.min(0.3, r.volume * 0.04);
      ctx.lineWidth = 0.25 + r.volume * 0.06;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      const f = (((world.tick * 0.01 + r.phase) % 1) + 1) % 1;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = RESOURCE_COLOR[r.good] ?? "#f2cf52";
      ctx.beginPath();
      ctx.arc(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (const r of world.map.resources) {
      if (r.amount < 1) continue;
      ctx.fillStyle = RESOURCE_COLOR[r.type];
      ctx.globalAlpha = 0.35 + 0.35 * (r.amount / r.capacity);
      ctx.beginPath();
      ctx.arc(r.x + 0.5, r.y + 0.5, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

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
      if (p) drawSelectionRing(ctx, p.x, p.y, 1.4, world.tick);
    }

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
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath();
        ctx.arc(army.x, army.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    for (const st of world.settlements) {
      if (!st) continue;
      const k = st.kingdomId >= 0 ? world.kingdoms[st.kingdomId] : null;
      const rel = st.religionId >= 0 ? world.religions[st.religionId] : null;
      const radius =
        st.tier === "city" ? 2.8 : st.tier === "town" ? 2.1 : st.tier === "village" ? 1.5 : 1;
      const color = k && k.alive ? k.color : "#e9cf93";

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.22;
      ctx.beginPath();
      ctx.arc(st.x, st.y, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(st.x, st.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#120c06";
      ctx.lineWidth = 0.2;
      ctx.stroke();

      if (k && k.capital === st.id) {
        ctx.strokeStyle = "#fff4d6";
        ctx.lineWidth = 0.3;
        ctx.beginPath();
        ctx.arc(st.x, st.y, radius * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (rel && rel.alive && rel.holyCity === st.id) {
        ctx.strokeStyle = rel.color;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        ctx.arc(st.x, st.y, radius * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (sel?.kind === "city" && sel.id === st.id) {
        drawSelectionRing(ctx, st.x, st.y, radius + 1.6, world.tick);
      }

      if (cam.zoom > 5 && (st.tier === "city" || st.tier === "town")) {
        ctx.textAlign = "center";
        if (rel && rel.alive) {
          ctx.fillStyle = rel.color;
          ctx.font = `3.4px serif`;
          ctx.fillText(rel.symbol, st.x, st.y - radius - 2.6);
        }
        ctx.fillStyle = "#f4e2b8";
        ctx.font = `3px Georgia, serif`;
        ctx.fillText(st.name, st.x, st.y - radius - 0.6);
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSelectionRing(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    tick: number,
  ) {
    const pulse = 0.85 + 0.15 * Math.sin(tick * 0.2);
    ctx.strokeStyle = "#fff8e0";
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    ctx.arc(x, y, radius * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05060a]">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Left column: telemetry + inspect panel */}
      <div className="pointer-events-none absolute left-4 top-4 bottom-28 flex w-72 flex-col gap-3">
        <div className="rounded-md border border-amber-200/20 bg-black/55 px-4 py-3 font-serif text-amber-100/90 backdrop-blur-sm">
          <div className="text-xl tracking-wide">Epoch</div>
          <div className="text-xs italic text-amber-100/50">{era}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 text-sm tabular-nums text-amber-100/70">
            <div>Year {stats.year}</div>
            <div>Pop {stats.population.toLocaleString()}</div>
            <div>Cities {stats.settlements}</div>
            <div>Kingdoms {stats.kingdoms}</div>
            <div>Faiths {stats.religions}</div>
            <div>Routes {stats.routes}</div>
            <div className={`col-span-2 ${stats.wars > 0 ? "text-red-300/90" : ""}`}>
              Active wars {stats.wars}
            </div>
          </div>
        </div>

        {detail && (
          <div className="pointer-events-auto overflow-y-auto rounded-md border bg-black/70 px-4 py-3 text-amber-100/90 backdrop-blur-sm"
            style={{ borderColor: detail.accent }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-amber-100/40">
                  {detail.kind}
                </div>
                <div className="font-serif text-lg leading-tight" style={{ color: detail.accent }}>
                  {detail.title}
                </div>
              </div>
              <button
                onClick={() => selectEntity(null)}
                className="rounded px-1.5 text-amber-100/50 hover:bg-white/10 hover:text-amber-100"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs tabular-nums">
              {detail.rows.map((r) => (
                <div key={r.label} className="flex justify-between gap-2">
                  <span className="text-amber-100/45">{r.label}</span>
                  <span className="text-right text-amber-100/90">{r.value}</span>
                </div>
              ))}
            </div>
            {detail.extra?.map((x, i) => (
              <div key={i} className="mt-2 text-xs leading-snug text-amber-100/60">
                {x}
              </div>
            ))}
            {detail.links.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {detail.links.map((l) => (
                  <button
                    key={l.label}
                    onClick={() => selectEntity(l.sel)}
                    className="rounded border border-amber-200/25 bg-white/5 px-2 py-0.5 text-xs text-amber-100/80 hover:bg-white/10"
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Playback controls */}
      <div className="absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1 rounded-full border border-amber-200/20 bg-black/60 px-2 py-1.5 text-amber-100/80 backdrop-blur-sm">
        <button
          onClick={togglePause}
          className="rounded-full px-3 py-1 text-sm hover:bg-white/10"
          title="Play / pause (space)"
        >
          {paused ? "▶ Play" : "⏸ Pause"}
        </button>
        <span className="mx-1 h-4 w-px bg-amber-200/20" />
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => changeSpeed(s)}
            className={`rounded-full px-2 py-1 text-xs ${
              speed === s ? "bg-amber-200/25 text-amber-50" : "hover:bg-white/10"
            }`}
          >
            {s}×
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-amber-200/20" />
        <button onClick={() => zoomBy(1.25)} className="rounded-full px-2 py-1 text-sm hover:bg-white/10" title="Zoom in">＋</button>
        <button onClick={() => zoomBy(1 / 1.25)} className="rounded-full px-2 py-1 text-sm hover:bg-white/10" title="Zoom out">－</button>
        <span className="mx-1 h-4 w-px bg-amber-200/20" />
        <button onClick={resetWorld} className="rounded-full px-3 py-1 text-xs hover:bg-white/10" title="Restart this world">↻ Reset</button>
        <button onClick={newWorld} className="rounded-full bg-amber-200/15 px-3 py-1 text-xs hover:bg-amber-200/25" title="Generate a new world">✦ New World</button>
      </div>

      {/* Chronicle */}
      <div className="absolute right-4 top-4 bottom-28 w-72 overflow-hidden rounded-md border border-amber-200/20 bg-black/55 backdrop-blur-sm">
        <div className="border-b border-amber-200/15 px-4 py-2 font-serif text-sm tracking-widest text-amber-100/80">
          CHRONICLE
        </div>
        <div className="h-full space-y-2 overflow-y-auto px-4 py-3 pb-12 text-xs leading-snug">
          {events.length === 0 && (
            <div className="text-amber-100/40">History has yet to be written…</div>
          )}
          {events.map((e, i) => (
            <div key={`${e.tick}-${i}`} className="flex gap-2">
              <span className="shrink-0 tabular-nums text-amber-100/40">Yr {e.year}</span>
              <span style={{ color: EVENT_COLOR[e.kind] ?? "#d8c79a" }}>{e.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="absolute bottom-12 left-4 right-4 rounded-md border border-amber-200/20 bg-black/55 px-4 py-2 backdrop-blur-sm">
        <div className="mb-1 flex items-center justify-between font-serif text-[11px] tracking-widest text-amber-100/70">
          <span>TIMELINE — {era.toUpperCase()}</span>
          <span className="tabular-nums text-amber-100/40">Year {stats.year}</span>
        </div>
        <div className="relative h-7">
          <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-amber-200/20" />
          {timeline.map((e, i) => {
            const leftPct = Math.min(100, (e.year / maxYear) * 100);
            return (
              <div
                key={`${e.tick}-${i}`}
                className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${leftPct}%` }}
              >
                <div
                  className="h-3 w-[3px] rounded-full"
                  style={{ backgroundColor: EVENT_COLOR[e.kind] ?? "#d8c79a" }}
                />
                <div className="pointer-events-none absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded border border-amber-200/20 bg-black/90 px-2 py-1 text-[10px] text-amber-100/90 group-hover:block">
                  Yr {e.year}: {e.text}
                </div>
              </div>
            );
          })}
          <div className="absolute bottom-0 left-0 text-[9px] tabular-nums text-amber-100/30">Yr 1</div>
          <div className="absolute bottom-0 right-0 text-[9px] tabular-nums text-amber-100/30">Yr {stats.year}</div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-amber-100/40">
        drag to pan · scroll to zoom · click a city, person, or land to inspect
      </div>
    </div>
  );
}
