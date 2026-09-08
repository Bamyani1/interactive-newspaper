import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PhotosPanel } from "@/features/ask-archive/components/PhotosPanel";
import type { TurnImage } from "@/features/ask-archive/lib/dedup-source-images";

vi.mock("next/image", () => ({
  __esModule: true,
  default: (
    props: React.ImgHTMLAttributes<HTMLImageElement> & {
      fill?: boolean;
      sizes?: string;
    }
  ) => {
    const { alt, src, fill: _fill, sizes: _sizes, ...rest } = props;
    void _fill;
    void _sizes;
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={alt ?? ""} src={String(src)} {...rest} />;
  },
}));

function makeImages(n: number): TurnImage[] {
  return Array.from({ length: n }, (_, i) => ({
    src: `https://x/${i}.webp`,
    caption: i % 2 === 0 ? `caption ${i}` : null,
    sourceIndex: (i % 3) + 1,
    sourceId: `src-${i}`,
  }));
}

describe("PhotosPanel", () => {
  it("renders nothing when the images list is empty", () => {
    const { container } = render(<PhotosPanel images={[]} onOpenUrl={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("uses the 'More pictures' heading", () => {
    render(<PhotosPanel images={makeImages(3)} onOpenUrl={() => {}} />);
    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("More pictures — 3");
  });

  it("renders one tile per image with caption where present", () => {
    render(<PhotosPanel images={makeImages(3)} onOpenUrl={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    // Even-indexed entries have captions.
    expect(screen.getByText("caption 0")).toBeInTheDocument();
    expect(screen.getByText("caption 2")).toBeInTheDocument();
  });

  it("caps tiles at 12 and offers a control to reveal the rest", () => {
    render(<PhotosPanel images={makeImages(15)} onOpenUrl={() => {}} />);
    expect(document.querySelectorAll(".ask-photos-tile")).toHaveLength(12);
    expect(screen.getByRole("button", { name: /show all 15 pictures/i })).toBeInTheDocument();
  });

  it("reveals every remaining tile and offers the way back", () => {
    render(<PhotosPanel images={makeImages(15)} onOpenUrl={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /show all 15 pictures/i }));
    expect(document.querySelectorAll(".ask-photos-tile")).toHaveLength(15);
    // "Show all" used to be one-way, so a reader who expanded a long set
    // had no route back to the short grid.
    const collapse = screen.getByRole("button", { name: /show fewer/i });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(collapse);
    expect(document.querySelectorAll(".ask-photos-tile")).toHaveLength(12);
    expect(screen.getByRole("button", { name: /show all 15 pictures/i })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  it("counts what is on screen, not the total, while capped", () => {
    render(<PhotosPanel images={makeImages(34)} onOpenUrl={() => {}} />);
    // The heading claimed "More pictures — 34" above twelve tiles.
    expect(screen.getByRole("heading", { name: /more pictures — 12 of 34/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /show all 34 pictures/i }));
    expect(screen.getByRole("heading", { name: /more pictures — 34$/i })).toBeInTheDocument();
  });

  it("omits the reveal control when nothing is capped", () => {
    render(<PhotosPanel images={makeImages(4)} onOpenUrl={() => {}} />);
    expect(screen.queryByRole("button", { name: /show all/i })).not.toBeInTheDocument();
  });

  it("passes the clicked image src to onOpenUrl", () => {
    const calls: string[] = [];
    const images = makeImages(4);
    render(<PhotosPanel images={images} onOpenUrl={(src) => calls.push(src)} />);
    document.querySelectorAll<HTMLButtonElement>(".ask-photos-tile button")[2].click();
    expect(calls).toEqual([images[2].src]);
  });

  it("shows source attribution chip for every tile", () => {
    render(<PhotosPanel images={makeImages(3)} onOpenUrl={() => {}} />);
    const attrs = document.querySelectorAll(".ask-photos-tile-attr");
    expect(attrs).toHaveLength(3);
    expect(attrs[0].textContent).toMatch(/^\[\d\]$/);
  });
});
