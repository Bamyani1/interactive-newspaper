/* eslint-disable @next/next/no-img-element */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NewsFeed } from "../../src/features/news-feed/components/NewsFeed";
import { ArticleCard } from "../../src/features/news-feed/components/ArticleCard";
import type { Article } from "../../src/features/news-feed/data/mockData";
import type { SectionId } from "../../src/features/news-feed";

vi.mock("next/link", () => ({
    default: ({
        children,
        href,
        ...props
    }: React.PropsWithChildren<{ href: string }>) => (
        <a href={href} {...props}>
            {children}
        </a>
    ),
}));

vi.mock("next/image", () => ({
    default: ({
        alt,
        src,
        ...props
    }: React.ImgHTMLAttributes<HTMLImageElement> & { src?: string }) => (
        <img alt={alt ?? ""} src={src ?? ""} {...props} />
    ),
}));

vi.mock("@/features/theme", () => ({
    ThemeModeToggle: () => <button type="button">Theme</button>,
}));

function makeArticle(overrides: Partial<Article> = {}): Article {
    return {
        id: "hero-news",
        date: "1987-10-14",
        category: "News",
        headline: "Cracked pipe cools campus",
        summary: "Heat was restored to residential halls after repairs began.",
        fullText: "<p>Full article body from hero story.</p>",
        imageUrls: [],
        imageCaptions: [],
        page: 1,
        isHero: true,
        isFeatured: true,
        ...overrides,
    };
}

function renderNewsFeed({
    articles = [makeArticle()],
    editionDate = "1987-10-14",
    activeSection = "Top",
}: {
    articles?: Article[];
    editionDate?: string | null;
    activeSection?: SectionId;
}) {
    return render(
        <NewsFeed
            articles={articles}
            displayAds={[]}
            classifiedAds={[]}
            editionDate={editionDate}
            editions={["1987-10-14"]}
            onDateChange={vi.fn()}
            activeSection={activeSection}
            onSectionChange={vi.fn()}
        />
    );
}

describe("NewsFeed data source and full-story rendering", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("renders hero headline and full text in print edition layout", () => {
        renderNewsFeed({
            editionDate: null,
            articles: [makeArticle()],
        });

        expect(screen.getByText("Cracked pipe cools campus")).toBeDefined();
        // TopStoriesPrintEdition renders fullText directly (no summary card)
        expect(screen.getByText("Full article body from hero story.")).toBeDefined();
    });

    it("renders hero fullText inline without needing expansion", () => {
        renderNewsFeed({
            articles: [makeArticle()],
        });

        // In print edition layout, the full text is displayed directly
        expect(screen.getByText("Cracked pipe cools campus")).toBeDefined();
        expect(screen.getByText("Full article body from hero story.")).toBeDefined();
    });

    it("renders hero fullText even when article id is empty", () => {
        renderNewsFeed({
            articles: [makeArticle({ id: "" })],
        });

        expect(screen.getByText("Cracked pipe cools campus")).toBeDefined();
        expect(screen.getByText("Full article body from hero story.")).toBeDefined();
    });

    it("renders fallback message when expanded article has no fullText or summary", () => {
        render(
            <ArticleCard
                article={makeArticle({
                    id: "empty-body",
                    headline: "Empty content story",
                    summary: "",
                    fullText: "   ",
                    isHero: false,
                    isFeatured: false,
                })}
                isExpanded
                onToggle={vi.fn()}
            />
        );

        expect(
            screen.getByText("Full story text unavailable for this article.")
        ).toBeDefined();
    });

    it("remains interactive when switching from Top Stories to section view", () => {
        const hero = makeArticle();
        const secondaryNews = makeArticle({
            id: "news-2",
            headline: "Second news story",
            summary: "Secondary summary",
            fullText: "<p>Secondary full text.</p>",
            isHero: false,
            isFeatured: false,
            page: 2,
        });

        const { rerender } = render(
            <NewsFeed
                articles={[hero, secondaryNews]}
                displayAds={[]}
                classifiedAds={[]}
                editionDate={null}
                editions={["1987-10-14"]}
                onDateChange={vi.fn()}
                activeSection="Top"
                onSectionChange={vi.fn()}
            />
        );

        // Full text is shown directly in print edition layout
        expect(screen.getByText("Full article body from hero story.")).toBeDefined();

        rerender(
            <NewsFeed
                articles={[hero, secondaryNews]}
                displayAds={[]}
                classifiedAds={[]}
                editionDate={null}
                editions={["1987-10-14"]}
                onDateChange={vi.fn()}
                activeSection="News"
                onSectionChange={vi.fn()}
            />
        );

        expect(screen.queryByText("No stories found for this section.")).toBeNull();
        expect(screen.getByText("Second news story")).toBeDefined();
    });
});
