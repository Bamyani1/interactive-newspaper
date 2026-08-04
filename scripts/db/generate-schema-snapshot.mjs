/**
 * Regenerates scripts/db/schema-snapshot.json.
 *
 * Boots an in-memory PGlite database, applies every canonical migration, and
 * writes the deterministic introspected schema (tables, indexes, triggers,
 * functions, extensions). Run after adding a migration:
 *   npm run db:schema:snapshot
 */

import { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(scriptDir, "schema-snapshot.json");

// .mjs importing .ts named exports needs the default-interop pattern (tsx
// compiles .ts to CJS because package.json has no "type":"module").
const pgliteHelperModule = await import("../../tests/db/helpers/pglite.ts");
const { createTestDb, introspectSchema } = pgliteHelperModule.default ?? pgliteHelperModule;
const migrationRunnerModule = await import("./lib/migration-runner.ts");
const { runMigrations } = migrationRunnerModule.default ?? migrationRunnerModule;

async function main() {
    const { pg, executor, close } = await createTestDb();
    try {
        await runMigrations(executor);
        const snapshot = await introspectSchema(pg);
        writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
        console.log(`Schema snapshot written to ${OUTPUT_PATH}`);
    } finally {
        await close();
    }
}

main().catch((error) => {
    console.error("Schema snapshot generation failed:", error);
    process.exit(1);
});
