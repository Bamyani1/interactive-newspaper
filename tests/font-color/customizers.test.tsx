import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import ColorCustomizer from "../../font-color/components/ColorCustomizer";
import FontCustomizer from "../../font-color/components/FontCustomizer";

vi.mock("next/navigation", () => ({
    usePathname: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);

function setBrandTokenDefaults() {
    document.documentElement.style.setProperty("--owu-red", "#DA0037");
    document.documentElement.style.setProperty("--owu-black", "#15191D");
    document.documentElement.style.setProperty("--owu-charcoal", "#444444");
    document.documentElement.style.setProperty("--owu-white", "#E6E6E6");
}

describe("font-color customizers", () => {
    beforeEach(() => {
        mockedUsePathname.mockReturnValue("/edition/1988-10-12");
        localStorage.clear();
        document.documentElement.classList.remove("light");
        document.documentElement.removeAttribute("style");
        document.body.dataset.mode = "dark";
        setBrandTokenDefaults();
    });

    it("hides both customizers outside /edition routes", () => {
        mockedUsePathname.mockReturnValue("/about");

        render(
            <>
                <ColorCustomizer />
                <FontCustomizer />
            </>
        );

        expect(screen.queryByTitle("Color Customizer")).toBeNull();
        expect(screen.queryByTitle("Font Customizer")).toBeNull();
    });

    it("applies a color preset with dual mode sync and theme-change event", () => {
        const onThemeChange = vi.fn();
        window.addEventListener("theme-change", onThemeChange);

        render(<ColorCustomizer />);

        fireEvent.click(screen.getByTitle("Color Customizer"));
        fireEvent.click(screen.getByTitle("Morning Edition"));

        expect(document.body.dataset.mode).toBe("light");
        expect(document.documentElement.classList.contains("light")).toBe(true);
        expect(localStorage.getItem("transcript-mode")).toBe("light");
        expect(localStorage.getItem("tts-theme")).toBe("light");
        expect(
            document.documentElement.style
                .getPropertyValue("--owu-red")
                .trim()
                .toLowerCase()
        ).toBe("#c71948");
        expect(onThemeChange).toHaveBeenCalledTimes(1);

        window.removeEventListener("theme-change", onThemeChange);
    });

    it("reset removes inline brand overrides and restores dark mode sync", () => {
        render(<ColorCustomizer />);

        fireEvent.click(screen.getByTitle("Color Customizer"));
        fireEvent.click(screen.getByTitle("Morning Edition"));
        fireEvent.click(screen.getByRole("button", { name: "Reset" }));

        expect(document.body.dataset.mode).toBe("dark");
        expect(document.documentElement.classList.contains("light")).toBe(false);
        expect(localStorage.getItem("transcript-mode")).toBe("dark");
        expect(localStorage.getItem("tts-theme")).toBe("dark");
        expect(document.documentElement.style.getPropertyValue("--owu-red")).toBe("");
        expect(document.documentElement.style.getPropertyValue("--owu-black")).toBe("");
        expect(document.documentElement.style.getPropertyValue("--owu-charcoal")).toBe("");
        expect(document.documentElement.style.getPropertyValue("--owu-white")).toBe("");
    });

    it("applies a font preset and persists tts-font-preset", () => {
        render(<FontCustomizer />);

        fireEvent.click(screen.getByTitle("Font Customizer"));
        fireEvent.click(screen.getByRole("button", { name: /Newsroom Classic/i }));

        expect(localStorage.getItem("tts-font-preset")).toBe("newsroom-classic");
        expect(
            document.documentElement.style.getPropertyValue("--font-header").trim()
        ).toContain("Playfair Display");
        expect(
            document.documentElement.style.getPropertyValue("--font-body").trim()
        ).toContain("Source Serif 4");
        expect(
            document.documentElement.style.getPropertyValue("--font-mono").trim()
        ).toContain("Source Sans 3");
    });

    it("customizer-panel-open keeps only one panel open at a time", () => {
        render(
            <>
                <ColorCustomizer />
                <FontCustomizer />
            </>
        );

        fireEvent.click(screen.getByTitle("Color Customizer"));
        expect(screen.getByText("Colors")).toBeDefined();

        fireEvent.click(screen.getByTitle("Font Customizer"));
        expect(screen.queryByText("Colors")).toBeNull();
        expect(screen.getByText("Fonts")).toBeDefined();
    });

    it("applies one new dark preset and one new bright preset", () => {
        render(<ColorCustomizer />);

        fireEvent.click(screen.getByTitle("Color Customizer"));
        fireEvent.click(screen.getByTitle("Copper Broadsheet"));

        expect(document.body.dataset.mode).toBe("dark");
        expect(
            document.documentElement.style.getPropertyValue("--owu-red").trim().toLowerCase()
        ).toBe("#b7602d");

        fireEvent.click(screen.getByTitle("Amber Parchment"));

        expect(document.body.dataset.mode).toBe("light");
        expect(
            document.documentElement.style.getPropertyValue("--owu-red").trim().toLowerCase()
        ).toBe("#92400e");
    });

    it("persists preset ID to localStorage and clears on reset", () => {
        render(<ColorCustomizer />);

        fireEvent.click(screen.getByTitle("Color Customizer"));
        fireEvent.click(screen.getByTitle("Morning Edition"));

        expect(localStorage.getItem("tts-color-preset")).toBe("morning-edition");

        fireEvent.click(screen.getByRole("button", { name: "Reset" }));

        expect(localStorage.getItem("tts-color-preset")).toBeNull();
    });
});
