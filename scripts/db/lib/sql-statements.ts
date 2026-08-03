import { createHash } from "node:crypto";

/**
 * Splits raw SQL text into individual statements at top-level semicolons.
 *
 * Comment handling lives inside the same state machine as quote handling so a
 * string literal containing "--" or "/*" is never corrupted (the previous
 * seed-time splitter stripped comments with a line regex first, which would
 * truncate such literals). Handles:
 *   - single-quoted strings with '' escapes
 *   - double-quoted identifiers with "" escapes
 *   - line comments (-- to end of line)
 *   - block comments, nested per Postgres
 *   - dollar-quoted strings ($$ ... $$ and $tag$ ... $tag$)
 */
export function splitSqlStatements(sqlText: string): string[] {
    const statements: string[] = [];
    let current = "";
    let i = 0;
    const n = sqlText.length;

    type Mode = "plain" | "single" | "double" | "line" | "block" | "dollar";
    let mode: Mode = "plain";
    let blockDepth = 0;
    let dollarTag = "";

    const dollarTagAt = (pos: number): string | null => {
        if (sqlText[pos] !== "$") return null;
        const match = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sqlText.slice(pos));
        return match ? match[0] : null;
    };

    while (i < n) {
        const ch = sqlText[i];
        const next = sqlText[i + 1];

        if (mode === "plain") {
            if (ch === "'") {
                mode = "single";
            } else if (ch === '"') {
                mode = "double";
            } else if (ch === "-" && next === "-") {
                mode = "line";
                i += 2;
                continue;
            } else if (ch === "/" && next === "*") {
                mode = "block";
                blockDepth = 1;
                current += "/*";
                i += 2;
                continue;
            } else {
                const tag = dollarTagAt(i);
                if (tag) {
                    mode = "dollar";
                    dollarTag = tag;
                    current += tag;
                    i += tag.length;
                    continue;
                }
                if (ch === ";") {
                    const trimmed = current.trim();
                    if (trimmed.length > 0) statements.push(trimmed);
                    current = "";
                    i += 1;
                    continue;
                }
            }
            current += ch;
            i += 1;
        } else if (mode === "single") {
            current += ch;
            if (ch === "'") {
                if (next === "'") {
                    current += next;
                    i += 2;
                    continue;
                }
                mode = "plain";
            }
            i += 1;
        } else if (mode === "double") {
            current += ch;
            if (ch === '"') {
                if (next === '"') {
                    current += next;
                    i += 2;
                    continue;
                }
                mode = "plain";
            }
            i += 1;
        } else if (mode === "line") {
            // Line comments are dropped; the newline still separates tokens.
            if (ch === "\n") {
                mode = "plain";
                current += ch;
            }
            i += 1;
        } else if (mode === "block") {
            if (ch === "/" && next === "*") {
                blockDepth += 1;
                current += "/*";
                i += 2;
                continue;
            }
            if (ch === "*" && next === "/") {
                blockDepth -= 1;
                current += "*/";
                i += 2;
                if (blockDepth === 0) mode = "plain";
                continue;
            }
            current += ch;
            i += 1;
        } else {
            // dollar
            if (sqlText.startsWith(dollarTag, i)) {
                current += dollarTag;
                i += dollarTag.length;
                mode = "plain";
                dollarTag = "";
                continue;
            }
            current += ch;
            i += 1;
        }
    }

    if (mode === "single" || mode === "double" || mode === "dollar") {
        throw new Error(`Unterminated ${mode === "dollar" ? "dollar-quoted string" : "quoted section"} in SQL input`);
    }
    if (mode === "block") {
        throw new Error("Unterminated block comment in SQL input");
    }

    const tail = current.trim();
    if (tail.length > 0) statements.push(tail);

    // Drop statements that are only comments (possible when a file ends with
    // a block comment after the final semicolon).
    return statements.filter((stmt) => stripComments(stmt).trim().length > 0);
}

/** Removes comments using the same quote-aware rules as the splitter. */
export function stripComments(sqlText: string): string {
    let out = "";
    let i = 0;
    const n = sqlText.length;
    type Mode = "plain" | "single" | "double" | "line" | "block" | "dollar";
    let mode: Mode = "plain";
    let blockDepth = 0;
    let dollarTag = "";

    while (i < n) {
        const ch = sqlText[i];
        const next = sqlText[i + 1];
        if (mode === "plain") {
            if (ch === "-" && next === "-") {
                mode = "line";
                i += 2;
                continue;
            }
            if (ch === "/" && next === "*") {
                mode = "block";
                blockDepth = 1;
                i += 2;
                continue;
            }
            if (ch === "'") mode = "single";
            else if (ch === '"') mode = "double";
            else {
                const match = ch === "$" ? /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sqlText.slice(i)) : null;
                if (match) {
                    mode = "dollar";
                    dollarTag = match[0];
                    out += dollarTag;
                    i += dollarTag.length;
                    continue;
                }
            }
            out += ch;
            i += 1;
        } else if (mode === "line") {
            if (ch === "\n") {
                mode = "plain";
                out += ch;
            }
            i += 1;
        } else if (mode === "block") {
            if (ch === "/" && next === "*") {
                blockDepth += 1;
                i += 2;
                continue;
            }
            if (ch === "*" && next === "/") {
                blockDepth -= 1;
                if (blockDepth === 0) mode = "plain";
                i += 2;
                continue;
            }
            i += 1;
        } else if (mode === "single") {
            out += ch;
            if (ch === "'" && next === "'") {
                out += next;
                i += 2;
                continue;
            }
            if (ch === "'") mode = "plain";
            i += 1;
        } else if (mode === "double") {
            out += ch;
            if (ch === '"' && next === '"') {
                out += next;
                i += 2;
                continue;
            }
            if (ch === '"') mode = "plain";
            i += 1;
        } else {
            if (sqlText.startsWith(dollarTag, i)) {
                out += dollarTag;
                i += dollarTag.length;
                mode = "plain";
                dollarTag = "";
                continue;
            }
            out += ch;
            i += 1;
        }
    }
    return out;
}

export function sha256Hex(text: string): string {
    return createHash("sha256").update(text, "utf8").digest("hex");
}
