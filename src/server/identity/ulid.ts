import { randomBytes } from "node:crypto";

/**
 * Minimal ULID implementation (https://github.com/ulid/spec): a 26-character
 * Crockford base32 string encoding a 48-bit millisecond timestamp followed by
 * 80 random bits. Implemented locally by design — Phase 3 adds no new
 * dependency for identifier minting.
 */

/** Crockford base32 alphabet (no I, L, O, U). */
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 48 timestamp bits -> 10 base32 chars (the top two bits are always zero). */
const TIME_LENGTH = 10;
const RANDOM_BYTES = 10; // 80 bits -> 16 base32 chars
const MAX_TIMESTAMP = 2 ** 48 - 1;

export const ULID_LENGTH = 26;
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Returns a new ULID. `timestamp` (Unix milliseconds) defaults to Date.now();
 * passing it explicitly makes the 10-character time prefix deterministic,
 * which tests use. The 16-character suffix is always fresh randomness from
 * node:crypto.
 */
export function ulid(timestamp: number = Date.now()): string {
    if (!Number.isInteger(timestamp) || timestamp < 0 || timestamp > MAX_TIMESTAMP) {
        throw new Error(
            `ULID timestamp must be an integer in [0, ${MAX_TIMESTAMP}], got ${timestamp}`,
        );
    }

    let time = timestamp;
    let timePart = "";
    for (let i = 0; i < TIME_LENGTH; i += 1) {
        timePart = ENCODING[time % 32] + timePart;
        time = Math.floor(time / 32);
    }

    const bytes = randomBytes(RANDOM_BYTES);
    let randomPart = "";
    let buffer = 0;
    let bitsInBuffer = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bitsInBuffer += 8;
        while (bitsInBuffer >= 5) {
            randomPart += ENCODING[(buffer >>> (bitsInBuffer - 5)) & 31];
            bitsInBuffer -= 5;
        }
    }

    return timePart + randomPart;
}
