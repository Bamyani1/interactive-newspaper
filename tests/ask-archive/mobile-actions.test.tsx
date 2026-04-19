/**
 * AskMobileActions — rendered above the transcript on < 1024px
 * viewports to surface the three sidebar actions (New / Clear /
 * Export) that the hidden sidebar would otherwise carry. All three
 * buttons are keyboard- and AT-reachable and respect the same
 * can*-gating that the desktop sidebar does.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskMobileActions } from "@/features/ask-archive/components/AskMobileActions";

describe("AskMobileActions", () => {
    const baseProps = {
        onNewConversation: vi.fn(),
        onClearConversation: vi.fn(),
        onExportConversation: vi.fn(),
        canNewConversation: true,
        canClearConversation: true,
        canExportConversation: true,
    };

    it("renders New / Clear / Export buttons with accessible names", () => {
        render(<AskMobileActions {...baseProps} />);
        expect(
            screen.getByRole("button", { name: /start a new conversation/i }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: /clear the current thread/i,
            }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", {
                name: /export the conversation as a pdf/i,
            }),
        ).toBeInTheDocument();
    });

    it("wires disabled state from the can* props", () => {
        render(
            <AskMobileActions
                {...baseProps}
                canNewConversation={false}
                canClearConversation={false}
                canExportConversation={false}
            />,
        );
        expect(
            screen.getByRole("button", { name: /start a new conversation/i }),
        ).toBeDisabled();
        expect(
            screen.getByRole("button", {
                name: /clear the current thread/i,
            }),
        ).toBeDisabled();
        expect(
            screen.getByRole("button", {
                name: /export the conversation as a pdf/i,
            }),
        ).toBeDisabled();
    });

    it("fires the correct handler for each button", () => {
        const onNew = vi.fn();
        const onClear = vi.fn();
        const onExport = vi.fn();
        render(
            <AskMobileActions
                {...baseProps}
                onNewConversation={onNew}
                onClearConversation={onClear}
                onExportConversation={onExport}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", { name: /start a new conversation/i }),
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: /clear the current thread/i,
            }),
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: /export the conversation as a pdf/i,
            }),
        );
        expect(onNew).toHaveBeenCalledTimes(1);
        expect(onClear).toHaveBeenCalledTimes(1);
        expect(onExport).toHaveBeenCalledTimes(1);
    });

    it("exposes the action strip as a labeled group for AT users", () => {
        render(<AskMobileActions {...baseProps} />);
        expect(
            screen.getByRole("group", { name: /conversation actions/i }),
        ).toBeInTheDocument();
    });
});
