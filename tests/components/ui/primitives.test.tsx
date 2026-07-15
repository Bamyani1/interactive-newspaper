import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
    Button,
    Card,
    Input,
    Label,
    ProseCodeBlock,
} from "@/shared/ui/primitives";

describe("design-system primitives", () => {
    it("keeps button text and pointer targets accessible", () => {
        render(<Button>Read edition</Button>);

        const button = screen.getByRole("button", { name: "Read edition" });
        expect(button).toHaveAttribute("type", "button");
        expect(button.className).toContain("min-h-11");
        expect(button.className).toContain("text-xs");
        expect(button.className).toContain("tracking-label-md");
        expect(button.className).not.toContain("0.6875rem");
        expect(button.className).toContain("rounded-sm");
        expect(button.className).toContain("focus-visible:outline-2");
        expect(button.className).toContain(
            "focus-visible:outline-[var(--color-focus-ring)]",
        );
        expect(button.className).toContain("motion-reduce:transition-none");
    });

    it("makes icon buttons exactly 44px square without generic padding", () => {
        render(<Button variant="icon" aria-label="Open menu">☰</Button>);

        const button = screen.getByRole("button", { name: "Open menu" });
        expect(button.className).toContain("size-11");
        expect(button.className).toContain("p-2");
        expect(button.className).not.toContain("min-h-11");
        expect(button.className).not.toContain("px-4");
        expect(button.className).not.toContain("py-2");
    });

    it("uses dark-safe semantic colors for accent controls", () => {
        render(
            <>
                <Button variant="accent">Ask</Button>
                <Button variant="link" as="a" href="/about">About</Button>
                <Label tone="accent">Archive label</Label>
            </>,
        );

        expect(screen.getByRole("button", { name: "Ask" }).className).toContain(
            "text-[var(--color-text-on-accent)]",
        );
        expect(screen.getByRole("link", { name: "About" }).className).toContain(
            "text-[var(--color-accent-text)]",
        );
        expect(screen.getByText("Archive label").className).toContain(
            "text-[var(--color-accent-text)]",
        );
    });

    it("keeps every label size at the 12px floor", () => {
        const { container } = render(
            <>
                <Label size="xs">Extra small</Label>
                <Label size="sm">Small</Label>
                <Label size="md">Medium</Label>
            </>,
        );

        for (const label of container.querySelectorAll("span")) {
            expect(label.className).toContain("text-xs");
            expect(label.className).not.toMatch(/0\.6875rem|text-\[11px\]/);
        }
    });

    it("applies canonical input, invalid, and card contracts", () => {
        render(
            <>
                <Input aria-label="Question" invalid />
                <Card>Story</Card>
            </>,
        );

        const input = screen.getByRole("textbox", { name: "Question" });
        expect(input).toHaveAttribute("aria-invalid", "true");
        expect(input.className).toContain("min-h-11");
        expect(input.className).toContain("px-4");
        expect(input.className).toContain("py-3");
        expect(input.className).toContain("text-base");
        expect(input.className).toContain("border-[var(--color-warning)]");
        expect(input.className).toContain(
            "focus-visible:outline-[var(--color-focus-ring)]",
        );

        const card = screen.getByText("Story");
        expect(card.className).toContain("p-5");
        expect(card.className).toContain("rounded-none");
    });

    it("makes horizontally scrollable prose code keyboard reachable", () => {
        const { container } = render(
            <ProseCodeBlock>
                <code>const edition = await getEdition();</code>
            </ProseCodeBlock>,
        );

        const codeBlock = container.querySelector("pre");
        expect(codeBlock).toHaveAttribute("tabindex", "0");
        codeBlock?.focus();
        expect(codeBlock).toHaveFocus();
    });
});
