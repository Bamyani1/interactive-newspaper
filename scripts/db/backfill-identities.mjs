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

export async function backfillIdentities(executor) {
    const { deriveIdentityKey, contentRevisionHash } = await loadIdentity();
    const { ulid } = await loadUlid();

    const counts = { issues: 0, items: 0, revisions: 0, aliases: 0, skipped: 0 };

    const editions = await executor.query({
        text: "SELECT date FROM editions ORDER BY date",
    });

    for (const edition of editions) {
        const date = String(edition.date);

        // Issue: the edition alias is the idempotency anchor.
        let issueId;
        const editionAlias = await executor.query({
            text: "SELECT issue_id FROM legacy_edition_aliases WHERE date = $1",
            params: [date],
        });
        if (editionAlias.length > 0) {
            issueId = String(editionAlias[0].issue_id);
        } else {
            issueId = ulid();
            await executor.query({
                text: "INSERT INTO issues (id, canonical_date) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
                params: [issueId, date],
            });
            const insertedAlias = await executor.query({
                text: `INSERT INTO legacy_edition_aliases (date, issue_id) VALUES ($1, $2)
                       ON CONFLICT (date) DO NOTHING RETURNING issue_id`,
                params: [date, issueId],
            });
            if (insertedAlias.length > 0) {
                counts.issues += 1;
            } else {
                // Alias appeared between SELECT and INSERT; adopt its issue.
                const reread = await executor.query({
                    text: "SELECT issue_id FROM legacy_edition_aliases WHERE date = $1",
                    params: [date],
                });
                issueId = String(reread[0].issue_id);
            }
        }

        // Batch-read the edition's articles once.
        const articles = await executor.query({
            text: `SELECT id, category, headline, summary, full_text, body_plain,
                          byline, writer_position, page, image_urls, image_captions
                   FROM articles
                   WHERE edition_date = $1
                   ORDER BY position, id`,
            params: [date],
        });

        for (const article of articles) {
            const legacyId = String(article.id);

            // Article alias is the per-article idempotency anchor.
            const existingAlias = await executor.query({
                text: "SELECT legacy_id FROM legacy_content_aliases WHERE legacy_id = $1",
                params: [legacyId],
            });
            if (existingAlias.length > 0) {
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

            let itemId = ulid();
            const insertedItem = await executor.query({
                text: `INSERT INTO content_items (id, issue_id, content_type, identity_key, identity_evidence)
                       VALUES ($1, $2, 'article', $3, $4)
                       ON CONFLICT (issue_id, identity_key) DO NOTHING RETURNING id`,
                params: [
                    itemId,
                    issueId,
                    identityKey,
                    JSON.stringify({ source: "legacy-backfill", legacyId, sourcePages: [page] }),
                ],
            });
            if (insertedItem.length > 0) {
                counts.items += 1;
            } else {
                const existingItem = await executor.query({
                    text: "SELECT id FROM content_items WHERE issue_id = $1 AND identity_key = $2",
                    params: [issueId, identityKey],
                });
                itemId = String(existingItem[0].id);
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
            const revisionId = revisionRowId(itemId, revisionHash);

            const insertedRevision = await executor.query({
                text: `INSERT INTO content_revisions
                           (id, content_item_id, revision_hash, category, headline, summary,
                            full_text, body_plain, byline, writer_position, page)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                       ON CONFLICT (content_item_id, revision_hash) DO NOTHING RETURNING id`,
                params: [
                    revisionId,
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
                ],
            });
            let effectiveRevisionId;
            if (insertedRevision.length > 0) {
                effectiveRevisionId = String(insertedRevision[0].id);
                counts.revisions += 1;
            } else {
                const existingRevision = await executor.query({
                    text: `SELECT id FROM content_revisions
                           WHERE content_item_id = $1 AND revision_hash = $2`,
                    params: [itemId, revisionHash],
                });
                effectiveRevisionId = String(existingRevision[0].id);
            }

            await executor.query({
                text: `UPDATE content_items SET active_revision_id = $2
                       WHERE id = $1 AND active_revision_id IS NULL`,
                params: [itemId, effectiveRevisionId],
            });

            const insertedContentAlias = await executor.query({
                text: `INSERT INTO legacy_content_aliases (legacy_id, content_item_id, content_revision_id, alias_kind)
                       VALUES ($1, $2, $3, 'article')
                       ON CONFLICT (legacy_id) DO NOTHING RETURNING legacy_id`,
                params: [legacyId, itemId, effectiveRevisionId],
            });
            if (insertedContentAlias.length > 0) counts.aliases += 1;
        }
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
