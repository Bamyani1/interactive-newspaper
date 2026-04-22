export interface ColorPreset {
    id: string;
    name: string;
    category: string;
    mode: "dark" | "light";
    colors: {
        "--owu-red": string;
        "--owu-black": string;
        "--owu-charcoal": string;
        "--owu-white": string;
    };
}

export const PRESET_STORAGE_KEY = "tts-color-preset";

// Direction A (Faithful) — the canonical defaults per /design.md.
// Other presets below remain user-selectable variants.
export const DEFAULT_LIGHT_TOKENS: ColorPreset["colors"] = {
    "--owu-red": "#B80D3E",
    "--owu-black": "#1B1917",
    "--owu-charcoal": "#3A3834",
    "--owu-white": "#FBF8F1",
};

export const DEFAULT_DARK_TOKENS: ColorPreset["colors"] = {
    "--owu-red": "#B80D3E",
    "--owu-black": "#1B1917",
    "--owu-charcoal": "#3A3834",
    "--owu-white": "#FBF8F1",
};

export const PRESET_CATEGORIES = ["Broadsheet Dark", "Broadsheet Light"] as const;

export const PRESETS: ColorPreset[] = [
    // ── Broadsheet Dark (10) ──
    {
        id: "steel-deadline",
        name: "Steel Deadline",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#B80D3E",
            "--owu-black": "#1A1F24",
            "--owu-charcoal": "#4C5158",
            "--owu-white": "#E8E8E8",
        },
    },
    {
        id: "pressroom-graphite",
        name: "Pressroom Graphite",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#C8103A",
            "--owu-black": "#101316",
            "--owu-charcoal": "#3A3F44",
            "--owu-white": "#E3E1DD",
        },
    },
    {
        id: "night-ink",
        name: "Night Ink",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#DA0037",
            "--owu-black": "#15191D",
            "--owu-charcoal": "#444444",
            "--owu-white": "#E6E6E6",
        },
    },
    {
        id: "archive-brick",
        name: "Archive Brick",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#A91B32",
            "--owu-black": "#1C1614",
            "--owu-charcoal": "#4F4641",
            "--owu-white": "#EFE6D8",
        },
    },
    {
        id: "copper-broadsheet",
        name: "Copper Broadsheet",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#B7602D",
            "--owu-black": "#1B1714",
            "--owu-charcoal": "#4E453E",
            "--owu-white": "#ECE4DA",
        },
    },
    {
        id: "oxblood-press",
        name: "Oxblood Press",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#8B1A2B",
            "--owu-black": "#181214",
            "--owu-charcoal": "#46393C",
            "--owu-white": "#E8E0DE",
        },
    },
    {
        id: "midnight-gazette",
        name: "Midnight Gazette",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#C43048",
            "--owu-black": "#121620",
            "--owu-charcoal": "#3C4254",
            "--owu-white": "#E6E8EE",
        },
    },
    {
        id: "charcoal-dispatch",
        name: "Charcoal Dispatch",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#B52840",
            "--owu-black": "#1E1E1E",
            "--owu-charcoal": "#525252",
            "--owu-white": "#E5E5E5",
        },
    },
    {
        id: "iron-editorial",
        name: "Iron Editorial",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#9E2A3C",
            "--owu-black": "#161A1E",
            "--owu-charcoal": "#434A52",
            "--owu-white": "#E0E2E6",
        },
    },
    {
        id: "warm-lead",
        name: "Warm Lead",
        category: "Broadsheet Dark",
        mode: "dark",
        colors: {
            "--owu-red": "#C25535",
            "--owu-black": "#1A1612",
            "--owu-charcoal": "#4D443C",
            "--owu-white": "#EDE6DC",
        },
    },

    // ── Broadsheet Light (10) ──
    {
        id: "amber-parchment",
        name: "Amber Parchment",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#92400E",
            "--owu-black": "#3D2209",
            "--owu-charcoal": "#8B7355",
            "--owu-white": "#FEF3C7",
        },
    },
    {
        id: "morning-edition",
        name: "Morning Edition",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#C71948",
            "--owu-black": "#1E2023",
            "--owu-charcoal": "#585B5F",
            "--owu-white": "#F4EFE7",
        },
    },
    {
        id: "sepia-ledger",
        name: "Sepia Ledger",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#AF2A3D",
            "--owu-black": "#241E1A",
            "--owu-charcoal": "#675A50",
            "--owu-white": "#F3E8D6",
        },
    },
    {
        id: "cream-bulletin",
        name: "Cream Bulletin",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#BE233F",
            "--owu-black": "#202226",
            "--owu-charcoal": "#5A5D61",
            "--owu-white": "#F6F1E8",
        },
    },
    {
        id: "campus-poster",
        name: "Campus Poster",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#D02B45",
            "--owu-black": "#1A1D22",
            "--owu-charcoal": "#52565D",
            "--owu-white": "#F2F0EE",
        },
    },
    {
        id: "wheat-gazette",
        name: "Wheat Gazette",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#9A5B2F",
            "--owu-black": "#2C1E12",
            "--owu-charcoal": "#7A6448",
            "--owu-white": "#F5ECD8",
        },
    },
    {
        id: "ivory-press",
        name: "Ivory Press",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#B83040",
            "--owu-black": "#1C1F24",
            "--owu-charcoal": "#5C6068",
            "--owu-white": "#F8F6F2",
        },
    },
    {
        id: "rust-folio",
        name: "Rust Folio",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#A84420",
            "--owu-black": "#2A1C12",
            "--owu-charcoal": "#715840",
            "--owu-white": "#F4EAD8",
        },
    },
    {
        id: "linen-chronicle",
        name: "Linen Chronicle",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#B5384A",
            "--owu-black": "#22201E",
            "--owu-charcoal": "#605C58",
            "--owu-white": "#F6F3EE",
        },
    },
    {
        id: "cedar-journal",
        name: "Cedar Journal",
        category: "Broadsheet Light",
        mode: "light",
        colors: {
            "--owu-red": "#8C4A28",
            "--owu-black": "#261A10",
            "--owu-charcoal": "#6D5A42",
            "--owu-white": "#F2E8D4",
        },
    },
];
