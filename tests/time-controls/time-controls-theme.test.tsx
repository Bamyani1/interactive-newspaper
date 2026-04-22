import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { usePathname, useRouter } from "next/navigation";
import { useArchive } from "@/features/archive";
import { TimeControls } from "@/features/time-controls";

vi.mock("next/navigation", () => ({
    usePathname: vi.fn(),
    useRouter: vi.fn(),
}));

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

vi.mock("@/features/archive", () => ({
    useArchive: vi.fn(),
}));

const mockedUsePathname = vi.mocked(usePathname);
const mockedUseRouter = vi.mocked(useRouter);
const mockedUseArchive = vi.mocked(useArchive);

describe("TimeControls theme tokens", () => {
    let pushSpy: ReturnType<typeof vi.fn>;
    let setDateSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        pushSpy = vi.fn();
        setDateSpy = vi.fn();

        mockedUsePathname.mockReturnValue("/edition/1988-10-12");
        mockedUseRouter.mockReturnValue({
            push: pushSpy,
        } as ReturnType<typeof useRouter>);

        mockedUseArchive.mockReturnValue({
            currentDate: "1988-10-12",
            setDate: setDateSpy,
            editions: ["1988-10-12", "1988-10-05"],
            editionInfo: [],
            hasEditions: true,
        });
    });

    it("uses semantic mode-aware tokens for the header surface and interactions", () => {
        const { container } = render(<TimeControls />);

        const header = container.querySelector("header");
        expect(header).toBeDefined();

        const headerClass = header?.getAttribute("class") ?? "";
        expect(headerClass).toContain("text-[var(--color-text-header)]");
        expect(headerClass).toContain("time-controls-header");
        expect(headerClass).not.toContain("bg-[var(--color-accent)]/25");
        expect(headerClass).not.toContain("text-[var(--owu-white)]");
        expect(headerClass).not.toContain("bg-[var(--owu-red)]/25");

        // Border token is applied via .time-controls-header CSS class, not inline style
        expect(headerClass).toContain("time-controls-header");

        const homeLink = screen.getByRole("link", { name: "Return to landing page" });
        const homeLinkClass = homeLink.getAttribute("class") ?? "";
        expect(homeLinkClass).toContain("hover:text-[var(--color-accent)]");

        const dateButton = screen.getByRole("button", { name: "Select edition date" });
        const dateButtonClass = dateButton.getAttribute("class") ?? "";
        expect(dateButtonClass).toContain("hover:bg-[var(--color-accent)]/8");
        expect(dateButtonClass).toContain("focus-visible:outline-[var(--color-focus-ring)]");
        expect(dateButtonClass).not.toContain("var(--owu-white)");
    });

    it("keeps dropdown behavior intact with edition selection", () => {
        render(<TimeControls />);

        const dateButton = screen.getByRole("button", { name: "Select edition date" });
        fireEvent.click(dateButton);

        const listbox = screen.getByRole("listbox", { name: "Available editions" });
        const options = within(listbox).getAllByRole("option");

        fireEvent.click(options[0]);

        expect(setDateSpy).toHaveBeenCalledWith("1988-10-05");
        expect(pushSpy).toHaveBeenCalledWith("/edition/1988-10-05");
    });
});
