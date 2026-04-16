import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FollowUpQuestions } from "@/features/ask-archive";

describe("FollowUpQuestions", () => {
  it("renders nothing when questions array is empty", () => {
    const { container } = render(
      <FollowUpQuestions questions={[]} onSelect={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders each question as a button", () => {
    render(
      <FollowUpQuestions
        questions={["Q1?", "Q2?", "Q3?"]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Q1?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Q2?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Q3?" })).toBeInTheDocument();
  });

  it("calls onSelect with question text when clicked", () => {
    const onSelect = vi.fn();
    render(
      <FollowUpQuestions questions={["What year?"]} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "What year?" }));
    expect(onSelect).toHaveBeenCalledWith("What year?");
  });

  it("disables buttons when disabled prop is true", () => {
    render(
      <FollowUpQuestions
        questions={["Q1?"]}
        onSelect={() => {}}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: "Q1?" })).toBeDisabled();
  });
});
