#!/usr/bin/env node

/**
 * Generate torn-edge SVG masks for the cinema landing page.
 *
 * Produces two lightweight SVGs with a single white-filled path that has
 * organic torn edges — purpose-built for CSS luminance masking.
 *
 * Usage: node scripts/generate-torn-mask.mjs
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "public", "shape");

// Seeded PRNG (mulberry32) for reproducible output
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a torn-edge path for a rectangle.
 *
 * @param {number} w — viewBox width
 * @param {number} h — viewBox height
 * @param {object} opts
 * @param {number} opts.seed — PRNG seed
 * @param {number} opts.step — approximate vertex spacing (px)
 * @param {number} opts.edgeTear — max inward offset on edges (px)
 * @param {number} opts.cornerTear — max inward offset near corners (px)
 * @param {number} opts.cornerRadius — distance from corner to apply deeper tear (px)
 */
function tornPath(w, h, opts = {}) {
  const {
    seed = 42,
    step = 10,
    edgeTear = 15,
    cornerTear = 25,
    cornerRadius = 40,
  } = opts;

  const rand = mulberry32(seed);

  // Returns a random tear depth, deeper near corners
  function tearDepth(distFromCorner) {
    const t = Math.min(distFromCorner / cornerRadius, 1); // 0 at corner, 1 far away
    const maxDepth = cornerTear + t * (edgeTear - cornerTear);
    return rand() * maxDepth;
  }

  // Collect vertices walking clockwise around the perimeter
  const vertices = [];

  // Helper: distance from nearest corner along the perimeter
  function cornerDist(pos, edgeLen) {
    return Math.min(pos, edgeLen - pos);
  }

  // Top edge: left → right (inward = +y)
  {
    const count = Math.ceil(w / step);
    const dx = w / count;
    for (let i = 0; i <= count; i++) {
      const x = i * dx;
      const depth = i === 0 || i === count ? 0 : tearDepth(cornerDist(x, w));
      vertices.push([x, depth]);
    }
  }

  // Right edge: top → bottom (inward = -x)
  {
    const count = Math.ceil(h / step);
    const dy = h / count;
    for (let i = 1; i <= count; i++) {
      const y = i * dy;
      const depth = i === count ? 0 : tearDepth(cornerDist(y, h));
      vertices.push([w - depth, y]);
    }
  }

  // Bottom edge: right → left (inward = -y)
  {
    const count = Math.ceil(w / step);
    const dx = w / count;
    for (let i = 1; i <= count; i++) {
      const x = w - i * dx;
      const depth = i === count ? 0 : tearDepth(cornerDist(x, w));
      vertices.push([x, h - depth]);
    }
  }

  // Left edge: bottom → top (inward = +x)
  {
    const count = Math.ceil(h / step);
    const dy = h / count;
    for (let i = 1; i < count; i++) {
      const y = h - i * dy;
      const depth = tearDepth(cornerDist(y, h));
      vertices.push([depth, y]);
    }
  }

  // Build path with quadratic bezier curves for organic feel
  // Use midpoints as anchor points, vertices as control points (Catmull–Rom-like)
  if (vertices.length < 3) return "";

  const fmt = (n) => n.toFixed(2);

  // Start at the midpoint between first and last vertex
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const startX = (last[0] + first[0]) / 2;
  const startY = (last[1] + first[1]) / 2;

  let d = `M ${fmt(startX)} ${fmt(startY)}`;

  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    const midX = (curr[0] + next[0]) / 2;
    const midY = (curr[1] + next[1]) / 2;
    d += ` Q ${fmt(curr[0])} ${fmt(curr[1])} ${fmt(midX)} ${fmt(midY)}`;
  }

  d += " Z";
  return d;
}

function generateSVG(w, h, seed) {
  const d = tornPath(w, h, { seed, step: 10, edgeTear: 15, cornerTear: 25, cornerRadius: 40 });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`,
    `  <path fill="#FFFFFF" d="${d}"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

// Portrait (mobile): 800×1200
const portrait = generateSVG(800, 1200, 42);
writeFileSync(join(OUTPUT_DIR, "landing-main-card.svg"), portrait);
console.log(`✓ landing-main-card.svg (portrait 800×1200) — ${Buffer.byteLength(portrait)} bytes`);

// Landscape (desktop): 1200×800
const landscape = generateSVG(1200, 800, 77);
writeFileSync(join(OUTPUT_DIR, "landing-main-card-landscape.svg"), landscape);
console.log(
  `✓ landing-main-card-landscape.svg (landscape 1200×800) — ${Buffer.byteLength(landscape)} bytes`
);
