import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDeepLinkSubmit } from "@/features/ask-archive/hooks/useDeepLinkSubmit";

const replaceMock = vi.fn();
const paramsGetMock = vi.fn<(key: string) => string | null>();

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        replace: replaceMock,
        push: vi.fn(),
        back: vi.fn(),
        forward: vi.fn(),
        refresh: vi.fn(),
        prefetch: vi.fn(),
    }),
    useSearchParams: () => ({
        get: paramsGetMock,
    }),
}));

describe("useDeepLinkSubmit", () => {
    beforeEach(() => {
        replaceMock.mockReset();
        paramsGetMock.mockReset();
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
        expect(replaceMock).toHaveBeenCalledWith("/ask", { scroll: false });
    });

    it("skips while the session is still hydrating", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("a question");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: true, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it("skips when a conversation is already in progress", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("a question");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 1, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
        expect(replaceMock).not.toHaveBeenCalled();
    });

    it("skips when the q param is absent", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue(null);
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
    });

    it("skips when the q param is whitespace-only", () => {
        const submit = vi.fn();
        paramsGetMock.mockReturnValue("   ");
        renderHook(() =>
            useDeepLinkSubmit({ isHydrating: false, turnCount: 0, submit }),
        );
        expect(submit).not.toHaveBeenCalled();
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
