import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MobileNav } from "@/features/navigation/components/MobileNav";
import type { SectionId } from "@/src/types";

vi.mock("next/navigation", () => ({
    usePathname: () => "/edition/1988-10-12",
}));

const sections = [
    { id: "Top" as SectionId, label: "Top" },
    { id: "Campus News" as SectionId, label: "Campus News" },
    { id: "Sports" as SectionId, label: "Sports" },
    { id: "Opinion" as SectionId, label: "Opinion" },
    { id: "Arts & Entertainment" as SectionId, label: "Arts" },
    { id: "Ads" as SectionId, label: "Ads" },
];

describe("MobileNav More menu", () => {
    it("exposes a menu and supports arrow/Home/End navigation", async () => {
        render(
            <MobileNav
                sections={sections}
                activeSection="Top"
                onSelect={vi.fn()}
            />,
        );
        const trigger = screen.getByRole("button", { name: "More sections" });
        expect(trigger.className).toContain("rounded-sm");
        expect(trigger.className).not.toContain("rounded-lg");
        for (const link of [
            screen.getByRole("link", { name: "Search the archive" }),
            screen.getByRole("link", { name: "Ask the archive" }),
        ]) {
            expect(link.className).toContain("rounded-sm");
            expect(link.className).not.toContain("rounded-lg");
        }
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        const menu = await screen.findByRole("menu", { name: "More sections" });
        expect(menu.className).toContain("rounded-sm");
        expect(menu.className).not.toContain("rounded-lg");
        const items = within(menu).getAllByRole("menuitem");
        await waitFor(() => expect(items[0]).toHaveFocus());
        fireEvent.keyDown(items[0], { key: "End" });
        expect(items[items.length - 1]).toHaveFocus();
        fireEvent.keyDown(items[items.length - 1], { key: "Home" });
        expect(items[0]).toHaveFocus();
    });

    it("returns focus to More after Escape and selection", async () => {
        const onSelect = vi.fn();
        render(
            <MobileNav
                sections={sections}
                activeSection="Top"
                onSelect={onSelect}
            />,
        );
        const trigger = screen.getByRole("button", { name: "More sections" });
        fireEvent.click(trigger);
        const menu = await screen.findByRole("menu", { name: "More sections" });
        const first = within(menu).getAllByRole("menuitem")[0];
        await waitFor(() => expect(first).toHaveFocus());

        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(trigger).toHaveFocus());
        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

        fireEvent.click(trigger);
        const reopened = await screen.findByRole("menu", { name: "More sections" });
        const option = within(reopened).getAllByRole("menuitem")[0];
        fireEvent.click(option);
        expect(onSelect).toHaveBeenCalled();
        await waitFor(() => expect(trigger).toHaveFocus());
    });

    it("waits for Tab focus traversal before closing the menu", async () => {
        render(
            <>
                <MobileNav
                    sections={sections}
                    activeSection="Top"
                    onSelect={vi.fn()}
                />
                <button type="button">After mobile navigation</button>
            </>,
        );
        fireEvent.click(screen.getByRole("button", { name: "More sections" }));
        const item = within(
            await screen.findByRole("menu", { name: "More sections" }),
        ).getAllByRole("menuitem")[0];
        await waitFor(() => expect(item).toHaveFocus());

        fireEvent.keyDown(item, { key: "Tab" });
        expect(item).toBeInTheDocument();
        const after = screen.getByRole("button", {
            name: "After mobile navigation",
        });
        act(() => after.focus());

        expect(after).toHaveFocus();
        await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    });
});
