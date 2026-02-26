/** True when the headline is an AI-generated image description, not real article text. */
export function isAdImageDescription(headline: string): boolean {
  const h = headline.trim().toLowerCase();
  // Ad image descriptions
  if (h.startsWith("advertisement titled") || h.startsWith("advertisement for")) return true;
  // Section banners described by AI (e.g., "Sports section header for the Ohio Wesleyan Transcript.")
  if (h.includes("section header")) return true;
  // AI-generated visual element descriptions (e.g., "A cartoon illustration of a character...")
  if (/^an?\s+(cartoon|decorative|logo)\s+(illustration|image|drawing|graphic)\b/.test(h)) return true;
  // Newspaper layout-element descriptions (e.g., "the Ohio College Newspaper Association logo within the newspaper's masthead")
  if (/\blogo\b/.test(h) && /\bmasthead\b|\bnameplate\b|\bheader\b|\bbanner\b/.test(h)) return true;
  // AI descriptions of visual elements using spatial language (e.g., "the X logo within the newspaper's Y")
  if (/\b(logo|emblem|seal|crest|insignia)\b/.test(h) &&
    /\b(within|inside|depicting|showing)\s+the\s+(newspaper|paper|publication|page)\b/.test(h)) return true;
  return false;
}

export function isValidImageFile(filename: string): boolean {
  return /\.(jpe?g|png|gif|webp|tiff?)$/i.test(filename);
}

/** True when a caption is just the author's name/mugshot label, not real content. */
export function isAuthorHeadshot(
  caption: string | undefined,
  authorName: string,
): boolean {
  if (!caption || !authorName) return false;
  const cap = caption.trim();
  const capWords = cap.split(/\s+/);
  if (capWords.length > 3 || /[,!?;:()]/.test(cap)) return false;
  const nameParts = authorName.toLowerCase().split(/\s+/);
  return capWords.some((w) => nameParts.includes(w.toLowerCase()));
}

/**
 * Detect body/caption duplication. Used to collapse OCR photo-only artifacts.
 */
export function isBodyMostlyCaption(body: string, caption: string): boolean {
  const bodyNorm = body.replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s.]+$/, "");
  const capNorm = caption.replace(/\s+/g, " ").trim().toLowerCase().replace(/[\s.]+$/, "");
  if (bodyNorm.length === 0) return false;
  const shorter = bodyNorm.length <= capNorm.length ? bodyNorm : capNorm;
  const longer = bodyNorm.length <= capNorm.length ? capNorm : bodyNorm;
  return longer.includes(shorter) && shorter.length / longer.length > 0.8;
}

/**
 * Detect whether the last body paragraph duplicates a photo caption.
 */
export function doesLastParagraphMatchAnyCaption(
  body: string,
  captions: Array<string | null>,
): boolean {
  const paragraphs = body.split(/\n\n+/);
  if (paragraphs.length <= 1) return false;

  const lastPara = paragraphs[paragraphs.length - 1]
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return captions.some((cap) => {
    if (!cap) return false;
    const capNorm = cap.replace(/\s+/g, " ").trim().toLowerCase();
    if (capNorm.length < 20) return false;
    const shorter = lastPara.length <= capNorm.length ? lastPara : capNorm;
    const longer = lastPara.length <= capNorm.length ? capNorm : lastPara;
    return longer.includes(shorter) && shorter.length / longer.length > 0.7;
  });
}
