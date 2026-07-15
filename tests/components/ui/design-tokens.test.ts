import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

function declarations(css: string, name: string) {
    const pattern = new RegExp(`${name}:\\s*([^;]+);`, "g");
    return [...css.matchAll(pattern)].map((match) => match[1].trim());
}

describe("canonical design tokens", () => {
    const colors = read("src/styles/tokens/colors.css");
    const spacing = read("src/styles/tokens/spacing.css");
    const type = read("src/styles/tokens/typography.css");
    const theme = read("src/app/globals.css");
    const layout = read("src/app/layout.tsx");
    const reset = read("src/styles/base/reset.css");
    const gallery = read("src/app/dev/primitives/page.tsx");
    const button = read("src/components/ui/primitives/Button.tsx");
    const input = read("src/components/ui/primitives/Input.tsx");

    it("mirrors every design.md primitive color exactly", () => {
        const expected = {
            "--newsprint-50": "#FBF8F1",
            "--newsprint-100": "#F5F1E8",
            "--newsprint-200": "#EBE4D4",
            "--newsprint-300": "#D9D3C7",
            "--newsprint-400": "#B8B0A0",
            "--ink-900": "#1B1917",
            "--ink-800": "#2B2926",
            "--ink-700": "#3A3834",
            "--ink-600": "#57534E",
            "--ink-500": "#7A756E",
            "--red-800": "#8A0A2E",
            "--red-700": "#A00C36",
            "--red-600": "#B80D3E",
            "--red-500": "#D43256",
            "--red-200": "#E8C3CD",
            "--red-100": "#F4DFE5",
        } as const;

        for (const [name, value] of Object.entries(expected)) {
            expect(declarations(colors, name)[0], name).toBe(value);
        }
    });

    it("keeps legacy OWU names inert and provides dark-safe accent semantics", () => {
        expect(declarations(colors, "--owu-red")).toEqual(["var(--red-600)"]);
        expect(declarations(colors, "--owu-black")).toEqual(["var(--ink-900)"]);
        expect(declarations(colors, "--owu-charcoal")).toEqual(["var(--ink-700)"]);
        expect(declarations(colors, "--owu-white")).toEqual(["var(--newsprint-50)"]);
        expect(declarations(colors, "--color-accent-text")).toEqual([
            "var(--red-600)",
            "var(--red-200)",
        ]);
        expect(declarations(colors, "--color-focus-ring")).toEqual([
            "var(--red-600)",
            "var(--red-200)",
        ]);
    });

    it("locks spacing, radius, and routine shadow mappings", () => {
        const expectedSpacing = [
            "0",
            "0.25rem",
            "0.5rem",
            "0.75rem",
            "1rem",
            "1.5rem",
            "2rem",
            "3rem",
            "4rem",
        ];
        expectedSpacing.forEach((value, index) => {
            expect(declarations(spacing, `--space-${index}`)[0]).toBe(value);
        });
        expect(declarations(spacing, "--radius-none")[0]).toBe("0");
        expect(declarations(spacing, "--radius-sm")[0]).toBe("2px");
        expect(declarations(spacing, "--radius-md")[0]).toBe("3px");
        expect(declarations(spacing, "--radius-full")[0]).toBe("9999px");
        expect(declarations(spacing, "--shadow-default")[0]).toBe("none");
        expect(declarations(spacing, "--shadow-md")[0]).toBe("none");
    });

    it("pairs every type size with its documented line height", () => {
        const expected = {
            xs: "1.35",
            sm: "1.45",
            base: "1.55",
            md: "1.3",
            lg: "1.25",
            xl: "1.15",
            "2xl": "1.1",
            "3xl": "1.1",
        } as const;

        for (const [name, value] of Object.entries(expected)) {
            expect(declarations(type, `--leading-${name}`)[0]).toBe(value);
            expect(theme).toContain(
                `--text-${name}--line-height: var(--leading-${name});`,
            );
        }
        expect(declarations(type, "--tracking-tighter")[0]).toBe(
            "var(--tracking-tight)",
        );
    });

    it("loads only the three canonical families and includes mono semibold", () => {
        expect(type).not.toContain("--font-inter");
        expect(type).not.toContain("--font-ui");
        expect(theme).not.toContain("--font-ui");
        expect(layout).not.toMatch(/\bInter\b/);

        const monoConfig = layout.match(
            /const jetbrainsMono = JetBrains_Mono\(\{([\s\S]*?)\n\}\);/,
        )?.[1];
        expect(monoConfig).toContain('weight: ["400", "500", "600"]');
    });

    it("keeps one primitive geometry contract and a wrapping mobile gallery", () => {
        expect(button).not.toContain("ButtonSize");
        expect(button).not.toMatch(/size\?:\s*["']sm["']/);
        expect(button).toContain('"size-11 shrink-0 p-2"');
        expect(button).toContain('"min-h-11 px-4 py-2"');
        expect(input).not.toMatch(/size\?:\s*["']sm["']/);
        expect(input).toContain('"px-4 py-3 text-base "');
        expect(gallery).toContain(
            'data-testid="button-size-row" className="flex max-w-full flex-wrap',
        );
    });

    it("disables document motion for reduced-motion users", () => {
        expect(reset).toMatch(
            /@media \(prefers-reduced-motion: reduce\)[\s\S]*?html \{[\s\S]*?scroll-behavior: auto;[\s\S]*?body \{[\s\S]*?transition: none;/,
        );
    });
});
