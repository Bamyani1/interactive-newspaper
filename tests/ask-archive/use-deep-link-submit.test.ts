import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeepLinkSubmit } from "@/features/ask-archive/hooks/useDeepLinkSubmit";

const paramsGetMock = vi.fn<(key: string) => string | null>();

vi.mock("next/navigation", () => ({
    useSearchParams: () => ({
        get: paramsGetMock,
    }),
}));

describe("useDeepLinkSubmit", () => {
    let replaceStateSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        paramsGetMock.mockReset();
        replaceStateSpy = vi
            .spyOn(window.history, "replaceState")
            .mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("submits the decoded question once and strips the URL param", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("How did OWU respond to Vietnam?");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 0, submit }),
        );
        expect(submit).toHaveBeenCalledTimes(1);
        expect(submit).toHaveBeenCalledWith(
            "How did OWU respond to Vietnam?",
        );
        expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/ask");
    });

    it("skips while the session is still hydrating", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("a question");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: true, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it("consumes without submitting when a conversation is already in progress", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("a question");
        const { rerender } = renderHook(
            (turnCount: number) =>
                useDeepLinkSubmit({
                    isHydrating: false,
                    turnCount,
                    submit,
                }),
            { initialProps: 1 },
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/ask");

        // Clearing the restored conversation must not release the stale
        // URL question later in the same mount.
        rerender(0);
        expect(submit).not.toHaveBeenCalled();
    });

    it("skips when the q param is absent", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue(null);
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it("skips when the q param is whitespace-only", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("   ");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceStateSpy).not.toHaveBeenCalled();
    });

    it("does not re-submit on re-render with the same props", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("a question");
        const { rerender } = renderHook(
            (props: Parameters<typeof useDeepLinkSubmit>[0]) =>
                useDeepLinkSubmit(props),
            {
                initialProps: {
                    isHydrating: false,
                    turnCount: 0,
                    submit,
                },
            },
        );
        rerender({ isHydrating: false, turnCount: 0, submit });
        rerender({ isHydrating: false, turnCount: 1, submit });
        expect(submit).toHaveBeenCalledTimes(1);
    });
});
