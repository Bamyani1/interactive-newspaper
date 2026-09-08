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
    replaceStateSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("submits the decoded question once and strips the URL param", () => {
    const submit = vi.fn();
    paramsGetMock.mockReturnValue("How did OWU respond to Vietnam?");
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: false,
        turnCount: 0,
        submit,
        startNewConversation: vi.fn(),
      })
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("How did OWU respond to Vietnam?");
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/ask");
  });

  it("skips while the session is still hydrating", () => {
    const submit = vi.fn();
    paramsGetMock.mockReturnValue("a question");
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: true,
        turnCount: 0,
        submit,
        startNewConversation: vi.fn(),
      })
    );
    expect(submit).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("opens a new thread and answers when a conversation is already in progress", () => {
    const submit = vi.fn();
    const startNewConversation = vi.fn();
    paramsGetMock.mockReturnValue("a question");
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: false,
        turnCount: 1,
        submit,
        startNewConversation,
      })
    );
    // The reader clicked a suggestion; dropping it silently is what made
    // every question after the first one look like the app had frozen.
    expect(startNewConversation).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith("a question");
    expect(replaceStateSpy).toHaveBeenCalledWith(null, "", "/ask");
  });

  it("does not open a new thread when the workspace is already empty", () => {
    const submit = vi.fn();
    const startNewConversation = vi.fn();
    paramsGetMock.mockReturnValue("a question");
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: false,
        turnCount: 0,
        submit,
        startNewConversation,
      })
    );
    expect(startNewConversation).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith("a question");
  });

  it("fires once even as the turn count changes", () => {
    const submit = vi.fn();
    const startNewConversation = vi.fn();
    paramsGetMock.mockReturnValue("a question");
    const { rerender } = renderHook(
      (turnCount: number) =>
        useDeepLinkSubmit({
          isHydrating: false,
          turnCount,
          submit,
          startNewConversation,
        }),
      { initialProps: 1 }
    );
    expect(submit).toHaveBeenCalledTimes(1);

    // Clearing the conversation must not release the stale URL question
    // a second time within the same mount.
    rerender(0);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(startNewConversation).toHaveBeenCalledTimes(1);
  });

  it("skips when the q param is absent", () => {
    const submit = vi.fn();
    paramsGetMock.mockReturnValue(null);
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: false,
        turnCount: 0,
        submit,
        startNewConversation: vi.fn(),
      })
    );
    expect(submit).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("skips when the q param is whitespace-only", () => {
    const submit = vi.fn();
    paramsGetMock.mockReturnValue("   ");
    renderHook(() =>
      useDeepLinkSubmit({
        isHydrating: false,
        turnCount: 0,
        submit,
        startNewConversation: vi.fn(),
      })
    );
    expect(submit).not.toHaveBeenCalled();
    expect(replaceStateSpy).not.toHaveBeenCalled();
  });

  it("does not re-submit on re-render with the same props", () => {
    const submit = vi.fn();
    paramsGetMock.mockReturnValue("a question");
    const { rerender } = renderHook(
      (props: Parameters<typeof useDeepLinkSubmit>[0]) => useDeepLinkSubmit(props),
      {
        initialProps: {
          isHydrating: false,
          turnCount: 0,
          submit,
        },
      }
    );
    rerender({ isHydrating: false, turnCount: 0, submit });
    rerender({ isHydrating: false, turnCount: 1, submit });
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
