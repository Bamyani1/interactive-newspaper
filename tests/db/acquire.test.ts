/** @vitest-environment node */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AcquireError, acquireFile, sniffMimeType } from "../../src/server/publisher/acquire";

const JPEG_MAGIC = [0xff, 0xd8, 0xff, 0xe0];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function makeBytes(magic: number[], fillTo = 64): Buffer {
    const buffer = Buffer.alloc(fillTo, 0x2a);
    Buffer.from(magic).copy(buffer, 0);
    return buffer;
}

function sha256Of(bytes: Buffer): string {
    return createHash("sha256").update(bytes).digest("hex");
}

function fetchReturning(bytes: Buffer): ReturnType<typeof vi.fn> {
    return vi.fn(async () => new Response(new Uint8Array(bytes)));
}

describe("acquireFile", () => {
    const sandbox = mkdtempSync(path.join(os.tmpdir(), "acquire-test-"));
    let caseId = 0;
    let destPath: string;

    beforeEach(() => {
        caseId += 1;
        destPath = path.join(sandbox, `case-${caseId}`, "page-0001.jpg");
    });

    afterAll(() => {
        rmSync(sandbox, { recursive: true, force: true });
    });

    it("downloads, validates, and atomically installs a fresh file", async () => {
        const bytes = makeBytes(JPEG_MAGIC, 128);
        const fetchImpl = fetchReturning(bytes);

        const result = await acquireFile({
            url: "https://example.test/page-0001.jpg",
            destPath,
            expected: { sha256: sha256Of(bytes), mimeType: "image/jpeg", minBytes: 128 },
            fetchImpl,
        });

        expect(result).toEqual({
            status: "downloaded",
            sha256: sha256Of(bytes),
            byteCount: 128,
            mimeType: "image/jpeg",
        });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(readFileSync(destPath)).toEqual(bytes);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });

    it("short-circuits on an existing valid file without calling fetch", async () => {
        const bytes = makeBytes(JPEG_MAGIC);
        mkdirSync(path.dirname(destPath), { recursive: true });
        writeFileSync(destPath, bytes);
        const fetchImpl = vi.fn(async () => {
            throw new Error("network must not be touched");
        });

        const result = await acquireFile({
            url: "https://example.test/page-0001.jpg",
            destPath,
            expected: { sha256: sha256Of(bytes), mimeType: "image/jpeg" },
            fetchImpl,
        });

        expect(result.status).toBe("already-valid");
        expect(result.sha256).toBe(sha256Of(bytes));
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("re-downloads when the existing file is corrupt", async () => {
        const goodBytes = makeBytes(JPEG_MAGIC, 96);
        mkdirSync(path.dirname(destPath), { recursive: true });
        writeFileSync(destPath, Buffer.from("corrupted partial garbage"));
        const fetchImpl = fetchReturning(goodBytes);

        const result = await acquireFile({
            url: "https://example.test/page-0001.jpg",
            destPath,
            expected: { sha256: sha256Of(goodBytes), mimeType: "image/jpeg" },
            fetchImpl,
        });

        expect(result.status).toBe("downloaded");
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(readFileSync(destPath)).toEqual(goodBytes);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });

    it("throws a typed error on hash mismatch and leaves no dest or .part file", async () => {
        const bytes = makeBytes(JPEG_MAGIC);
        const fetchImpl = fetchReturning(bytes);

        const error = await acquireFile({
            url: "https://example.test/page-0001.jpg",
            destPath,
            expected: { sha256: "0".repeat(64) },
            fetchImpl,
        }).then(
            () => null,
            (err: unknown) => err,
        );

        expect(error).toBeInstanceOf(AcquireError);
        expect((error as AcquireError).reason).toBe("sha256-mismatch");
        expect(existsSync(destPath)).toBe(false);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });

    it("rejects an empty body and cleans up the .part", async () => {
        const fetchImpl = fetchReturning(Buffer.alloc(0));

        await expect(
            acquireFile({ url: "https://example.test/empty.jpg", destPath, fetchImpl }),
        ).rejects.toMatchObject({ name: "AcquireError", reason: "empty-body" });
        expect(existsSync(destPath)).toBe(false);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });

    it("rejects a truncated body (below minBytes) and cleans up the .part", async () => {
        const fetchImpl = fetchReturning(makeBytes(JPEG_MAGIC, 32));

        await expect(
            acquireFile({
                url: "https://example.test/truncated.jpg",
                destPath,
                expected: { minBytes: 1024 },
                fetchImpl,
            }),
        ).rejects.toMatchObject({ name: "AcquireError", reason: "too-small" });
        expect(existsSync(destPath)).toBe(false);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });

    it("sniffs JPEG from magic bytes", async () => {
        const result = await acquireFile({
            url: "https://example.test/page.jpg",
            destPath,
            fetchImpl: fetchReturning(makeBytes(JPEG_MAGIC)),
        });
        expect(result.mimeType).toBe("image/jpeg");
    });

    it("sniffs PNG from magic bytes", async () => {
        const result = await acquireFile({
            url: "https://example.test/page.png",
            destPath,
            fetchImpl: fetchReturning(makeBytes(PNG_MAGIC)),
        });
        expect(result.mimeType).toBe("image/png");
    });

    it("rejects a MIME mismatch against the expectation", async () => {
        await expect(
            acquireFile({
                url: "https://example.test/page.png",
                destPath,
                expected: { mimeType: "image/jpeg" },
                fetchImpl: fetchReturning(makeBytes(PNG_MAGIC)),
            }),
        ).rejects.toMatchObject({ name: "AcquireError", reason: "mime-mismatch" });
        expect(existsSync(destPath)).toBe(false);
        expect(existsSync(`${destPath}.part`)).toBe(false);
    });
});

describe("sniffMimeType", () => {
    it("recognizes TIFF (both byte orders) and GIF", () => {
        expect(sniffMimeType(makeBytes([0x49, 0x49, 0x2a, 0x00]))).toBe("image/tiff");
        expect(sniffMimeType(makeBytes([0x4d, 0x4d, 0x00, 0x2a]))).toBe("image/tiff");
        expect(sniffMimeType(makeBytes([0x47, 0x49, 0x46, 0x38]))).toBe("image/gif");
    });

    it("returns null for unknown bytes", () => {
        expect(sniffMimeType(Buffer.from("not an image"))).toBeNull();
    });
});
