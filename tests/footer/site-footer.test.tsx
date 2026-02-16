import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "@/features/footer";

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

vi.mock("@/features/theme", () => ({
    ThemeModeToggle: () => <button type="button">Light Mode</button>,
}));

describe("SiteFooter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders About and Contact links with expected destinations", () => {
        render(<SiteFooter />);

        expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
        expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/contact");
    });

    it("renders the mode toggle in the utility row", () => {
        const { container } = render(<SiteFooter />);

        const utilityRow = container.querySelector(".site-footer__links");
        const modeToggle = screen.getByRole("button", { name: "Light Mode" });

        expect(utilityRow).toContainElement(modeToggle);
    });

    it("renders decorative separators as aria-hidden markers", () => {
        const { container } = render(<SiteFooter />);

        const separators = container.querySelectorAll(
            ".site-footer__separator[aria-hidden='true']"
        );

        expect(separators).toHaveLength(2);
    });

    it("renders primaryAction when provided and omits it by default", () => {
        const { container, rerender } = render(
            <SiteFooter primaryAction={<button type="button">Jump</button>} />
        );

        expect(screen.getByRole("button", { name: "Jump" })).toBeInTheDocument();
        expect(container.querySelector(".site-footer__primary")).toBeInTheDocument();

        rerender(<SiteFooter />);

        expect(screen.queryByRole("button", { name: "Jump" })).toBeNull();
        expect(container.querySelector(".site-footer__primary")).toBeNull();
    });
});
