import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    let prefetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        pushSpy = vi.fn();
        prefetchSpy = vi.fn();

        mockedUsePathname.mockReturnValue("/edition/1988-10-12");
        mockedUseRouter.mockReturnValue({
            push: pushSpy,
            prefetch: prefetchSpy,
        } as ReturnType<typeof useRouter>);

        mockedUseArchive.mockReturnValue({
            editions: ["1988-10-05", "1988-10-12"],
            hasEditions: true,
        });
    });

    it("uses semantic mode-aware tokens for the header surface and interactions", () => {
        const { container } = render(<TimeControls currentDate="1988-10-12" />);

        const header = container.querySelector("header");
        expect(header).toBeDefined();
        expect(within(header!).queryByRole("heading", { level: 1 })).toBeNull();

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
        expect(homeLinkClass).toContain("min-h-[44px]");
        expect(homeLinkClass).toContain("hover:text-[var(--color-accent-text)]");

        const dateButton = screen.getByRole("button", { name: "Select edition date" });
        const dateButtonClass = dateButton.getAttribute("class") ?? "";
        expect(dateButtonClass).toContain("hover:bg-[var(--color-accent)]/8");
        expect(dateButtonClass).toContain("focus-visible:outline-[var(--color-focus-ring)]");
        expect(dateButtonClass).not.toContain("var(--owu-white)");
    });

    it("keeps dropdown behavior intact with edition selection", () => {
        render(<TimeControls currentDate="1988-10-12" />);

        const dateButton = screen.getByRole("button", { name: "Select edition date" });
        fireEvent.click(dateButton);

        const listbox = screen.getByRole("listbox", { name: "Available editions" });
        const options = within(listbox).getAllByRole("option");

        fireEvent.click(options[0]);

        expect(pushSpy).toHaveBeenCalledWith("/edition/1988-10-05");
        expect(prefetchSpy).toHaveBeenCalledWith("/edition/1988-10-05");
    });

    it("renders the latest date synchronously and navigates from a general route", () => {
        mockedUsePathname.mockReturnValue("/about");
        render(<TimeControls />);

        expect(screen.getByText("Oct 12, 1988")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Select edition date" }));
        const listbox = screen.getByRole("listbox", { name: "Available editions" });
        fireEvent.click(within(listbox).getAllByRole("option")[1]);

        expect(pushSpy).toHaveBeenCalledWith("/edition/1988-10-12");
    });

    it("supports roving listbox focus and restores the trigger on Escape", async () => {
        render(<TimeControls currentDate="1988-10-12" />);
        const trigger = screen.getByRole("button", {
            name: "Select edition date",
        });
        trigger.focus();
        fireEvent.keyDown(trigger, { key: "ArrowDown" });

        const options = within(
            screen.getByRole("listbox", { name: "Available editions" }),
        ).getAllByRole("option");
        await waitFor(() => expect(options[0]).toHaveFocus());
        fireEvent.keyDown(options[0], { key: "End" });
        expect(options[options.length - 1]).toHaveFocus();
        fireEvent.keyDown(document, { key: "Escape" });
        await waitFor(() => expect(trigger).toHaveFocus());
        await waitFor(() =>
            expect(
                screen.queryByRole("listbox", { name: "Available editions" }),
            ).toBeNull(),
        );
    });

    it("keeps the focused option mounted until Tab moves focus outside", async () => {
        render(
            <>
                <TimeControls currentDate="1988-10-12" />
                <button type="button">After header</button>
            </>,
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Select edition date" }),
        );
        const option = within(
            screen.getByRole("listbox", { name: "Available editions" }),
        ).getAllByRole("option")[1];
        await waitFor(() => expect(option).toHaveFocus());

        fireEvent.keyDown(option, { key: "Tab" });
        expect(option).toBeInTheDocument();
        const after = screen.getByRole("button", { name: "After header" });
        act(() => after.focus());

        expect(after).toHaveFocus();
        await waitFor(() =>
            expect(
                screen.queryByRole("listbox", { name: "Available editions" }),
            ).toBeNull(),
        );
    });
});
