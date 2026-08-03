import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/**
 * Atomic source-page acquisition for the publication pipeline. Downloads a
 * file to `destPath + ".part"` (streamed to disk), validates size, MIME
 * (magic-byte sniff) and sha256 against the caller's expectations, then
 * atomically renames the .part into place. Offline-testable: the fetch
 * implementation is injectable and no network access happens outside it.
 */

export type AcquireErrorReason =
    | "http-error"
    | "empty-body"
    | "too-small"
    | "mime-mismatch"
    | "sha256-mismatch";

export class AcquireError extends Error {
    readonly reason: AcquireErrorReason;

    constructor(reason: AcquireErrorReason, message: string) {
        super(message);
        this.name = "AcquireError";
        this.reason = reason;
    }
}

/** Minimal magic-byte table for the scan formats the pipeline ingests. */
const MAGIC_TABLE: ReadonlyArray<{ mimeType: string; magics: readonly (readonly number[])[] }> = [
    { mimeType: "image/jpeg", magics: [[0xff, 0xd8, 0xff]] },
    { mimeType: "image/png", magics: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
    {
        mimeType: "image/tiff",
        magics: [
            [0x49, 0x49, 0x2a, 0x00], // little-endian ("II*\0")
            [0x4d, 0x4d, 0x00, 0x2a], // big-endian ("MM\0*")
        ],
    },
    { mimeType: "image/gif", magics: [[0x47, 0x49, 0x46, 0x38]] }, // "GIF8"
];

/** Returns the sniffed MIME type, or null when no known magic matches. */
export function sniffMimeType(bytes: Buffer): string | null {
    for (const { mimeType, magics } of MAGIC_TABLE) {
        for (const magic of magics) {
            if (bytes.length >= magic.length && magic.every((byte, i) => bytes[i] === byte)) {
                return mimeType;
            }
        }
    }
    return null;
}

export interface AcquireExpectations {
    /** Expected sha256 of the file bytes, lowercase or uppercase hex. */
    sha256?: string;
    /** Expected sniffed MIME type (e.g. "image/jpeg"). */
    mimeType?: string;
    /** Minimum acceptable byte count. Zero-byte files always fail. */
    minBytes?: number;
}

export interface AcquireResult {
    status: "downloaded" | "already-valid";
    sha256: string;
    byteCount: number;
    mimeType: string;
}

export interface AcquireFileOptions {
    url: string;
    destPath: string;
    expected?: AcquireExpectations;
    fetchImpl?: (url: string) => Promise<Response>;
}

type ValidatedBytes = Omit<AcquireResult, "status">;

function validateBytes(bytes: Buffer, expected: AcquireExpectations, origin: string): ValidatedBytes {
    if (bytes.length === 0) {
        throw new AcquireError("empty-body", `${origin}: file is empty`);
    }
    if (expected.minBytes !== undefined && bytes.length < expected.minBytes) {
        throw new AcquireError(
            "too-small",
            `${origin}: ${bytes.length} bytes is below the expected minimum of ${expected.minBytes}`,
        );
    }
    const mimeType = sniffMimeType(bytes) ?? "application/octet-stream";
    if (expected.mimeType !== undefined && mimeType !== expected.mimeType) {
        throw new AcquireError(
            "mime-mismatch",
            `${origin}: sniffed MIME type ${mimeType} does not match expected ${expected.mimeType}`,
        );
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expected.sha256 !== undefined && sha256 !== expected.sha256.toLowerCase()) {
        throw new AcquireError(
            "sha256-mismatch",
            `${origin}: sha256 ${sha256} does not match expected ${expected.sha256.toLowerCase()}`,
        );
    }
    return { sha256, byteCount: bytes.length, mimeType };
}

/**
 * Acquires `url` into `destPath`.
 *
 * - When `destPath` already exists, its bytes are re-validated (size, MIME,
 *   hash); a passing file short-circuits with `status: "already-valid"` and
 *   no fetch. A failing file is removed and re-downloaded.
 * - Downloads stream to `destPath + ".part"` and only an atomic rename ever
 *   creates `destPath`, so no failure path can leave partial bytes there.
 * - Every failure removes the .part and throws a typed {@link AcquireError}.
 */
export async function acquireFile({
    url,
    destPath,
    expected = {},
    fetchImpl = fetch,
}: AcquireFileOptions): Promise<AcquireResult> {
    if (existsSync(destPath)) {
        try {
            const existing = validateBytes(readFileSync(destPath), expected, `existing file ${destPath}`);
            return { status: "already-valid", ...existing };
        } catch {
            // Corrupt or stale existing file: remove it and re-download.
            rmSync(destPath, { force: true });
        }
    }

    const partPath = `${destPath}.part`;
    try {
        const response = await fetchImpl(url);
        if (!response.ok) {
            throw new AcquireError("http-error", `GET ${url} failed with status ${response.status}`);
        }
        mkdirSync(dirname(destPath), { recursive: true });
        const source = response.body
            ? Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
            : Readable.from([]);
        await pipeline(source, createWriteStream(partPath));
        const validated = validateBytes(readFileSync(partPath), expected, `download of ${url}`);
        renameSync(partPath, destPath);
        return { status: "downloaded", ...validated };
    } catch (error) {
        rmSync(partPath, { force: true });
        throw error;
    }
}
