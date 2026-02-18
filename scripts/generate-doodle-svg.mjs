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
  const POOL_SIZE = 1;

  // Hero box in viewBox coordinates — padded ~50px beyond actual hero edges
  const hero = { x1: 360, y1: 350, x2: 1560, y2: 850 };

  // Initial delay to sync with mapFadeIn CSS animation on .cinema-map
  const INITIAL_DELAY = 300;

  // Screen center for radial wave origin
  const screenCx = VIEWBOX_W / 2; // 960
  const screenCy = VIEWBOX_H / 2; // 600

  // -- Compute distance + centroid + sweep direction for each cluster --
  const enriched = clusters.map((cluster, origIdx) => {
    const cx = (cluster.bbox.minX + cluster.bbox.maxX) / 2;
    const cy = (cluster.bbox.minY + cluster.bbox.maxY) / 2;
    const dist = Math.sqrt((cx - screenCx) ** 2 + (cy - screenCy) ** 2);
    const isHidden = distToHeroEdge(cx, cy, hero) < 0; // under hero box

    // Sweep direction based on bbox aspect ratio with 50% random reversal
    const w = cluster.bbox.maxX - cluster.bbox.minX;
    const h = cluster.bbox.maxY - cluster.bbox.minY;
    const isHoriz = w >= h;
    const rev = rand() > 0.5;
    const sweep = isHoriz ? (rev ? "h-rev" : "h") : (rev ? "v-rev" : "v");

    return { cluster, origIdx, cx, cy, dist, isHidden, sweep };
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
     data-delay="${item.revealDelay}" data-hidden="${hidden}" data-sweep="${item.sweep}">
${pathEls}
  </g>`;
    })
    .join("\n\n");

  // -- Generate gradient pool defs --
  const neonStops = `
      <stop offset="0" stop-color="#ff6b3d"/>
      <stop offset="0.38" stop-color="#ff6b3d"/>
      <stop offset="0.42" stop-color="#ffaa40"/>
      <stop offset="0.47" stop-color="#fffbe8"/>
      <stop offset="0.52" stop-color="#ffaa40"/>
      <stop offset="0.58" stop-color="#1a0808"/>
      <stop offset="1" stop-color="#1a0808"/>`;

  const gradientDefs = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    gradientDefs.push(`    <linearGradient id="neonFill-${i}" gradientUnits="objectBoundingBox"
                    x1="0" y1="0" x2="1" y2="0" gradientTransform="translate(-1.2, 0)">${neonStops}
    </linearGradient>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX_W} ${VIEWBOX_H}" preserveAspectRatio="xMidYMid slice">
  <rect width="100%" height="100%" fill="#c0392b"/>

  <defs>
${gradientDefs.join("\n")}
  </defs>

  <style>
    .doodle-element {
      fill: #1a0808;
      opacity: 0;
      transition: opacity 150ms ease-out, fill 400ms ease-out, filter 400ms ease-out;
    }
    .doodle-lit {
      fill: #ff6b3d;
      filter: drop-shadow(0 0 6px rgba(255,107,61,0.5))
              drop-shadow(0 0 14px rgba(255,60,30,0.25));
    }
  </style>

${groupEls}

  <script type="text/javascript">
  <![CDATA[
    (function() {
      var groups = Array.from(document.querySelectorAll('.doodle-element'));
      var FILL_DUR = 3000;
      var HOLD_DUR = 1000;

      // Sweep direction config: gradient orientation + translate range
      var SWEEP_CFG = {
        'h':     { x1: 0, y1: 0, x2: 1, y2: 0, axis: 'x', from: -1.2, to: 0.8 },
        'h-rev': { x1: 0, y1: 0, x2: 1, y2: 0, axis: 'x', from: 0.8,  to: -1.2 },
        'v':     { x1: 0, y1: 0, x2: 0, y2: 1, axis: 'y', from: -1.2, to: 0.8 },
        'v-rev': { x1: 0, y1: 0, x2: 0, y2: 1, axis: 'y', from: 0.8,  to: -1.2 }
      };

      // Single gradient element (pool size = 1)
      var gradEl = document.getElementById('neonFill-0');

      // Ease-out cubic: fast start, gentle finish
      function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
      }

      // Neon sweep on a single element, calls onDone when complete
      function startNeonFill(g, sweep, onDone) {
        var cfg = SWEEP_CFG[sweep] || SWEEP_CFG['h'];

        // Configure gradient orientation
        gradEl.setAttribute('x1', cfg.x1);
        gradEl.setAttribute('y1', cfg.y1);
        gradEl.setAttribute('x2', cfg.x2);
        gradEl.setAttribute('y2', cfg.y2);

        // Apply gradient fill
        g.style.fill = 'url(#neonFill-0)';

        var start = performance.now();

        function animate(now) {
          var elapsed = now - start;
          var t = Math.min(1, elapsed / FILL_DUR);
          var eased = easeOutCubic(t);

          // Translate gradient along axis
          var pos = cfg.from + (cfg.to - cfg.from) * eased;
          if (cfg.axis === 'x') {
            gradEl.setAttribute('gradientTransform', 'translate(' + pos.toFixed(3) + ', 0)');
          } else {
            gradEl.setAttribute('gradientTransform', 'translate(0, ' + pos.toFixed(3) + ')');
          }

          // Dual drop-shadow glow peaking at midpoint
          var intensity = Math.sin(t * Math.PI);
          var blur1 = (16 * intensity).toFixed(1);
          var alpha1 = (0.7 * intensity).toFixed(2);
          var blur2 = (32 * intensity).toFixed(1);
          var alpha2 = (0.2 * intensity).toFixed(2);
          g.style.filter = 'drop-shadow(0 0 ' + blur1 + 'px rgba(255,107,61,' + alpha1 + ')) ' +
                           'drop-shadow(0 0 ' + blur2 + 'px rgba(255,60,30,' + alpha2 + '))';

          if (t < 1) {
            requestAnimationFrame(animate);
          } else {
            // Sweep complete — switch to .doodle-lit class
            g.style.fill = '';
            g.style.filter = '';
            g.classList.add('doodle-lit');
            if (onDone) onDone();
          }
        }

        requestAnimationFrame(animate);
      }

      // Sort groups by data-delay for reveal order
      groups.sort(function(a, b) {
        return parseInt(a.dataset.delay) - parseInt(b.dataset.delay);
      });

      // ── Phase 1: Per-element reveal (individual fades from center outward) ──
      var maxDelay = 0;
      for (var i = 0; i < groups.length; i++) {
        var delay = parseInt(groups[i].dataset.delay) || 0;
        if (delay > maxDelay) maxDelay = delay;

        (function(g, d) {
          setTimeout(function() {
            g.style.opacity = '1';
          }, d);
        })(groups[i], delay);
      }

      // Start Phase 2 after all reveals + 500ms settle
      setTimeout(spotlightNext, maxDelay + 500);

      // ── Phase 2: Sequential spotlight (starts after all reveals settle) ──
      var visibleGroups = groups.filter(function(g) {
        return g.dataset.hidden !== '1';
      });

      var spotlightIndex = 0;
      var prevGroup = null;

      function spotlightNext() {
        // Remove glow from previous (CSS transition handles smooth fade-back)
        if (prevGroup) {
          prevGroup.classList.remove('doodle-lit');
        }

        var current = visibleGroups[spotlightIndex];
        prevGroup = current;

        // Start neon sweep on current element
        startNeonFill(current, current.dataset.sweep, function() {
          // Hold glow, then advance to next
          setTimeout(spotlightNext, HOLD_DUR);
        });

        spotlightIndex = (spotlightIndex + 1) % visibleGroups.length;
      }

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
