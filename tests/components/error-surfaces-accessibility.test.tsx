import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import GlobalError from "@/src/app/error";
import EditionError from "@/src/app/edition/error";
import { ErrorBoundary } from "@/shared";

function ThrowDuringRender(): React.ReactNode {
    throw new Error("private implementation detail");
}

describe("dynamic error surface accessibility", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("focuses the edition error heading as its single announcement path", async () => {
        const { container } = render(
            <EditionError error={new Error("private detail")} reset={vi.fn()} />,
        );
        const heading = screen.getByRole("heading", {
            level: 1,
            name: "Edition Unavailable",
        });

        await waitFor(() => expect(heading).toHaveFocus());
        expect(heading).toHaveAttribute("tabindex", "-1");
        expect(container.querySelector("[aria-live], [role='alert']")).toBeNull();
        expect(screen.queryByText("private detail")).toBeNull();
    });

    it("focuses the root boundary heading without a competing live region", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { container } = render(
            <ErrorBoundary>
                <ThrowDuringRender />
            </ErrorBoundary>,
        );
        const heading = screen.getByRole("heading", {
            level: 1,
            name: "Something went wrong",
        });

        await waitFor(() => expect(heading).toHaveFocus());
        expect(heading).toHaveAttribute("tabindex", "-1");
        expect(container.querySelector("[aria-live], [role='alert']")).toBeNull();
        expect(screen.queryByText("private implementation detail")).toBeNull();
    });

    it("keeps the global route error generic, focused, and retryable", async () => {
        const reset = vi.fn();
        const { container } = render(
            <GlobalError
                error={new Error("private implementation detail")}
                reset={reset}
            />,
        );
        const heading = screen.getByRole("heading", {
            level: 1,
            name: "Something Went Wrong",
        });

        await waitFor(() => expect(heading).toHaveFocus());
        expect(heading).toHaveAttribute("tabindex", "-1");
        expect(container.querySelector("[aria-live], [role='alert']")).toBeNull();
        expect(screen.queryByText("private implementation detail")).toBeNull();
        screen.getByRole("button", { name: "Try Again" }).click();
        expect(reset).toHaveBeenCalledOnce();
    });
});
