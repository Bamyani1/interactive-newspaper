import {
    buildEmbeddingInput,
    embeddingInputFingerprint,
    type EmbedInput,
} from "@/src/lib/embeddings";

export const ARTICLE_CHUNK_TARGET_CHARS = 3_200;
export const ARTICLE_CHUNK_OVERLAP_CHARS = 600;

export interface ChunkableArticle {
    id: string;
    headline: string;
    byline?: string | null;
    body_plain: string;
    edition_date?: string | null;
    category?: string | null;
    summary?: string | null;
}

export interface ArticleChunkRecord {
    id: string;
    articleId: string;
    chunkIndex: number;
    chunkText: string;
    embeddingInput: EmbedInput;
    embeddingInputHash: string;
}

function splitLongSegment(segment: string, targetChars: number): string[] {
    if (segment.length <= targetChars) return [segment];
    const pieces: string[] = [];
    let cursor = 0;
    while (cursor < segment.length) {
        let end = Math.min(segment.length, cursor + targetChars);
        if (end < segment.length) {
            const boundary = segment.lastIndexOf(" ", end);
            if (boundary > cursor + Math.floor(targetChars * 0.6)) end = boundary;
        }
        pieces.push(segment.slice(cursor, end).trim());
        cursor = end;
        while (segment[cursor] === " ") cursor += 1;
    }
    return pieces.filter(Boolean);
}

/**
 * Deterministic sentence-aware chunking. The overlap is composed of complete
 * trailing sentences, so a quote or paragraph seam is not cut merely to hit
 * an exact character count.
 */
export function chunkArticleBody(
    body: string,
    targetChars = ARTICLE_CHUNK_TARGET_CHARS,
    overlapChars = ARTICLE_CHUNK_OVERLAP_CHARS,
): string[] {
    const normalized = body.replace(/\s+/g, " ").trim();
    if (!normalized) return [""];

    const rawSentences = normalized.match(/[^.!?]+(?:[.!?]+(?:["'”’)]*)|$)/g) ?? [normalized];
    const sentences = rawSentences
        .flatMap((sentence) => splitLongSegment(sentence.trim(), targetChars))
        .filter(Boolean);

    const chunks: string[] = [];
    let current: string[] = [];
    let currentLength = 0;

    for (const sentence of sentences) {
        const addedLength = sentence.length + (current.length > 0 ? 1 : 0);
        if (current.length > 0 && currentLength + addedLength > targetChars) {
            chunks.push(current.join(" ").trim());

            const overlap: string[] = [];
            let overlapLength = 0;
            for (let index = current.length - 1; index >= 0; index -= 1) {
                const candidate = current[index];
                const candidateLength = candidate.length + (overlap.length > 0 ? 1 : 0);
                if (overlapLength + candidateLength > overlapChars) break;
                overlap.unshift(candidate);
                overlapLength += candidateLength;
            }
            current = overlap;
            currentLength = overlapLength;
        }

        current.push(sentence);
        currentLength += sentence.length + (current.length > 1 ? 1 : 0);
    }

    if (current.length > 0) chunks.push(current.join(" ").trim());
    return chunks.filter((chunk, index) => chunk && chunk !== chunks[index - 1]);
}

export function buildArticleChunkRecords(article: ChunkableArticle): ArticleChunkRecord[] {
    return chunkArticleBody(article.body_plain).map((chunkText, chunkIndex) => {
        const embeddingInput = buildEmbeddingInput({
            headline: article.headline,
            byline: article.byline,
            body_plain: chunkText,
            edition_date: article.edition_date,
            category: article.category,
            summary: chunkIndex === 0 ? article.summary : null,
        });
        return {
            id: `${article.id}:${String(chunkIndex).padStart(4, "0")}`,
            articleId: article.id,
            chunkIndex,
            chunkText,
            embeddingInput,
            embeddingInputHash: embeddingInputFingerprint(embeddingInput),
        };
    });
}
