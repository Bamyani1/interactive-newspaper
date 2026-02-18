import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditionPicker } from "../../src/components/landing/EditionPicker";

const EDITIONS = ["1986-09-12", "1987-04-08", "1988-10-12"];

describe("EditionPicker", () => {
    it("renders decade list by default", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        expect(screen.getByText("Select an Edition")).toBeInTheDocument();
        expect(screen.getByText("1980s")).toBeInTheDocument();
    });

    it("shows edition list and hides decade list when decade is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("1980s"));

        // Decade heading and decade card should be gone
        expect(screen.queryByText("Select an Edition")).not.toBeInTheDocument();

        // Back button with decade label should appear
        expect(screen.getByLabelText("Back to decade list")).toBeInTheDocument();

        // Edition dates should appear
        expect(screen.getByText(/Sep 12, 1986/)).toBeInTheDocument();
        expect(screen.getByText(/Oct 12, 1988/)).toBeInTheDocument();
    });

    it("returns to decade list when back button is clicked", () => {
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={vi.fn()} />
        );
        fireEvent.click(screen.getByText("1980s"));
        fireEvent.click(screen.getByLabelText("Back to decade list"));

        expect(screen.getByText("Select an Edition")).toBeInTheDocument();
        expect(screen.getByText("1980s")).toBeInTheDocument();
    });

    it("calls onOpenChange(true) when decade is clicked", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("1980s"));
        expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("calls onOpenChange(false) when back button is clicked", () => {
        const onOpenChange = vi.fn();
        render(
            <EditionPicker
                editions={EDITIONS}
                selectedEdition={null}
                onSelect={vi.fn()}
                onOpenChange={onOpenChange}
            />
        );
        fireEvent.click(screen.getByText("1980s"));
        onOpenChange.mockClear();

        fireEvent.click(screen.getByLabelText("Back to decade list"));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("calls onSelect when an edition is clicked", () => {
        const onSelect = vi.fn();
        render(
            <EditionPicker editions={EDITIONS} selectedEdition={null} onSelect={onSelect} />
        );
        fireEvent.click(screen.getByText("1980s"));
        fireEvent.click(screen.getByText(/Sep 12, 1986/));
        expect(onSelect).toHaveBeenCalledWith("1986-09-12");
    });
});
