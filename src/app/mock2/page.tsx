"use client";

import React, { useEffect, useRef, useMemo } from "react";
import { Cinzel_Decorative, Cinzel } from "next/font/google";

/* ─────────────────────────────────────────────
   FONTS
   ───────────────────────────────────────────── */

const cinzelDecorative = Cinzel_Decorative({
  variable: "--font-cinzel-decorative",
  subsets: ["latin"],
  display: "swap",
  weight: ["400"],
});

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

/* ─────────────────────────────────────────────
   DUST MOTE GENERATOR
   ───────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   MAIN PAGE
   ───────────────────────────────────────────── */

export default function Mock2Page() {
  const rootRef = useRef<HTMLDivElement>(null);
  const motes = useMemo(() => generateMotes(25), []);

  /* Mouse tracking — writes CSS custom properties directly to DOM */
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      rootRef.current?.style.setProperty(
        "--mouse-x",
        String(e.clientX / window.innerWidth)
      );
      rootRef.current?.style.setProperty(
        "--mouse-y",
        String(e.clientY / window.innerHeight)
      );
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return (
    <div
      ref={rootRef}
      className={`cathedral-root ${cinzelDecorative.variable} ${cinzel.variable}`}
    >
      {/* Layer 1: Cherry blossom stained glass SVG */}
      <div className="cathedral-glass">
        <object
          type="image/svg+xml"
          data="/shape/cherry-blossom-animated.svg"
          aria-label="Cherry blossom tower stained glass animation"
        />
      </div>

      {/* Layer 2: Ambient color bleed */}
      <div className="cathedral-ambient" />


      {/* Layer 5: Dust motes */}
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

      {/* Layer 6: Film grain */}
      <div className="cathedral-grain" />
    </div>
  );
}
