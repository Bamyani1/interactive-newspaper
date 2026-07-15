"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prose, ProseCodeBlock } from "@/shared/ui/primitives";
import { InlineAnswerImage } from "./InlineAnswerImage";

interface MarkdownProps {
    children: string;
    /**
     * Optional lookup from agent-style article id (YYYY-MM-DD-N) to the
     * 1-based source index so [YYYY-MM-DD-N] citations become the same
     * scrollable anchors as the pipeline's [Source N] citations.
     */
    articleIdIndex?: Map<string, number>;
    className?: string;
}

// Match both citation shapes:
//   - pipeline:  [Source N]
//   - agent:     [YYYY-MM-DD-N] or [YYYY-MM-DD-N, YYYY-MM-DD-N, …]
// Pre-process them into markdown anchor links so react-markdown's default
// <a> renderer handles them; the custom link renderer below adds smooth-
// scroll behavior + the ask-citation-link class.
const PIPELINE_CITATION_RE = /\[Source (\d+)\]/g;
const AGENT_CITATION_RE =
    /\[(\d{4}-\d{2}-\d{2}-\d+(?:\s*,\s*\d{4}-\d{2}-\d{2}-\d+)*)\]/g;

function replaceCitations(
    text: string,
    articleIdIndex?: Map<string, number>,
): string {
    let out = text.replace(
        PIPELINE_CITATION_RE,
        (_match, n: string) => `[[${n}]](#ask-source-${n})`,
    );
    out = out.replace(AGENT_CITATION_RE, (_match, inner: string) => {
        const ids = inner.split(/\s*,\s*/);
        const linked = ids
            .map((id) => {
                const num = articleIdIndex?.get(id);
                return num === undefined
                    ? null
                    : `[[${num}]](#ask-source-${num})`;
            })
            .filter((x): x is string => x !== null);
        // If none of the IDs resolved, drop the bracket entirely — it's
        // noise. If at least one resolved, join with a thin space.
        return linked.length === 0 ? "" : linked.join(" ");
    });
    return out;
}

type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href?: string;
    children?: React.ReactNode;
};

// Intercept <img> so LLM-emitted inline images render through
// InlineAnswerImage, which upgrades to a clickable caption + chip
// when an AnswerImageContext is present, and falls back to a plain
// lazy <img> otherwise. The wrapper is phrasing content (spans) so
// nesting inside the <p> react-markdown wraps around inline content
// is valid HTML; no paragraph-unwrap required. Drop the element
// entirely if src is empty/undefined so a malformed embed can't
// break layout.
const renderImg: React.FC<
    React.ImgHTMLAttributes<HTMLImageElement>
> = ({ src, alt, ...rest }) => {
    if (typeof src !== "string" || src.trim().length === 0) return null;
    return <InlineAnswerImage {...rest} src={src} alt={alt} />;
};

const renderPre: React.FC<
    React.HTMLAttributes<HTMLPreElement> & { node?: unknown }
> = ({ node: _node, ...rest }) => {
    void _node;
    return <ProseCodeBlock {...rest} />;
};

// Intercept <a> so in-document citation links get smooth-scroll behavior
// and the ask-citation-link class. External links open in a new tab with
// the usual safety attributes.
const renderAnchor: React.FC<AnchorProps> = ({ href, children, ...rest }) => {
    if (href && href.startsWith("#ask-source-")) {
        const num = href.replace("#ask-source-", "");
        return (
            <a
                {...rest}
                className="ask-citation-link"
                href={href}
                onClick={(e) => {
                    e.preventDefault();
                    const flashTarget = (): boolean => {
                        const target = document.getElementById(
                            `ask-source-${num}`,
                        );
                        if (!target) return false;
                        target.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                        });
                        target.setAttribute("data-highlighted", "true");
                        window.setTimeout(() => {
                            target.removeAttribute("data-highlighted");
                        }, 1200);
                        return true;
                    };
                    if (flashTarget()) return;
                    // Target not in DOM — sources are collapsed. Expand
                    // every closed source list, then retry once React
                    // has flushed the new children.
                    document
                        .querySelectorAll<HTMLButtonElement>(
                            '.ask-source-toggle[aria-expanded="false"]',
                        )
                        .forEach((btn) => btn.click());
                    window.requestAnimationFrame(() => {
                        window.requestAnimationFrame(() => {
                            flashTarget();
                        });
                    });
                }}
            >
                {children}
            </a>
        );
    }
    return (
        <a
            {...rest}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
        >
            {children}
        </a>
    );
};

/**
 * Markdown renderer for answer text. Uses react-markdown + remark-gfm so
 * code blocks, lists, tables, and strikethrough render correctly. Pre-
 * processes citation tokens ([Source N], [YYYY-MM-DD-N]) into anchor
 * links that scroll to the matching source card.
 */
export const Markdown: React.FC<MarkdownProps> = ({
    children,
    articleIdIndex,
    className,
}) => {
    const preprocessed = useMemo(
        () => replaceCitations(children, articleIdIndex),
        [children, articleIdIndex],
    );

    // Wrap the markdown in the <Prose> primitive so every RAG answer
    // picks up the Direction-A prose typography defined in
    // markdown-prose.css. When a className is provided by the caller,
    // keep it on a wrapper <div> and apply .prose alongside it so both
    // the legacy per-parent class AND the new prose spec style the
    // content. The streaming cursor in typing-cursor.css matches both
    // .ask-turn-answer > :last-child and .ask-turn-answer > .prose >
    // :last-child, so the Prose wrapper doesn't break the trailing-
    // cursor invariant.
    if (!className) {
        return (
            <Prose measure="narrow">
                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{ a: renderAnchor, img: renderImg, pre: renderPre }}
                >
                    {preprocessed}
                </ReactMarkdown>
            </Prose>
        );
    }

    return (
        <div className={`${className} prose`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ a: renderAnchor, img: renderImg, pre: renderPre }}
            >
                {preprocessed}
            </ReactMarkdown>
        </div>
    );
};
