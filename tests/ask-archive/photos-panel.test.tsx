import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PhotosPanel } from "@/features/ask-archive/components/PhotosPanel";
import type { TurnImage } from "@/features/ask-archive/lib/dedup-source-images";

vi.mock("next/image", () => ({
    __esModule: true,
    default: (
        props: React.ImgHTMLAttributes<HTMLImageElement> & {
            fill?: boolean;
            sizes?: string;
        },
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
        const { container } = render(
            <PhotosPanel images={[]} onOpen={() => {}} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it("renders one tile per image with caption where present", () => {
        render(
            <PhotosPanel images={makeImages(3)} onOpen={() => {}} />,
        );
        expect(screen.getAllByRole("button")).toHaveLength(3);
        // Even-indexed entries have captions.
        expect(screen.getByText("caption 0")).toBeInTheDocument();
        expect(screen.getByText("caption 2")).toBeInTheDocument();
    });

    it("caps tiles at 12 and surfaces an overflow hint", () => {
        render(
            <PhotosPanel images={makeImages(15)} onOpen={() => {}} />,
        );
        expect(screen.getAllByRole("button")).toHaveLength(12);
        expect(screen.getByText(/showing first 12/i)).toBeInTheDocument();
    });

    it("passes the dedup index to onOpen when a tile is clicked", () => {
        const calls: number[] = [];
        const images = makeImages(4);
        render(<PhotosPanel images={images} onOpen={(i) => calls.push(i)} />);
        screen.getAllByRole("button")[2].click();
        expect(calls).toEqual([2]);
    });

    it("shows source attribution chip for every tile", () => {
        render(
            <PhotosPanel images={makeImages(3)} onOpen={() => {}} />,
        );
        const attrs = document.querySelectorAll(".ask-photos-tile-attr");
        expect(attrs).toHaveLength(3);
        expect(attrs[0].textContent).toMatch(/^\[\d\]$/);
    });
});
