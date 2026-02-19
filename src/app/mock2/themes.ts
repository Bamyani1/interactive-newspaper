/**
 * 10 immersive visual themes for the canopy page.
 * Pure data — no React dependencies.
 */

export type LeafDepth = "near" | "mid" | "far";

/** [sizeBase, sizeRange, durBase, durRange, swayBase, swayRange, opBase, opRange, blur] */
export type DepthTuple = [number, number, number, number, number, number, number, number, number];

export interface SkyPalette {
  stops: readonly [string, string, string];
  clouds: readonly [
    readonly [string, string],
    readonly [string, string],
    readonly [string, string],
  ];
}

export type ParticleShape = "leaf" | "circle" | "line" | "square" | "petal" | "wisp";
export type ParticleDirection = "fall" | "rise" | "drift" | "rain" | "twinkle";
export type ParticleLayer = "front" | "behind";

export interface CanopyTheme {
  id: string;
  name: string;
  dominantColor: string;
  sky: { day: SkyPalette; night: SkyPalette };
  particles: {
    colors: string[];
    glowColors: string[];
    count: number;
    shape: ParticleShape;
    direction: ParticleDirection;
    depthConfig: Record<LeafDepth, DepthTuple>;
    blendMode: string;
    layer: ParticleLayer;
  };
  /** Standardized: brightness(B) saturate(S) hue-rotate(Hdeg) sepia(P) contrast(C) */
  svgFilter: { day: string; night: string };
  base: { day: string; night: string };
  grain: { opacity: { day: number; night: number }; blendMode: string };
}

/* ─────────────────────────────────────────────
   1. AUTUMN CANOPY (default — current look)
   ───────────────────────────────────────────── */

const autumn: CanopyTheme = {
  id: "autumn",
  name: "Autumn Canopy",
  dominantColor: "#e09010",
  sky: {
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
  },
  particles: {
    colors: [
      "#e01818", "#e83010", "#c03010", "#f06000", "#f08010", "#e09010",
      "#e8b810", "#d0b020", "#60b818", "#208820", "#fff0c0", "#f8e070",
    ],
    glowColors: [
      "#ff2020", "#ff4820", "#f05020", "#ff8020", "#ffa020", "#ffc020",
      "#ffe030", "#f0e030", "#90e830", "#30c830", "#fffef0", "#fff090",
    ],
    count: 45,
    shape: "leaf",
    direction: "fall",
    depthConfig: {
      near: [8, 6, 6, 4, 25, 20, 0.5, 0.3, 0],
      mid: [4, 4, 8, 6, 15, 10, 0.3, 0.3, 0],
      far: [2, 3, 14, 6, 5, 7, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(0.88) saturate(0.85) hue-rotate(0deg) sepia(0) contrast(1)",
    night: "brightness(0.88) saturate(0.85) hue-rotate(0deg) sepia(0) contrast(1)",
  },
  base: { day: "#88c8f0", night: "#0a1428" },
  grain: { opacity: { day: 0.02, night: 0.05 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   2. WINTER FROST
   ───────────────────────────────────────────── */

const winter: CanopyTheme = {
  id: "winter",
  name: "Winter Frost",
  dominantColor: "#b0c8d8",
  sky: {
    day: {
      stops: ["#b0c0d0", "#c0d0d8", "#d0dce4"],
      clouds: [
        ["rgba(200,216,232,0.16)", "rgba(200,216,232,0)"],
        ["rgba(200,216,232,0.12)", "rgba(200,216,232,0)"],
        ["rgba(200,216,232,0.09)", "rgba(200,216,232,0)"],
      ],
    },
    night: {
      stops: ["#0c1420", "#141c28", "#1c2430"],
      clouds: [
        ["rgba(140,160,200,0.08)", "rgba(140,160,200,0)"],
        ["rgba(140,160,200,0.06)", "rgba(140,160,200,0)"],
        ["rgba(140,160,200,0.05)", "rgba(140,160,200,0)"],
      ],
    },
  },
  particles: {
    colors: ["#ffffff", "#e8f0f8", "#d0e0f0", "#f0f4f8", "#c8dce8"],
    glowColors: ["#ffffff", "#f0f4f8", "#e0e8f0", "#f8fafc", "#d8e8f0"],
    count: 50,
    shape: "circle",
    direction: "fall",
    depthConfig: {
      near: [6, 4, 7, 5, 20, 15, 0.5, 0.3, 0],
      mid: [3, 3, 10, 6, 12, 8, 0.3, 0.3, 0],
      far: [1.5, 2, 16, 6, 4, 5, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(1.1) saturate(0.25) hue-rotate(190deg) sepia(0) contrast(0.9)",
    night: "brightness(0.5) saturate(0.2) hue-rotate(190deg) sepia(0) contrast(0.95)",
  },
  base: { day: "#c8d8e4", night: "#0c1420" },
  grain: { opacity: { day: 0.03, night: 0.04 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   3. CHERRY BLOSSOM
   ───────────────────────────────────────────── */

const cherry: CanopyTheme = {
  id: "cherry",
  name: "Cherry Blossom",
  dominantColor: "#e8a0b8",
  sky: {
    day: {
      stops: ["#b8a8c8", "#cbb8d0", "#dcc8d8"],
      clouds: [
        ["rgba(240,200,220,0.16)", "rgba(240,200,220,0)"],
        ["rgba(240,200,220,0.12)", "rgba(240,200,220,0)"],
        ["rgba(240,200,220,0.09)", "rgba(240,200,220,0)"],
      ],
    },
    night: {
      stops: ["#18102a", "#241838", "#302048"],
      clouds: [
        ["rgba(180,120,180,0.08)", "rgba(180,120,180,0)"],
        ["rgba(160,100,160,0.06)", "rgba(160,100,160,0)"],
        ["rgba(140,80,140,0.05)", "rgba(140,80,140,0)"],
      ],
    },
  },
  particles: {
    colors: ["#f0c0c8", "#f5d0d5", "#f8dce0", "#eab0b8", "#fce8ec"],
    glowColors: ["#f8d0d8", "#fce0e5", "#ffecf0", "#f0c0c8", "#fff0f4"],
    count: 40,
    shape: "petal",
    direction: "fall",
    depthConfig: {
      near: [9, 5, 8, 5, 30, 20, 0.4, 0.3, 0],
      mid: [5, 4, 12, 6, 20, 12, 0.3, 0.2, 0],
      far: [3, 3, 18, 6, 8, 6, 0.15, 0.15, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(1.05) saturate(0.6) hue-rotate(300deg) sepia(0.1) contrast(0.95)",
    night: "brightness(0.5) saturate(0.45) hue-rotate(300deg) sepia(0.1) contrast(1)",
  },
  base: { day: "#dcc0d0", night: "#18102a" },
  grain: { opacity: { day: 0.02, night: 0.04 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   4. STARRY NIGHT
   ───────────────────────────────────────────── */

const starry: CanopyTheme = {
  id: "starry",
  name: "Starry Night",
  dominantColor: "#c8c0a0",
  sky: {
    day: {
      stops: ["#141828", "#1c2030", "#242838"],
      clouds: [
        ["rgba(140,130,160,0.06)", "rgba(140,130,160,0)"],
        ["rgba(140,130,160,0.05)", "rgba(140,130,160,0)"],
        ["rgba(140,130,160,0.04)", "rgba(140,130,160,0)"],
      ],
    },
    night: {
      stops: ["#060810", "#0a0c18", "#0e1020"],
      clouds: [
        ["rgba(100,96,120,0.04)", "rgba(100,96,120,0)"],
        ["rgba(100,96,120,0.03)", "rgba(100,96,120,0)"],
        ["rgba(100,96,120,0.02)", "rgba(100,96,120,0)"],
      ],
    },
  },
  particles: {
    colors: ["#fff8e0", "#ffe8c0", "#ffffff", "#f8f0d0"],
    glowColors: ["#fffae8", "#fff0d0", "#ffffff", "#faf4e0"],
    count: 80,
    shape: "circle",
    direction: "twinkle",
    depthConfig: {
      near: [3, 2, 6, 4, 0, 0, 0.7, 0.3, 0],
      mid: [1.5, 1.5, 8, 6, 0, 0, 0.4, 0.3, 0],
      far: [0.8, 1, 12, 8, 0, 0, 0.25, 0.2, 0],
    },
    blendMode: "screen",
    layer: "behind",
  },
  svgFilter: {
    day: "brightness(0.35) saturate(0.2) hue-rotate(0deg) sepia(0) contrast(1.4)",
    night: "brightness(0.2) saturate(0.15) hue-rotate(0deg) sepia(0) contrast(1.5)",
  },
  base: { day: "#141828", night: "#060810" },
  grain: { opacity: { day: 0.03, night: 0.05 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   5. FIREFLY EVENING
   ───────────────────────────────────────────── */

const firefly: CanopyTheme = {
  id: "firefly",
  name: "Firefly Evening",
  dominantColor: "#a0c830",
  sky: {
    day: {
      stops: ["#30283c", "#3c3040", "#483838"],
      clouds: [
        ["rgba(120,100,80,0.08)", "rgba(120,100,80,0)"],
        ["rgba(120,100,80,0.06)", "rgba(120,100,80,0)"],
        ["rgba(120,100,80,0.05)", "rgba(120,100,80,0)"],
      ],
    },
    night: {
      stops: ["#0c1018", "#141820", "#1c2028"],
      clouds: [
        ["rgba(60,80,60,0.06)", "rgba(60,80,60,0)"],
        ["rgba(60,80,60,0.05)", "rgba(60,80,60,0)"],
        ["rgba(60,80,60,0.04)", "rgba(60,80,60,0)"],
      ],
    },
  },
  particles: {
    colors: ["#c8e040", "#a0d830", "#e0f060", "#90c020"],
    glowColors: ["#d8f050", "#b0e840", "#f0ff70", "#a0d030"],
    count: 35,
    shape: "circle",
    direction: "rise",
    depthConfig: {
      near: [5, 3, 6, 4, 15, 10, 0.6, 0.3, 0],
      mid: [3, 2, 9, 5, 10, 8, 0.4, 0.3, 0],
      far: [2, 1.5, 14, 6, 5, 4, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "behind",
  },
  svgFilter: {
    day: "brightness(0.6) saturate(0.8) hue-rotate(60deg) sepia(0.1) contrast(1.1)",
    night: "brightness(0.35) saturate(0.6) hue-rotate(60deg) sepia(0.1) contrast(1.2)",
  },
  base: { day: "#282030", night: "#0c1018" },
  grain: { opacity: { day: 0.03, night: 0.05 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   6. RAINSTORM
   ───────────────────────────────────────────── */

const rain: CanopyTheme = {
  id: "rain",
  name: "Rainstorm",
  dominantColor: "#708090",
  sky: {
    day: {
      stops: ["#505860", "#606870", "#707880"],
      clouds: [
        ["rgba(140,148,160,0.14)", "rgba(140,148,160,0)"],
        ["rgba(140,148,160,0.11)", "rgba(140,148,160,0)"],
        ["rgba(140,148,160,0.08)", "rgba(140,148,160,0)"],
      ],
    },
    night: {
      stops: ["#181c22", "#202428", "#282c32"],
      clouds: [
        ["rgba(80,88,100,0.08)", "rgba(80,88,100,0)"],
        ["rgba(80,88,100,0.06)", "rgba(80,88,100,0)"],
        ["rgba(80,88,100,0.05)", "rgba(80,88,100,0)"],
      ],
    },
  },
  particles: {
    colors: ["#c0c8d0", "#d0d8e0", "#e0e4e8"],
    glowColors: ["#d0d8e0", "#e0e8f0", "#f0f2f4"],
    count: 60,
    shape: "line",
    direction: "rain",
    depthConfig: {
      near: [10, 6, 1.5, 1, 4, 3, 0.4, 0.3, 0],
      mid: [7, 4, 2.5, 1.5, 3, 2, 0.3, 0.2, 0],
      far: [4, 3, 3.5, 2, 2, 1.5, 0.15, 0.15, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(0.7) saturate(0.4) hue-rotate(170deg) sepia(0.05) contrast(0.95)",
    night: "brightness(0.35) saturate(0.3) hue-rotate(170deg) sepia(0.05) contrast(1.05)",
  },
  base: { day: "#505860", night: "#181c22" },
  grain: { opacity: { day: 0.04, night: 0.06 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   7. NORTHERN LIGHTS
   ───────────────────────────────────────────── */

const aurora: CanopyTheme = {
  id: "aurora",
  name: "Northern Lights",
  dominantColor: "#40c080",
  sky: {
    day: {
      stops: ["#061020", "#0c1830", "#102040"],
      clouds: [
        ["rgba(64,200,128,0.10)", "rgba(64,200,128,0)"],
        ["rgba(100,140,220,0.08)", "rgba(100,140,220,0)"],
        ["rgba(140,80,200,0.06)", "rgba(140,80,200,0)"],
      ],
    },
    night: {
      stops: ["#040810", "#081420", "#0c1830"],
      clouds: [
        ["rgba(48,180,100,0.08)", "rgba(48,180,100,0)"],
        ["rgba(80,120,200,0.06)", "rgba(80,120,200,0)"],
        ["rgba(120,60,180,0.05)", "rgba(120,60,180,0)"],
      ],
    },
  },
  particles: {
    colors: ["#40ff80", "#60ffa0", "#80c0ff", "#a060ff"],
    glowColors: ["#50ff90", "#70ffb0", "#90d0ff", "#b070ff"],
    count: 40,
    shape: "circle",
    direction: "rise",
    depthConfig: {
      near: [6, 4, 8, 5, 18, 12, 0.5, 0.3, 0],
      mid: [3.5, 3, 12, 6, 10, 8, 0.3, 0.3, 0],
      far: [2, 2, 18, 6, 5, 4, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "behind",
  },
  svgFilter: {
    day: "brightness(0.6) saturate(0.3) hue-rotate(180deg) sepia(0) contrast(1.1)",
    night: "brightness(0.4) saturate(0.25) hue-rotate(180deg) sepia(0) contrast(1.2)",
  },
  base: { day: "#061020", night: "#040810" },
  grain: { opacity: { day: 0.03, night: 0.04 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   8. GOLDEN HOUR
   ───────────────────────────────────────────── */

const golden: CanopyTheme = {
  id: "golden",
  name: "Golden Hour",
  dominantColor: "#d0a060",
  sky: {
    day: {
      stops: ["#c08850", "#d0a060", "#d8b878"],
      clouds: [
        ["rgba(220,180,120,0.14)", "rgba(220,180,120,0)"],
        ["rgba(220,180,120,0.11)", "rgba(220,180,120,0)"],
        ["rgba(220,180,120,0.08)", "rgba(220,180,120,0)"],
      ],
    },
    night: {
      stops: ["#141008", "#201810", "#2c2018"],
      clouds: [
        ["rgba(140,100,50,0.08)", "rgba(140,100,50,0)"],
        ["rgba(140,100,50,0.06)", "rgba(140,100,50,0)"],
        ["rgba(140,100,50,0.05)", "rgba(140,100,50,0)"],
      ],
    },
  },
  particles: {
    colors: ["#d8c080", "#e0c888", "#c8b070", "#f0d890"],
    glowColors: ["#e0c890", "#e8d098", "#d0b880", "#f8e0a0"],
    count: 45,
    shape: "circle",
    direction: "drift",
    depthConfig: {
      near: [4, 3, 5, 3, 15, 10, 0.5, 0.3, 0],
      mid: [2.5, 2, 7, 4, 10, 6, 0.3, 0.3, 0],
      far: [1.5, 1.5, 10, 5, 5, 4, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(1.05) saturate(0.7) hue-rotate(-10deg) sepia(0.45) contrast(0.9)",
    night: "brightness(0.45) saturate(0.5) hue-rotate(-10deg) sepia(0.35) contrast(1)",
  },
  base: { day: "#c09060", night: "#141008" },
  grain: { opacity: { day: 0.04, night: 0.05 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   9. MISTY MORNING
   ───────────────────────────────────────────── */

const mist: CanopyTheme = {
  id: "mist",
  name: "Misty Morning",
  dominantColor: "#a0a8a8",
  sky: {
    day: {
      stops: ["#909898", "#a0a8a8", "#b0b8b8"],
      clouds: [
        ["rgba(180,188,188,0.16)", "rgba(180,188,188,0)"],
        ["rgba(180,188,188,0.12)", "rgba(180,188,188,0)"],
        ["rgba(180,188,188,0.09)", "rgba(180,188,188,0)"],
      ],
    },
    night: {
      stops: ["#141818", "#1c2020", "#242828"],
      clouds: [
        ["rgba(80,88,88,0.08)", "rgba(80,88,88,0)"],
        ["rgba(80,88,88,0.06)", "rgba(80,88,88,0)"],
        ["rgba(80,88,88,0.05)", "rgba(80,88,88,0)"],
      ],
    },
  },
  particles: {
    colors: ["#c0c8c8", "#d0d8d8", "#e0e4e4"],
    glowColors: ["#d0d8d8", "#e0e8e8", "#f0f2f2"],
    count: 20,
    shape: "wisp",
    direction: "drift",
    depthConfig: {
      near: [50, 20, 12, 6, 8, 5, 0.12, 0.05, 0],
      mid: [35, 15, 16, 8, 6, 4, 0.08, 0.04, 0],
      far: [25, 10, 22, 8, 4, 3, 0.05, 0.03, 0],
    },
    blendMode: "normal",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(0.9) saturate(0.3) hue-rotate(120deg) sepia(0.05) contrast(0.85)",
    night: "brightness(0.45) saturate(0.2) hue-rotate(120deg) sepia(0.05) contrast(0.9)",
  },
  base: { day: "#889090", night: "#141818" },
  grain: { opacity: { day: 0.03, night: 0.05 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   10. VOLCANIC TWILIGHT
   ───────────────────────────────────────────── */

const ember: CanopyTheme = {
  id: "ember",
  name: "Volcanic Twilight",
  dominantColor: "#c83010",
  sky: {
    day: {
      stops: ["#381008", "#501810", "#682818"],
      clouds: [
        ["rgba(200,80,20,0.12)", "rgba(200,80,20,0)"],
        ["rgba(200,80,20,0.10)", "rgba(200,80,20,0)"],
        ["rgba(200,80,20,0.08)", "rgba(200,80,20,0)"],
      ],
    },
    night: {
      stops: ["#100800", "#1c0c04", "#281008"],
      clouds: [
        ["rgba(160,50,10,0.08)", "rgba(160,50,10,0)"],
        ["rgba(160,50,10,0.06)", "rgba(160,50,10,0)"],
        ["rgba(160,50,10,0.05)", "rgba(160,50,10,0)"],
      ],
    },
  },
  particles: {
    colors: ["#ff4010", "#ff6020", "#e03008", "#a8a098"],
    glowColors: ["#ff5020", "#ff7030", "#f04018", "#b8b0a8"],
    count: 45,
    shape: "circle",
    direction: "rise",
    depthConfig: {
      near: [5, 4, 5, 3, 20, 15, 0.6, 0.3, 0],
      mid: [3, 3, 7, 4, 12, 8, 0.4, 0.3, 0],
      far: [1.5, 2, 10, 5, 5, 5, 0.2, 0.2, 1],
    },
    blendMode: "screen",
    layer: "front",
  },
  svgFilter: {
    day: "brightness(0.6) saturate(1.5) hue-rotate(-15deg) sepia(0.3) contrast(1.3)",
    night: "brightness(0.3) saturate(1.2) hue-rotate(-15deg) sepia(0.3) contrast(1.4)",
  },
  base: { day: "#301008", night: "#100800" },
  grain: { opacity: { day: 0.06, night: 0.08 }, blendMode: "overlay" },
};

/* ─────────────────────────────────────────────
   EXPORTS
   ───────────────────────────────────────────── */

export const THEMES: CanopyTheme[] = [
  autumn, winter, cherry, starry, firefly,
  rain, aurora, golden, mist, ember,
];

export const DEFAULT_THEME = autumn;
