#!/usr/bin/env node

/**
 * Generate animated doodle SVG via automated bitmap-to-vector tracing.
 *
 * Pipeline:
 * 1. Sharp pre-processing: grayscale → threshold → binary buffer
 * 2. Potrace tracing: bitmap → SVG vector paths
 * 3. Spatial clustering: group nearby paths into doodle elements
 * 4. Animated SVG assembly: neon pipe fill + static glow
 *
 * Usage: node scripts/generate-doodle-svg.mjs
 */

import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Potrace from "oslllo-potrace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_IMAGE = join(__dirname, "..", "public", "backgrounds", "background.png");
const OUTPUT_PATH = join(__dirname, "..", "public", "shape", "doodle-animated.svg");

// -- Config --
const THRESHOLD = 75; // Grayscale cutoff: doodles (~48) vs background (~103)
const TURD_SIZE = 2; // Suppress speckles up to this many pixels
const OPT_TOLERANCE = 0.2; // Potrace default; preserves thin features that higher values smooth away
const CLUSTER_DIST = 12; // Max gap (px, in viewBox coords) between paths to group as one element
const MIN_CLUSTER_AREA = 50; // Catch small "fat" doodles (viewBox coords²)
const MIN_CLUSTER_SPAN = 12; // Catch thin lines — any dimension >= 12px (e.g. light bulb rays)
const MAX_CLUSTER_DIM = 280; // Max width or height (viewBox px) before refusing to merge
const VIEWBOX_W = 1920;
const VIEWBOX_H = 1200;

// Seeded PRNG (mulberry32) for reproducible initial animation delays
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
/*  Step 1: Image Pre-processing                                       */
/* ------------------------------------------------------------------ */

async function preprocessImage() {
  const metadata = await sharp(SOURCE_IMAGE).metadata();
  console.log(`  Source: ${metadata.width}×${metadata.height}`);

  // No resize — trace at full resolution for maximum detail.
  // Grayscale + threshold isolates doodles (dark, ~48) from background (lighter, ~103).
  // Result: black doodles on white — exactly what potrace expects (dark-on-light).
  const buffer = await sharp(SOURCE_IMAGE)
    .grayscale()
    .threshold(THRESHOLD)
    .png()
    .toBuffer();

  return { buffer, sourceW: metadata.width, sourceH: metadata.height };
}

/* ------------------------------------------------------------------ */
/*  Step 2: Potrace Tracing                                            */
/* ------------------------------------------------------------------ */

async function traceImage(buffer) {
  const tracer = Potrace(buffer, {
    turdsize: TURD_SIZE,
    opttolerance: OPT_TOLERANCE,
  });

  return await tracer.trace();
}

/* ------------------------------------------------------------------ */
/*  Step 3: Parse Paths & Spatial Clustering                           */
/* ------------------------------------------------------------------ */

/**
 * Extract path d-strings from SVG output.
 * Potrace may emit one big <path> with multiple subpaths (M...z M...z),
 * or multiple <path> elements. We handle both by also splitting subpaths.
 */
function extractPaths(svgString, scale) {
  const pathRegex = /<path[^>]*\bd="([^"]+)"[^>]*\/?>/g;
  const subpaths = [];
  let match;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const fullD = match[1].trim();
    // Split on M commands to get individual subpaths
    const parts = splitSubpaths(fullD);
    for (const part of parts) {
      if (part.trim().length > 0) subpaths.push(scalePathCoords(part.trim(), scale));
    }
  }

  return subpaths;
}

/** Scale coordinates from source space to viewBox space with 1-decimal precision. */
function scalePathCoords(d, scale) {
  return d.replace(/-?\d+\.?\d*/g, (n) => {
    const val = parseFloat(n) * scale;
    const rounded = Math.round(val * 10) / 10;
    return rounded === Math.floor(rounded) ? String(rounded) : rounded.toFixed(1);
  });
}

/**
 * Split a compound path (M...z M...z) into individual subpaths.
 * Each subpath starts with M and may end with z/Z.
 */
function splitSubpaths(d) {
  const parts = [];
  // Split at each M that starts a new subpath (not the first one)
  const mPositions = [];
  const re = /M/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    mPositions.push(m.index);
  }

  if (mPositions.length <= 1) return [d];

  for (let i = 0; i < mPositions.length; i++) {
    const start = mPositions[i];
    const end = i + 1 < mPositions.length ? mPositions[i + 1] : d.length;
    parts.push(d.slice(start, end));
  }

  return parts;
}

/**
 * Compute bounding box from SVG path d-string.
 * Potrace uses absolute coordinates (M, C, L, Z) — all numbers come in (x, y) pairs.
 * We extract all numeric values and compute min/max for x and y coordinates.
 * Control points of cubic Beziers are included, giving a slightly expanded but valid bbox.
 */
function computeBBox(d) {
  const nums = [];
  const numRe = /-?\d+\.?\d*/g;
  let nm;
  while ((nm = numRe.exec(d)) !== null) {
    nums.push(parseFloat(nm[0]));
  }

  if (nums.length < 2) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  // Numbers come in (x, y) pairs for M, L, C commands
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

/** Euclidean gap between two axis-aligned bounding boxes (0 if they overlap). */
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
    const ra = find(a),
      rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) parent[ra] = rb;
    else if (rank[ra] > rank[rb]) parent[rb] = ra;
    else {
      parent[rb] = ra;
      rank[ra]++;
    }
  }

  return { find, union };
}

function clusterPaths(pathsWithBBoxes) {
  const n = pathsWithBBoxes.length;
  const uf = makeUF(n);

  // Track each cluster's combined bbox to enforce MAX_CLUSTER_DIM
  const clusterBBox = pathsWithBBoxes.map((p) => ({ ...p.bbox }));

  function getClusterBBox(idx) {
    return clusterBBox[uf.find(idx)];
  }

  // Pairwise: merge paths whose bboxes are within CLUSTER_DIST,
  // but only if the resulting cluster wouldn't exceed MAX_CLUSTER_DIM
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (uf.find(i) === uf.find(j)) continue; // already merged
      if (bboxDistance(pathsWithBBoxes[i].bbox, pathsWithBBoxes[j].bbox) > CLUSTER_DIST) continue;

      // Check if merging would exceed max dimension
      const bboxA = getClusterBBox(i);
      const bboxB = getClusterBBox(j);
      const mergedMinX = Math.min(bboxA.minX, bboxB.minX);
      const mergedMinY = Math.min(bboxA.minY, bboxB.minY);
      const mergedMaxX = Math.max(bboxA.maxX, bboxB.maxX);
      const mergedMaxY = Math.max(bboxA.maxY, bboxB.maxY);
      const mergedW = mergedMaxX - mergedMinX;
      const mergedH = mergedMaxY - mergedMinY;

      // Check if one individual path bbox fully contains the other (hole/boundary pair).
      // Containment pairs must always merge — the hole never grows the cluster.
      const bboxI = pathsWithBBoxes[i].bbox;
      const bboxJ = pathsWithBBoxes[j].bbox;
      const contained =
        (bboxJ.minX >= bboxI.minX && bboxJ.maxX <= bboxI.maxX &&
         bboxJ.minY >= bboxI.minY && bboxJ.maxY <= bboxI.maxY) ||
        (bboxI.minX >= bboxJ.minX && bboxI.maxX <= bboxJ.maxX &&
         bboxI.minY >= bboxJ.minY && bboxI.maxY <= bboxJ.maxY);

      if (!contained) {
        // Only enforce MAX_CLUSTER_DIM for non-containment merges
        if (mergedW > MAX_CLUSTER_DIM || mergedH > MAX_CLUSTER_DIM) continue;
      }

      // Safe to merge — update bbox at the new root
      uf.union(i, j);
      const newRoot = uf.find(i);
      clusterBBox[newRoot] = {
        minX: mergedMinX,
        minY: mergedMinY,
        maxX: mergedMaxX,
        maxY: mergedMaxY,
      };
    }
  }

  // Group by union-find root
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(pathsWithBBoxes[i]);
  }

  // Filter: discard clusters too small (noise/artifacts)
  const clusters = [];
  for (const members of groups.values()) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
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

  console.log(`  Clusters after filtering: ${clusters.length} (${groups.size - clusters.length} noise filtered)`);

  // Sort by position (top-left to bottom-right) for deterministic output
  clusters.sort((a, b) => a.bbox.minY - b.bbox.minY || a.bbox.minX - b.bbox.minX);

  return clusters;
}

/**
 * Classify clusters into size tiers (lg/md/sm) by area terciles.
 * Mutates each cluster to add a `.size` property.
 */
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

  const counts = { lg: 0, md: 0, sm: 0 };
  for (const c of clusters) counts[c.size]++;
  console.log(
    `  Size classification: ${counts.lg} lg, ${counts.md} md, ${counts.sm} sm` +
      ` (thresholds: sm<${thresholdSm.toFixed(0)}, lg>=${thresholdLg.toFixed(0)})`
  );
}

/* ------------------------------------------------------------------ */
/*  Step 4: Animated SVG Assembly                                      */
/* ------------------------------------------------------------------ */

/**
 * Signed distance from point (cx, cy) to the hero box boundary.
 * Negative = inside the box, positive = outside.
 */
function distToHeroEdge(cx, cy, hero) {
  const dx = Math.max(hero.x1 - cx, 0, cx - hero.x2);
  const dy = Math.max(hero.y1 - cy, 0, cy - hero.y2);

  // Outside: positive Euclidean distance
  if (dx > 0 || dy > 0) return Math.sqrt(dx * dx + dy * dy);

  // Inside: negative distance to nearest edge
  const toLeft = cx - hero.x1;
  const toRight = hero.x2 - cx;
  const toTop = cy - hero.y1;
  const toBottom = hero.y2 - cy;
  return -Math.min(toLeft, toRight, toTop, toBottom);
}

/** Fisher-Yates shuffle (in-place) using provided PRNG */
function shuffle(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildAnimatedSVG(clusters) {
  const rand = mulberry32(42);

  // Hero box in viewBox coordinates — padded ~50px beyond actual hero edges
  const hero = { x1: 360, y1: 350, x2: 1560, y2: 850 };

  // Initial delay to sync with mapFadeIn CSS animation on .cinema-map
  const INITIAL_DELAY = 300;

  // Screen center for radial wave origin
  const screenCx = VIEWBOX_W / 2; // 960
  const screenCy = VIEWBOX_H / 2; // 600

  // -- Compute distance + centroid for each cluster --
  const enriched = clusters.map((cluster, origIdx) => {
    const cx = (cluster.bbox.minX + cluster.bbox.maxX) / 2;
    const cy = (cluster.bbox.minY + cluster.bbox.maxY) / 2;
    const dist = Math.sqrt((cx - screenCx) ** 2 + (cy - screenCy) ** 2);
    const isHidden = distToHeroEdge(cx, cy, hero) < 0; // under hero box

    return { cluster, origIdx, cx, cy, dist, isHidden };
  });

  // -- Sort by distance (ascending: inside-hero first, then outward) --
  enriched.sort((a, b) => a.dist - b.dist);

  // -- Assign distance-proportional reveal delays (radial wave from center) --
  const SPREAD_DURATION = 2000; // total wave time in ms
  const SCATTER = 200; // ±ms random jitter to prevent visible "rings"
  const maxDist = Math.max(...enriched.map((e) => e.dist));
  for (const item of enriched) {
    const normalized = item.dist / maxDist; // 0 = center, 1 = edge
    const scatter = Math.round(rand() * SCATTER);
    item.revealDelay = Math.round(INITIAL_DELAY + normalized * SPREAD_DURATION + scatter);
  }

  // -- Generate group elements --
  const groupEls = enriched
    .map((item) => {
      const combinedD = item.cluster.paths.join(" ");
      const pathEls = `    <path fill-rule="evenodd" d="${combinedD}"/>`;
      const hidden = item.isHidden ? 1 : 0;

      return `  <g id="doodle-${item.origIdx}" class="doodle-element"
     data-delay="${item.revealDelay}" data-hidden="${hidden}" data-size="${item.cluster.size}">
${pathEls}
  </g>`;
    })
    .join("\n\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}" preserveAspectRatio="xMidYMid meet">
  <rect width="100%" height="100%" fill="none"/>

  <style>
    .doodle-element {
      opacity: 0;
    }
    .doodle-element path {
      fill: #1a0808;
      fill-opacity: 0;
      stroke: none;
      stroke-width: 1.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .doodle-drawing path {
      stroke: #0e0404;
    }
    .doodle-drawn path {
      fill: #1a0808;
      fill-opacity: 0.55;
      stroke: #0e0404;
      stroke-opacity: 0.55;
    }
  </style>

${groupEls}

  <script type="text/javascript">
  <![CDATA[
    (function() {
      var groups = Array.from(document.querySelectorAll('.doodle-element'));
      var MAX_DRAW_MS = 2500;
      var MIN_DRAW_MS = 1000;
      var FILL_MAX_OPACITY = 0.55;
      var DRAW_SPEED = 1.5; // ms per path-length unit

      // Ease-out cubic: fast start, gentle finish
      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      // Ease-in-out cubic: natural hand-drawing feel
      function easeInOutCubic(t) {
        return t < 0.5
          ? 4 * t * t * t
          : 1 - Math.pow(-2 * t + 2, 3) / 2;
      }

      // Helper: parse hex color to {r, g, b}
      function hexToRgb(hex) {
        return {
          r: parseInt(hex.slice(1, 3), 16),
          g: parseInt(hex.slice(3, 5), 16),
          b: parseInt(hex.slice(5, 7), 16)
        };
      }

      // Helper: pick next glow color (cycles through shuffled palette)
      function nextGlowColor() {
        var color = GLOW_COLORS[colorIdx % GLOW_COLORS.length];
        colorIdx++;
        if (colorIdx >= GLOW_COLORS.length) {
          // Re-shuffle when we've used them all
          for (var i = GLOW_COLORS.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = GLOW_COLORS[i];
            GLOW_COLORS[i] = GLOW_COLORS[j];
            GLOW_COLORS[j] = tmp;
          }
          colorIdx = 0;
        }
        return color;
      }

      // Helper: apply glow at given intensity (0–1) — tight 2-layer, color-aware
      function applyGlow(g, intensity, cr, cg, cb) {
        if (intensity <= 0) { g.style.filter = ''; return; }
        var b1 = (3.5 * intensity).toFixed(1);
        var a1 = (0.95 * intensity).toFixed(2);
        var b2 = (11 * intensity).toFixed(1);
        var a2 = (0.5 * intensity).toFixed(2);
        g.style.filter =
          'drop-shadow(0 0 ' + b1 + 'px rgba(' + cr + ',' + cg + ',' + cb + ',' + a1 + ')) ' +
          'drop-shadow(0 0 ' + b2 + 'px rgba(' + cr + ',' + cg + ',' + cb + ',' + a2 + '))';
      }

      // Helper: linear interpolation between two hex colors
      function lerpColor(a, b, t) {
        var ar = parseInt(a.slice(1, 3), 16), ag = parseInt(a.slice(3, 5), 16), ab = parseInt(a.slice(5, 7), 16);
        var br = parseInt(b.slice(1, 3), 16), bg = parseInt(b.slice(3, 5), 16), bb = parseInt(b.slice(5, 7), 16);
        var r = Math.round(ar + (br - ar) * t);
        var g = Math.round(ag + (bg - ag) * t);
        var bl = Math.round(ab + (bb - ab) * t);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
      }

      // Sort groups by data-delay for reveal order
      groups.sort(function(a, b) {
        return parseInt(a.dataset.delay) - parseInt(b.dataset.delay);
      });

      // ── Phase 1: Stroke-drawing reveal (center outward) ──
      var activeDraws = []; // { path, totalLen, duration, startTime }
      var drawLoopRunning = false;
      var drawsCompleted = 0;
      var totalDraws = groups.length;

      // Master rAF loop — drives all active stroke draws
      function drawLoop(now) {
        var i = activeDraws.length;
        while (i--) {
          var draw = activeDraws[i];
          var elapsed = now - draw.startTime;
          var t = Math.min(1, elapsed / draw.duration);
          var eased = easeInOutCubic(t);

          draw.path.style.strokeDashoffset = (draw.totalLen * (1 - eased)).toFixed(1);
          draw.path.style.fillOpacity = (eased * FILL_MAX_OPACITY).toFixed(3);

          if (t >= 1) {
            draw.path.style.strokeDasharray = '';
            draw.path.style.strokeDashoffset = '';
            draw.path.style.fillOpacity = String(FILL_MAX_OPACITY);
            draw.path.style.strokeOpacity = '';
            var g = draw.path.closest('g');
            g.classList.remove('doodle-drawing');
            g.classList.add('doodle-drawn');
            activeDraws.splice(i, 1);
            drawsCompleted++;
          }
        }

        if (activeDraws.length > 0) {
          requestAnimationFrame(drawLoop);
        } else {
          drawLoopRunning = false;
        }
      }

      function startDraw(g) {
        var path = g.querySelector('path');
        if (!path) return;

        var totalLen = path.getTotalLength();
        path.style.strokeDasharray = totalLen;
        path.style.strokeDashoffset = totalLen;
        path.style.fillOpacity = '0';

        // Make visible and add drawing class
        g.style.opacity = '1';
        g.classList.add('doodle-drawing');

        // Duration proportional to length, clamped
        var duration = Math.max(MIN_DRAW_MS, Math.min(MAX_DRAW_MS, totalLen * DRAW_SPEED));

        activeDraws.push({
          path: path,
          totalLen: totalLen,
          duration: duration,
          startTime: performance.now()
        });

        // Start the master loop if not already running
        if (!drawLoopRunning) {
          drawLoopRunning = true;
          requestAnimationFrame(drawLoop);
        }
      }

      var maxDelay = 0;
      for (var i = 0; i < groups.length; i++) {
        var delay = parseInt(groups[i].dataset.delay) || 0;
        if (delay > maxDelay) maxDelay = delay;

        (function(g, d) {
          setTimeout(function() {
            startDraw(g);
          }, d);
        })(groups[i], delay);
      }

      // ── Phase 2: Random concurrent firefly glow ──
      var GLOW_COLORS = [
        '#ffc060',  // golden amber
        '#ff7088',  // warm rose
        '#60d0c0',  // soft teal
        '#a080ff',  // lavender
        '#ff9050',  // copper
        '#70b8ff',  // sky blue
      ];
      var colorIdx = 0;
      var REST_FILL = '#1a0808';
      var REST_STROKE = '#0e0404';
      var REST_OPACITY = 0.55;
      var GLOW_UP_BASE = 1800;
      var GLOW_HOLD = 2200;
      var GLOW_FADE_BASE = 2000;
      var GLOW_JITTER = 300;
      var SPAWN_INTERVAL_BASE = 2400;
      var SPAWN_INTERVAL_JITTER = 400;
      var MAX_CONCURRENT = 1;
      var PHASE2_SETTLE = 500;

      var visibleGroups = groups.filter(function(g) {
        return g.dataset.hidden !== '1';
      });

      var activeGlows = new Set();

      // ── Size-weighted glow targeting ──
      // Partition visible groups into size buckets
      var sizeBuckets = { lg: [], md: [], sm: [] };
      for (var si = 0; si < visibleGroups.length; si++) {
        var sz = visibleGroups[si].dataset.size || 'md';
        if (sizeBuckets[sz]) sizeBuckets[sz].push(visibleGroups[si]);
        else sizeBuckets.md.push(visibleGroups[si]); // fallback
      }

      // Independent shuffle-bag per size
      var bags = { lg: [], md: [], sm: [] };
      var bagIdx = { lg: 0, md: 0, sm: 0 };

      function shuffleSizeBag(size) {
        bags[size] = sizeBuckets[size].slice();
        for (var i = bags[size].length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = bags[size][i];
          bags[size][i] = bags[size][j];
          bags[size][j] = tmp;
        }
        bagIdx[size] = 0;
      }

      // Initialize all bags
      shuffleSizeBag('lg');
      shuffleSizeBag('md');
      shuffleSizeBag('sm');

      // Weighted pattern: large glows twice as often
      var GLOW_PATTERN = ['lg', 'lg', 'md', 'sm'];
      var patternIdx = 0;

      function nextGlowTargetFromBag(size) {
        var bucket = sizeBuckets[size];
        if (bucket.length === 0) return null;
        var checked = 0;
        while (checked < bucket.length) {
          if (bagIdx[size] >= bags[size].length) shuffleSizeBag(size);
          var candidate = bags[size][bagIdx[size]];
          bagIdx[size]++;
          checked++;
          if (!activeGlows.has(candidate)) return candidate;
        }
        return null;
      }

      function nextGlowTarget() {
        for (var attempts = 0; attempts < GLOW_PATTERN.length; attempts++) {
          var size = GLOW_PATTERN[patternIdx % GLOW_PATTERN.length];
          patternIdx++;
          var target = nextGlowTargetFromBag(size);
          if (target) return target;
        }
        return null;
      }

      function startGlow(g) {
        activeGlows.add(g);
        var path = g.querySelector('path');
        var upDur = GLOW_UP_BASE + (Math.random() * 2 - 1) * GLOW_JITTER;
        var fadeDur = GLOW_FADE_BASE + (Math.random() * 2 - 1) * GLOW_JITTER;

        // Pick a color for this glow cycle
        var glowHex = nextGlowColor();
        var rgb = hexToRgb(glowHex);

        // ── Glow up ──
        var upStart = performance.now();
        function animateUp(now) {
          var t = Math.min(1, (now - upStart) / upDur);
          var eased = easeOutCubic(t);
          path.style.fill = lerpColor(REST_FILL, glowHex, eased);
          path.style.stroke = lerpColor(REST_STROKE, glowHex, eased);
          path.style.fillOpacity = String(REST_OPACITY + (1 - REST_OPACITY) * eased);
          path.style.strokeOpacity = String(REST_OPACITY + (1 - REST_OPACITY) * eased);
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
            path.style.fill = lerpColor(glowHex, REST_FILL, eased);
            path.style.stroke = lerpColor(glowHex, REST_STROKE, eased);
            path.style.fillOpacity = String(1 - (1 - REST_OPACITY) * eased);
            path.style.strokeOpacity = String(1 - (1 - REST_OPACITY) * eased);
            applyGlow(g, 1 - eased, rgb.r, rgb.g, rgb.b);
            if (t < 1) { requestAnimationFrame(animateFade); }
            else {
              path.style.fill = '';
              path.style.stroke = '';
              path.style.fillOpacity = '';
              path.style.strokeOpacity = '';
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

      // Start Phase 2 after all draws complete + settle
      setTimeout(scheduleNextGlow, maxDelay + MAX_DRAW_MS + PHASE2_SETTLE);

    })();
  ]]>
  </script>
</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Step 1: Pre-processing image...");
  const { buffer, sourceW } = await preprocessImage();

  console.log("Step 2: Tracing with potrace...");
  const svgString = await traceImage(buffer);

  console.log("Step 3: Parsing paths and clustering...");
  const scale = VIEWBOX_W / sourceW;
  const rawPaths = extractPaths(svgString, scale);
  console.log(`  Raw subpaths from potrace: ${rawPaths.length}`);

  const pathsWithBBoxes = rawPaths.map((d) => ({ d, bbox: computeBBox(d) })).filter((p) => p.bbox !== null);
  console.log(`  Paths with valid bboxes: ${pathsWithBBoxes.length}`);

  const clusters = clusterPaths(pathsWithBBoxes);
  classifyClusters(clusters);

  console.log("Step 4: Assembling animated SVG...");
  const svg = buildAnimatedSVG(clusters);

  writeFileSync(OUTPUT_PATH, svg);

  const kb = (Buffer.byteLength(svg) / 1024).toFixed(1);
  console.log(`\n✓ doodle-animated.svg — ${clusters.length} elements, ${kb} KB`);
  console.log(`  Path count: ${svg.match(/<path/g)?.length || 0}`);
  console.log(`  Written to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
