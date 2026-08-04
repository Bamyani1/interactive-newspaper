/** @vitest-environment node */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const SCRIPT_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../scripts/db/upload-images.mjs",
);

type BuildAssetManifestEntry = (input: {
    hash: string;
    publicPath: string;
    r2Key: string;
    sizeBytes: number;
    width: number;
    height: number;
    quality: number | null;
    sourceSha256: string;
    status: string;
}) => Record<string, unknown>;

/**
 * upload-images.mjs is a CLI script whose top level parses argv and runs the
 * pipeline on import. To unit-test the exported pure helper we import it in a
 * sandbox: argv pointed at a temp editions dir whose edition.json references
 * no images, --dry-run so no sharp/R2 work happens, and process.exit stubbed
 * so the script's early exit(0) cannot kill the vitest worker.
 */
describe("buildAssetManifestEntry (asset-manifest v2)", () => {
    let tmpDir: string;
    let buildAssetManifestEntry: BuildAssetManifestEntry;

    beforeAll(async () => {
        tmpDir = mkdtempSync(path.join(os.tmpdir(), "asset-manifest-test-"));
        const editionDir = path.join(tmpDir, "1980-04-17");
        mkdirSync(editionDir, { recursive: true });
        writeFileSync(
            path.join(editionDir, "edition.json"),
            JSON.stringify({ articles: [], ads: [], enriched_ads: [], other_content: [] }),
        );

        const argvBackup = process.argv;
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        process.argv = [
            process.execPath,
            SCRIPT_PATH,
            "--date",
            "1980-04-17",
            "--dry-run",
            "--editions-dir",
            tmpDir,
        ];
        try {
            const m = await import(SCRIPT_PATH);
            const mod = m.default ?? m;
            buildAssetManifestEntry = m.buildAssetManifestEntry ?? mod.buildAssetManifestEntry;
        } finally {
            process.argv = argvBackup;
            exitSpy.mockRestore();
            logSpy.mockRestore();
        }
        expect(typeof buildAssetManifestEntry).toBe("function");
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it("keeps every v1 field and adds source_sha256 and mime_type", () => {
        const entry = buildAssetManifestEntry({
            hash: "b".repeat(64),
            publicPath: `images/${"b".repeat(64)}.webp`,
            r2Key: `ocr-assets/${"b".repeat(64)}.webp`,
            sizeBytes: 12345,
            width: 1400,
            height: 900,
            quality: 85,
            sourceSha256: "c".repeat(64),
            status: "uploaded",
        });

        expect(entry).toEqual({
            hash: "b".repeat(64),
            public_path: `images/${"b".repeat(64)}.webp`,
            r2_key: `ocr-assets/${"b".repeat(64)}.webp`,
            size_bytes: 12345,
            width: 1400,
            height: 900,
            quality: 85,
            source_sha256: "c".repeat(64),
            mime_type: "image/webp",
            status: "uploaded",
        });
    });

    it("preserves a null quality (already-optimized passthrough assets)", () => {
        const entry = buildAssetManifestEntry({
            hash: "d".repeat(64),
            publicPath: `images/${"d".repeat(64)}.webp`,
            r2Key: `ocr-assets/${"d".repeat(64)}.webp`,
            sizeBytes: 100,
            width: 500,
            height: 400,
            quality: null,
            sourceSha256: "d".repeat(64),
            status: "dry_run",
        });

        expect(entry.quality).toBeNull();
        expect(entry.mime_type).toBe("image/webp");
        expect(entry.source_sha256).toBe("d".repeat(64));
    });
});
