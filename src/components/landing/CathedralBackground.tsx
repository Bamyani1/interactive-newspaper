"use client";

import React, { useMemo, useCallback, useRef } from "react";

interface Mote {
  id: number;
  size: number;
  left: number;
  startY: number;
  duration: number;
  delay: number;
  opacityStart: number;
  opacityMid: number;
  opacityEnd: number;
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

function generateMotes(count: number): Mote[] {
  const random = seededRandom(42);
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    size: 2 + random() * 3,
    left: 5 + random() * 90,
    startY: 60 + random() * 35,
    duration: 10 + random() * 12,
    delay: random() * 8,
    opacityStart: 0,
    opacityMid: 0.3 + random() * 0.4,
    opacityEnd: 0,
  }));
}

export function CathedralBackground() {
  const motes = useMemo(() => generateMotes(25), []);
  const rootRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const el = rootRef.current;
    if (!el) return;
    el.style.setProperty("--mouse-x", String(e.clientX / window.innerWidth));
    el.style.setProperty("--mouse-y", String(e.clientY / window.innerHeight));
  }, []);

  return (
    <div className="cathedral-root" ref={rootRef} onMouseMove={handleMouseMove}>
      {/* Layer 1: Stained glass SVG */}
      <div className="cathedral-glass">
        <object
          type="image/svg+xml"
          data="/shape/stained-glass-animated.svg"
          aria-label="Stained glass rosette animation"
        />
      </div>

      {/* Layer 2: Ambient color bleed */}
      <div className="cathedral-ambient" />


      {/* Layer 5: Gothic vignette */}
      <div className="cathedral-vignette" />

      {/* Layer 6: Dust motes */}
      <div className="cathedral-motes">
        {motes.map((mote) => (
          <div
            key={mote.id}
            className="cathedral-mote"
            style={{
              width: mote.size,
              height: mote.size,
              left: `${mote.left}%`,
              top: `${mote.startY}%`,
              "--mote-opacity-start": mote.opacityStart,
              "--mote-opacity-mid": mote.opacityMid,
              "--mote-opacity-end": mote.opacityEnd,
              animation: `cathedralMoteFloat ${mote.duration}s ease-in-out ${mote.delay}s infinite`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      {/* Layer 8: Film grain */}
      <div className="cathedral-grain" />
    </div>
  );
}
