import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Ticker, useTickerAnimation } from "@/shared/landing/Ticker";

const items = [
  { text: "OWU Chartered", year: "1842" },
  { text: "Perkins Observatory Opens", year: "1931" },
];

function AnimatedTicker() {
  useTickerAnimation();
  return <Ticker items={items} />;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("landing ticker", () => {
  it("exposes one milestone sequence and hides the visual loop copy", () => {
    const { container } = render(<Ticker items={items} />);

    expect(
      screen.getByRole("list", { name: "Ohio Wesleyan milestones" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("OWU Chartered")).toHaveLength(2);
    expect(
      container.querySelectorAll('.cinema-ticker-sequence[aria-hidden="true"]'),
    ).toHaveLength(1);
  });

  it("hides the duplicated bottom rail from assistive technology", () => {
    const { container } = render(<Ticker items={items} reverse />);

    expect(container.querySelector(".cinema-ticker-bottom")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("does not start WAAPI movement when reduced motion is requested", async () => {
    const animate = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });

    const { container } = render(<AnimatedTicker />);

    await waitFor(() => {
      expect(
        container.querySelector<HTMLElement>(".cinema-ticker-track")?.style
          .transform,
      ).toBe("none");
    });
    expect(animate).not.toHaveBeenCalled();
  });
});
