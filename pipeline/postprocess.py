#!/usr/bin/env python3
"""
OCR post-processing to fix common errors.
"""
import re


# Common OCR substitution errors
OCR_FIXES = {
    # Character confusion
    r'\brn\b': 'm',           # "rn" often misread for "m"
    r'(?<=[a-z])1(?=[a-z])': 'l',  # "1" in middle of word → "l"
    r'(?<=[a-z])0(?=[a-z])': 'o',  # "0" in middle of word → "o"
    r'\bI\b(?=[a-z])': 'l',   # Standalone "I" before lowercase → "l"

    # Common word fixes for newspapers
    r'\bswit?chboar[sd]?\b': 'switchboards',
    r'\bcalend[ae]rs?\b': 'calendars',
    r'\bchall[ae]nge\b': 'challenge',
    r'\bgovern-?\s*ment\b': 'government',
    r'\badrninistr': 'administr',

    # Punctuation fixes
    r'\.(?=[A-Z][a-z])': '. ',  # Period directly before capital → add space
    r'\s+\.': '.',              # Space before period → remove
    r',,': ',',                 # Double comma
    r'""': '"',                 # Double quote
}

# Words that are commonly split across lines in newspapers
HYPHEN_FIXES = [
    (r'fund-\s*raising', 'fundraising'),
    (r'per-\s*sonalized', 'personalized'),
    (r'switch-\s*boards?', 'switchboards'),
    (r'ad-\s*missions', 'admissions'),
    (r'Uni-\s*versity', 'University'),
    (r'ad-\s*ministr', 'administr'),
    (r'ex-\s*perience', 'experience'),
    (r'cam-\s*paign', 'campaign'),
    (r'organ-\s*izations?', 'organizations'),
]


def fix_hyphenated_words(text: str) -> str:
    """Fix words that were hyphenated at line breaks."""
    for pattern, replacement in HYPHEN_FIXES:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    # Generic hyphen-newline fix: word- \n continuation
    text = re.sub(r'(\w+)-\s*\n\s*(\w+)', r'\1\2', text)

    return text


def fix_ocr_errors(text: str) -> str:
    """Apply common OCR error fixes."""
    for pattern, replacement in OCR_FIXES.items():
        text = re.sub(pattern, replacement, text)
    return text


def fix_spacing(text: str) -> str:
    """Fix spacing issues."""
    # Multiple spaces → single space
    text = re.sub(r'  +', ' ', text)

    # Fix missing space after period (but not in abbreviations like "p." or "Mr.")
    text = re.sub(r'\.(?=[A-Z][a-z]{2,})', '. ', text)

    # Fix spurious periods before words
    text = re.sub(r'(?<!\.)\.(?=[A-Z][a-z])', '', text)

    return text


def clean_ocr_text(text: str) -> str:
    """
    Full OCR cleaning pipeline.
    """
    text = fix_hyphenated_words(text)
    text = fix_ocr_errors(text)
    text = fix_spacing(text)
    return text


def clean_article_text(text: str) -> str:
    """
    Clean article text specifically (for fullText field).
    Preserves paragraph structure.
    """
    # Split by paragraph tags if present
    if '<p>' in text:
        paragraphs = re.findall(r'<p>(.*?)</p>', text, re.DOTALL)
        cleaned = [clean_ocr_text(p) for p in paragraphs]
        return ''.join(f'<p>{p}</p>' for p in cleaned)
    else:
        return clean_ocr_text(text)


def clean_headline(headline: str) -> str:
    """Clean headline text - remove newlines, extra spaces."""
    headline = headline.replace('\n', ' ')
    headline = re.sub(r'\s+', ' ', headline)
    return headline.strip()


def clean_byline(byline: str) -> str:
    """Clean byline text."""
    if not byline:
        return None
    byline = byline.replace('\n', ' ')
    byline = re.sub(r'\s+', ' ', byline)
    # Fix ".Academic" → "Academic"
    byline = re.sub(r'\.(?=[A-Z])', '', byline)
    return byline.strip()


