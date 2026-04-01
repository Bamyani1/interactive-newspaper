"""Prompt and safety settings constants."""

from __future__ import annotations

from google.genai import types

IMAGE_MATCHING_PROMPT = """\
You are analyzing a newspaper page image with numbered red rectangles drawn around detected regions.

Below is a list of articles and advertisements extracted from this page, with body text previews and any associated caption text to help you match correctly.

{content_list}

For each numbered region (1 through {num_regions}), determine what it is and return an assignment:
- region_number: the number shown on the image (1-based)
- content_type: "article", "ad", "standalone", "text_ad", or "not_image"
- content_index: the 0-based index from the list above (-1 for standalone/text_ad/not_image)
- caption: a brief description of what the image shows (leave empty for text_ad/not_image)

CATEGORIZATION & MATCHING GUIDELINES:
1. Identify the visual type first:
   - "not_image": Border artifacts, scanner noise, decorative ruled lines, partial fragments — no meaningful content at all.
   - "text_ad": Region contains ONLY typeset/printed text — ad copy, phone numbers, addresses, classified listings. No photos, illustrations, logos, or drawings.
   - If it has actual graphical content (photo, illustration, logo, art), it is an "article", "ad", or "standalone".

2. For actual images, match to the content:
   - "article": Photo belongs to a specific article — match by visual content, proximity, and topic relevance relative to the body text preview.
   - "ad": Photo/illustration/logo is part of an advertisement.
   - "standalone": A meaningful image that does not clearly belong to any listed article or ad.

3. CRITICAL — Caption-based matching (highest accuracy method):
   - Look at the TEXT PRINTED DIRECTLY BELOW OR BESIDE each numbered region on the page image.
   - This text is the photo's CAPTION — it names the people or describes the event in the photo.
   - Match the caption's content to the article whose body discusses the same people or event.
   - Caption matching is MORE RELIABLE than visual appearance. Use it as the primary signal.
   - If the extracted captions listed above for an article match what you see near a region, that is a strong confirmation.
"""

MERGE_PROMPT = """\
You are analyzing newspaper articles extracted from individual pages of a single edition.
Some articles start on one page and continue on another.

Below is a numbered list of articles with their page, headline, author, continuation references, and a preview. Your task is to return ONLY grouping decisions — which articles should be merged.

Rules:
1. Merge ONLY when there is clear evidence of continuation: explicit "Continued on/from page X" references matching the other article's page, matching headlines across pages, or a stub (headline with "---"/"..." prefix) paired with its source. Tolerate OCR misspellings in continuation markers (e.g., "Continuted" for "Continued", "(. 1)" for "(p. 1)").
2. NEVER merge articles that both have distinct, substantive headlines — even if on similar topics. Example: "Scots Spoil Homecoming" and "Bishops Hurt By Mistakes" are SEPARATE articles.
3. NEVER merge a photo-only entry (body is just a caption, <100 chars) into an article body. Photo captions should remain as standalone entries.
4. Every article must appear in exactly one group (even single-article groups).
5. When multiple articles on the SAME page reference the SAME continuation page, match them 1:1 by headline and content similarity. Read the CONTENT of each preview carefully — pair by semantic match, not by order.
6. For EVERY group, set a "confidence" score between 0.0 and 1.0:
   - 1.0 = reciprocal explicit markers (both sides reference each other's page)
   - 0.8-0.9 = one-sided explicit marker with matching headline or content
   - 0.5-0.7 = ambiguous match based on content similarity alone
   - Below 0.5 = very uncertain, should probably remain separate
   Single-article groups (no merge) should have confidence 1.0.
7. Pick the best headline, author, and writer_position for each group — prefer the longer, more descriptive headline.
8. Do NOT return any article body text — only article_ids, merged_headline, merged_author, merged_writer_position, and confidence.
9. When continuation values show "?" (ambiguous/textual page reference), treat them as uncertain — match only if content similarity confirms the connection.
"""

DOCAI_SYSTEM_PROMPT = """\
You are an expert newspaper editor structuring pre-extracted OCR text into articles, advertisements, and other content.

The text below was extracted by Google Cloud Document AI — a deterministic character-level OCR system. Your job is NOT to re-read the image for text; your job is to STRUCTURE the already-extracted text into the correct JSON schema.

CRITICAL RULES:
- Body text MUST come from the OCR transcript provided below. Do not invent, paraphrase, or supplement text that is not in the transcript. If a word is unclear in the transcript (marked with uncertain spelling), keep it as-is.
- If the same name appears multiple times, ensure consistent spelling throughout. Check each proper noun carefully against every other occurrence.
- CRITICAL: Carefully scan the BOTTOM of every column for "Continued on page X", "See page X", "(p. X)", or similar continuation markers. These are often printed in small italic type at the very end of a column and are easy to miss. If found, you MUST populate the "continues_on" field with the page number (digits only, e.g. "5" not "page 5"). Similarly, scan the TOP of columns for "Continued from page Y" markers and populate "continued_from". If an article body ends mid-sentence without any visible continuation marker, set "continues_on" to "?" to signal ambiguity.
- NEVER generate descriptions of what text says. Only use the actual words from the OCR transcript.
- Full-page or large-format subscription/promotional content with pricing is an AD, not an article.
- For optional string fields (author, writer_position, continues_on, continued_from), use an empty string "" — NEVER output the word "null" or "none".
- SPELLING CONSISTENCY: When the same proper noun appears multiple times, ensure consistent spelling throughout. If a name appears as both "Monahan" and "Mohahan", pick the more common/likely spelling and use it everywhere.
- CONTINUATION MARKERS may be garbled by OCR. Look for patterns like "(. X)", "(p X)", "(Cont. from p. X)" and include them in continues_on/continued_from even if partially corrupted.

PRE-EXTRACTED OCR TEXT (paragraph-organized):
{ocr_text}

KNOWN CONTINUATION MARKERS DETECTED BY OCR:
{known_continuations}

For each article:
- Capture the headline (empty string if none visible).
- Capture the byline/author if present. Always include the "By" prefix in the author field if it appears in the original (e.g., "By John Smith").
- If a role or title appears near the byline (e.g., "Sports Editor", "Staff Writer", "Transcript Columnist"), put it in "writer_position" — not in the author field.
- Rejoin hyphenated words split across line breaks.
- Separate paragraphs with blank lines.
- For each photo or illustration, capture its caption and approximate position on the page (e.g. "top-left", "upper-center", "bottom-right", "center-left") in the images field.

Capture advertisements in ads (business_name + full ad text).
Capture masthead/publication header in publication_info.
Set page_number to the numeric page number (e.g., "3" not "Page 3"). Front pages are page 1.
Put any remaining content (schedules, tables, notices, calendars) in other_content.

LETTERS TO THE EDITOR: Each Letter to the Editor is a SEPARATE article. Letters typically end with a signature line (a dash or newline followed by a name, e.g. "- John Smith"). When you see a new salutation ("Editor, the Transcript:") or a new signature followed by a new heading, start a new article. Do not combine multiple signed letters into one article, even if they appear in the same column under a shared heading like "Letters" or "Mail".

CONTINUATION FIELD FORMAT: The `continues_on` and `continued_from` fields must contain ONLY a page number as digits (e.g., "5"). If the source text says "Back Page", "next page", or similar phrases, set the field to "?" — never include textual descriptions.

SYNDICATED CONTENT: Syndicated humor or entertainment columns (nationally distributed content, often with embedded product mentions, sponsor attributions, or copyright notices like "(C) 1960 Author Name") are "Arts & Entertainment", not "Campus News".

LOGOS AND SEALS: Organization logos, newspaper association seals, award emblems, and masthead graphics should go in `other_content` with a descriptive title, not as articles.

Read columns top-to-bottom, then left-to-right. Follow articles that continue across columns.

For each article, YOU MUST ASSIGN EXACTLY ONE of these categories to `category`:
- Campus News: OWU-specific news — administration, policy changes, student government, campus events, institutional announcements, obituaries, Greek life events, student organizations, human interest profiles of students/faculty
- News: National/international news, wire service stories (AP, UPI), off-campus events, government/politics beyond OWU
- Sports: Athletics, game results, player profiles, team news, intramurals
- Arts & Entertainment: Music, theater, film, visual arts, performances, exhibitions, book/film/concert/album reviews, entertainment columns. Also: articles that are primarily photos with no or minimal text body (photo features, photo essays)
- Opinion: Editorials, letters to the editor, commentary columns on campus or social issues

CRITICAL: DO NOT default to "Campus News" unless the article explicitly meets its definition. Read the article and evaluate it against the categories. You MUST provide the `category` field in your response for EVERY article.

Important distinctions:
- Film, book, or music REVIEWS are Arts & Entertainment, not Opinion (Opinion is for editorials/letters about issues)
- Short obituaries and death notices are Campus News
- Wire stories (AP, UPI, Reuters) about national/world events are News, not Campus News
- Student org events and Greek life are Campus News
- Articles with images but no/minimal text body → Arts & Entertainment
- When unsure between Campus News and News, ask: "Is this primarily about OWU or its students?" If yes → Campus News
"""

SAFETY_OFF = [
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="OFF"),
    types.SafetySetting(category="HARM_CATEGORY_CIVIC_INTEGRITY", threshold="OFF"),
]

__all__ = ["DOCAI_SYSTEM_PROMPT", "IMAGE_MATCHING_PROMPT", "MERGE_PROMPT", "SAFETY_OFF"]
