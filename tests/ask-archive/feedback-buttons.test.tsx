import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedbackButtons } from "@/features/ask-archive/components/FeedbackButtons";
import type { AskResponse } from "@/src/types";

const baseResponse: AskResponse = {
  question: "What happened?",
  answer: "Things happened [Source 1].",
  citations: [{ articleId: "1960-01-07-0", headline: "Test", editionDate: "1960-01-07" }],
  confidence: "high",
  mode: "text",
  requestId: "req-123",
  sourceArticles: [],
  meta: {
    retrievalTimeMs: 100,
    generationTimeMs: 500,
    totalTimeMs: 600,
    articlesSearched: 8,
    method: "hybrid",
  },
};

function okFetch() {
  return { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) };
}

function errFetch(status = 500, body: unknown = { error: "Nope" }) {
  return { ok: false, status, json: () => Promise.resolve(body) };
}

describe("FeedbackButtons", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okFetch()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders both thumbs in the initial prompt state", () => {
    render(<FeedbackButtons response={baseResponse} />);
    expect(screen.getByText("Was this helpful?")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark this answer as helpful")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark this answer as unhelpful")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("moves to the comment collection state when a thumb is clicked", () => {
    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    expect(screen.getByText("What worked?")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("prompts appropriately when the down vote is chosen", () => {
    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as unhelpful"));
    expect(screen.getByText("What went wrong?")).toBeInTheDocument();
  });

  it("clamps the textarea value at 1000 characters", () => {
    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "x".repeat(1500) } });
    expect(textarea.value.length).toBe(1000);
  });

  it("sends the comment in the POST body when Send is clicked", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okFetch());
    vi.stubGlobal("fetch", fetchSpy);

    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  useful answer  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Thanks for the feedback.")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.vote).toBe("up");
    expect(body.requestId).toBe("req-123");
    expect(body.comment).toBe("useful answer");
  });

  it("omits the comment field in the POST body when Skip is clicked", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okFetch());
    vi.stubGlobal("fetch", fetchSpy);

    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as unhelpful"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "typed but skipped" } });
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));

    await waitFor(() => {
      expect(screen.getByText("Thanks for the feedback.")).toBeInTheDocument();
    });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.vote).toBe("down");
    expect(body).not.toHaveProperty("comment");
  });

  it("omits the comment field when the textarea is whitespace-only", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okFetch());
    vi.stubGlobal("fetch", fetchSpy);

    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   \n  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByText("Thanks for the feedback.")).toBeInTheDocument();
    });
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("comment");
  });

  it("shows the error message and allows retry when POST fails", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(errFetch(500, { error: "Server exploded" }))
      .mockResolvedValueOnce(okFetch());
    vi.stubGlobal("fetch", fetchSpy);

    render(<FeedbackButtons response={baseResponse} />);
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Server exploded");
    });
    // After error the thumbs are back; clicking again should retry
    fireEvent.click(screen.getByLabelText("Mark this answer as helpful"));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText("Thanks for the feedback.")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("disables thumbs while the response has no requestId yet", () => {
    const streaming: AskResponse = { ...baseResponse, requestId: "" };
    render(<FeedbackButtons response={streaming} />);
    expect(screen.getByLabelText("Mark this answer as helpful")).toBeDisabled();
    expect(screen.getByLabelText("Mark this answer as unhelpful")).toBeDisabled();
  });
});
