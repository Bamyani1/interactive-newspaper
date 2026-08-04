import { createHash } from "node:crypto";

/**
 * Pure content-identity primitives for Phase 3 of the RAG roadmap. No I/O.
 *
 * Legacy article ids are positional ("{date}-{index}", minted in
 * src/server/ocr-adapter/article-transform.ts) and re-mint whenever an
 * edition is re-OCRed or its articles reorder. The identity key derived here
 * is deliberately NOT a function of positional index or body text, so the
 * same physical article keeps the same identity across re-OCR runs while body
 * changes surface as new revisions on the same content item.
 */

// Built with `new RegExp` rather than a literal because Unicode property
// escapes in regex literals require a TS target of ES2018+ and the project
// targets ES2017. Matches every run of non-letter/non-digit/non-whitespace.
const NON_ALPHANUMERIC = new RegExp("[^\\p{L}\\p{N}\\s]+", "gu");

/**
 * Normalizes text for identity matching ONLY (never for display): lowercase,
 * punctuation stripped to spaces, whitespace collapsed. This makes identity
 * keys tolerant of OCR noise like stray punctuation and casing drift.
 */
export function normalizeIdentityText(s: string): string {
    return s
        .toLowerCase()
        .replace(NON_ALPHANUMERIC, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export type ContentType = "article" | "ad" | "other";

export interface IdentityInput {
    contentType: ContentType;
    /** Physical page numbers the content appears on. */
    sourcePages: readonly number[];
    headline: string;
    byline?: string | null;
}

/**
 * Derives the stable identity key for a piece of content within one issue:
 *
 *   {contentType}:p{sorted unique pages}:{sha256 of normalized headline+byline, 16 hex}
 *
 * Explicitly NOT a function of positional index or body text — identity must
 * survive re-OCR and reorder. Two content items with the same key inside one
 * issue are the same item (content_items UNIQUE (issue_id, identity_key));
 * body differences become additional content_revisions rows.
 */
export function deriveIdentityKey(input: IdentityInput): string {
    const pages = [...new Set(input.sourcePages)].sort((a, b) => a - b).join(",");
    const digest = createHash("sha256")
        .update(
            `${normalizeIdentityText(input.headline)}\n${normalizeIdentityText(input.byline ?? "")}`,
            "utf8",
        )
        .digest("hex")
        .slice(0, 16);
    return `${input.contentType}:p${pages}:${digest}`;
}

/**
 * The canonical revision payload. Field set mirrors legacyContentRevisionId
 * (src/lib/db.ts) minus `id` and `editionDate`: those identify the content
 * item and issue, not the revision text, and including them would break the
 * "unchanged text => same hash" invariant across re-identification.
 * `full_text` and `writer_position` are intentionally excluded to stay
 * aligned with the legacy hash basis — body_plain is the canonical text
 * (full_text is markup over the same words).
 */
export interface RevisionPayload {
    category: string;
    headline: string;
    summary: string;
    byline: string | null;
    bodyPlain: string;
    imageUrls: string[];
    imageCaptions: (string | null)[];
}

/**
 * Deterministic content-revision hash: changed text => changed hash,
 * unchanged text => same hash. Returns 'crev-sha256:<64 hex>'.
 */
export function contentRevisionHash(fields: RevisionPayload): string {
    const digest = createHash("sha256")
        .update(
            JSON.stringify({
                category: fields.category,
                headline: fields.headline,
                summary: fields.summary,
                byline: fields.byline ?? null,
                bodyPlain: fields.bodyPlain,
                imageUrls: fields.imageUrls,
                imageCaptions: fields.imageCaptions,
            }),
            "utf8",
        )
        .digest("hex");
    return `crev-sha256:${digest}`;
}

export interface ExistingContentItem {
    id: string;
    identityKey: string;
}

export type RevisionMatch =
    | { kind: "matched"; itemId: string }
    | { kind: "new" }
    | { kind: "ambiguous"; itemIds: string[] };

/**
 * Matches an incoming revision candidate against the issue's existing content
 * items by identity key. Exactly one match -> the revision belongs to that
 * item; none -> a new item; several -> ambiguous, which Phase 4's publisher
 * persists into content_identity_conflicts (via AmbiguousIdentityMatchError)
 * and stops.
 */
export function matchRevisionToItems(
    candidate: { identityKey: string },
    existingItems: readonly ExistingContentItem[],
): RevisionMatch {
    const matches = existingItems.filter((item) => item.identityKey === candidate.identityKey);
    if (matches.length === 0) return { kind: "new" };
    if (matches.length === 1) return { kind: "matched", itemId: matches[0].id };
    return { kind: "ambiguous", itemIds: matches.map((item) => item.id) };
}

export class AmbiguousIdentityMatchError extends Error {
    readonly itemIds: string[];

    constructor(itemIds: string[]) {
        super(
            `Ambiguous identity match: ${itemIds.length} content items share the identity key (${itemIds.join(", ")})`,
        );
        this.name = "AmbiguousIdentityMatchError";
        this.itemIds = [...itemIds];
    }
}

/** content_revisions row fields needed to rebuild a legacy article row. */
export interface ContentRevisionRow {
    category: string;
    headline: string;
    summary: string;
    full_text: string;
    body_plain: string;
    byline: string | null;
    writer_position: string | null;
    page: number;
}

/** legacy_content_aliases row fields needed to rebuild a legacy article row. */
export interface LegacyContentAliasRow {
    legacy_id: string;
}

/** The legacy `articles` row projection served by existing APIs. */
export interface LegacyArticleProjection {
    id: string;
    category: string;
    headline: string;
    summary: string;
    full_text: string;
    body_plain: string;
    byline: string | null;
    writer_position: string | null;
    page: number;
}

/**
 * Phase 3 compat proof: reconstructs the exact legacy article row shape from
 * a content revision plus its legacy alias. Revision-backed reads must
 * preserve API shapes byte-for-byte; the id comes from the alias, everything
 * else from the immutable revision.
 */
export function hydrateArticleFromRevision(
    revision: ContentRevisionRow,
    alias: LegacyContentAliasRow,
): LegacyArticleProjection {
    return {
        id: alias.legacy_id,
        category: revision.category,
        headline: revision.headline,
        summary: revision.summary,
        full_text: revision.full_text,
        body_plain: revision.body_plain,
        byline: revision.byline,
        writer_position: revision.writer_position,
        page: revision.page,
    };
}
