import { Article, AdType, VintageAd, OcrEdition, OcrEnrichedAd } from "@/src/types";
import fs from "fs/promises";
import path from "path";
import { GoldenEditionClient } from "./client";

export default async function GoldenPage() {
    const EDITION_DATE = "1980-04-17";
    const filePath = path.join(process.cwd(), `tests/ocr/gold_data/${EDITION_DATE}/edition.json`);

    let rawData: OcrEdition;
    try {
        const fileContent = await fs.readFile(filePath, "utf-8");
        rawData = JSON.parse(fileContent);
    } catch {
        return (
            <div className="p-8 text-black bg-white min-h-screen">
                <h1 className="text-2xl font-bold">Failed to load Golden Dataset</h1>
                <p>Ensure the dataset exists at tests/ocr/gold_data/{EDITION_DATE}/edition.json</p>
            </div>
        );
    }

    // Map OCR Articles to Frontend Articles
    const articles: Article[] = rawData.articles.map((a, i) => {
        const title = a.headline || `Article ${i + 1}`;
        const sourcePage = a.source_pages?.[0] ? parseInt(a.source_pages[0], 10) : 1;

        return {
            id: `golden-article-${i}`,
            date: EDITION_DATE,
            category: (a.category as Article["category"]) || "News",
            headline: title,
            summary: a.body?.substring(0, 150) + "..." || "",
            fullText: a.body || "",
            // Route images specifically to our new API endpoint
            imageUrls: (a.image_files || []).map(f => `/api/golden-image/${encodeURIComponent(path.basename(f))}`),
            byline: a.author || null,
            writerPosition: a.writer_position || null,
            page: sourcePage,
            isHero: i === 0, // Make first article hero
            isFeatured: i > 0 && i < 4,
            imageCaptions: (a.images || []).map(img => img.caption || null),
            imageCaption: a.images?.[0]?.caption || null,
        };
    });

    // Map OCR Ads to Frontend Ads
    const displayAds: VintageAd[] = [];
    const classifiedAds: VintageAd[] = [];

    rawData.ads.forEach((ad, i) => {
        const mappedAd: VintageAd = {
            title: ad.business_name || `Advertisement ${i + 1}`,
            body: ad.body || "",
            imageUrls: (ad.image_files || []).map(f => `/api/golden-image/${encodeURIComponent(path.basename(f))}`),
            category: "Other",
            adType: (("ad_type" in ad ? (ad as OcrEnrichedAd).ad_type : null) || (ad.image_files?.length ? "display" : "classified")) as AdType,
        };

        if (mappedAd.adType === "display" || mappedAd.body.length >= 200) {
            displayAds.push(mappedAd);
        } else {
            classifiedAds.push(mappedAd);
        }
    });

    return (
        <GoldenEditionClient
            articles={articles}
            displayAds={displayAds}
            classifiedAds={classifiedAds}
            editionDate={EDITION_DATE}
            publicationInfo={rawData.publication_info || "The Ohio Wesleyan Transcript • Delaware, Ohio"}
        />
    );
}
