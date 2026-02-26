/**
 * OCR text normalization helpers shared by article transforms.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Rejoin words split by hyphens across line/paragraph breaks (OCR artifact). */
export function dehyphenate(text: string): string {
  return text.replace(/(\w)-\n+\s*([a-z])/g, "$1$2");
}

/** Detect and strip OCR preamble: letter salutations and role-title lines. */
export function cleanBodyPreamble(
  body: string,
  hasAuthor: boolean,
): { body: string; roleTitle: string | null } {
  // 1. Strip letter-to-editor salutation (runs regardless of author)
  const breakIdx1 = body.indexOf("\n\n");
  if (breakIdx1 >= 0) {
    const firstParagraph = body.slice(0, breakIdx1).trim();
    if (/^Editor,?\s+the\s+Transcript:?\s*$/i.test(firstParagraph)) {
      body = body.slice(breakIdx1 + 2);
    }
  }

  // 2. Strip role-title line (existing logic, unchanged)
  if (!hasAuthor) return { body, roleTitle: null };

  const breakIdx2 = body.indexOf("\n\n");
  if (breakIdx2 < 0) return { body, roleTitle: null };

  const firstLine = body.slice(0, breakIdx2).trim();
  const words = firstLine.split(/\s+/);

  if (
    words.length <= 3 &&
    !/[.,!?;:]/.test(firstLine) &&
    words.every((w) => /^[A-Z]/.test(w))
  ) {
    return { body: body.slice(breakIdx2 + 2), roleTitle: firstLine };
  }

  return { body, roleTitle: null };
}

/** Strip OCR page-break markers and convert paragraphs to HTML. */
export function bodyToHtml(body: string): string {
  const dehyphenated = dehyphenate(body);
  const cleaned = dehyphenated.replace(/\n\. \d+\n/g, "\n");
  return cleaned
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("\n");
}

export function extractSummary(body: string): string {
  const dehyphenated = dehyphenate(body);
  const cleaned = dehyphenated.replace(/\n\. \d+\n/g, "\n");
  const first = cleaned.split(/\n\n/)[0]?.trim() || "";
  if (first.length <= 300) return first;
  const lastSpace = first.lastIndexOf(" ", 300);
  const boundary = lastSpace > 200 ? lastSpace : 297;
  return `${first.slice(0, boundary).trim()}...`;
}
