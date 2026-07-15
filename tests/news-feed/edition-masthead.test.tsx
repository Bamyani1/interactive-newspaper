import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EditionMasthead } from "@/features/news-feed/components/EditionMasthead";

describe("EditionMasthead", () => {
    it("uses contrast-safe semantic metadata for the gold edition volume", () => {
        render(
            <EditionMasthead
                editionHeaderDate="January 13, 1960"
                publicationInfo="Ohio Wesleyan Transcript Vol. 93 — No. 13 DELAWARE, OHIO"
            />,
        );

        const volume = screen.getByText("Vol. 93 · No. 13");
        expect(volume.className).toContain(
            "text-[var(--color-text-secondary)]",
        );
        expect(volume.className).not.toContain("opacity-60");
    });
});
