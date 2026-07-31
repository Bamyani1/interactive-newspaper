import pytest

from transcript_ocr.evaluation.gold_score import score_editions


def _edition(article_body: str):
    return {
        "edition_date": "1990-02-21",
        "publication_info": "The Transcript",
        "articles": [
            {
                "headline": "Headline",
                "author": "Reporter",
                "writer_position": "Staff Writer",
                "category": "News",
                "source_pages": ["1"],
                "continues_on": "",
                "continued_from": "",
                "body": article_body,
                "image_files": [],
            }
        ],
        "ads": [],
        "other_content": [],
    }


def test_exact_mode_never_fuzzily_pairs_changed_text():
    report = score_editions(_edition("One exact body."), _edition("One changed body."))
    articles = report["collections"]["articles"]
    assert report["mapping_method"] == "exact_normalized_fingerprint"
    assert articles["matched_count"] == 0
    assert articles["recall"] == 0.0


def test_manual_mapping_scores_word_and_character_fidelity():
    report = score_editions(
        _edition("One exact body."),
        _edition("One changed body."),
        {"articles": [[0, 0]], "ads": [], "other_content": []},
    )
    articles = report["collections"]["articles"]
    assert report["mapping_method"] == "manual_reviewed_indices"
    assert articles["matched_count"] == 1
    assert articles["word_fidelity"]["substitutions"] == 1
    assert articles["word_fidelity"]["wer"] == pytest.approx(1 / 3, abs=1e-6)
    assert articles["character_fidelity"]["cer"] > 0
