import { createHash } from "crypto";
import type { Citation, CitationSnapshot } from "@/src/types";

const MAX_EVIDENCE_CHARS = 2_000;
const MAX_SNAPSHOT_IMAGES = 10;

export interface CitationSnapshotSource {
    id: string;
    contentRevisionId?: string;
    headline: string;
    editionDate: string;
    category: string;
    summary: string;
    byline: string | null;
    bodyPlain?: string;
    bodySnippet?: string;
    matchedPassages?: string[];
    evidenceText?: string;
    imageUrls: string[];
    imageCaptions: (string | null)[];
}

function clippedEvidence(value: string): string {
    if (value.length <= MAX_EVIDENCE_CHARS) return value;
    const half = Math.floor((MAX_EVIDENCE_CHARS - 24) / 2);
    return `${value.slice(0, half)}\n[…snapshot clipped…]\n${value.slice(-half)}`;
}

function derivedRevisionId(source: CitationSnapshotSource): string {
    const digest = createHash("sha256")
        .update(
            JSON.stringify({
                id: source.id,
                editionDate: source.editionDate,
                category: source.category,
                headline: source.headline,
                summary: source.summary,
                byline: source.byline,
                body: source.bodyPlain ?? source.evidenceText ?? source.bodySnippet ?? "",
                imageUrls: source.imageUrls,
                imageCaptions: source.imageCaptions,
            }),
        )
        .digest("hex");
    return `legacy-sha256:${digest}`;
}

export function buildCitationSnapshots(
    citations: Citation[],
    sources: Iterable<CitationSnapshotSource>,
): CitationSnapshot[] {
    const byId = new Map(Array.from(sources, (source) => [source.id, source]));
    const snapshots: CitationSnapshot[] = [];
    const seen = new Set<string>();

    for (const citation of citations) {
        if (seen.has(citation.articleId)) continue;
        const source = byId.get(citation.articleId);
        if (!source) continue;
        seen.add(citation.articleId);
        const evidence =
            source.matchedPassages?.filter(Boolean).join("\n\n") ||
            source.evidenceText ||
            source.bodyPlain ||
            source.bodySnippet ||
            source.summary;
        const body = source.bodyPlain ?? source.bodySnippet ?? evidence;
        const imageUrls = source.imageUrls.slice(0, MAX_SNAPSHOT_IMAGES);
        snapshots.push({
            articleId: source.id,
            contentRevisionId:
                citation.contentRevisionId ||
                source.contentRevisionId ||
                derivedRevisionId(source),
            headline: source.headline,
            editionDate: source.editionDate,
            category: source.category,
            summary: source.summary,
            byline: source.byline,
            bodySnippet: body.slice(0, 300) + (body.length > 300 ? "…" : ""),
            evidenceSnippet: clippedEvidence(evidence),
            imageUrls,
            imageCaptions: source.imageCaptions.slice(0, imageUrls.length),
        });
    }

    return snapshots;
}

export function isCitationSnapshot(value: unknown): value is CitationSnapshot {
    if (!value || typeof value !== "object") return false;
    const snapshot = value as Record<string, unknown>;
    return (
        typeof snapshot.articleId === "string" &&
        typeof snapshot.contentRevisionId === "string" &&
        typeof snapshot.headline === "string" &&
        typeof snapshot.editionDate === "string" &&
        typeof snapshot.category === "string" &&
        typeof snapshot.summary === "string" &&
        (typeof snapshot.byline === "string" || snapshot.byline === null) &&
        typeof snapshot.bodySnippet === "string" &&
        typeof snapshot.evidenceSnippet === "string" &&
        Array.isArray(snapshot.imageUrls) &&
        snapshot.imageUrls.every((url) => typeof url === "string") &&
        Array.isArray(snapshot.imageCaptions) &&
        snapshot.imageCaptions.every(
            (caption) => typeof caption === "string" || caption === null,
        )
    );
}
