import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");

const styleFiles = [
    "landing.css",
    "layout.css",
    "caveat.css",
    "transcript.css",
    "sources.css",
    "photos.css",
    "markdown-prose.css",
    "composer.css",
    "typing-cursor.css",
].map((file) =>
    read(`src/styles/components/ask-archive/${file}`),
);

function rule(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    expect(match, `Missing CSS rule for ${selector}`).not.toBeNull();
    return match?.[1] ?? "";
}

describe("Ask accessibility style contracts", () => {
    const [landing, layout, caveat, transcript, sources, photos, markdown] =
        styleFiles;

    it("keeps every literal rem size in the reachable Ask surfaces at 12px or larger", () => {
        for (const css of styleFiles) {
            for (const match of css.matchAll(/font-size:\s*([\d.]+)rem/g)) {
                expect(
                    Number(match[1]),
                    `Sub-12px declaration: ${match[0]}`,
                ).toBeGreaterThanOrEqual(0.75);
            }
        }
    });

    it("maps compact labels, captions, badges, and stats to the 12px token", () => {
        const contracts: Array<[string, string, string]> = [
            [landing, ".ask-landing-suggestions-label", "landing suggestions"],
            [landing, ".ask-landing-stats", "landing stats"],
            [layout, ".ask-mobile-action", "mobile actions"],
            [layout, ".ask-export-kicker", "export kicker"],
            [caveat, ".ask-caveat-label", "caveat label"],
            [transcript, ".ask-turn-user-label", "question label"],
            [transcript, ".ask-turn-assistant-label", "answer label"],
            [transcript, ".ask-followups-label", "follow-up label"],
            [transcript, ".ask-error-inline-label", "error label"],
            [sources, ".ask-source-card-meta", "source metadata"],
            [sources, ".ask-source-card-hint", "source hint"],
            [sources, ".ask-source-thumb-count", "source image badge"],
            [sources, ".ask-source-toggle", "source disclosure"],
            [photos, ".ask-photos-panel-label", "photos label"],
            [photos, ".ask-photos-panel-overflow", "photos overflow"],
            [photos, ".ask-photos-tile-caption", "photo caption"],
            [photos, ".ask-photos-tile-attr", "photo attribution"],
            [markdown, ".ask-answer-image-attr", "answer image attribution"],
        ];

        for (const [css, selector, label] of contracts) {
            expect(rule(css, selector), label).toContain(
                "font-size: var(--text-xs);",
            );
        }
    });

    it("keeps disclosures and follow-up actions at least 44px tall", () => {
        expect(rule(sources, ".ask-source-toggle")).toContain(
            "min-height: 44px;",
        );
        expect(rule(transcript, ".ask-example-chip")).toContain(
            "min-height: 44px;",
        );
    });

    it("does not dilute source date or source number contrast with opacity", () => {
        expect(rule(sources, ".ask-source-card-date")).not.toContain(
            "opacity:",
        );
        expect(rule(sources, ".ask-source-card-num")).not.toContain(
            "opacity:",
        );
    });
});
