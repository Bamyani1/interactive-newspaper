"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import {
  DEFAULT_THEME,
  THEMES,
  type CanopyTheme,
  type LeafDepth,
  type ParticleDirection,
  type ParticleShape,
  type SkyPalette,
} from "./themes";
import { ThemeSelector } from "./ThemeSelector";

/* ─────────────────────────────────────────────
   COLOR UTILITIES
   ───────────────────────────────────────────── */

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

function skyGradientCSS(stops: readonly [string, string, string]): string {
  return `linear-gradient(to bottom, ${stops[0]}, ${stops[1]}, ${stops[2]})`;
}

function cloudRadialCSS(colors: readonly [string, string]): string {
  return `radial-gradient(ellipse at center, ${colors[0]}, ${colors[1]})`;
}

/* ─────────────────────────────────────────────
   PARTICLE MOTE GENERATOR
   ───────────────────────────────────────────── */

interface ParticleMote {
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
  shape: ParticleShape;
  direction: ParticleDirection;
}

function seededRandom(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRECTION_KEYFRAMES: Record<ParticleDirection, Record<LeafDepth, string>> = {
  fall: { near: "canopyLeafNear", mid: "canopyLeafMid", far: "canopyLeafFar" },
  rise: { near: "canopyRiseNear", mid: "canopyRiseMid", far: "canopyRiseFar" },
  drift: { near: "canopyDriftNear", mid: "canopyDriftMid", far: "canopyDriftFar" },
  rain: { near: "canopyRainNear", mid: "canopyRainMid", far: "canopyRainFar" },
  twinkle: { near: "canopyTwinkleNear", mid: "canopyTwinkleMid", far: "canopyTwinkleFar" },
};

function generateParticles(theme: CanopyTheme): ParticleMote[] {
  const random = seededRandom(77);
  const { colors, glowColors, count, shape, direction, depthConfig } = theme.particles;

  return Array.from({ length: count }, (_, i) => {
    const roll = random();
    const depth: LeafDepth = roll < 0.2 ? "near" : roll < 0.7 ? "mid" : "far";
    const colorIdx = Math.floor(random() * colors.length);
    const [sB, sR, dB, dR, swB, swR, oB, oR, blur] = depthConfig[depth];

    let left: number;
    let startY: number;

    if (direction === "twinkle") {
      // Stars: random position across entire viewport
      left = 3 + random() * 94;
      startY = 3 + random() * 94;
    } else if (direction === "rise") {
      left = 3 + random() * 94;
      startY = 105 + random() * 10;
    } else if (direction === "drift") {
      left = -5 - random() * 10;
      startY = 5 + random() * 90;
    } else {
      // fall or rain
      left = 3 + random() * 94;
      startY = -5 - random() * 10;
    }

    return {
      id: i,
      depth,
      size: sB + random() * sR,
      left,
      startY,
      duration: dB + random() * dR,
      delay: random() * 12,
      rotation: random() * 360,
      sway: swB + random() * swR,
      opacity: oB + random() * oR,
      color: colors[colorIdx],
      blur,
      glowColor: glowColors[colorIdx],
      shape,
      direction,
    };
  });
}

function particleDimensions(size: number, shape: ParticleShape): { w: number; h: number } {
  switch (shape) {
    case "leaf":
      return { w: size, h: size * 0.7 };
    case "petal":
      return { w: size, h: size * 1.3 };
    case "line":
      return { w: Math.max(size * 0.2, 1.5), h: size * 2.5 };
    case "wisp":
      return { w: size, h: size * 0.4 };
    default:
      // circle, square
      return { w: size, h: size };
  }
}

/* ─────────────────────────────────────────────
   MAIN PAGE
   ───────────────────────────────────────────── */

export default function Mock2Page() {
  const [activeTheme, setActiveTheme] = useState<CanopyTheme>(DEFAULT_THEME);
  const [isDay, setIsDay] = useState(false);
  const activeThemeRef = useRef(activeTheme);
  useEffect(() => {
    activeThemeRef.current = activeTheme;
  }, [activeTheme]);

  // Generate particles from current theme
  const particles = useMemo(() => generateParticles(activeTheme), [activeTheme]);

  const svgObjectRef = useRef<HTMLObjectElement>(null);
  const skyRef = useRef<HTMLDivElement>(null);
  const cloudRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);
  const animationRef = useRef<number>(0);

  /* ── Sky gradient manipulation (DOM-based) ── */

  const applySkyPalette = useCallback((palette: SkyPalette) => {
    if (skyRef.current) {
      skyRef.current.style.background = skyGradientCSS(palette.stops);
    }
    palette.clouds.forEach((cloudColors, ci) => {
      const el = cloudRefs.current[ci];
      if (el) {
        el.style.background = cloudRadialCSS(cloudColors);
      }
    });
  }, []);

  const transitionSkyPalette = useCallback(
    (from: SkyPalette, to: SkyPalette) => {
      cancelAnimationFrame(animationRef.current);

      const duration = 1200;
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = now - start;
        const rawT = Math.min(elapsed / duration, 1);
        const t = rawT < 0.5 ? 2 * rawT * rawT : 1 - Math.pow(-2 * rawT + 2, 2) / 2;

        // Interpolate sky gradient stops
        const lerpedStops = from.stops.map((s, i) => lerpHexColor(s, to.stops[i], t)) as [
          string,
          string,
          string,
        ];
        if (skyRef.current) {
          skyRef.current.style.background = skyGradientCSS(lerpedStops);
        }

        if (rawT < 1) {
          animationRef.current = requestAnimationFrame(tick);
        } else {
          // Snap clouds at end (too subtle to interpolate)
          to.clouds.forEach((cloudColors, ci) => {
            const el = cloudRefs.current[ci];
            if (el) {
              el.style.background = cloudRadialCSS(cloudColors);
            }
          });
        }
      };

      animationRef.current = requestAnimationFrame(tick);
    },
    []
  );

  const transitionSky = useCallback(
    (toNight: boolean) => {
      const theme = activeThemeRef.current;
      const from = toNight ? theme.sky.day : theme.sky.night;
      const to = toNight ? theme.sky.night : theme.sky.day;
      transitionSkyPalette(from, to);
    },
    [transitionSkyPalette]
  );

  /* ── SVG load: hide background rects ── */

  useEffect(() => {
    const obj = svgObjectRef.current;
    if (!obj) return undefined;

    let initialized = false;

    const tryInit = () => {
      const doc = obj.contentDocument;
      if (!doc || initialized) return false;

      // Hide the 4 background rects (sky + 3 clouds) inside the SVG
      const rects = doc.querySelectorAll("svg > rect");
      rects.forEach((r) => r.setAttribute("opacity", "0"));

      initialized = true;

      // Apply initial DOM sky palette
      const theme = activeThemeRef.current;
      const night = document.body.dataset.mode !== "light";
      applySkyPalette(night ? theme.sky.night : theme.sky.day);
      return true;
    };

    const onLoad = () => tryInit();
    obj.addEventListener("load", onLoad);

    if (obj.contentDocument?.readyState === "complete") {
      tryInit();
    }

    return () => obj.removeEventListener("load", onLoad);
  }, [applySkyPalette]);

  /* ── Hydrate from localStorage + body data-mode ── */

  useEffect(() => {
    // Client-only hydration: reading from DOM + localStorage after mount
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-only hydration from external APIs
    setIsDay(document.body.dataset.mode === "light");

    const savedId = localStorage.getItem("canopy-theme");
    if (savedId) {
      const found = THEMES.find((t) => t.id === savedId);
      if (found) setActiveTheme(found);
    }
  }, []);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(animationRef.current);
  }, []);

  /* ── Day/Night toggle ── */

  const toggleMode = useCallback(() => {
    const nextDay = !isDay;
    setIsDay(nextDay);
    document.body.dataset.mode = nextDay ? "light" : "dark";
    transitionSky(!nextDay);
  }, [isDay, transitionSky]);

  /* ── Theme change handler ── */

  const handleThemeChange = useCallback(
    (theme: CanopyTheme) => {
      localStorage.setItem("canopy-theme", theme.id);

      // Lerp sky from current theme's palette to new theme's palette
      const currentTheme = activeThemeRef.current;
      const fromPalette = isDay ? currentTheme.sky.day : currentTheme.sky.night;
      const toPalette = isDay ? theme.sky.day : theme.sky.night;
      transitionSkyPalette(fromPalette, toPalette);

      setActiveTheme(theme);
    },
    [isDay, transitionSkyPalette]
  );

  /* ── Derived theme values ── */

  const svgFilter = isDay ? activeTheme.svgFilter.day : activeTheme.svgFilter.night;
  const baseBg = isDay ? activeTheme.base.day : activeTheme.base.night;
  const grainOpacity = isDay ? activeTheme.grain.opacity.day : activeTheme.grain.opacity.night;

  /* ── Split particles by layer ── */

  const behindParticles = activeTheme.particles.layer === "behind" ? particles : [];
  const frontParticles = activeTheme.particles.layer === "front" ? particles : [];

  /* ── Render a single mote ── */

  const renderMote = (mote: ParticleMote) => {
    const { w, h } = particleDimensions(mote.size, mote.shape);
    return (
      <div
        key={mote.id}
        className={`canopy-mote canopy-mote--${mote.shape}`}
        style={
          {
            width: w,
            height: h,
            left: `${mote.left}%`,
            top: `${mote.startY}%`,
            background: mote.color,
            mixBlendMode: activeTheme.particles.blendMode,
            filter: mote.blur > 0 ? `blur(${mote.blur}px)` : undefined,
            boxShadow:
              mote.depth === "near" ? `0 0 ${mote.size * 0.6}px ${mote.glowColor}` : undefined,
            "--leaf-sway": `${mote.sway}px`,
            "--leaf-opacity": mote.opacity,
            animation: `${DIRECTION_KEYFRAMES[mote.direction][mote.depth]} ${mote.duration}s ease-in-out ${mote.delay}s infinite`,
          } as React.CSSProperties
        }
      />
    );
  };

  return (
    <div className="canopy-root" style={{ background: baseBg }}>
      {/* Layer 0: DOM sky gradient */}
      <div className="canopy-sky" ref={skyRef} />

      {/* Layer 1: DOM cloud overlays */}
      <div className="canopy-clouds">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className={`canopy-cloud canopy-cloud--${i}`}
            ref={(el) => {
              cloudRefs.current[i] = el;
            }}
          />
        ))}
      </div>

      {/* Layer 2: Behind-tree particles (stars, fireflies, aurora) */}
      <div className="canopy-motes--behind">{behindParticles.map(renderMote)}</div>

      {/* Layer 3: Canopy SVG (tree canopy only, bg hidden) */}
      <div className="canopy-glass">
        <object
          ref={svgObjectRef}
          type="image/svg+xml"
          data="/shape/autumn-canopy-animated.svg"
          aria-label="Tree canopy animation"
          style={{ filter: svgFilter }}
        />
      </div>

      {/* Layer 6: Front particles (leaves, snow, rain, petals, embers) */}
      <div className="canopy-motes--front">{frontParticles.map(renderMote)}</div>

      {/* Layer 8: Film grain */}
      <div
        className="canopy-grain"
        style={{
          opacity: grainOpacity,
          mixBlendMode: activeTheme.grain.blendMode as React.CSSProperties["mixBlendMode"],
        }}
      />

      {/* Layer 10: Controls */}
      <div className="canopy-controls">
        <button className="canopy-mode-toggle" onClick={toggleMode} aria-label="Toggle day/night mode">
          {isDay ? <Moon size={20} /> : <Sun size={20} />}
        </button>
        <ThemeSelector activeThemeId={activeTheme.id} onThemeChange={handleThemeChange} />
      </div>
    </div>
  );
}
