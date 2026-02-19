import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "@/features/ask-archive";

describe("ConfidenceBadge", () => {
  it("renders 'High confidence' for high confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="high" />);

    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--high")).toBeInTheDocument();
  });

  it("renders 'Medium confidence' for medium confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="medium" />);

    expect(screen.getByText("Medium confidence")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--medium")).toBeInTheDocument();
  });

  it("renders 'Limited sources' for low confidence", () => {
    const { container } = render(<ConfidenceBadge confidence="low" />);

    expect(screen.getByText("Limited sources")).toBeInTheDocument();
    expect(container.querySelector(".ask-confidence-dot--low")).toBeInTheDocument();
  });
});
