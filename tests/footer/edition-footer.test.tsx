import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditionFooter } from "@/features/news-feed/components/EditionFooter";

vi.mock("next/link", () => ({
    default: ({
        children,
        href,
        ...props
    }: React.PropsWithChildren<{ href: string }>) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

describe("EditionFooter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders shared footer links", () => {
        render(
            <EditionFooter
                onNextEdition={vi.fn()}
                canGoToNextEdition
            />
        );

        expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
        expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    });

    it("renders and wires the See Next Edition button", () => {
        const onNextEdition = vi.fn();
        render(
            <EditionFooter
                onNextEdition={onNextEdition}
                canGoToNextEdition
            />
        );

        const button = screen.getByRole("button", { name: "See Next Edition" });
        expect(button).toBeEnabled();
        expect(button.closest(".site-footer__primary")).not.toBeNull();

        fireEvent.click(button);
        expect(onNextEdition).toHaveBeenCalledTimes(1);
    });

    it("disables button when next edition is unavailable", () => {
        render(
            <EditionFooter
                onNextEdition={vi.fn()}
                canGoToNextEdition={false}
            />
        );

        expect(screen.getByRole("button", { name: "See Next Edition" })).toBeDisabled();
    });

    it("still renders semantic footer landmark", () => {
        const { container } = render(
            <EditionFooter
                onNextEdition={vi.fn()}
                canGoToNextEdition
            />
        );
        expect(container.querySelector("footer")).toBeInTheDocument();
    });
});
