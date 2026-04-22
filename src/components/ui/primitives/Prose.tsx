import * as React from "react";

export type ProseProps = Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "children"
> & {
    /** Tag to wrap the prose content with. Defaults to `<div>` for safe nesting. */
    as?: "div" | "article" | "section";
    /** Optional max-width override; defaults to the article reading measure. */
    measure?: "narrow" | "wide";
    children: React.ReactNode;
};

/**
 * Wrapper that applies the Direction-A Markdown-rendered typography spec
 * (per /design.md "prose" component) to anything passed in. Use to wrap
 * react-markdown output (RAG answers) and static article body so prose
 * styling lives in exactly one place.
 *
 * The actual prose styling lives in src/styles/components/ask-archive/
 * markdown-prose.css (Phase 6) — this primitive applies the .prose class
 * to opt in.
 */
export const Prose = React.forwardRef<HTMLDivElement, ProseProps>(
    ({ as = "div", measure = "narrow", className = "", children, ...rest }, ref) => {
        const Tag = as as React.ElementType;
        const measureClass =
            measure === "wide" ? "max-w-[58rem]" : "max-w-[42rem]";
        return (
            <Tag
                ref={ref}
                className={`prose ${measureClass} ${className}`.trim()}
                {...rest}
            >
                {children}
            </Tag>
        );
    },
);

Prose.displayName = "Prose";
