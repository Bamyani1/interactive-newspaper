import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeModeToggle } from "@/features/theme";
import {
    THEME_INITIALIZER_SCRIPT,
    THEME_STORAGE_KEY,
} from "@/features/theme/lib/theme";
import { PageShell } from "@/shared";

describe("theme mode ownership", () => {
    beforeEach(() => {
        window.localStorage.clear();
        document.documentElement.dataset.mode = "light";
    });

    it("initializes html from the saved mode before hydration", () => {
        window.localStorage.setItem(THEME_STORAGE_KEY, "dark");

        window.eval(THEME_INITIALIZER_SCRIPT);

        expect(document.documentElement).toHaveAttribute("data-mode", "dark");
    });

    it("toggles html and storage without changing rendered markup", () => {
        const { container } = render(<ThemeModeToggle iconOnly />);
        const initialMarkup = container.innerHTML;
        const toggle = screen.getByRole("button", { name: "Toggle color theme" });
        expect(toggle.className).toContain("size-11");
        expect(toggle.className).not.toContain("min-w-[40px]");

        fireEvent.click(toggle);

        expect(document.documentElement).toHaveAttribute("data-mode", "dark");
        expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
        expect(container.innerHTML).toBe(initialMarkup);
    });

    it("scopes a forced page mode without mutating the document preference", () => {
        const { container } = render(
            <PageShell forcedMode="dark">Landing</PageShell>,
        );

        expect(container.firstElementChild).toHaveAttribute("data-page-shell");
        expect(container.firstElementChild).toHaveAttribute("data-mode", "dark");
        expect(document.documentElement).toHaveAttribute("data-mode", "light");
    });
});
