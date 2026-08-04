import type { QueryExecutor } from "../../../scripts/db/lib/migration-runner";

export interface RevisionValidationIssue {
    check: string;
    detail: string;
}

export interface RevisionValidationResult {
    ok: boolean;
    issues: RevisionValidationIssue[];
    counts: {
        pages: number;
        expectedPages: number | null;
        failedPages: number;
        items: number;
        revisions: number;
        articleAliases: number;
        adAliases: number;
        assetReferences: number;
        missingAssets: number;
    };
    /**
     * Versioned embedding readiness is not applicable until a Phase 5 index
     * build exists for this corpus; reported truthfully rather than passed.
     */
    embeddingReadiness: "not_applicable_no_index_build";
}

async function one(executor: QueryExecutor, text: string, params: unknown[]): Promise<Record<string, unknown>> {
    const rows = await executor.query({ text, params });
    return rows[0] ?? {};
}

/**
 * Pre-activation validation for a staged edition revision: page lineage,
 * content pointers, alias resolution, and asset existence. Read-only.
 */
export async function validateRevision(
    executor: QueryExecutor,
    editionRevisionId: string,
): Promise<RevisionValidationResult> {
    const issues: RevisionValidationIssue[] = [];

    const revision = await one(
        executor,
        `SELECT id, issue_id, expected_pages, processed_pages, failed_pages
         FROM edition_revisions WHERE id = $1`,
        [editionRevisionId],
    );
    if (!revision.id) {
        return {
            ok: false,
            issues: [{ check: "revision-exists", detail: `edition revision ${editionRevisionId} not found` }],
            counts: {
                pages: 0, expectedPages: null, failedPages: 0, items: 0, revisions: 0,
                articleAliases: 0, adAliases: 0, assetReferences: 0, missingAssets: 0,
            },
            embeddingReadiness: "not_applicable_no_index_build",
        };
    }
    const issueId = String(revision.issue_id);
    const expectedPages = revision.expected_pages === null ? null : Number(revision.expected_pages);
    const failedPages = Array.isArray(revision.failed_pages) ? revision.failed_pages.length : 0;

    const pageRow = await one(
        executor,
        `SELECT count(*)::int AS n FROM edition_revision_pages WHERE edition_revision_id = $1`,
        [editionRevisionId],
    );
    const pages = Number(pageRow.n ?? 0);
    if (expectedPages !== null && pages !== expectedPages) {
        issues.push({
            check: "page-lineage",
            detail: `edition_revision_pages has ${pages} rows, expected_pages is ${expectedPages}`,
        });
    }

    const itemRow = await one(
        executor,
        `SELECT count(*)::int AS n,
                count(*) FILTER (WHERE active_revision_id IS NULL)::int AS unpointed
         FROM content_items WHERE issue_id = $1`,
        [issueId],
    );
    const items = Number(itemRow.n ?? 0);
    if (items === 0) {
        issues.push({
            check: "no-content-items",
            detail: `issue ${issueId} has no content items; the adapter dropped everything or staging was incomplete`,
        });
    }
    if (Number(itemRow.unpointed ?? 0) > 0) {
        issues.push({
            check: "active-revision-pointers",
            detail: `${itemRow.unpointed} content item(s) for issue ${issueId} have no active revision`,
        });
    }

    const revRow = await one(
        executor,
        `SELECT count(*)::int AS n FROM content_revisions cr
         JOIN content_items ci ON ci.id = cr.content_item_id
         WHERE ci.issue_id = $1`,
        [issueId],
    );

    const aliasRow = await one(
        executor,
        `SELECT
            count(*) FILTER (WHERE lca.alias_kind = 'article')::int AS articles,
            count(*) FILTER (WHERE lca.alias_kind = 'ad')::int AS ads,
            count(*) FILTER (WHERE lca.content_revision_id IS NULL)::int AS unpinned
         FROM legacy_content_aliases lca
         JOIN content_items ci ON ci.id = lca.content_item_id
         WHERE ci.issue_id = $1`,
        [issueId],
    );
    if (Number(aliasRow.unpinned ?? 0) > 0) {
        issues.push({
            check: "alias-revision-pins",
            detail: `${aliasRow.unpinned} legacy alias(es) lack a content revision pin`,
        });
    }

    const assetRow = await one(
        executor,
        `SELECT count(*)::int AS refs,
                count(*) FILTER (WHERE a.sha256 IS NULL)::int AS missing
         FROM asset_references ar
         JOIN content_revisions cr ON cr.id = ar.content_revision_id
         JOIN content_items ci ON ci.id = cr.content_item_id
         LEFT JOIN assets a ON a.sha256 = ar.asset_id
         WHERE ci.issue_id = $1`,
        [issueId],
    );
    const missingAssets = Number(assetRow.missing ?? 0);
    if (missingAssets > 0) {
        issues.push({
            check: "asset-existence",
            detail: `${missingAssets} asset reference(s) point at unregistered assets`,
        });
    }

    return {
        ok: issues.length === 0,
        issues,
        counts: {
            pages,
            expectedPages,
            failedPages,
            items,
            revisions: Number(revRow.n ?? 0),
            articleAliases: Number(aliasRow.articles ?? 0),
            adAliases: Number(aliasRow.ads ?? 0),
            assetReferences: Number(assetRow.refs ?? 0),
            missingAssets,
        },
        embeddingReadiness: "not_applicable_no_index_build",
    };
}
