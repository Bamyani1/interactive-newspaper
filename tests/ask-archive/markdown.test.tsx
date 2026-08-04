import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "@/features/ask-archive/components/Markdown";

describe("Markdown renderer", () => {
    it("renders bold and italic", () => {
        const { container } = render(
            <Markdown>{"This is **bold** and *italic* text."}</Markdown>,
        );
        expect(container.querySelector("strong")?.textContent).toBe("bold");
        expect(container.querySelector("em")?.textContent).toBe("italic");
    });

    it("renders ## as <h2> and ### as <h3>", () => {
        const { container } = render(
            <Markdown>{"## H2\n\n### H3"}</Markdown>,
        );
        expect(container.querySelector("h2")?.textContent).toBe("H2");
        expect(container.querySelector("h3")?.textContent).toBe("H3");
    });

    it("renders fenced code blocks", () => {
        const { container } = render(
            <Markdown>{"```\nconst x = 1;\n```"}</Markdown>,
        );
        const code = container.querySelector("pre code");
        expect(code?.textContent).toContain("const x = 1;");
        expect(code?.parentElement).toHaveAttribute("tabindex", "0");
    });

    it("renders ordered and unordered lists", () => {
        const { container } = render(
            <Markdown>
                {"- one\n- two\n\n1. first\n2. second"}
            </Markdown>,
        );
        expect(container.querySelectorAll("ul li")).toHaveLength(2);
        expect(container.querySelectorAll("ol li")).toHaveLength(2);
    });

    it("renders GFM tables", () => {
        const md = [
            "| A | B |",
            "| - | - |",
            "| 1 | 2 |",
            "| 3 | 4 |",
        ].join("\n");
        const { container } = render(<Markdown>{md}</Markdown>);
        expect(container.querySelector("table")).not.toBeNull();
        expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    });

    it("turns [Source N] citations into #ask-source-N anchors", () => {
        render(<Markdown>{"Foo [Source 1] bar [Source 2]."}</Markdown>);
        const links = screen.getAllByRole("link");
        expect(links).toHaveLength(2);
        expect(links[0]).toHaveAttribute("href", "#ask-source-1");
        expect(links[0].textContent).toBe("[1]");
        expect(links[0].className).toContain("ask-citation-link");
        expect(links[1]).toHaveAttribute("href", "#ask-source-2");
    });

    it("maps agent [YYYY-MM-DD-N] citations via articleIdIndex", () => {
        const index = new Map<string, number>([
            ["1960-01-07-0", 1],
            ["1965-03-12-4", 2],
        ]);
        render(
            <Markdown articleIdIndex={index}>
                {"X [1960-01-07-0] Y [1965-03-12-4] Z"}
            </Markdown>,
        );
        const links = screen.getAllByRole("link");
        expect(links).toHaveLength(2);
        expect(links[0]).toHaveAttribute("href", "#ask-source-1");
        expect(links[1]).toHaveAttribute("href", "#ask-source-2");
    });

    it("leaves agent citations unlinked when articleIdIndex has no match", () => {
        render(
            <Markdown>{"unmapped [1970-01-01-0] citation"}</Markdown>,
        );
        // No link rendered for the unknown citation
        const links = screen.queryAllByRole("link");
        expect(links).toHaveLength(0);
    });

    it("external links open in a new tab", () => {
        render(
            <Markdown>
                {"See [the docs](https://example.com/docs) for more."}
            </Markdown>,
        );
        const link = screen.getByRole("link");
        expect(link).toHaveAttribute("href", "https://example.com/docs");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
});

describe("splitMarkdownBlocks", () => {
    it("splits paragraphs and headings on blank lines", async () => {
        const { splitMarkdownBlocks } = await import(
            "@/features/ask-archive/components/Markdown"
        );
        expect(splitMarkdownBlocks("## Head\n\nPara one.\n\nPara two.")).toEqual([
            "## Head",
            "Para one.",
            "Para two.",
        ]);
    });

    it("keeps a fenced code block with internal blank lines intact", async () => {
        const { splitMarkdownBlocks } = await import(
            "@/features/ask-archive/components/Markdown"
        );
        const text = "Intro\n\n```\nline\n\nline after gap\n```\n\nOutro";
        const blocks = splitMarkdownBlocks(text);
        expect(blocks).toEqual([
            "Intro",
            "```\nline\n\nline after gap\n```",
            "Outro",
        ]);
    });

    it("keeps a loose ordered list in one block so numbering survives", async () => {
        const { splitMarkdownBlocks } = await import(
            "@/features/ask-archive/components/Markdown"
        );
        const blocks = splitMarkdownBlocks("1. first\n\n2. second\n\n3. third");
        expect(blocks).toEqual(["1. first\n\n2. second\n\n3. third"]);
    });

    it("renders a loose ordered list with continuous numbering", () => {
        const { container } = render(
            <Markdown>{"1. first\n\n2. second"}</Markdown>,
        );
        const lists = container.querySelectorAll("ol");
        expect(lists.length).toBe(1);
        expect(lists[0].querySelectorAll("li").length).toBe(2);
    });
});

describe("splitMarkdownBlocks separator fidelity", () => {
    it("preserves blank-line runs inside fenced code verbatim", async () => {
        const { splitMarkdownBlocks } = await import(
            "@/features/ask-archive/components/Markdown"
        );
        const text = "Intro\n\n```\ndef foo():\n    pass\n\n\ndef bar():\n    pass\n```";
        const blocks = splitMarkdownBlocks(text);
        expect(blocks).toEqual([
            "Intro",
            "```\ndef foo():\n    pass\n\n\ndef bar():\n    pass\n```",
        ]);
    });
});
