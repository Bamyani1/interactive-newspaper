export interface FontPreset {
    id: string;
    name: string;
    nameEn: string;
    fonts: {
        "--font-header": string;
        "--font-body": string;
        "--font-masthead": string;
        "--font-mono": string;
        "--font-accent": string;
    };
    googleFontsToLoad: string[];
}

export const DEFAULT_FONTS = {
    "--font-header": '"Playfair Display", serif',
    "--font-body": '"Source Serif 4", serif',
    "--font-masthead": '"Playfair Display", serif',
    "--font-mono": '"JetBrains Mono", ui-monospace, monospace',
    "--font-accent": '"Playfair Display", serif',
} as const;

export const FONT_PRESETS: FontPreset[] = [
    {
        id: "owu-default",
        name: "OWU Default",
        nameEn: "OWU Default",
        fonts: {
            "--font-header": '"Playfair Display", serif',
            "--font-body": '"Source Serif 4", serif',
            "--font-masthead": '"Playfair Display", serif',
            "--font-mono": '"JetBrains Mono", ui-monospace, monospace',
            "--font-accent": '"Playfair Display", serif',
        },
        googleFontsToLoad: [],
    },
    {
        id: "newsroom-classic",
        name: "Newsroom Classic",
        nameEn: "Newsroom Classic",
        fonts: {
            "--font-header": '"Playfair Display", serif',
            "--font-body": '"Source Serif 4", serif',
            "--font-masthead": '"Playfair Display", serif',
            "--font-mono": '"Source Sans 3", sans-serif',
            "--font-accent": '"Playfair Display", serif',
        },
        googleFontsToLoad: ["Playfair Display", "Source Serif 4", "Source Sans 3"],
    },
    {
        id: "broadsheet-modern",
        name: "Broadsheet Modern",
        nameEn: "Broadsheet Modern",
        fonts: {
            "--font-header": '"Bodoni Moda", serif',
            "--font-body": '"Literata", serif',
            "--font-masthead": '"Bodoni Moda", serif',
            "--font-mono": '"IBM Plex Sans", sans-serif',
            "--font-accent": '"Bodoni Moda", serif',
        },
        googleFontsToLoad: ["Bodoni Moda", "Literata", "IBM Plex Sans"],
    },
    {
        id: "campus-ledger",
        name: "Campus Ledger",
        nameEn: "Campus Ledger",
        fonts: {
            "--font-header": '"Merriweather", serif',
            "--font-body": '"Lora", serif',
            "--font-masthead": '"Merriweather", serif',
            "--font-mono": '"Work Sans", sans-serif',
            "--font-accent": '"Merriweather", serif',
        },
        googleFontsToLoad: ["Merriweather", "Lora", "Work Sans"],
    },
    {
        id: "review-desk",
        name: "Review Desk",
        nameEn: "Review Desk",
        fonts: {
            "--font-header": '"Cormorant Garamond", serif',
            "--font-body": '"Spectral", serif',
            "--font-masthead": '"Cormorant Garamond", serif',
            "--font-mono": '"IBM Plex Sans", sans-serif',
            "--font-accent": '"Cormorant Garamond", serif',
        },
        googleFontsToLoad: ["Cormorant Garamond", "Spectral", "IBM Plex Sans"],
    },
];
