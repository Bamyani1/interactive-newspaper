import React, { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AskInput } from "@/features/ask-archive";

// Small harness so tests can exercise the now-controlled AskInput without
// every test re-implementing controlled state.
function Harness({
  onSubmit,
  isLoading = false,
  initial = "",
  focusSignal,
}: {
  onSubmit: (v: string) => void;
  isLoading?: boolean;
  initial?: string;
  focusSignal?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AskInput
      value={value}
      onChange={setValue}
      onSubmit={onSubmit}
      isLoading={isLoading}
      focusSignal={focusSignal}
    />
  );
}

describe("AskInput", () => {
  const onSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a text input and submit button", () => {
    render(<Harness onSubmit={onSubmit} />);

    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit question" })).toBeInTheDocument();
  });

  it("calls onSubmit with trimmed text on Enter key", () => {
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  What happened?  " } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).toHaveBeenCalledWith("What happened?");
  });

  it("calls onSubmit on submit button click", () => {
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Tell me about sports" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit question" }));

    expect(onSubmit).toHaveBeenCalledWith("Tell me about sports");
  });

  it("disables submit button when isLoading is true", () => {
    render(<Harness onSubmit={onSubmit} isLoading initial="A question" />);

    expect(screen.getByRole("button", { name: "Submit question" })).toBeDisabled();
  });

  it("renders example question chips", () => {
    render(<Harness onSubmit={onSubmit} />);

    expect(
      screen.getByText("How did campus life change from the 1950s to the 2000s?"),
    ).toBeInTheDocument();
    expect(screen.getByText("Tell me about OWU sports teams")).toBeInTheDocument();
  });

  it("submits when clicking an example chip", () => {
    render(<Harness onSubmit={onSubmit} />);

    fireEvent.click(
      screen.getByText("How did campus life change from the 1950s to the 2000s?"),
    );

    expect(onSubmit).toHaveBeenCalledWith(
      "How did campus life change from the 1950s to the 2000s?",
    );
  });

  it("does not submit empty or whitespace-only input", () => {
    render(<Harness onSubmit={onSubmit} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: false });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders the caller-controlled value (history picks populate the input)", () => {
    render(<Harness onSubmit={onSubmit} initial="prior question" />);

    expect(screen.getByRole("textbox")).toHaveValue("prior question");
  });
});
