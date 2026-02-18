#!/usr/bin/env node

/**
 * Generate animated cherry blossom stained glass SVG from a photograph.
 *
 * Pipeline:
 * 1. Sharp: read image at trace resolution (960×600), get raw RGBA
 * 2. Color segmentation: create binary mask per color via HSL ranges
 * 3. Morphological cleanup: median filter per mask
 * 4. Potrace: trace each binary mask to SVG vector paths
 * 5. Spatial clustering: group nearby paths within each color
 * 6. Animated SVG assembly: opacity fade-in reveal + self-colored glow
 *
 * Usage: node scripts/generate-cherry-blossom-svg.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Potrace from "oslllo-potrace";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_IMAGE = join(__dirname, "..", "public", "2.png");
const OUTPUT_PATH = join(__dirname, "..", "public", "shape", "cherry-blossom-animated.svg");
const DEBUG = process.argv.includes("--debug");
const DEBUG_DIR = join(__dirname, "..", "debug");

// -- Config --
const TRACE_W = 960;
const TRACE_H = 600;
const VIEWBOX_W = 1920;
const VIEWBOX_H = 1200;
const CLUSTER_DIST = 6;
const MIN_CLUSTER_AREA = 40;
const MIN_CLUSTER_SPAN = 8;
const MAX_CLUSTER_DIM = 600;
const MAX_CLUSTERS_PER_COLOR = 350;
const TILE_COLS = 6;
const TILE_ROWS = 4;
const OVERLAP_FRACTION = 0.05;

// Trace profiles — different preprocessing + Potrace params per color category
const TRACE_PROFILES = {
  flower_fine: {
    // No cleanup — preserves raw petal edges; turdsize=1 lets Potrace handle noise
    preprocess: async (maskBuffer) => {
      return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
        .png()
        .toBuffer();
    },
    potrace: { turdsize: 1, opttolerance: 0.05, alphamax: 2.0, turnpolicy: "left" },
  },
  flower_clean: {
    // Light median only — removes salt-and-pepper while keeping petal detail
    preprocess: async (maskBuffer) => {
      return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
        .median(3)
        .png()
        .toBuffer();
    },
    potrace: { turdsize: 3, opttolerance: 0.1, alphamax: 1.5, turnpolicy: "minority" },
  },
  detail: {
    // Moderate cleanup for mid-detail colors (sky, green, stone)
    preprocess: async (maskBuffer) => {
      return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
        .median(3)
        .png()
        .toBuffer();
    },
    potrace: { turdsize: 3, opttolerance: 0.1, alphamax: 1.5, turnpolicy: "minority" },
  },
  sky: {
    // Aggressive gap-filling for large continuous sky regions
    preprocess: async (maskBuffer) => {
      return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
        .blur(0.5)
        .threshold(128)
        .median(5)
        .png()
        .toBuffer();
    },
    potrace: { turdsize: 8, opttolerance: 0.2, alphamax: 1.5, turnpolicy: "majority" },
  },
  structure: {
    // Heavy cleanup for structural colors (dark, bright) — blur + threshold + median
    preprocess: async (maskBuffer) => {
      return await sharp(maskBuffer, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
        .blur(0.3)
        .threshold(128)
        .median(3)
        .png()
        .toBuffer();
    },
    potrace: { turdsize: 5, opttolerance: 0.2, alphamax: 1.5, turnpolicy: "majority" },
  },
};

// Color definitions (HSL-based) — tuned for cherry blossoms
// hueRange: [min, max] in degrees (wraps for red), null = any hue
// profiles: which TRACE_PROFILES to run (multi-pass for flower colors)
const COLOR_DEFS = [
  { id: "petal-white", hueRange: null, satMin: 0, lRange: [88, 100], fill: "#f8f0f4", glow: "#ffffff", stroke: "#d8d0d4", profiles: ["flower_clean"] },
  { id: "petal-light", hueRange: [300, 360], satMin: 6, lRange: [78, 92], fill: "#f0c8d8", glow: "#ffe8f0", stroke: "#c8a0b0", profiles: ["flower_fine", "flower_clean"] },
  { id: "petal-deep", hueRange: [310, 360], satMin: 10, lRange: [65, 82], fill: "#d898a8", glow: "#f0b8c8", stroke: "#b07888", profiles: ["flower_fine", "flower_clean"] },
  { id: "rose", hueRange: [335, 10], satMin: 25, lRange: [25, 68], fill: "#c06878", glow: "#ff90a8", stroke: "#904858", profiles: ["flower_fine", "flower_clean"] },
  { id: "sky", hueRange: [195, 242], satMin: 25, lRange: [38, 88], fill: "#4088c0", glow: "#70b8ff", stroke: "#286090", profiles: ["sky"] },
  { id: "green", hueRange: [60, 150], satMin: 20, lRange: [15, 55], fill: "#508040", glow: "#80c060", stroke: "#386030", profiles: ["detail"] },
  { id: "stone", hueRange: [20, 50], satMin: 12, lRange: [25, 60], fill: "#988870", glow: "#c8b8a0", stroke: "#706050", profiles: ["detail"] },
  { id: "dark", hueRange: null, satMin: 0, lRange: [0, 18], fill: "#18140e", glow: "#504030", stroke: "#0d0a07", profiles: ["structure"] },
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
  // Wrapping range (e.g. 335-10 means 335→360 + 0→10)
  return h >= min || h <= max;
}

/* ------------------------------------------------------------------ */
/*  Step 1: Read Image at Trace Resolution                             */
/* ------------------------------------------------------------------ */

async function readSourceMetadata() {
  const metadata = await sharp(SOURCE_IMAGE).metadata();
  console.log(`  Source: ${metadata.width}×${metadata.height}`);
  return { sourceW: metadata.width, sourceH: metadata.height };
}

async function extractTileBuffer(col, row, sourceW, sourceH) {
  const baseTileW = Math.floor(sourceW / TILE_COLS);
  const baseTileH = Math.floor(sourceH / TILE_ROWS);
  const overlapW = Math.round(baseTileW * OVERLAP_FRACTION);
  const overlapH = Math.round(baseTileH * OVERLAP_FRACTION);

  const sourceX = col * baseTileW;
  const sourceY = row * baseTileH;

  const cropLeft = Math.max(0, sourceX - (col > 0 ? overlapW : 0));
  const cropTop = Math.max(0, sourceY - (row > 0 ? overlapH : 0));
  const cropRight = Math.min(sourceW, sourceX + baseTileW + (col < TILE_COLS - 1 ? overlapW : 0));
  const cropBottom = Math.min(sourceH, sourceY + baseTileH + (row < TILE_ROWS - 1 ? overlapH : 0));

  const cropW = cropRight - cropLeft;
  const cropH = cropBottom - cropTop;

  const rawBuffer = await sharp(SOURCE_IMAGE)
    .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
    .resize(TRACE_W, TRACE_H, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const viewboxLeft = (cropLeft / sourceW) * VIEWBOX_W;
  const viewboxRight = (cropRight / sourceW) * VIEWBOX_W;
  const viewboxTop = (cropTop / sourceH) * VIEWBOX_H;
  const viewboxBottom = (cropBottom / sourceH) * VIEWBOX_H;

  const scaleX = (viewboxRight - viewboxLeft) / TRACE_W;
  const scaleY = (viewboxBottom - viewboxTop) / TRACE_H;

  return { rawBuffer, scaleX, scaleY, offsetX: viewboxLeft, offsetY: viewboxTop };
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

async function preprocessMask(maskBuffer, profileName) {
  const profile = TRACE_PROFILES[profileName];
  return await profile.preprocess(maskBuffer);
}

/* ------------------------------------------------------------------ */
/*  Step 4: Potrace Tracing (profile-aware)                            */
/* ------------------------------------------------------------------ */

async function traceMaskWithProfile(pngBuffer, profileName) {
  const profile = TRACE_PROFILES[profileName];
  const tracer = Potrace(pngBuffer, profile.potrace);
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

function scaleAndTranslatePathCoords(d, scaleX, scaleY, offsetX, offsetY) {
  let coordIndex = 0;
  return d.replace(/-?\d+\.?\d*/g, (n) => {
    const isX = coordIndex % 2 === 0;
    coordIndex++;
    const scale = isX ? scaleX : scaleY;
    const offset = isX ? offsetX : offsetY;
    const val = parseFloat(n) * scale + offset;
    const rounded = Math.round(val * 10) / 10;
    return rounded === Math.floor(rounded) ? String(rounded) : rounded.toFixed(1);
  });
}

function extractPathsWithTransform(svgString, scaleX, scaleY, offsetX, offsetY) {
  const pathRegex = /<path[^>]*\bd="([^"]+)"[^>]*\/?>/g;
  const subpaths = [];
  let match;

  while ((match = pathRegex.exec(svgString)) !== null) {
    const fullD = match[1].trim();
    const parts = splitSubpaths(fullD);
    for (const part of parts) {
      if (part.trim().length > 0) {
        subpaths.push(scaleAndTranslatePathCoords(part.trim(), scaleX, scaleY, offsetX, offsetY));
      }
    }
  }

  return subpaths;
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

function buildAnimatedSVG(allColorClusters) {
  const rand = mulberry32(42);

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

      enriched.push({
        cluster,
        colorDef,
        colorIdx: i,
        cx, cy, dist,
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

      return `  <g id="glass-${item.colorDef.id}-${item.colorIdx}" class="glass-panel"
     data-delay="${item.revealDelay}" data-size="${item.cluster.size}">
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


    })();
  ]]>
  </script>
</svg>`;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  console.log("Step 1: Reading source image metadata...");
  const { sourceW, sourceH } = await readSourceMetadata();
  console.log(`  Tile grid: ${TILE_COLS}×${TILE_ROWS} (${TILE_COLS * TILE_ROWS} tiles)`);

  // Accumulate paths across all tiles per color
  const colorPathsMap = new Map();
  for (const colorDef of COLOR_DEFS) {
    colorPathsMap.set(colorDef.id, []);
  }

  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const tileIdx = row * TILE_COLS + col + 1;
      console.log(`\n── Tile ${tileIdx}/${TILE_COLS * TILE_ROWS} (col=${col}, row=${row}) ──`);

      const { rawBuffer, scaleX, scaleY, offsetX, offsetY } =
        await extractTileBuffer(col, row, sourceW, sourceH);
      console.log(`  Viewbox offset: (${offsetX.toFixed(1)}, ${offsetY.toFixed(1)}), scale: (${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`);

      for (const colorDef of COLOR_DEFS) {
        const { mask, matchCount } = createColorMask(rawBuffer, colorDef);
        const pct = ((matchCount / (TRACE_W * TRACE_H)) * 100).toFixed(1);

        if (DEBUG) {
          mkdirSync(DEBUG_DIR, { recursive: true });
          const debugMask = Buffer.from(mask);
          // Invert: mask uses 0=match, but for debug PNGs we want white=match
          for (let px = 0; px < debugMask.length; px++) {
            debugMask[px] = debugMask[px] === 0 ? 255 : 0;
          }
          await sharp(debugMask, { raw: { width: TRACE_W, height: TRACE_H, channels: 1 } })
            .png()
            .toFile(join(DEBUG_DIR, `mask-${colorDef.id}-tile${tileIdx}.png`));
        }

        if (matchCount < 100) continue;

        // Multi-pass: same mask traced with each profile for this color
        for (const profileName of colorDef.profiles) {
          const pngBuffer = await preprocessMask(mask, profileName);
          const svgString = await traceMaskWithProfile(pngBuffer, profileName);
          const paths = extractPathsWithTransform(svgString, scaleX, scaleY, offsetX, offsetY);

          if (paths.length > 0) {
            colorPathsMap.get(colorDef.id).push(...paths);
            console.log(`  ${colorDef.id}[${profileName}]: ${paths.length} subpaths (${pct}% pixels)`);
          }
        }
      }
    }
  }

  // Cluster paths per color (cross-tile clustering handles overlap dedup)
  const allColorClusters = [];
  for (const colorDef of COLOR_DEFS) {
    const allPaths = colorPathsMap.get(colorDef.id);
    if (allPaths.length === 0) continue;

    console.log(`\n── Clustering color: ${colorDef.id} (${allPaths.length} total subpaths) ──`);

    const pathsWithBBoxes = allPaths
      .map((d) => ({ d, bbox: computeBBox(d) }))
      .filter((p) => p.bbox !== null);

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
  console.log(`\n✓ cherry-blossom-animated.svg — ${totalClusters} panels, ${kb} KB`);
  console.log(`  Path count: ${svg.match(/<path/g)?.length || 0}`);
  console.log(`  Written to: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
