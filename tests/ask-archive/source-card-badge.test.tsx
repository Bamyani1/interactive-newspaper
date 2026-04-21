import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceCard } from "@/features/ask-archive/components/SourceCard";
import type { AskResponse } from "@/src/types";

vi.mock("next/image", () => ({
    __esModule: true,
    default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => {
        const { alt, src, ...rest } = props;
        // eslint-disable-next-line @next/next/no-img-element
        return <img alt={alt ?? ""} src={String(src)} {...rest} />;
    },
}));

type Source = AskResponse["sourceArticles"][number];

function makeSource(imageUrls: string[]): Source {
    return {
        id: "1960-05-11-0",
        headline: "Campus news",
        editionDate: "1960-05-11",
        category: "News",
        summary: "",
        byline: null,
        bodySnippet: "snippet",
        distance: 0,
        imageUrls,
        imageCaptions: imageUrls.map(() => null),
    };
}

describe("SourceCard image-count badge", () => {
    it("hides the badge when there is only one photo", () => {
        render(<SourceCard source={makeSource(["u1"])} index={0} />);
        expect(document.querySelector(".ask-source-thumb-count")).toBeNull();
    });

    it("shows +N when the article carries multiple photos", () => {
        render(
            <SourceCard
                source={makeSource(["u1", "u2", "u3", "u4"])}
                index={0}
            />,
        );
        const badge = document.querySelector(".ask-source-thumb-count");
        expect(badge).not.toBeNull();
        expect(badge?.textContent).toBe("+3");
    });

    it("hides the badge (and thumbnail) when there are no photos", () => {
        render(<SourceCard source={makeSource([])} index={0} />);
        expect(document.querySelector(".ask-source-card-thumb")).toBeNull();
        expect(document.querySelector(".ask-source-thumb-count")).toBeNull();
    });

    it("labels the badge for assistive tech", () => {
        render(
            <SourceCard source={makeSource(["u1", "u2"])} index={0} />,
        );
        expect(
            screen.getByLabelText(/2 photos in this article/i),
        ).toBeInTheDocument();
    });
});
