/** @vitest-environment node */
import { appendFileSync, copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
    MIGRATION_LOCK_KEY,
    RUNNER_VERSION,
    buildMigrationBatch,
    discoverMigrations,
    runMigrations,
    type QueryExecutor,
} from "../../scripts/db/lib/migration-runner";
import { sha256Hex, splitSqlStatements } from "../../scripts/db/lib/sql-statements";
import { MIGRATIONS_DIR, createTestDb, type TestDb } from "./helpers/pglite";

const DB_TIMEOUT = 120_000;

function onDiskMigrationFiles(): string[] {
    return readdirSync(MIGRATIONS_DIR)
        .filter((name) => name.endsWith(".sql"))
        .sort();
}

function makeTempDir(): string {
    return mkdtempSync(path.join(os.tmpdir(), "migration-runner-test-"));
}

async function captureRejection(promise: Promise<unknown>): Promise<Error> {
    const error = await promise.then(
        () => null,
        (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    return error as Error;
}

describe("runMigrations against a real database", () => {
    let db: TestDb;

    beforeAll(async () => {
        db = await createTestDb();
    }, DB_TIMEOUT);

    afterAll(async () => {
        await db.close();
    });

    it("fresh apply records every on-disk migration id and checksum in the ledger", async () => {
        const result = await runMigrations(db.executor);

        const expected = onDiskMigrationFiles().map((fileName) => ({
            id: fileName.replace(/\.sql$/, ""),
            checksum: sha256Hex(readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8")),
        }));
        expect(expected.length).toBeGreaterThan(0);
        expect(result.applied).toEqual(expected.map((m) => m.id));
        expect(result.skipped).toEqual([]);
        expect(result.alreadyApplied).toEqual([]);

        const rows = await db.executor.query({
            text: "SELECT id, checksum FROM schema_migrations ORDER BY id",
        });
        expect(rows.map((row) => ({ id: String(row.id), checksum: String(row.checksum) }))).toEqual(
            expected,
        );
    }, DB_TIMEOUT);

    it("second run is a no-op: everything alreadyApplied, nothing applied or skipped", async () => {
        const result = await runMigrations(db.executor);
        expect(result.applied).toEqual([]);
        expect(result.skipped).toEqual([]);
        expect(result.alreadyApplied).toEqual(
            onDiskMigrationFiles().map((fileName) => fileName.replace(/\.sql$/, "")),
        );
    }, DB_TIMEOUT);

    it("releases the advisory lock after a successful run", async () => {
        const rows = await db.executor.query({
            text: "SELECT count(*) AS held FROM pg_locks WHERE locktype = 'advisory'",
        });
        expect(Number(rows[0].held)).toBe(0);
    }, DB_TIMEOUT);
});

describe("applied-migration immutability guards", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        while (tempDirs.length > 0) {
            rmSync(tempDirs.pop() as string, { recursive: true, force: true });
        }
    });

    it("throws naming the migration when an applied file's checksum changes", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        cpSync(MIGRATIONS_DIR, dir, { recursive: true });

        const db = await createTestDb();
        try {
            await runMigrations(db.executor, { dir });
            appendFileSync(path.join(dir, "0002_legacy_core.sql"), "\n-- tampered\n");

            const error = await captureRejection(runMigrations(db.executor, { dir }));
            expect(error.message).toContain("0002_legacy_core");
            expect(error.message).toContain("immutable");
        } finally {
            await db.close();
        }
    }, DB_TIMEOUT);

    it("throws naming the migration when an applied file is deleted", async () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        cpSync(MIGRATIONS_DIR, dir, { recursive: true });

        const db = await createTestDb();
        try {
            await runMigrations(db.executor, { dir });
            rmSync(path.join(dir, "0003_runtime_tables.sql"));

            const error = await captureRejection(runMigrations(db.executor, { dir }));
            expect(error.message).toContain("0003_runtime_tables");
            expect(error.message).toContain("no matching file");
        } finally {
            await db.close();
        }
    }, DB_TIMEOUT);
});

describe("discoverMigrations filename discipline", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        while (tempDirs.length > 0) {
            rmSync(tempDirs.pop() as string, { recursive: true, force: true });
        }
    });

    it("rejects duplicate numeric prefixes", () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        writeFileSync(path.join(dir, "0001_a.sql"), "SELECT 1;\n");
        writeFileSync(path.join(dir, "0001_b.sql"), "SELECT 2;\n");
        expect(() => discoverMigrations(dir)).toThrow(/Duplicate migration prefix "0001"/);
    });

    it("rejects file names without the NNNN_ prefix", () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        writeFileSync(path.join(dir, "noprefix.sql"), "SELECT 1;\n");
        expect(() => discoverMigrations(dir)).toThrow(/"noprefix\.sql" is invalid/);
    });

    it("rejects statements that cannot run inside a transaction", () => {
        const dir = makeTempDir();
        tempDirs.push(dir);
        writeFileSync(
            path.join(dir, "0001_concurrent.sql"),
            "CREATE INDEX CONCURRENTLY idx_bad ON articles(id);\n",
        );
        expect(() => discoverMigrations(dir)).toThrow(/cannot run inside a transaction/);
    });
});

describe("buildMigrationBatch", () => {
    it("locks first and appends the parameterized ledger insert last", () => {
        const migration = discoverMigrations(MIGRATIONS_DIR)[0];
        const batch = buildMigrationBatch(migration, "v");

        expect(batch[0].text).toContain("pg_advisory_xact_lock");
        expect(batch[0].text).toContain(String(MIGRATION_LOCK_KEY[0]));
        expect(batch).toHaveLength(migration.statements.length + 2);

        const ledgerInsert = batch[batch.length - 1];
        expect(ledgerInsert.text).toContain("INSERT INTO schema_migrations");
        expect(ledgerInsert.params).toEqual([migration.id, migration.checksum, 0, "v"]);
    });
});

describe("ledger-race atomicity", () => {
    it("rolls back the whole batch (DDL included) when the ledger insert conflicts", async () => {
        const dir = makeTempDir();
        const db = await createTestDb();
        try {
            for (const fileName of onDiskMigrationFiles().slice(0, 5)) {
                copyFileSync(path.join(MIGRATIONS_DIR, fileName), path.join(dir, fileName));
            }
            const result = await runMigrations(db.executor, { dir });
            expect(result.applied).toHaveLength(5);

            // Simulate a concurrent runner having committed 0006 first.
            await db.executor.query({
                text: "INSERT INTO schema_migrations (id, checksum, duration_ms, runner_version) VALUES ($1, $2, $3, $4)",
                params: ["0006_source_and_issues", "someone-elses-checksum", 0, "other-runner"],
            });

            const migration = discoverMigrations(MIGRATIONS_DIR).find(
                (m) => m.id === "0006_source_and_issues",
            );
            expect(migration).toBeDefined();

            await expect(
                db.executor.transactionBatch(
                    buildMigrationBatch(migration as NonNullable<typeof migration>, RUNNER_VERSION),
                ),
            ).rejects.toThrow();

            const rows = await db.executor.query({
                text: "SELECT to_regclass('source_records') AS oid",
            });
            expect(rows[0].oid).toBeNull();
        } finally {
            await db.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, DB_TIMEOUT);
});

describe("concurrent-runner 23505 mapping", () => {
    it("reports the lost race as skipped instead of throwing", async () => {
        const stub: QueryExecutor = {
            async query() {
                return [];
            },
            async transactionBatch() {
                throw Object.assign(new Error("duplicate key value violates unique constraint schema_migrations_pkey"), {
                    code: "23505",
                });
            },
        };

        const result = await runMigrations(stub);
        const allIds = onDiskMigrationFiles().map((fileName) => fileName.replace(/\.sql$/, ""));
        expect(result.applied).toEqual([]);
        expect(result.alreadyApplied).toEqual([]);
        expect(result.skipped).toEqual(allIds);
    });
});

describe("splitSqlStatements", () => {
    it("keeps '--' inside a string literal intact", () => {
        const statements = splitSqlStatements("SELECT 'a -- b; c' AS x;");
        expect(statements).toEqual(["SELECT 'a -- b; c' AS x"]);
    });

    it("keeps a dollar-quoted body containing ';' and '--' as one statement", () => {
        const sqlText = [
            "CREATE FUNCTION f() RETURNS trigger AS $$",
            "BEGIN",
            "  NEW.x := 1; -- inline note",
            "  RETURN NEW;",
            "END $$ LANGUAGE plpgsql;",
        ].join("\n");
        const statements = splitSqlStatements(sqlText);
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain("-- inline note");
        expect(statements[0]).toContain("RETURN NEW;");
    });

    it("handles nested block comments", () => {
        const statements = splitSqlStatements("/* outer /* inner ; */ still outer */ SELECT 1;");
        expect(statements).toHaveLength(1);
        expect(statements[0]).toContain("SELECT 1");
    });

    it("handles $tag$ quoting", () => {
        const statements = splitSqlStatements("SELECT $body$ ; -- $body$ AS s;");
        expect(statements).toEqual(["SELECT $body$ ; -- $body$ AS s"]);
    });

    it("throws on an unterminated quote", () => {
        expect(() => splitSqlStatements("SELECT 'oops")).toThrow(/Unterminated/);
    });

    it("yields zero statements for comment-only input", () => {
        expect(splitSqlStatements("-- just a comment\n/* and a block */")).toEqual([]);
    });
});
