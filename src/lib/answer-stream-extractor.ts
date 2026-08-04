/**
 * Incrementally extracts the "answer" string field from a streaming JSON
 * envelope ({"answer": "...", "follow_ups": [...]}) so user-facing text can
 * be emitted while the model is still generating, without ever exposing
 * JSON syntax to the client.
 *
 * The extractor scans the raw stream for the `"answer"` key, then decodes
 * the string value escape-by-escape, holding back anything that could be
 * split across chunk boundaries (a partial \-escape, a partial \uXXXX, or a
 * lone UTF-16 high surrogate). Once the value's closing quote is seen all
 * further input is ignored, so follow_ups never leak through deltas.
 *
 * The decoded stream is the model's raw answer text — grounding, link
 * sanitization, and coverage policy still run on the buffered full response,
 * and the `done` event's answer remains authoritative for consumers.
 */

const ANSWER_KEY_RE = /"answer"\s*:\s*"/;

/** Longest tail that can hold a partially-arrived `"answer": "` pattern. */
const SEEK_TAIL_CHARS = 64;

const SIMPLE_ESCAPES: Record<string, string> = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
};

export class AnswerFieldExtractor {
    private pending = "";
    private phase: "seeking" | "streaming" | "closed" = "seeking";
    private surrogateCarry = "";

    /** Feed one raw model chunk; returns newly decoded answer text. */
    push(chunk: string): string {
        if (this.phase === "closed" || !chunk) return "";
        this.pending += chunk;
        if (this.phase === "seeking") {
            const match = ANSWER_KEY_RE.exec(this.pending);
            if (!match) {
                if (this.pending.length > SEEK_TAIL_CHARS) {
                    this.pending = this.pending.slice(-SEEK_TAIL_CHARS);
                }
                return "";
            }
            this.pending = this.pending.slice(match.index + match[0].length);
            this.phase = "streaming";
        }
        return this.decode();
    }

    /** True once the closing quote of the answer value has been consumed. */
    get complete(): boolean {
        return this.phase === "closed";
    }

    private decode(): string {
        let out = this.surrogateCarry;
        this.surrogateCarry = "";
        const s = this.pending;
        let i = 0;
        while (i < s.length) {
            const ch = s[i];
            if (ch === '"') {
                this.phase = "closed";
                this.pending = "";
                return out;
            }
            if (ch !== "\\") {
                out += ch;
                i += 1;
                continue;
            }
            if (i + 1 >= s.length) break; // escape split across chunks
            const esc = s[i + 1];
            if (esc === "u") {
                if (i + 6 > s.length) break; // partial \uXXXX
                const code = Number.parseInt(s.slice(i + 2, i + 6), 16);
                if (!Number.isNaN(code)) out += String.fromCharCode(code);
                i += 6;
                continue;
            }
            out += SIMPLE_ESCAPES[esc] ?? esc;
            i += 2;
        }
        this.pending = s.slice(i);
        // Hold back a trailing high surrogate so a split 😀 pair
        // is never emitted as a lone half.
        const last = out.charCodeAt(out.length - 1);
        if (out && last >= 0xd800 && last <= 0xdbff) {
            this.surrogateCarry = out.slice(-1);
            out = out.slice(0, -1);
        }
        return out;
    }
}
