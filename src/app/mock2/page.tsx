"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";

/* ─────────────────────────────────────────────
   SKY GRADIENT PALETTES (day / night)
   ───────────────────────────────────────────── */

const SKY_PALETTES = {
  day: {
    stops: ["#4a4080", "#7a5888", "#b86878"],
    clouds: [
      ["rgba(220,180,180,0.15)", "rgba(220,180,180,0)"],
      ["rgba(220,180,180,0.12)", "rgba(220,180,180,0)"],
      ["rgba(220,180,180,0.10)", "rgba(220,180,180,0)"],
    ],
  },
  night: {
    stops: ["#10102a", "#181838", "#201845"],
    clouds: [
      ["rgba(140,130,200,0.08)", "rgba(140,130,200,0)"],
      ["rgba(140,130,200,0.06)", "rgba(140,130,200,0)"],
      ["rgba(140,130,200,0.05)", "rgba(140,130,200,0)"],
    ],
  },
} as const;

interface SvgGradientRefs {
  skyStops: SVGStopElement[];
  cloudStops: SVGStopElement[][]; // [cloud1Stops, cloud2Stops, cloud3Stops]
}

function lerpHexColor(a: string, b: string, t: number): string {
  const parse = (hex: string) => {
    const h = hex.replace("#", "");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/* ─────────────────────────────────────────────
   LEAF MOTE GENERATOR (3 parallax depths)
   ───────────────────────────────────────────── */

type LeafDepth = "near" | "mid" | "far";

interface LeafMote {
  id: number;
  size: number;
  left: number;
  startY: number;
  duration: number;
  delay: number;
  rotation: number;
  sway: number;
  opacity: number;
  color: string;
  depth: LeafDepth;
  blur: number;
  glowColor: string;
}

const AUTUMN_COLORS = [
  "#e01818", // crimson
  "#e83010", // scarlet
  "#c03010", // rust
  "#f06000", // orange
  "#f08010", // tangerine
  "#e09010", // amber
  "#e8b810", // gold
  "#d0b020", // honey
  "#60b818", // lime
  "#208820", // forest
  "#fff0c0", // highlight
  "#f8e070", // sunlit
];

const GLOW_COLORS = [
  "#ff2020", // crimson
  "#ff4820", // scarlet
  "#f05020", // rust
  "#ff8020", // orange
  "#ffa020", // tangerine
  "#ffc020", // amber
  "#ffe030", // gold
  "#f0e030", // honey
  "#90e830", // lime
  "#30c830", // forest
  "#fffef0", // highlight
  "#fff090", // sunlit
];

function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Depth config: [sizeBase, sizeRange, durBase, durRange, swayBase, swayRange, opBase, opRange, blur]
const DEPTH_CONFIG: Record<LeafDepth, [number, number, number, number, number, number, number, number, number]> = {
  near: [8, 6, 6, 4, 25, 20, 0.5, 0.3, 0],
  mid:  [4, 4, 8, 6, 15, 10, 0.3, 0.3, 0],
  far:  [2, 3, 14, 6, 5, 7, 0.2, 0.2, 1],
};

function generateLeafMotes(count: number): LeafMote[] {
  const random = seededRandom(77);
  return Array.from({ length: count }, (_, i) => {
    const roll = random();
    const depth: LeafDepth = roll < 0.2 ? "near" : roll < 0.7 ? "mid" : "far";
    const colorIdx = Math.floor(random() * AUTUMN_COLORS.length);
    const [sB, sR, dB, dR, swB, swR, oB, oR, blur] = DEPTH_CONFIG[depth];

    return {
      id: i,
      depth,
      size: sB + random() * sR,
      left: 3 + random() * 94,
      startY: -5 - random() * 10,
      duration: dB + random() * dR,
      delay: random() * 12,
      rotation: random() * 360,
      sway: swB + random() * swR,
      opacity: oB + random() * oR,
      color: AUTUMN_COLORS[colorIdx],
      blur,
      glowColor: GLOW_COLORS[colorIdx],
    };
  });
}

const KEYFRAME_MAP: Record<LeafDepth, string> = {
  near: "canopyLeafNear",
  mid: "canopyLeafMid",
  far: "canopyLeafFar",
};

/* ─────────────────────────────────────────────
   MAIN PAGE
   ───────────────────────────────────────────── */

export default function Mock2Page() {
  const leafMotes = useMemo(() => generateLeafMotes(45), []);
  const [isDay, setIsDay] = useState(false);

  const svgObjectRef = useRef<HTMLObjectElement>(null);
  const svgGradientsRef = useRef<SvgGradientRefs | null>(null);
  const animationRef = useRef<number>(0);

  // Apply sky palette (immediate, no animation)
  const applySkyPalette = useCallback((night: boolean) => {
    const refs = svgGradientsRef.current;
    if (!refs) return;
    const palette = night ? SKY_PALETTES.night : SKY_PALETTES.day;
    refs.skyStops.forEach((stop, i) => {
      stop.setAttribute("stop-color", palette.stops[i]);
    });
    palette.clouds.forEach((cloudColors, ci) => {
      refs.cloudStops[ci]?.forEach((stop, si) => {
        stop.setAttribute("stop-color", cloudColors[si]);
      });
    });
  }, []);

  // Smooth sky transition via rAF
  const transitionSky = useCallback(
    (toNight: boolean) => {
      const refs = svgGradientsRef.current;
      if (!refs) return;

      cancelAnimationFrame(animationRef.current);

      const from = toNight ? SKY_PALETTES.day : SKY_PALETTES.night;
      const to = toNight ? SKY_PALETTES.night : SKY_PALETTES.day;
      const duration = 1200;
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = now - start;
        const rawT = Math.min(elapsed / duration, 1);
        // ease-in-out
        const t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

        refs.skyStops.forEach((stop, i) => {
          stop.setAttribute("stop-color", lerpHexColor(from.stops[i], to.stops[i], t));
        });

        if (rawT < 1) {
          animationRef.current = requestAnimationFrame(tick);
        } else {
          // Snap clouds at end (too subtle to interpolate)
          to.clouds.forEach((cloudColors, ci) => {
            refs.cloudStops[ci]?.forEach((stop, si) => {
              stop.setAttribute("stop-color", cloudColors[si]);
            });
          });
        }
      };

      animationRef.current = requestAnimationFrame(tick);
    },
    []
  );

  // Native load listener + fallback for cached SVGs
  useEffect(() => {
    const obj = svgObjectRef.current;
    if (!obj) return;

    const tryInit = () => {
      const doc = obj.contentDocument;
      if (!doc || svgGradientsRef.current) return false;

      const skyGradient = doc.getElementById("sky");
      const skyStops = skyGradient
        ? Array.from(skyGradient.querySelectorAll("stop"))
        : [];

      const cloudStops = ["cloud1", "cloud2", "cloud3"].map((id) => {
        const el = doc.getElementById(id);
        return el ? Array.from(el.querySelectorAll("stop")) : [];
      });

      if (skyStops.length === 0) return false;

      svgGradientsRef.current = { skyStops, cloudStops };
      applySkyPalette(document.body.dataset.mode !== "light");
      return true;
    };

    // Native load event (works when SVG hasn't loaded yet)
    const onLoad = () => tryInit();
    obj.addEventListener("load", onLoad);

    // Fallback: SVG may already be loaded (cached / hot reload)
    if (obj.contentDocument?.readyState === "complete") {
      tryInit();
    }

    return () => obj.removeEventListener("load", onLoad);
  }, [applySkyPalette]);

  // Sync initial state with body data-mode
  useEffect(() => {
    setIsDay(document.body.dataset.mode === "light");
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  const toggleMode = useCallback(() => {
    const nextDay = !isDay;
    setIsDay(nextDay);
    document.body.dataset.mode = nextDay ? "light" : "dark";
    transitionSky(!nextDay); // toNight = !nextDay
  }, [isDay, transitionSky]);

  return (
    <div className="canopy-root">
      {/* Layer 1: Autumn canopy SVG + night overlay */}
      <div className="canopy-glass">
        <object
          ref={svgObjectRef}
          type="image/svg+xml"
          data="/shape/autumn-canopy-animated.svg"
          aria-label="Autumn tree canopy animation"
        />
      </div>

      {/* Layer 3: Falling leaf motes (3 parallax depths) */}
      <div className="canopy-motes">
        {leafMotes.map((leaf) => (
          <div
            key={leaf.id}
            className="canopy-mote"
            style={
              {
                width: leaf.size,
                height: leaf.size * 0.7,
                left: `${leaf.left}%`,
                top: `${leaf.startY}%`,
                background: leaf.color,
                filter: leaf.blur > 0 ? `blur(${leaf.blur}px)` : undefined,
                boxShadow:
                  leaf.depth === "near"
                    ? `0 0 ${leaf.size * 0.6}px ${leaf.glowColor}`
                    : undefined,
                "--leaf-sway": `${leaf.sway}px`,
                "--leaf-opacity": leaf.opacity,
                animation: `${KEYFRAME_MAP[leaf.depth]} ${leaf.duration}s ease-in-out ${leaf.delay}s infinite`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Layer 8: Film grain */}
      <div className="canopy-grain" />

      {/* Day/Night toggle */}
      <button className="canopy-mode-toggle" onClick={toggleMode} aria-label="Toggle day/night mode">
        {isDay ? <Moon size={20} /> : <Sun size={20} />}
      </button>
    </div>
  );
}
