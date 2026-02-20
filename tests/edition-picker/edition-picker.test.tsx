import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
});
