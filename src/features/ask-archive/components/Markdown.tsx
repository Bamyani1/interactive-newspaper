"use client";

import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
//   - agent:     [YYYY-MM-DD-N]
// Pre-process them into markdown anchor links so react-markdown's default
// <a> renderer handles them; the custom link renderer below adds smooth-
// scroll behavior + the ask-citation-link class.
const PIPELINE_CITATION_RE = /\[Source (\d+)\]/g;
const AGENT_CITATION_RE = /\[(\d{4}-\d{2}-\d{2}-\d+)\]/g;

function replaceCitations(
    text: string,
    articleIdIndex?: Map<string, number>,
): string {
    let out = text.replace(
        PIPELINE_CITATION_RE,
        (_match, n: string) => `[[${n}]](#ask-source-${n})`,
    );
    out = out.replace(AGENT_CITATION_RE, (match, id: string) => {
        const num = articleIdIndex?.get(id);
        if (num === undefined) return match; // leave unlinked
        return `[[${num}]](#ask-source-${num})`;
    });
    return out;
}

type AnchorProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href?: string;
    children?: React.ReactNode;
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
                    document
                        .getElementById(`ask-source-${num}`)
                        ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
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

    return (
        <div className={className}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ a: renderAnchor }}
            >
                {preprocessed}
            </ReactMarkdown>
        </div>
    );
};
