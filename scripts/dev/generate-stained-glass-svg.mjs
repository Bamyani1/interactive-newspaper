#!/usr/bin/env node

/**
 * Generate animated stained glass SVG from a photograph.
 *
 * Pipeline:
 * 1. Sharp: read image at trace resolution (960×600), get raw RGBA
 * 2. Color segmentation: create binary mask per color via HSL ranges
 * 3. Morphological cleanup: median filter per mask
 * 4. Potrace: trace each binary mask to SVG vector paths
 * 5. Spatial clustering: group nearby paths within each color
 * 6. Animated SVG assembly: opacity fade-in reveal + self-colored glow
 *
 * Usage: node scripts/generate-stained-glass-svg.mjs
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Potrace from "oslllo-potrace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_IMAGE = join(__dirname, "..", "public", "1.png");
const OUTPUT_PATH = join(__dirname, "..", "public", "shape", "stained-glass-animated.svg");

// -- Config --
const TRACE_W = 960;
const TRACE_H = 600;
const VIEWBOX_W = 1920;
const VIEWBOX_H = 1200;
const TURD_SIZE = 40;
const OPT_TOLERANCE = 0.8;
const ALPHA_MAX = 1.5;
const CLUSTER_DIST = 8;
const MIN_CLUSTER_AREA = 500;
const MIN_CLUSTER_SPAN = 30;
const MAX_CLUSTER_DIM = 600;
const MAX_CLUSTERS_PER_COLOR = 80;

// Color definitions (HSL-based)
// hueRange: [min, max] in degrees (wraps for red), null = any hue
const COLOR_DEFS = [
  { id: "red", hueRange: [350, 12], satMin: 35, lRange: [15, 82], fill: "#b83030", glow: "#ff6060", stroke: "#802020" },
  { id: "orange", hueRange: [12, 28], satMin: 35, lRange: [15, 82], fill: "#c06020", glow: "#ff9040", stroke: "#804018" },
  { id: "gold", hueRange: [28, 58], satMin: 40, lRange: [15, 82], fill: "#c09030", glow: "#ffd060", stroke: "#806020" },
  { id: "cyan", hueRange: [165, 218], satMin: 30, lRange: [15, 82], fill: "#3090a8", glow: "#60d0f0", stroke: "#1a6080" },
  { id: "dark", hueRange: null, satMin: 0, lRange: [0, 18], fill: "#1a1008", glow: "#503a20", stroke: "#0d0804" },
  { id: "bright", hueRange: null, satMin: 0, lRange: [82, 100], fill: "#e8e0d0", glow: "#ffffff", stroke: "#a09880" },
];

// Seeded PRNG (mulberry32) for reproducible animation delays
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/*  Color Utilities                                                     */
/* ------------------------------------------------------------------ */

/** Convert RGB (0-255) to HSL (H: 0-360, S: 0-100, L: 0-100). */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/** Check if hue falls within a range that may wrap around 360°. */
function hueInRange(h, min, max) {
  if (min <= max) return h >= min && h <= max;
  // Wrapping range (e.g. 350-12 means 350→360 + 0→12)
  return h >= min || h <= max;
}

/* ------------------------------------------------------------------ */
/*  Step 1: Read Image at Trace Resolution                             */
/* ------------------------------------------------------------------ */

async function readSourceImage() {
  const metadata = await sharp(SOURCE_IMAGE).metadata();
  console.log(`  Source: ${metadata.width}×${metadata.height}`);

  const rawBuffer = await sharp(SOURCE_IMAGE)
    .resize(TRACE_W, TRACE_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  console.log(`  Resized to: ${TRACE_W}×${TRACE_H} (${rawBuffer.length} bytes raw RGBA)`);
  return rawBuffer;
}

/* ------------------------------------------------------------------ */
/*  Step 2: Color Segmentation — Binary Mask Per Color                 */
/* ------------------------------------------------------------------ */

function createColorMask(rawBuffer, colorDef) {
  const totalPixels = TRACE_W * TRACE_H;
  const mask = Buffer.alloc(totalPixels, 255); // start white (no match)
  let matchCount = 0;

  for (let i = 0; i < totalPixels; i++) {
    const offset = i * 4;
    const r = rawBuffer[offset];
    const g = rawBuffer[offset + 1];
    const b = rawBuffer[offset + 2];
    const a = rawBuffer[offset + 3];

    // Skip mostly-transparent pixels
    if (a < 128) continue;

    const hsl = rgbToHsl(r, g, b);

    // Check lightness range first (cheapest filter)
    if (hsl.l < colorDef.lRange[0] || hsl.l > colorDef.lRange[1]) continue;

    if (colorDef.hueRange === null) {
      // dark/bright: match on lightness alone
      mask[i] = 0; // black = match
      matchCount++;
    } else {
      // Hue-based color: check saturation minimum + hue range
      if (hsl.s >= colorDef.satMin && hueInRange(hsl.h, colorDef.hueRange[0], colorDef.hueRange[1])) {
        mask[i] = 0;
        matchCount++;
      }
    }
  }

  return { mask, matchCount };
}

/* ------------------------------------------------------------------ */
/*  Step 3: Morphological Cleanup                                      */
/* ------------------------------------------------------------------ */

async function cleanupMask(maskBuffer) {
  // median(3) removes salt-and-pepper noise from anti-aliased color boundaries
  // blur(0.5) + threshold(128) approximates a gentle close (erode + dilate)
  return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
    .blur(0.5)
    .threshold(128)
    .median(3)
    .png()
    .toBuffer();
}

/* ------------------------------------------------------------------ */
/*  Step 4: Potrace Tracing (per color)                                */
/* ------------------------------------------------------------------ */

async function traceMask(pngBuffer) {
  const tracer = Potrace(pngBuffer, {
    turdsize: TURD_SIZE,
    opttolerance: OPT_TOLERANCE,
    alphamax: ALPHA_MAX,
  });
  return await tracer.trace();
}

/* ------------------------------------------------------------------ */
/*  Step 5: Path Extraction & Clustering (reused from doodle script)   */
/* ------------------------------------------------------------------ */

function extractPaths(svgString, scale) {
  const pathRegex = /<path[^>]*\bd="([^"]+)"[^>]*\/?>/g;
  const subpaths = [];
  let match;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const fullD = match[1].trim();
    const parts = splitSubpaths(fullD);
    for (const part of parts) {
      if (part.trim().length > 0) subpaths.push(scalePathCoords(part.trim(), scale));
    }
  }

  return subpaths;
}

function scalePathCoords(d, scale) {
  return d.replace(/-?\d+\.?\d*/g, (n) => {
    const val = parseFloat(n) * scale;
    const rounded = Math.round(val * 10) / 10;
    return rounded === Math.floor(rounded) ? String(rounded) : rounded.toFixed(1);
  });
}

function splitSubpaths(d) {
  const mPositions = [];
  const re = /M/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    mPositions.push(m.index);
  }

  if (mPositions.length <= 1) return [d];

  const parts = [];
  for (let i = 0; i < mPositions.length; i++) {
    const start = mPositions[i];
    const end = i + 1 < mPositions.length ? mPositions[i + 1] : d.length;
    parts.push(d.slice(start, end));
  }
  return parts;
}

function computeBBox(d) {
  const nums = [];
  const numRe = /-?\d+\.?\d*/g;
  let nm;
  while ((nm = numRe.exec(d)) !== null) {
    nums.push(parseFloat(nm[0]));
  }

  if (nums.length < 2) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

function bboxDistance(a, b) {
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.sqrt(dx * dx + dy * dy);
}

// -- Union-Find --
function makeUF(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x) {
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }

  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else { parent[rb] = ra; rank[ra]++; }
  }

  return { find, union };
}

function clusterPaths(pathsWithBBoxes) {
  const n = pathsWithBBoxes.length;
  if (n === 0) return [];

  const uf = makeUF(n);
  const clusterBBox = pathsWithBBoxes.map((p) => ({ ...p.bbox }));

  function getClusterBBox(idx) {
    return clusterBBox[uf.find(idx)];
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (uf.find(i) === uf.find(j)) continue;
      if (bboxDistance(pathsWithBBoxes[i].bbox, pathsWithBBoxes[j].bbox) > CLUSTER_DIST) continue;

      const bboxA = getClusterBBox(i);
      const bboxB = getClusterBBox(j);
      const mergedMinX = Math.min(bboxA.minX, bboxB.minX);
      const mergedMinY = Math.min(bboxA.minY, bboxB.minY);
      const mergedMaxX = Math.max(bboxA.maxX, bboxB.maxX);
      const mergedMaxY = Math.max(bboxA.maxY, bboxB.maxY);
      const mergedW = mergedMaxX - mergedMinX;
      const mergedH = mergedMaxY - mergedMinY;

      // Containment check — holes/boundaries always merge
      const bboxI = pathsWithBBoxes[i].bbox;
      const bboxJ = pathsWithBBoxes[j].bbox;
      const contained =
        (bboxJ.minX >= bboxI.minX && bboxJ.maxX <= bboxI.maxX &&
         bboxJ.minY >= bboxI.minY && bboxJ.maxY <= bboxI.maxY) ||
        (bboxI.minX >= bboxJ.minX && bboxI.maxX <= bboxJ.maxX &&
         bboxI.minY >= bboxJ.minY && bboxI.maxY <= bboxJ.maxY);

      if (!contained) {
        if (mergedW > MAX_CLUSTER_DIM || mergedH > MAX_CLUSTER_DIM) continue;
      }

      uf.union(i, j);
      const newRoot = uf.find(i);
      clusterBBox[newRoot] = { minX: mergedMinX, minY: mergedMinY, maxX: mergedMaxX, maxY: mergedMaxY };
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(pathsWithBBoxes[i]);
  }

  const clusters = [];
  for (const members of groups.values()) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.bbox.minX);
      minY = Math.min(minY, m.bbox.minY);
      maxX = Math.max(maxX, m.bbox.maxX);
      maxY = Math.max(maxY, m.bbox.maxY);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const area = w * h;
    const maxDim = Math.max(w, h);
    if (area >= MIN_CLUSTER_AREA || maxDim >= MIN_CLUSTER_SPAN) {
      clusters.push({
        paths: members.map((m) => m.d),
        bbox: { minX, minY, maxX, maxY },
        area,
      });
    }
  }

  // Sort by area descending, cap at MAX_CLUSTERS_PER_COLOR
  clusters.sort((a, b) => b.area - a.area);
  return clusters.slice(0, MAX_CLUSTERS_PER_COLOR);
}

function classifyClusters(clusters) {
  const sorted = clusters.slice().sort((a, b) => a.area - b.area);
  const n = sorted.length;
  const t1 = Math.floor(n / 3);
  const t2 = Math.floor((2 * n) / 3);

  const thresholdSm = sorted[t1] ? sorted[t1].area : 0;
  const thresholdLg = sorted[t2] ? sorted[t2].area : 0;

  for (const cluster of clusters) {
    if (cluster.area >= thresholdLg) cluster.size = "lg";
    else if (cluster.area >= thresholdSm) cluster.size = "md";
    else cluster.size = "sm";
  }
}

/* ------------------------------------------------------------------ */
/*  Step 6: Animated SVG Assembly                                      */
/* ------------------------------------------------------------------ */

function distToHeroEdge(cx, cy, hero) {
  const dx = Math.max(hero.x1 - cx, 0, cx - hero.x2);
  const dy = Math.max(hero.y1 - cy, 0, cy - hero.y2);
  if (dx > 0 || dy > 0) return Math.sqrt(dx * dx + dy * dy);
  const toLeft = cx - hero.x1;
  const toRight = hero.x2 - cx;
  const toTop = cy - hero.y1;
  const toBottom = hero.y2 - cy;
  return -Math.min(toLeft, toRight, toTop, toBottom);
}

function buildAnimatedSVG(allColorClusters) {
  const rand = mulberry32(42);

  // Hero box in viewBox coordinates
  const hero = { x1: 480, y1: 380, x2: 1440, y2: 820 };

  const INITIAL_DELAY = 300;
  const screenCx = VIEWBOX_W / 2;
  const screenCy = VIEWBOX_H / 2;

  // Flatten all color clusters into enriched items with color metadata
  const enriched = [];
  for (const { colorDef, clusters } of allColorClusters) {
    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      const cx = (cluster.bbox.minX + cluster.bbox.maxX) / 2;
      const cy = (cluster.bbox.minY + cluster.bbox.maxY) / 2;
      const dist = Math.sqrt((cx - screenCx) ** 2 + (cy - screenCy) ** 2);
      const isHidden = distToHeroEdge(cx, cy, hero) < 0;

      enriched.push({
        cluster,
        colorDef,
        colorIdx: i,
        cx, cy, dist, isHidden,
      });
    }
  }

  // Sort by distance from center (ascending: center first)
  enriched.sort((a, b) => a.dist - b.dist);

  // Assign distance-proportional reveal delays (radial wave from center)
  const SPREAD_DURATION = 2500;
  const SCATTER = 250;
  const maxDist = Math.max(...enriched.map((e) => e.dist));
  for (const item of enriched) {
    const normalized = maxDist > 0 ? item.dist / maxDist : 0;
    const scatter = Math.round(rand() * SCATTER);
    item.revealDelay = Math.round(INITIAL_DELAY + normalized * SPREAD_DURATION + scatter);
  }

  // Generate group elements
  const groupEls = enriched
    .map((item) => {
      const combinedD = item.cluster.paths.join(" ");
      const fill = item.colorDef.fill;
      const pathEl = `    <path fill="${fill}" fill-rule="nonzero" d="${combinedD}"/>`;
      const hidden = item.isHidden ? 1 : 0;

      return `  <g id="glass-${item.colorDef.id}-${item.colorIdx}" class="glass-panel"
     data-delay="${item.revealDelay}" data-fill="${item.colorDef.fill}" data-glow="${item.colorDef.glow}"
     data-stroke="${item.colorDef.stroke}" data-size="${item.cluster.size}" data-hidden="${hidden}">
${pathEl}
  </g>`;
    })
    .join("\n\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}" preserveAspectRatio="xMidYMid meet">
  <rect width="100%" height="100%" fill="none"/>

  <style>
    .glass-panel {
      opacity: 0;
    }
    .glass-panel path {
      fill-opacity: 0;
      transition: filter 0.4s ease-out;
    }
  </style>

${groupEls}

  <script type="text/javascript">
  <![CDATA[
    (function() {
      var groups = Array.from(document.querySelectorAll('.glass-panel'));
      var FILL_MAX_OPACITY = 0.8;
      var REVEAL_DURATION = 800;

      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      function easeInOutCubic(t) {
        return t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      function hexToRgb(hex) {
        return {
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16)
        };
      }

      function lerpColor(a, b, t) {
        var ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
        var br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        var r = Math.round(ar + (br - ar) * t);
        var g = Math.round(ag + (bg - ag) * t);
        var bl = Math.round(ab + (bb - ab) * t);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
      }

      function applyGlow(g, intensity, cr, cg, cb) {
        if (intensity <= 0) { g.style.filter = ''; return; }
        var b1 = (4 * intensity).toFixed(1);
        var a1 = (0.9 * intensity).toFixed(2);
        var b2 = (14 * intensity).toFixed(1);
        var a2 = (0.45 * intensity).toFixed(2);
        g.style.filter =
          'drop-shadow(0 0 ' + b1 + 'px rgba(' + cr + ',' + cg + ',' + cb + ',' + a1 + ')) ' +
          'drop-shadow(0 0 ' + b2 + 'px rgba(' + cr + ',' + cg + ',' + cb + ',' + a2 + '))';
      }

      // Sort groups by reveal delay
      groups.sort(function(a, b) {
        return parseInt(a.dataset.delay) - parseInt(b.dataset.delay);
      });

      // ── Phase 1: Panel Reveal (opacity fade-in, center outward) ──
      var activeReveals = [];
      var revealLoopRunning = false;
      var maxDelay = 0;

      function revealLoop(now) {
        var i = activeReveals.length;
        while (i--) {
          var rev = activeReveals[i];
          var elapsed = now - rev.startTime;
          var t = Math.min(1, elapsed / REVEAL_DURATION);
          var eased = easeOutCubic(t);

          for (var p = 0; p < rev.paths.length; p++) {
            rev.paths[p].style.fillOpacity = (eased * FILL_MAX_OPACITY).toFixed(3);
          }

          if (t >= 1) {
            for (var p2 = 0; p2 < rev.paths.length; p2++) {
              rev.paths[p2].style.fillOpacity = String(FILL_MAX_OPACITY);
            }
            rev.group.classList.add('glass-revealed');
            activeReveals.splice(i, 1);
          }
        }

        if (activeReveals.length > 0) {
          requestAnimationFrame(revealLoop);
        } else {
          revealLoopRunning = false;
        }
      }

      function startReveal(g) {
        var paths = Array.from(g.querySelectorAll('path'));
        g.style.opacity = '1';

        activeReveals.push({
          group: g,
          paths: paths,
          startTime: performance.now()
        });

        if (!revealLoopRunning) {
          revealLoopRunning = true;
          requestAnimationFrame(revealLoop);
        }
      }

      for (var i = 0; i < groups.length; i++) {
        var delay = parseInt(groups[i].dataset.delay) || 0;
        if (delay > maxDelay) maxDelay = delay;

        (function(g, d) {
          setTimeout(function() { startReveal(g); }, d);
        })(groups[i], delay);
      }

      // ── Phase 2: Self-Colored Glow (sunlight through glass) ──
      var GLOW_UP_BASE = 1800;
      var GLOW_HOLD = 3000;
      var GLOW_FADE_BASE = 2000;
      var GLOW_JITTER = 300;
      var SPAWN_INTERVAL_BASE = 1800;
      var SPAWN_INTERVAL_JITTER = 400;
      var MAX_CONCURRENT = 3;
      var PHASE2_SETTLE = 500;

      var visibleGroups = groups.filter(function(g) {
        return g.dataset.hidden !== '1';
      });

      var activeGlows = new Set();

      // Shuffle-bag for fair distribution
      var glowBag = [];
      var glowBagIdx = 0;

      function shuffleGlowBag() {
        glowBag = visibleGroups.slice();
        for (var i = glowBag.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = glowBag[i];
          glowBag[i] = glowBag[j];
          glowBag[j] = tmp;
        }
        glowBagIdx = 0;
      }
      shuffleGlowBag();

      function nextGlowTarget() {
        var checked = 0;
        while (checked < visibleGroups.length) {
          if (glowBagIdx >= glowBag.length) shuffleGlowBag();
          var candidate = glowBag[glowBagIdx];
          glowBagIdx++;
          checked++;
          if (!activeGlows.has(candidate)) return candidate;
        }
        return null;
      }

      function startGlow(g) {
        activeGlows.add(g);
        var paths = Array.from(g.querySelectorAll('path'));
        var baseFill = g.dataset.fill;
        var glowHex = g.dataset.glow;
        var rgb = hexToRgb(glowHex);
        var upDur = GLOW_UP_BASE + (Math.random() * 2 - 1) * GLOW_JITTER;
        var fadeDur = GLOW_FADE_BASE + (Math.random() * 2 - 1) * GLOW_JITTER;

        // ── Glow up ──
        var upStart = performance.now();
        function animateUp(now) {
          var t = Math.min(1, (now - upStart) / upDur);
          var eased = easeOutCubic(t);
          var fill = lerpColor(baseFill, glowHex, eased * 0.6);
          var opacity = FILL_MAX_OPACITY + (1 - FILL_MAX_OPACITY) * eased;
          for (var i = 0; i < paths.length; i++) {
            paths[i].style.fill = fill;
            paths[i].style.fillOpacity = String(opacity.toFixed(3));
          }
          applyGlow(g, eased, rgb.r, rgb.g, rgb.b);
          if (t < 1) { requestAnimationFrame(animateUp); }
          else { setTimeout(startGlowFade, GLOW_HOLD); }
        }

        // ── Hold, then fade ──
        function startGlowFade() {
          var fadeStart = performance.now();
          function animateFade(now) {
            var t = Math.min(1, (now - fadeStart) / fadeDur);
            var eased = easeOutCubic(t);
            var fill = lerpColor(glowHex, baseFill, eased * 0.6);
            var invEased = 1 - eased;
            var opacity = FILL_MAX_OPACITY + (1 - FILL_MAX_OPACITY) * invEased;
            for (var i = 0; i < paths.length; i++) {
              paths[i].style.fill = fill;
              paths[i].style.fillOpacity = String(opacity.toFixed(3));
            }
            applyGlow(g, invEased, rgb.r, rgb.g, rgb.b);
            if (t < 1) { requestAnimationFrame(animateFade); }
            else {
              // Reset to base state
              for (var i = 0; i < paths.length; i++) {
                paths[i].style.fill = '';
                paths[i].style.fillOpacity = String(FILL_MAX_OPACITY);
              }
              g.style.filter = '';
              activeGlows.delete(g);
            }
          }
          requestAnimationFrame(animateFade);
        }

        requestAnimationFrame(animateUp);
      }

      function scheduleNextGlow() {
        if (activeGlows.size < MAX_CONCURRENT) {
          var target = nextGlowTarget();
          if (target) startGlow(target);
        }
        var interval = SPAWN_INTERVAL_BASE + (Math.random() * 2 - 1) * SPAWN_INTERVAL_JITTER;
        setTimeout(scheduleNextGlow, interval);
      }

      // Start Phase 2 after all reveals complete + settle time
      setTimeout(scheduleNextGlow, maxDelay + REVEAL_DURATION + PHASE2_SETTLE);

      // ── Phase 3: Pointer Proximity Reactivity ──
      var PROXIMITY_RADIUS = 250;
      var MAX_BRIGHTNESS = 1.5;
      var MAX_SATURATE = 1.8;

      var tileCenters = groups.map(function(g) {
        var bbox = g.getBBox();
        return {
          paths: Array.from(g.querySelectorAll('path')),
          cx: bbox.x + bbox.width / 2,
          cy: bbox.y + bbox.height / 2
        };
      });

      var svgEl = document.documentElement;
      var pendingPointer = null;
      var proximityRAF = 0;

      function applyProximity() {
        proximityRAF = 0;
        if (!pendingPointer) return;
        var pt = svgEl.createSVGPoint();
        pt.x = pendingPointer.clientX;
        pt.y = pendingPointer.clientY;
        var svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
        pendingPointer = null;

        for (var i = 0; i < tileCenters.length; i++) {
          var tc = tileCenters[i];
          var dx = svgPt.x - tc.cx;
          var dy = svgPt.y - tc.cy;
          var dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < PROXIMITY_RADIUS) {
            var t = 1 - dist / PROXIMITY_RADIUS;
            t = t * t;
            var b = 1 + (MAX_BRIGHTNESS - 1) * t;
            var s = 1 + (MAX_SATURATE - 1) * t;
            var f = 'brightness(' + b.toFixed(2) + ') saturate(' + s.toFixed(2) + ')';
            for (var j = 0; j < tc.paths.length; j++) tc.paths[j].style.filter = f;
          } else {
            for (var j = 0; j < tc.paths.length; j++) {
              if (tc.paths[j].style.filter) tc.paths[j].style.filter = '';
            }
          }
        }
      }

      svgEl.addEventListener('pointermove', function(e) {
        pendingPointer = e;
        if (!proximityRAF) proximityRAF = requestAnimationFrame(applyProximity);
      });

      svgEl.addEventListener('pointerleave', function() {
        pendingPointer = null;
        if (proximityRAF) { cancelAnimationFrame(proximityRAF); proximityRAF = 0; }
        for (var i = 0; i < tileCenters.length; i++) {
          var paths = tileCenters[i].paths;
          for (var j = 0; j < paths.length; j++) paths[j].style.filter = '';
        }
      });

    })();
  ]]>
  </script>
</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Step 1: Reading source image...");
  const rawBuffer = await readSourceImage();

  const scale = VIEWBOX_W / TRACE_W; // 2x

  const allColorClusters = [];

  for (const colorDef of COLOR_DEFS) {
    console.log(`\n── Processing color: ${colorDef.id} ──`);

    console.log("  Step 2: Creating binary mask...");
    const { mask, matchCount } = createColorMask(rawBuffer, colorDef);
    const pct = ((matchCount / (TRACE_W * TRACE_H)) * 100).toFixed(1);
    console.log(`  Matching pixels: ${matchCount} (${pct}%)`);

    if (matchCount < 100) {
      console.log("  Skipping — too few matching pixels");
      continue;
    }

    console.log("  Step 3: Morphological cleanup...");
    const cleanPng = await cleanupMask(mask);

    console.log("  Step 4: Tracing with potrace...");
    const svgString = await traceMask(cleanPng);

    console.log("  Step 5: Extracting paths and clustering...");
    const rawPaths = extractPaths(svgString, scale);
    console.log(`  Raw subpaths: ${rawPaths.length}`);

    const pathsWithBBoxes = rawPaths
      .map((d) => ({ d, bbox: computeBBox(d) }))
      .filter((p) => p.bbox !== null);
    console.log(`  Paths with valid bboxes: ${pathsWithBBoxes.length}`);

    const clusters = clusterPaths(pathsWithBBoxes);
    classifyClusters(clusters);
    console.log(`  Final clusters: ${clusters.length}`);

    if (clusters.length > 0) {
      allColorClusters.push({ colorDef, clusters });
    }
  }

  const totalClusters = allColorClusters.reduce((sum, c) => sum + c.clusters.length, 0);
  console.log(`\n── Assembling animated SVG (${totalClusters} total panels) ──`);

  const svg = buildAnimatedSVG(allColorClusters);
  writeFileSync(OUTPUT_PATH, svg);

  const kb = (Buffer.byteLength(svg) / 1024).toFixed(1);
  console.log(`\n✓ stained-glass-animated.svg — ${totalClusters} panels, ${kb} KB`);
  console.log(`  Path count: ${svg.match(/<path/g)?.length || 0}`);
  console.log(`  Written to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
