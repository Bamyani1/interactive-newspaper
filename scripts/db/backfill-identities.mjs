#!/usr/bin/env node
/**
 * Phase 3 identity backfill. DATA-ONLY: never runs DDL.
 *
 *   editions -> issues + legacy_edition_aliases
 *   articles -> content_items + content_revisions + legacy_content_aliases
 *
 * Ads get NO aliases in Phase 3 (user decision: articles only).
 *
 * Idempotency anchors are the alias tables: an existing legacy_edition_aliases
 * row means the edition's issue is already minted (reuse it); an existing
 * legacy_content_aliases row means the article is already backfilled (skip
 * it). Every INSERT is ON CONFLICT DO NOTHING, so re-runs create nothing.
 *
 * Identity approximation: legacy article rows lack true page lineage, so the
 * identity key uses the stored `page` column as the single source page. That
 * is the best signal the legacy schema carries; true page lineage arrives
 * with the Phase 4 pipeline.
 *
 * Executor-injectable: tests drive backfillIdentities(executor) against
 * PGlite. main() runs only when this file is the CLI entry, requires
 * DATABASE_URL plus an explicit --yes, and is authorized for local/test
 * databases only in this phase.
 *
 * Execution shape (Neon HTTP round-trips are ~150-300ms each, so per-row
 * queries are unaffordable): READ current state in a handful of queries
 * (articles via keyset pagination — Neon HTTP responses cap at 64 MiB), PLAN
 * every insert in JS with the same ULID/hash derivations the per-row version
 * used, then WRITE batched multi-row INSERTs grouped into transactionBatch
 * calls. Counts are derived from the plan against the existing alias/item/
 * revision sets, so they match the per-row semantics exactly.
 */

import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

// This package compiles .ts to CJS (no "type":"module"), so .ts modules must
// be loaded dynamically and unwrapped via `mod.default ?? mod`; static named
// imports from .mjs fail at runtime.
async function loadIdentity() {
    const mod = await import("../../src/server/identity/content-identity.ts");
    return mod.default ?? mod;
}

async function loadUlid() {
    const mod = await import("../../src/server/identity/ulid.ts");
    return mod.default ?? mod;
}

function jsonArray(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * Deterministic content_revisions primary key, derived from the content
 * revision hash scoped to its item — globally unique exactly when the
 * UNIQUE (content_item_id, revision_hash) constraint is satisfied, even if
 * two items (e.g. reprints across editions) share identical payloads.
 */
function revisionRowId(contentItemId, revisionHash) {
    const digest = createHash("sha256")
        .update(`${contentItemId}\n${revisionHash}`, "utf8")
        .digest("hex");
    return `crev-${digest.slice(0, 32)}`;
}

/** Keyset page for article reads: rows carry full bodies, so stay well under
 * Neon's 64 MiB HTTP response cap (1000 articles is ~10-20 MB worst case). */
const ARTICLE_PAGE_SIZE = 1000;
/** Rows per multi-row INSERT for small rows (well under 30k bind params). */
const INSERT_CHUNK_ROWS = 400;
/** content_revisions rows carry article bodies: fewer rows per statement. */
const REVISION_CHUNK_ROWS = 100;
/** Flush a content_revisions statement early once its text payload is large. */
const REVISION_CHUNK_TEXT_CHARS = 4 * 1024 * 1024;
/** Statements per transactionBatch call (one HTTP request each). */
const STATEMENTS_PER_BATCH = 15;

function chunkArray(items, size) {
    const chunks = [];
    for (let offset = 0; offset < items.length; offset += size) {
        chunks.push(items.slice(offset, offset + size));
    }
    return chunks;
}

/** Splits revision rows at REVISION_CHUNK_ROWS or the accumulated text cap. */
function chunkRevisionRows(rows) {
    const chunks = [];
    let current = [];
    let currentChars = 0;
    for (const row of rows) {
        const rowChars = row.reduce(
            (sum, value) => sum + (typeof value === "string" ? value.length : 0),
            0,
        );
        if (
            current.length > 0 &&
            (current.length >= REVISION_CHUNK_ROWS ||
                currentChars + rowChars > REVISION_CHUNK_TEXT_CHARS)
        ) {
            chunks.push(current);
            current = [];
            currentChars = 0;
        }
        current.push(row);
        currentChars += rowChars;
    }
    if (current.length > 0) chunks.push(current);
    return chunks;
}

/** Builds one multi-row `INSERT ... VALUES (...), (...) <suffix>` statement. */
function multiRowInsert(prefix, rows, suffix) {
    const params = [];
    const tuples = rows.map((row) => {
        const placeholders = row.map((value) => {
            params.push(value);
            return `$${params.length}`;
        });
        return `(${placeholders.join(", ")})`;
    });
    return { text: `${prefix} VALUES ${tuples.join(", ")} ${suffix}`, params };
}

/** Batched form of `UPDATE ... SET active_revision_id ... WHERE ... IS NULL`. */
function activeRevisionUpdate(pairs) {
    const params = [];
    const tuples = pairs.map(([itemId, revisionId]) => {
        params.push(itemId, revisionId);
        return `($${params.length - 1}, $${params.length})`;
    });
    return {
        text: `UPDATE content_items AS ci SET active_revision_id = v.revision_id
               FROM (VALUES ${tuples.join(", ")}) AS v(item_id, revision_id)
               WHERE ci.id = v.item_id AND ci.active_revision_id IS NULL`,
        params,
    };
}

/** Reads every article via keyset pagination on the primary key. */
async function readAllArticles(executor) {
    const articles = [];
    let lastId = null;
    for (;;) {
        const pageRows = await executor.query({
            text: `SELECT id, edition_date, position, category, headline, summary, full_text,
                          body_plain, byline, writer_position, page, image_urls, image_captions
                   FROM articles
                   ${lastId === null ? "" : "WHERE id > $1"}
                   ORDER BY id
                   LIMIT ${ARTICLE_PAGE_SIZE}`,
            params: lastId === null ? [] : [lastId],
        });
        articles.push(...pageRows);
        if (pageRows.length < ARTICLE_PAGE_SIZE) break;
        lastId = String(pageRows[pageRows.length - 1].id);
    }
    return articles;
}

export async function backfillIdentities(executor) {
    const { deriveIdentityKey, contentRevisionHash } = await loadIdentity();
    const { ulid } = await loadUlid();

    const counts = { issues: 0, items: 0, revisions: 0, aliases: 0, skipped: 0 };

    // READ phase: current state in a handful of queries.
    const editions = await executor.query({
        text: "SELECT date FROM editions ORDER BY date",
    });
    const editionAliasRows = await executor.query({
        text: "SELECT date, issue_id FROM legacy_edition_aliases",
    });
    const issueIdByDate = new Map(
        editionAliasRows.map((row) => [String(row.date), String(row.issue_id)]),
    );
    const itemRows = await executor.query({
        text: "SELECT id, issue_id, identity_key, active_revision_id FROM content_items",
    });
    const existingItems = new Map(
        itemRows.map((row) => [
            `${String(row.issue_id)}\n${String(row.identity_key)}`,
            { id: String(row.id), hasActive: row.active_revision_id != null },
        ]),
    );
    const contentAliasRows = await executor.query({
        text: "SELECT legacy_id FROM legacy_content_aliases",
    });
    const existingAliasIds = new Set(contentAliasRows.map((row) => String(row.legacy_id)));
    const revisionRows = await executor.query({
        text: "SELECT id, content_item_id, revision_hash FROM content_revisions",
    });
    const existingRevisions = new Map(
        revisionRows.map((row) => [
            `${String(row.content_item_id)}\n${String(row.revision_hash)}`,
            String(row.id),
        ]),
    );

    const articlesByDate = new Map();
    for (const article of await readAllArticles(executor)) {
        const date = String(article.edition_date);
        const group = articlesByDate.get(date);
        if (group) group.push(article);
        else articlesByDate.set(date, [article]);
    }
    for (const group of articlesByDate.values()) {
        // Same visit order as the per-edition `ORDER BY position, id` read.
        group.sort((a, b) => {
            const positionDelta = Number(a.position) - Number(b.position);
            if (positionDelta !== 0) return positionDelta;
            const aId = String(a.id);
            const bId = String(b.id);
            return aId < bId ? -1 : aId > bId ? 1 : 0;
        });
    }

    // PLAN phase: exactly the rows the per-row logic would have inserted.
    const issueInserts = [];
    const editionAliasInserts = [];
    const itemInserts = [];
    const revisionInserts = [];
    const contentAliasInserts = [];
    const activeRevisionPairs = [];
    const plannedItems = new Map(); // "issueId\nidentityKey" -> planned item id
    const plannedRevisions = new Set(); // "itemId\nrevisionHash"
    const activeAssigned = new Set(); // item ids given an active revision this run

    for (const edition of editions) {
        const date = String(edition.date);

        // Issue: the edition alias is the idempotency anchor.
        let issueId = issueIdByDate.get(date);
        if (issueId === undefined) {
            issueId = ulid();
            issueIdByDate.set(date, issueId);
            issueInserts.push([issueId, date]);
            editionAliasInserts.push([date, issueId]);
            counts.issues += 1;
        }

        for (const article of articlesByDate.get(date) ?? []) {
            const legacyId = String(article.id);

            // Article alias is the per-article idempotency anchor.
            if (existingAliasIds.has(legacyId)) {
                counts.skipped += 1;
                continue;
            }

            const page = Number(article.page) || 1;
            const headline = String(article.headline ?? "");
            const byline = article.byline == null ? null : String(article.byline);
            // Legacy rows lack true page lineage; the stored page column is
            // the approximation (documented in the module header).
            const identityKey = deriveIdentityKey({
                contentType: "article",
                sourcePages: [page],
                headline,
                byline,
            });

            const itemKey = `${issueId}\n${identityKey}`;
            const existingItem = existingItems.get(itemKey);
            let itemId;
            if (existingItem) {
                itemId = existingItem.id;
            } else if (plannedItems.has(itemKey)) {
                itemId = plannedItems.get(itemKey);
            } else {
                itemId = ulid();
                plannedItems.set(itemKey, itemId);
                itemInserts.push([
                    itemId,
                    issueId,
                    "article",
                    identityKey,
                    JSON.stringify({ source: "legacy-backfill", legacyId, sourcePages: [page] }),
                ]);
                counts.items += 1;
            }

            const payload = {
                category: String(article.category ?? "News"),
                headline,
                summary: String(article.summary ?? ""),
                byline,
                bodyPlain: String(article.body_plain ?? ""),
                imageUrls: jsonArray(article.image_urls),
                imageCaptions: jsonArray(article.image_captions),
            };
            const revisionHash = contentRevisionHash(payload);
            const revisionKey = `${itemId}\n${revisionHash}`;
            let effectiveRevisionId = existingRevisions.get(revisionKey);
            if (effectiveRevisionId === undefined) {
                // revisionRowId is deterministic, so a duplicate planned
                // revision resolves to the id the first occurrence will mint.
                effectiveRevisionId = revisionRowId(itemId, revisionHash);
                if (!plannedRevisions.has(revisionKey)) {
                    plannedRevisions.add(revisionKey);
                    revisionInserts.push([
                        effectiveRevisionId,
                        itemId,
                        revisionHash,
                        payload.category,
                        payload.headline,
                        payload.summary,
                        String(article.full_text ?? ""),
                        payload.bodyPlain,
                        payload.byline,
                        article.writer_position == null ? null : String(article.writer_position),
                        page,
                    ]);
                    counts.revisions += 1;
                }
            }

            // First article to touch an item without an active revision wins,
            // matching the per-row `WHERE active_revision_id IS NULL` UPDATE.
            const itemHasActive = existingItem ? existingItem.hasActive : false;
            if (!itemHasActive && !activeAssigned.has(itemId)) {
                activeAssigned.add(itemId);
                activeRevisionPairs.push([itemId, effectiveRevisionId]);
            }

            contentAliasInserts.push([legacyId, itemId, effectiveRevisionId, "article"]);
            counts.aliases += 1;
        }
    }

    // WRITE phase: batched multi-row statements with the same ON CONFLICT
    // anchors as the per-row version, in FK order, grouped into
    // transactionBatch calls (one HTTP request each).
    const statements = [];
    for (const rows of chunkArray(issueInserts, INSERT_CHUNK_ROWS)) {
        statements.push(
            multiRowInsert(
                "INSERT INTO issues (id, canonical_date)",
                rows,
                "ON CONFLICT (id) DO NOTHING",
            ),
        );
    }
    for (const rows of chunkArray(editionAliasInserts, INSERT_CHUNK_ROWS)) {
        statements.push(
            multiRowInsert(
                "INSERT INTO legacy_edition_aliases (date, issue_id)",
                rows,
                "ON CONFLICT (date) DO NOTHING",
            ),
        );
    }
    for (const rows of chunkArray(itemInserts, INSERT_CHUNK_ROWS)) {
        statements.push(
            multiRowInsert(
                `INSERT INTO content_items
                     (id, issue_id, content_type, identity_key, identity_evidence)`,
                rows,
                "ON CONFLICT (issue_id, identity_key) DO NOTHING",
            ),
        );
    }
    for (const rows of chunkRevisionRows(revisionInserts)) {
        statements.push(
            multiRowInsert(
                `INSERT INTO content_revisions
                     (id, content_item_id, revision_hash, category, headline, summary,
                      full_text, body_plain, byline, writer_position, page)`,
                rows,
                "ON CONFLICT (content_item_id, revision_hash) DO NOTHING",
            ),
        );
    }
    for (const rows of chunkArray(contentAliasInserts, INSERT_CHUNK_ROWS)) {
        statements.push(
            multiRowInsert(
                `INSERT INTO legacy_content_aliases
                     (legacy_id, content_item_id, content_revision_id, alias_kind)`,
                rows,
                "ON CONFLICT (legacy_id) DO NOTHING",
            ),
        );
    }
    for (const pairs of chunkArray(activeRevisionPairs, INSERT_CHUNK_ROWS)) {
        statements.push(activeRevisionUpdate(pairs));
    }
    for (const group of chunkArray(statements, STATEMENTS_PER_BATCH)) {
        await executor.transactionBatch(group);
    }

    return counts;
}

async function main() {
    console.warn(
        "WARNING: Phase 3 identity backfill is authorized for LOCAL/TEST databases only. " +
            "Never point DATABASE_URL at production.",
    );
    if (!process.env.DATABASE_URL) {
        console.error("ERROR: DATABASE_URL is required.");
        process.exit(1);
    }
    if (!process.argv.slice(2).includes("--yes")) {
        console.error("Refusing to run without an explicit --yes flag.");
        process.exit(1);
    }

    const neonMod = await import("./lib/neon-executor.ts");
    const { createNeonExecutor } = neonMod.default ?? neonMod;
    const runnerMod = await import("./lib/migration-runner.ts");
    const { assertMigrationsCurrent } = runnerMod.default ?? runnerMod;

    const executor = createNeonExecutor(process.env.DATABASE_URL);
    await assertMigrationsCurrent(executor);
    const counts = await backfillIdentities(executor);
    console.log(JSON.stringify(counts));
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}
