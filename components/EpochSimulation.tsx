"use client";

import { useEffect, useRef, useState } from "react";
import { createWorld, step } from "@/lib/engine/world";
import { renderTerrain, RESOURCE_COLOR } from "@/lib/engine/render";
import { renderTerritoryOverlay } from "@/lib/engine/kingdoms";
import { World, WorldEvent } from "@/lib/engine/types";

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

const TICKS_PER_SECOND = 30;

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

// Events worth pinning to the permanent timeline.
const MAJOR = new Set([
  "kingdom",
  "war",
  "capture",
  "collapse",
  "religion",
  "ruler",
]);

export default function EpochSimulation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const worldRef = useRef<World | null>(null);
  const terrainRef = useRef<HTMLCanvasElement | null>(null);
  const territoryRef = useRef<HTMLCanvasElement | null>(null);
  const territoryVersionRef = useRef(-1);
  const cameraRef = useRef<Camera>({ x: 110, y: 75, zoom: 4 });

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
      acc += dt * TICKS_PER_SECOND;
      let steps = 0;
      while (acc >= 1 && steps < 8) {
        step(world);
        acc -= 1;
        steps++;
      }

      if (world.territoryVersion !== territoryVersionRef.current) {
        bakeTerritory(world);
      }

      draw(ctx, canvas, world);

      if (world.tick % 15 === 0) {
        let pop = 0;
        for (const s of world.settlements) if (s) pop += s.population;
        setStats({
          year: 1 + Math.floor(world.tick / 12),
          population: pop || world.settlers.length,
          settlements: world.settlements.filter(Boolean).length,
          kingdoms: world.kingdoms.filter((k) => k && k.alive).length,
          religions: world.religions.filter((r) => r && r.alive).length,
          wars: world.wars.length,
          routes: world.tradeRoutes.length,
        });
        setEvents(world.events.slice(-14).reverse());

        // Accumulate major events into the permanent timeline.
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
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onDown = (e: MouseEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = () => (dragging = false);
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const cam = cameraRef.current;
      cam.x -= (e.clientX - lastX) / cam.zoom;
      cam.y -= (e.clientY - lastY) / cam.zoom;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = cameraRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      cam.zoom = Math.max(1.5, Math.min(24, cam.zoom * factor));
    };
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("mousemove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("wheel", onWheel);
    };
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

    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(w / 2 - cam.x * pps, h / 2 - cam.y * pps);
    ctx.scale(pps, pps);

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(terrainRef.current!, 0, 0);
    if (territoryRef.current) ctx.drawImage(territoryRef.current, 0, 0);

    // Trade routes — glowing caravan lanes with a travelling cart.
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

      const f = ((world.tick * 0.01 + r.phase) % 1 + 1) % 1;
      const cx = a.x + (b.x - a.x) * f;
      const cy = a.y + (b.y - a.y) * f;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = RESOURCE_COLOR[r.good] ?? "#f2cf52";
      ctx.beginPath();
      ctx.arc(cx, cy, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Resource nodes.
    for (const r of world.map.resources) {
      if (r.amount < 1) continue;
      ctx.fillStyle = RESOURCE_COLOR[r.type];
      ctx.globalAlpha = 0.35 + 0.35 * (r.amount / r.capacity);
      ctx.beginPath();
      ctx.arc(r.x + 0.5, r.y + 0.5, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Settlers — tiny glowing people.
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
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = "#ff6b6b";
        ctx.beginPath();
        ctx.arc(army.x, army.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // Settlements + religion glyphs.
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

      // Holy-city aura in the faith's color.
      if (rel && rel.alive && rel.holyCity === st.id) {
        ctx.strokeStyle = rel.color;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        ctx.arc(st.x, st.y, radius * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      if (cam.zoom > 5 && (st.tier === "city" || st.tier === "town")) {
        ctx.textAlign = "center";
        if (rel && rel.alive) {
          ctx.fillStyle = rel.color;
          ctx.font = `${Math.max(2.6, 3.4)}px serif`;
          ctx.fillText(rel.symbol, st.x, st.y - radius - 2.6);
        }
        ctx.fillStyle = "#f4e2b8";
        ctx.font = `${Math.max(2.4, 3)}px Georgia, serif`;
        ctx.fillText(st.name, st.x, st.y - radius - 0.6);
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05060a]">
      <canvas ref={canvasRef} className="block h-full w-full cursor-grab active:cursor-grabbing" />

      {/* Live telemetry */}
      <div className="pointer-events-none absolute left-4 top-4 rounded-md border border-amber-200/20 bg-black/55 px-4 py-3 font-serif text-amber-100/90 backdrop-blur-sm">
        <div className="text-xl tracking-wide">Epoch</div>
        <div className="text-xs italic text-amber-100/50">{era}</div>
        <div className="mt-1 text-sm tabular-nums text-amber-100/70">
          <div>Year {stats.year}</div>
          <div>Population {stats.population.toLocaleString()}</div>
          <div>Settlements {stats.settlements}</div>
          <div>Kingdoms {stats.kingdoms}</div>
          <div>Religions {stats.religions}</div>
          <div>Trade routes {stats.routes}</div>
          <div className={stats.wars > 0 ? "text-red-300/90" : ""}>
            Active wars {stats.wars}
          </div>
        </div>
      </div>

      {/* Historical event feed */}
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

      {/* Timeline of ages */}
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
          <div className="absolute bottom-0 left-0 text-[9px] tabular-nums text-amber-100/30">
            Yr 1
          </div>
          <div className="absolute bottom-0 right-0 text-[9px] tabular-nums text-amber-100/30">
            Yr {stats.year}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] text-amber-100/40">
        drag to pan · scroll to zoom · history unfolds on its own
      </div>
    </div>
  );
}
