import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LowConfidenceCaveat } from "@/features/ask-archive";

describe("LowConfidenceCaveat", () => {
  it("renders a caveat when confidence is low", () => {
    render(<LowConfidenceCaveat confidence="low" />);
    expect(screen.getByText(/Heads up/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Limited sources found for this question/i),
    ).toBeInTheDocument();
  });

  it("renders nothing for medium confidence", () => {
    const { container } = render(<LowConfidenceCaveat confidence="medium" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for high confidence", () => {
    const { container } = render(<LowConfidenceCaveat confidence="high" />);
    expect(container).toBeEmptyDOMElement();
  });
});
