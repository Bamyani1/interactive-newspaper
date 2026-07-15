import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditionPicker } from "../../src/components/landing/EditionPicker";

const EDITIONS = ["1986-09-12", "1987-04-08", "1988-10-12"];

describe("EditionPicker", () => {
    it("renders closed with Pick Edition button by default", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        expect(screen.getByText("Pick Edition")).toBeInTheDocument();
        // Decade tabs should not be visible when closed
        expect(screen.queryByText("1980s")).not.toBeInTheDocument();
    });

    it("opens to show decade tabs and edition list when Pick Edition is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("Pick Edition"));

        // Pick Edition button should be gone, decade tab should appear
        expect(screen.queryByText("Pick Edition")).not.toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "1980s" })).toBeInTheDocument();

        // Edition dates should appear
        expect(screen.getByText(/Sep 12, 1986/)).toBeInTheDocument();
        expect(screen.getByText(/Oct 12, 1988/)).toBeInTheDocument();
    });

    it("returns to closed state when close button is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("Pick Edition"));
        fireEvent.click(screen.getByText(/Close/));

        expect(screen.getByText("Pick Edition")).toBeInTheDocument();
        expect(screen.queryByRole("tab", { name: "1980s" })).not.toBeInTheDocument();
    });

    it("calls onOpenChange(true) when picker is opened", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("Pick Edition"));
        expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange(false) when close button is clicked", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("Pick Edition"));
        onOpenChange.mockClear();

        fireEvent.click(screen.getByText(/Close/));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("calls onSelect when an edition is clicked", () => {
        const onSelect = vi.fn();
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={onSelect} />
        );
        fireEvent.click(screen.getByText("Pick Edition"));
        fireEvent.click(screen.getByText(/Sep 12, 1986/));
        expect(onSelect).toHaveBeenCalledWith("1986-09-12");
    });

    it("implements arrow/Home/End navigation for tabs and listbox options", async () => {
        render(
            <EditionPicker
                editions={["1978-02-03", ...EDITIONS]}
                selectedEdition="1978-02-03"
                onSelect={vi.fn()}
            />,
        );
        const trigger = screen.getByRole("button", {
            name: /selected edition/i,
        });
        fireEvent.click(trigger);

        const seventies = screen.getByRole("tab", { name: "1970s" });
        await waitFor(() => expect(seventies).toHaveFocus());
        fireEvent.keyDown(seventies, { key: "ArrowRight" });

        const eighties = screen.getByRole("tab", { name: "1980s" });
        expect(eighties).toHaveFocus();
        expect(eighties).toHaveAttribute("aria-selected", "true");

        const panel = screen.getByRole("tabpanel", { name: "1980s" });
        expect(eighties).toHaveAttribute("aria-controls", panel.id);
        expect(panel).toHaveAttribute("aria-labelledby", eighties.id);
        expect(
            document.getElementById(
                screen.getByRole("tab", { name: "1970s" }).getAttribute("aria-controls")!,
            ),
        ).toHaveAttribute("hidden");

        const listbox = screen.getByRole("listbox", {
            name: "Editions from the 1980s",
        });
        const options = screen.getAllByRole("option");
        act(() => options[0].focus());
        fireEvent.keyDown(options[0], { key: "End" });
        expect(options[options.length - 1]).toHaveFocus();
        fireEvent.keyDown(options[options.length - 1], { key: "Home" });
        expect(options[0]).toHaveFocus();
        expect(listbox).toContainElement(options[0]);
    });

    it("returns focus to the closed trigger after Escape", async () => {
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={EDITIONS[0]}
                onSelect={vi.fn()}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: /selected edition/i }),
        );
        fireEvent.keyDown(screen.getByRole("tab", { name: "1980s" }), {
            key: "Escape",
        });

        const trigger = await screen.findByRole("button", {
            name: /selected edition/i,
        });
        await waitFor(() => expect(trigger).toHaveFocus());
    });
});
