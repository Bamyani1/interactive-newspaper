import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskInput } from "@/features/ask-archive";

describe("AskInput", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a textarea and submit button", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit question" })).toBeInTheDocument();
  });

  it("calls onSubmit with trimmed text on Enter key", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "  What happened?  " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith("What happened?");
  });

  it("calls onSubmit on submit button click", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Tell me about sports" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit question" }));

    expect(onSubmit).toHaveBeenCalledWith("Tell me about sports");
  });

  it("disables submit button when isLoading is true", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={true} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "A question" } });

    expect(screen.getByRole("button", { name: "Submit question" })).toBeDisabled();
  });

  it("renders example question chips", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    expect(screen.getByText("How did campus life change from the 1950s to the 2000s?")).toBeInTheDocument();
    expect(screen.getByText("Tell me about OWU sports teams")).toBeInTheDocument();
  });

  it("submits when clicking an example chip", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    fireEvent.click(screen.getByText("How did campus life change from the 1950s to the 2000s?"));

    expect(onSubmit).toHaveBeenCalledWith("How did campus life change from the 1950s to the 2000s?");
  });

  it("does not submit empty or whitespace-only input", () => {
    render(<AskInput onSubmit={onSubmit} isLoading={false} />);

    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
