/**
 * Extracts volume and issue number from a raw `publication_info` string.
 *
 * Handles all known format variations across decades:
 *   1960s: "Vol. 93 — No. 13"   (em-dash or hyphen)
 *   1970s: "Vol. 103, No. 14"   (comma)
 *   1980s: "Vol. 113 No. 11"    (space only)
 *   1990s: "Vol.123 No.15"      (no spaces)
 */

export interface PublicationInfo {
  volume: string;
  issue: string;
}

const PUBLICATION_RE = /Vol\.?\s*(\d+)\s*[—–\-,]?\s*No\.?\s*(\d+)/i;

export function parsePublicationInfo(raw: string | undefined | null): PublicationInfo | null {
  if (!raw) return null;
  const match = PUBLICATION_RE.exec(raw);
  if (!match) return null;
  return { volume: match[1], issue: match[2] };
}
