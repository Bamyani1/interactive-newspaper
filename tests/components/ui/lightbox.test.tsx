import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Lightbox } from "@/src/components/ui/lightbox";

vi.mock("next/image", () => ({
    __esModule: true,
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
        const { alt, src, ...rest } = props;
        // eslint-disable-next-line @next/next/no-img-element
        return <img alt={alt ?? ""} src={String(src)} {...rest} />;
    },
}));

// framer-motion's AnimatePresence defers mount/unmount by a tick in
// jsdom; replacing it with a pass-through keeps these tests synchronous.
vi.mock("framer-motion", async () => {
    const React = await import("react");
    const passthrough: React.FC<React.PropsWithChildren<Record<string, unknown>>> = ({
        children,
    }) => <>{children}</>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const motion: any = new Proxy(
        {},
        {
            get:
                () =>
                ({
                    children,
                    ...rest
                }: React.PropsWithChildren<Record<string, unknown>>) => {
                    // Strip framer-motion-only props so React doesn't warn.
                    const filtered: Record<string, unknown> = {};
                    for (const k of Object.keys(rest)) {
                        if (
                            ![
                                "initial",
                                "animate",
                                "exit",
                                "transition",
                                "whileHover",
                                "whileTap",
                            ].includes(k)
                        )
                            filtered[k] = rest[k];
                    }
                    return <div {...filtered}>{children}</div>;
                },
        },
    );
    return { __esModule: true, motion, AnimatePresence: passthrough };
});

describe("Lightbox", () => {
    it("renders nothing when src is null and no images[]", () => {
        const { container } = render(
            <Lightbox src={null} onClose={() => {}} />,
        );
        expect(container.querySelector("img")).toBeNull();
    });

    it("renders a single image in legacy src mode", () => {
        render(
            <Lightbox src="https://x/p.webp" onClose={() => {}} />,
        );
        const img = screen.getByRole("img");
        expect(img.getAttribute("src")).toBe("https://x/p.webp");
    });

    it("renders the initialIndex in gallery mode and shows counter", () => {
        render(
            <Lightbox
                images={[
                    { src: "u1" },
                    { src: "u2", caption: "second" },
                    { src: "u3" },
                ]}
                initialIndex={1}
                onClose={() => {}}
            />,
        );
        expect(screen.getByRole("img").getAttribute("src")).toBe("u2");
        expect(screen.getByText("second")).toBeInTheDocument();
        expect(screen.getByText("2 / 3")).toBeInTheDocument();
    });

    it("advances with ArrowRight and wraps around", () => {
        render(
            <Lightbox
                images={[{ src: "u1" }, { src: "u2" }]}
                onClose={() => {}}
            />,
        );
        expect(screen.getByRole("img").getAttribute("src")).toBe("u1");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(screen.getByRole("img").getAttribute("src")).toBe("u2");
        fireEvent.keyDown(document, { key: "ArrowRight" });
        expect(screen.getByRole("img").getAttribute("src")).toBe("u1");
    });

    it("calls onClose on Escape", () => {
        const close = vi.fn();
        render(
            <Lightbox
                images={[{ src: "u1" }]}
                onClose={close}
            />,
        );
        fireEvent.keyDown(document, { key: "Escape" });
        expect(close).toHaveBeenCalledTimes(1);
    });
});
