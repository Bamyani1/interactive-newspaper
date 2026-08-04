import { createHash } from "node:crypto";
import type { QueryExecutor, SqlStatement } from "../../../scripts/db/lib/migration-runner";
import type { OcrArticle, OcrEdition, OcrImage } from "../../types";
import {
    AmbiguousIdentityMatchError,
    contentRevisionHash,
    deriveIdentityKey,
    matchRevisionToItems,
    type ContentType,
    type ExistingContentItem,
    type RevisionPayload,
} from "../identity/content-identity";
import { ulid } from "../identity/ulid";
import { computePageCount, transformAds, transformArticles } from "../ocr-adapter";

/**
 * Phase 4 adapter-to-revision bridge. Given one edition.json (OcrEdition), it
 * writes the immutable Phase 3 rows for that edition — edition_revisions,
 * edition_revision_pages, content_items, content_revisions,
 * legacy_content_aliases, assets, asset_references — preserving everything the
 * legacy tables drop (page lineage, ads/other_content revisions, captions and
 * credits on assets). It NEVER writes to legacy tables (editions/articles/ads).
 *
 * Payload columns come from the existing OCR adapter (transformArticles /
 * transformAds / computePageCount); this module never reimplements adapter
 * rules, it only maps adapter output onto revision rows.
 *
 * Atomicity: everything is planned in memory first (including the ambiguity
 * check), then written in ONE transactionBatch. On an ambiguous identity match
 * the writer records content_identity_conflicts rows and throws
 * AmbiguousIdentityMatchError before any content write happens.
 *
 * Whole-edition revision_hash recipe (deterministic):
 *   'erev-sha256:' + sha256hex(JSON.stringify({
 *       v: 1,
 *       publicationInfo,
 *       content: [[contentType, identityKey, contentRevisionHash], ...],
 *       pages: { expected, statuses: [status of page 1..expected] },
 *   }))
 * The content list is ordered exactly as candidates are planned: adapter
 * article order, then adapter ad order, then other_content input order — so
 * identical input always produces the identical hash, and any change to
 * content text, identity, page lineage, or publication info produces a new
 * edition revision. If (issue_id, revision_hash) already exists the call is an
 * idempotent re-stage: it returns created:false and writes nothing.
 *
 * Documented approximations and conventions:
 * - expected_pages falls back to computePageCount(edition) — the max page
 *   number referenced by any article's source_pages — when input.expectedPages
 *   is absent. That is an approximation: trailing pages with no surviving
 *   articles are invisible to it, which is exactly why callers that know the
 *   true page count (from acquisition) should pass expectedPages.
 * - Ad identity has no page lineage in the OCR contract, so ad identity keys
 *   are derived from the business name/title alone with an empty source-page
 *   list. Structured enriched-ad fields that have no revision column
 *   (ad_type, phone, address, price) are preserved on the owning
 *   content_items.identity_evidence under `adFields`; display_text maps to the
 *   revision `summary` column so it participates in the revision hash.
 * - other_content identity comes from the normalized title alone (no pages);
 *   entries whose body is empty/whitespace are skipped as non-substantive.
 * - Ad alias legacy ids are 'ad:{date}:{position}' where position is the index
 *   in the adapter's transformAds output. This key is regenerated per staging
 *   and is NOT stable across differing inputs (an ad added mid-list shifts
 *   later positions); it exists so ads deferred from Phase 3 still land in
 *   legacy_content_aliases with a queryable handle.
 * - Aliases are stable on item linkage but track the latest revision:
 *   ON CONFLICT (legacy_id) DO UPDATE only repoints content_revision_id; the
 *   content_item_id linkage set at first staging is never rewritten.
 * - Asset join: scripts/db/upload-images.mjs rewrites edition.json image
 *   references to content-addressed 'images/<sha256>.webp' paths and records
 *   the same names in the manifest's public_path. The adapter turns those into
 *   URLs whose basename is still '<sha256>.webp' (resolveImageUrl keeps the
 *   basename in both CDN and API-proxy forms), so manifest entries are joined
 *   to article images by that basename. Credits are read from the raw OCR
 *   image entry aligned via the same basename against image_files.
 * - This writer stages AND activates content-level pointers
 *   (content_items.active_revision_id); edition-level activation
 *   (issues.active_edition_revision_id) stays with the publication-run state
 *   machine.
 */

export type PageStatus = "processed" | "failed" | "missing";

export interface AssetManifestEntry {
    hash: string;
    public_path: string;
    r2_key: string;
    size_bytes: number;
    width?: number | null;
    height?: number | null;
    quality?: number | null;
    status?: string;
    source_sha256?: string | null;
    mime_type?: string | null;
}

export interface AssetManifestV2 {
    schema_version: 2;
    date: string;
    assets: AssetManifestEntry[];
}

export interface WriteEditionRevisionInput {
    editionDate: string;
    edition: OcrEdition;
    runId?: string | null;
    expectedPages?: number;
    /** Explicit per-page status overrides, keyed by 1-based page number. */
    pageStates?: Partial<Record<number, PageStatus>>;
    assetManifest?: AssetManifestV2;
}

export interface WriteEditionRevisionCounts {
    items: number;
    revisions: number;
    aliases: number;
    pages: number;
    assets: number;
    refs: number;
}

export interface WriteEditionRevisionResult {
    issueId: string;
    editionRevisionId: string;
    created: boolean;
    counts: WriteEditionRevisionCounts;
}

type AliasKind = "article" | "ad";

interface PlannedAssetRef {
    position: number;
    sha256: string;
    printedCaption: string | null;
    credit: string | null;
}

interface RevisionColumns {
    category: string;
    headline: string;
    summary: string;
    fullText: string;
    bodyPlain: string;
    byline: string | null;
    writerPosition: string | null;
    page: number;
}

interface ContentCandidate {
    contentType: ContentType;
    identityKey: string;
    payload: RevisionPayload;
    columns: RevisionColumns;
    legacyId: string | null;
    aliasKind: AliasKind | null;
    identityEvidence: Record<string, unknown>;
    assetRefs: PlannedAssetRef[];
}

interface PlannedItem {
    id: string;
    isNew: boolean;
    contentType: ContentType;
    identityKey: string;
    identityEvidence: Record<string, unknown>;
}

function sha256Hex(input: string): string {
    return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Mirrors stripHtml in scripts/db/seed.mjs (null bytes stripped, tags removed,
 * whitespace collapsed) so body_plain here is byte-identical to what the
 * legacy seed would store for the same adapter output — the golden
 * hydrateArticleFromRevision comparison depends on this.
 */
function stripHtml(html: string): string {
    return html
        .replace(/\0/g, "")
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Deterministic content_revisions primary key — same recipe as
 * scripts/db/backfill-identities.mjs so re-staging identical text lands on the
 * exact row the backfill (or a previous staging) already minted.
 */
function revisionRowId(contentItemId: string, revisionHash: string): string {
    return `crev-${sha256Hex(`${contentItemId}\n${revisionHash}`).slice(0, 32)}`;
}

function basenameOf(p: string): string {
    const parts = p.split("/");
    return parts[parts.length - 1] ?? "";
}

/** Postgres text[] literal for parameter binding (ids contain no quotes). */
function textArrayLiteral(values: readonly string[]): string {
    return `{${values.map((v) => `"${v}"`).join(",")}}`;
}

function parseSourcePages(raw: OcrArticle | undefined, fallbackPage: number): number[] {
    const pages = (raw?.source_pages ?? [])
        .map((p) => parseInt(p, 10))
        .filter((n) => Number.isInteger(n) && n > 0);
    return pages.length > 0 ? pages : [fallbackPage];
}

function buildCandidates(
    input: WriteEditionRevisionInput,
): ContentCandidate[] {
    const { edition, editionDate } = input;
    const candidates: ContentCandidate[] = [];

    const manifestByBasename = new Map<string, AssetManifestEntry>();
    for (const entry of input.assetManifest?.assets ?? []) {
        manifestByBasename.set(basenameOf(entry.public_path), entry);
    }

    // Articles: adapter ordering; legacy id is the adapter-minted "{date}-{i}".
    for (const article of transformArticles(edition)) {
        const rawIndex = Number(article.id.slice(editionDate.length + 1));
        const raw = Number.isInteger(rawIndex) ? edition.articles?.[rawIndex] : undefined;
        const sourcePages = parseSourcePages(raw, article.page);
        const byline = article.byline ?? null;
        const bodyPlain = stripHtml(article.fullText);

        const assetRefs: PlannedAssetRef[] = [];
        for (let pos = 0; pos < article.imageUrls.length; pos += 1) {
            const urlBasename = decodeURIComponent(basenameOf(article.imageUrls[pos]));
            const entry = manifestByBasename.get(urlBasename);
            if (!entry) continue;
            // Credit lives on the raw OCR image entry; align it by the same
            // content-addressed basename against image_files.
            let credit: string | null = null;
            const fileIndex = (raw?.image_files ?? []).findIndex(
                (f) => basenameOf(f) === urlBasename,
            );
            if (fileIndex >= 0) {
                const rawImage = raw?.images?.[fileIndex] as
                    | (OcrImage & { credit?: unknown })
                    | undefined;
                if (typeof rawImage?.credit === "string" && rawImage.credit.trim() !== "") {
                    credit = rawImage.credit;
                }
            }
            assetRefs.push({
                position: pos,
                sha256: entry.hash,
                printedCaption: article.imageCaptions[pos] ?? null,
                credit,
            });
        }

        candidates.push({
            contentType: "article",
            identityKey: deriveIdentityKey({
                contentType: "article",
                sourcePages,
                headline: article.headline,
                byline,
            }),
            payload: {
                category: article.category,
                headline: article.headline,
                summary: article.summary,
                byline,
                bodyPlain,
                imageUrls: article.imageUrls,
                imageCaptions: article.imageCaptions,
            },
            columns: {
                category: article.category,
                headline: article.headline,
                summary: article.summary,
                fullText: article.fullText,
                bodyPlain,
                byline,
                writerPosition: article.writerPosition ?? null,
                page: article.page,
            },
            legacyId: article.id,
            aliasKind: "article",
            identityEvidence: {
                source: "revision-writer",
                legacyId: article.id,
                sourcePages,
                headline: article.headline,
                byline,
            },
            assetRefs,
        });
    }

    // Ads: no page lineage in the OCR contract — identity from the title
    // (business name) alone; positional legacy id regenerated per staging.
    const ads = transformAds(edition);
    for (let position = 0; position < ads.length; position += 1) {
        const ad = ads[position];
        const legacyId = `ad:${editionDate}:${position}`;
        const adFields: Record<string, unknown> = {};
        if (ad.adType !== undefined) adFields.adType = ad.adType;
        if (ad.phone !== undefined) adFields.phone = ad.phone;
        if (ad.address !== undefined) adFields.address = ad.address;
        if (ad.price !== undefined) adFields.price = ad.price;

        candidates.push({
            contentType: "ad",
            identityKey: deriveIdentityKey({
                contentType: "ad",
                sourcePages: [],
                headline: ad.title ?? "",
                byline: null,
            }),
            payload: {
                category: ad.category ?? "Other",
                headline: ad.title ?? "",
                summary: ad.displayText ?? "",
                byline: null,
                bodyPlain: ad.body ?? "",
                imageUrls: ad.imageUrls ?? [],
                imageCaptions: [],
            },
            columns: {
                category: ad.category ?? "Other",
                headline: ad.title ?? "",
                summary: ad.displayText ?? "",
                fullText: ad.body ?? "",
                bodyPlain: ad.body ?? "",
                byline: null,
                writerPosition: null,
                page: 1,
            },
            legacyId,
            aliasKind: "ad",
            identityEvidence: {
                source: "revision-writer",
                legacyId,
                title: ad.title ?? "",
                adFields,
            },
            assetRefs: [],
        });
    }

    // Substantive other_content: identity from normalized title; entries with
    // an empty/whitespace body are non-substantive and skipped.
    for (const entry of edition.other_content ?? []) {
        const body = (entry?.body ?? "").trim();
        if (body === "") continue;
        const title = entry.title ?? "";
        candidates.push({
            contentType: "other",
            identityKey: deriveIdentityKey({
                contentType: "other",
                sourcePages: [],
                headline: title,
                byline: null,
            }),
            payload: {
                category: "Other",
                headline: title,
                summary: "",
                byline: null,
                bodyPlain: entry.body,
                imageUrls: [],
                imageCaptions: [],
            },
            columns: {
                category: "Other",
                headline: title,
                summary: "",
                fullText: entry.body,
                bodyPlain: entry.body,
                byline: null,
                writerPosition: null,
                page: 1,
            },
            legacyId: null,
            aliasKind: null,
            identityEvidence: { source: "revision-writer", title },
            assetRefs: [],
        });
    }

    return candidates;
}

export async function writeEditionRevision(
    executor: QueryExecutor,
    input: WriteEditionRevisionInput,
): Promise<WriteEditionRevisionResult> {
    const { edition, editionDate } = input;
    if (edition.edition_date !== editionDate) {
        throw new Error(
            `editionDate "${editionDate}" does not match edition.edition_date "${edition.edition_date}"`,
        );
    }

    const candidates = buildCandidates(input);

    // 1. Resolve or create the issue (legacy_edition_aliases is the anchor).
    const aliasRows = await executor.query({
        text: "SELECT issue_id FROM legacy_edition_aliases WHERE date = $1",
        params: [editionDate],
    });
    const issueIsNew = aliasRows.length === 0;
    const issueId = issueIsNew ? ulid() : String(aliasRows[0].issue_id);

    // 2. Plan items against the issue's existing items of the same type.
    const existingRows = issueIsNew
        ? []
        : await executor.query({
              text: "SELECT id, content_type, identity_key FROM content_items WHERE issue_id = $1",
              params: [issueId],
          });
    const existingByType = new Map<ContentType, ExistingContentItem[]>();
    for (const row of existingRows) {
        const type = String(row.content_type) as ContentType;
        const list = existingByType.get(type) ?? [];
        list.push({ id: String(row.id), identityKey: String(row.identity_key) });
        existingByType.set(type, list);
    }

    const plannedByKey = new Map<string, PlannedItem>();
    const conflicts: { evidence: Record<string, unknown>; itemIds: string[] }[] = [];
    const itemForCandidate: PlannedItem[] = [];

    for (const candidate of candidates) {
        // In-batch fold: a second candidate with the same identity key becomes
        // another revision of the already-planned item instead of a duplicate
        // item that would violate UNIQUE (issue_id, identity_key).
        let planned = plannedByKey.get(candidate.identityKey);
        if (!planned) {
            const match = matchRevisionToItems(
                { identityKey: candidate.identityKey },
                existingByType.get(candidate.contentType) ?? [],
            );
            if (match.kind === "ambiguous") {
                conflicts.push({
                    evidence: { identityKey: candidate.identityKey, ...candidate.identityEvidence },
                    itemIds: match.itemIds,
                });
                itemForCandidate.push({
                    id: "",
                    isNew: false,
                    contentType: candidate.contentType,
                    identityKey: candidate.identityKey,
                    identityEvidence: candidate.identityEvidence,
                });
                continue;
            }
            planned = {
                id: match.kind === "matched" ? match.itemId : ulid(),
                isNew: match.kind === "new",
                contentType: candidate.contentType,
                identityKey: candidate.identityKey,
                identityEvidence: candidate.identityEvidence,
            };
            plannedByKey.set(candidate.identityKey, planned);
        }
        itemForCandidate.push(planned);
    }

    // Ambiguity: persist the review-queue rows, then stop with NO content
    // writes — planning happened entirely in memory, so nothing else exists.
    if (conflicts.length > 0) {
        const conflictStatements: SqlStatement[] = conflicts.map((conflict) => ({
            text: `INSERT INTO content_identity_conflicts (issue_id, candidate_evidence, candidate_item_ids)
                   VALUES ($1, $2::jsonb, $3::text[])`,
            params: [issueId, JSON.stringify(conflict.evidence), textArrayLiteral(conflict.itemIds)],
        }));
        await executor.transactionBatch(conflictStatements);
        throw new AmbiguousIdentityMatchError([
            ...new Set(conflicts.flatMap((conflict) => conflict.itemIds)),
        ]);
    }

    // 3. Plan revisions. Existing (content_item_id, revision_hash) pairs are
    //    reused verbatim (re-OCR with identical text is a no-op).
    const matchedItemIds = [...plannedByKey.values()]
        .filter((item) => !item.isNew)
        .map((item) => item.id);
    const existingRevisionIdByKey = new Map<string, string>();
    if (matchedItemIds.length > 0) {
        const revisionRows = await executor.query({
            text: `SELECT id, content_item_id, revision_hash FROM content_revisions
                   WHERE content_item_id = ANY($1::text[])`,
            params: [textArrayLiteral(matchedItemIds)],
        });
        for (const row of revisionRows) {
            existingRevisionIdByKey.set(
                `${String(row.content_item_id)}\n${String(row.revision_hash)}`,
                String(row.id),
            );
        }
    }

    interface PlannedRevision {
        id: string;
        itemId: string;
        revisionHash: string;
        isNew: boolean;
        columns: RevisionColumns;
    }
    const revisionByKey = new Map<string, PlannedRevision>();
    const revisionForCandidate: PlannedRevision[] = [];
    for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const itemId = itemForCandidate[i].id;
        const revisionHash = contentRevisionHash(candidate.payload);
        const key = `${itemId}\n${revisionHash}`;
        let planned = revisionByKey.get(key);
        if (!planned) {
            const existingId = existingRevisionIdByKey.get(key);
            planned = {
                id: existingId ?? revisionRowId(itemId, revisionHash),
                itemId,
                revisionHash,
                isNew: existingId === undefined,
                columns: candidate.columns,
            };
            revisionByKey.set(key, planned);
        }
        revisionForCandidate.push(planned);
    }

    // 4. Page lineage: explicit pageStates win; otherwise a page covered by any
    //    article source page is 'processed', anything else 'missing'.
    const expectedPages = input.expectedPages ?? computePageCount(edition);
    const coveredPages = new Set<number>();
    for (const article of edition.articles ?? []) {
        for (const p of article.source_pages ?? []) {
            const n = parseInt(p, 10);
            if (Number.isInteger(n) && n > 0) coveredPages.add(n);
        }
    }
    const pageStatuses: PageStatus[] = [];
    for (let page = 1; page <= expectedPages; page += 1) {
        const explicit = input.pageStates?.[page];
        pageStatuses.push(explicit ?? (coveredPages.has(page) ? "processed" : "missing"));
    }
    const processedPages = pageStatuses.filter((s) => s === "processed").length;
    const failedPages = pageStatuses
        .map((status, index) => ({ status, page: index + 1 }))
        .filter((entry) => entry.status === "failed")
        .map((entry) => entry.page);

    // 5. Whole-edition revision hash (recipe documented in the module header).
    const revisionHash = `erev-sha256:${sha256Hex(
        JSON.stringify({
            v: 1,
            publicationInfo: edition.publication_info ?? "",
            content: candidates.map((candidate, i) => [
                candidate.contentType,
                candidate.identityKey,
                revisionForCandidate[i].revisionHash,
            ]),
            pages: { expected: expectedPages, statuses: pageStatuses },
        }),
    )}`;

    // 6. Idempotent re-stage: the identical edition already exists.
    if (!issueIsNew) {
        const existingRevision = await executor.query({
            text: "SELECT id FROM edition_revisions WHERE issue_id = $1 AND revision_hash = $2",
            params: [issueId, revisionHash],
        });
        if (existingRevision.length > 0) {
            return {
                issueId,
                editionRevisionId: String(existingRevision[0].id),
                created: false,
                counts: { items: 0, revisions: 0, aliases: 0, pages: 0, assets: 0, refs: 0 },
            };
        }
    }

    // 7. Pre-count what will actually be new (aliases/assets/refs upsert).
    const plannedAliases = candidates
        .map((candidate, i) => ({
            legacyId: candidate.legacyId,
            aliasKind: candidate.aliasKind,
            itemId: itemForCandidate[i].id,
            revisionId: revisionForCandidate[i].id,
        }))
        .filter(
            (alias): alias is { legacyId: string; aliasKind: AliasKind; itemId: string; revisionId: string } =>
                alias.legacyId !== null && alias.aliasKind !== null,
        );
    const existingAliasIds = new Set<string>();
    if (plannedAliases.length > 0) {
        const rows = await executor.query({
            text: "SELECT legacy_id FROM legacy_content_aliases WHERE legacy_id = ANY($1::text[])",
            params: [textArrayLiteral(plannedAliases.map((alias) => alias.legacyId))],
        });
        for (const row of rows) existingAliasIds.add(String(row.legacy_id));
    }

    const manifestAssets = new Map<string, AssetManifestEntry>();
    for (const entry of input.assetManifest?.assets ?? []) {
        manifestAssets.set(entry.hash, entry);
    }
    const existingAssetHashes = new Set<string>();
    if (manifestAssets.size > 0) {
        const rows = await executor.query({
            text: "SELECT sha256 FROM assets WHERE sha256 = ANY($1::text[])",
            params: [textArrayLiteral([...manifestAssets.keys()])],
        });
        for (const row of rows) existingAssetHashes.add(String(row.sha256));
    }

    const plannedRefs = candidates.flatMap((candidate, i) =>
        candidate.assetRefs.map((ref) => ({ ...ref, revisionId: revisionForCandidate[i].id })),
    );
    const existingRefKeys = new Set<string>();
    if (plannedRefs.length > 0) {
        const rows = await executor.query({
            text: `SELECT content_revision_id, position FROM asset_references
                   WHERE content_revision_id = ANY($1::text[])`,
            params: [textArrayLiteral([...new Set(plannedRefs.map((ref) => ref.revisionId))])],
        });
        for (const row of rows) {
            existingRefKeys.add(`${String(row.content_revision_id)}\n${Number(row.position)}`);
        }
    }

    // 8. Build the single transactional batch.
    const editionRevisionId = ulid();
    const statements: SqlStatement[] = [];

    if (issueIsNew) {
        statements.push(
            {
                text: "INSERT INTO issues (id, canonical_date) VALUES ($1, $2)",
                params: [issueId, editionDate],
            },
            {
                text: "INSERT INTO legacy_edition_aliases (date, issue_id) VALUES ($1, $2)",
                params: [editionDate, issueId],
            },
        );
    }

    statements.push({
        text: `INSERT INTO edition_revisions
                   (id, issue_id, revision_hash, publication_info, expected_pages,
                    processed_pages, failed_pages, created_by_run)
               VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
        params: [
            editionRevisionId,
            issueId,
            revisionHash,
            edition.publication_info ?? "",
            expectedPages,
            processedPages,
            JSON.stringify(failedPages),
            input.runId ?? null,
        ],
    });

    pageStatuses.forEach((status, index) => {
        statements.push({
            text: `INSERT INTO edition_revision_pages (edition_revision_id, page_number, status)
                   VALUES ($1, $2, $3)`,
            params: [editionRevisionId, index + 1, status],
        });
    });

    for (const item of plannedByKey.values()) {
        if (!item.isNew) continue;
        statements.push({
            text: `INSERT INTO content_items (id, issue_id, content_type, identity_key, identity_evidence)
                   VALUES ($1, $2, $3, $4, $5::jsonb)`,
            params: [
                item.id,
                issueId,
                item.contentType,
                item.identityKey,
                JSON.stringify(item.identityEvidence),
            ],
        });
    }

    for (const revision of revisionByKey.values()) {
        if (!revision.isNew) continue;
        statements.push({
            text: `INSERT INTO content_revisions
                       (id, content_item_id, edition_revision_id, revision_hash, category,
                        headline, summary, full_text, body_plain, byline, writer_position, page)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                   ON CONFLICT (content_item_id, revision_hash) DO NOTHING`,
            params: [
                revision.id,
                revision.itemId,
                editionRevisionId,
                revision.revisionHash,
                revision.columns.category,
                revision.columns.headline,
                revision.columns.summary,
                revision.columns.fullText,
                revision.columns.bodyPlain,
                revision.columns.byline,
                revision.columns.writerPosition,
                revision.columns.page,
            ],
        });
    }

    // Content-level activation: last candidate for an item (in plan order)
    // wins, deterministically.
    const activeRevisionByItem = new Map<string, string>();
    for (const revision of revisionForCandidate) {
        activeRevisionByItem.set(revision.itemId, revision.id);
    }
    for (const [itemId, revisionId] of activeRevisionByItem) {
        statements.push({
            text: "UPDATE content_items SET active_revision_id = $2 WHERE id = $1",
            params: [itemId, revisionId],
        });
    }

    for (const alias of plannedAliases) {
        statements.push({
            text: `INSERT INTO legacy_content_aliases (legacy_id, content_item_id, content_revision_id, alias_kind)
                   VALUES ($1, $2, $3, $4)
                   ON CONFLICT (legacy_id) DO UPDATE SET content_revision_id = EXCLUDED.content_revision_id`,
            params: [alias.legacyId, alias.itemId, alias.revisionId, alias.aliasKind],
        });
    }

    for (const entry of manifestAssets.values()) {
        statements.push({
            text: `INSERT INTO assets
                       (sha256, byte_count, width, height, mime_type, source_sha256, storage_key, legacy_key)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                   ON CONFLICT (sha256) DO NOTHING`,
            params: [
                entry.hash,
                entry.size_bytes,
                entry.width ?? null,
                entry.height ?? null,
                entry.mime_type ?? "image/webp",
                entry.source_sha256 ?? null,
                entry.r2_key,
                `${editionDate}/images/${basenameOf(entry.public_path)}`,
            ],
        });
    }

    for (const ref of plannedRefs) {
        statements.push({
            text: `INSERT INTO asset_references
                       (content_revision_id, position, asset_id, role, printed_caption, credit)
                   VALUES ($1, $2, $3, 'article_image', $4, $5)
                   ON CONFLICT (content_revision_id, position) DO NOTHING`,
            params: [ref.revisionId, ref.position, ref.sha256, ref.printedCaption, ref.credit],
        });
    }

    await executor.transactionBatch(statements);

    return {
        issueId,
        editionRevisionId,
        created: true,
        counts: {
            items: [...plannedByKey.values()].filter((item) => item.isNew).length,
            revisions: [...revisionByKey.values()].filter((revision) => revision.isNew).length,
            aliases: plannedAliases.filter((alias) => !existingAliasIds.has(alias.legacyId)).length,
            pages: expectedPages,
            assets: [...manifestAssets.keys()].filter((hash) => !existingAssetHashes.has(hash))
                .length,
            refs: plannedRefs.filter(
                (ref) => !existingRefKeys.has(`${ref.revisionId}\n${ref.position}`),
            ).length,
        },
    };
}
