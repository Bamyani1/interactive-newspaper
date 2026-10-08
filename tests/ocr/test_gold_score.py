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


def test_auto_map_pairs_changed_text_by_similarity_and_says_so():
    report = score_editions(
        _edition("One exact body of several words."),
        _edition("One changed body of several words."),
        auto_map=True,
    )
    articles = report["collections"]["articles"]
    assert report["mapping_method"] == "similarity_auto"
    assert articles["matched_count"] == 1
    assert articles["word_fidelity"]["substitutions"] == 1


def test_paragraph_breaks_are_scored_against_gold():
    gold = _edition("First part here.\n\nSecond part here.\n\nThird part here.")
    candidate = _edition("First part here.\n\nSecond part here. Third part here.")

    report = score_editions(gold, candidate, {"articles": [[0, 0]], "ads": [], "other_content": []})

    breaks = report["collections"]["articles"]["paragraph_breaks"]
    assert breaks["gold"] == 2
    assert breaks["found"] == 1
    assert breaks["recall"] == pytest.approx(0.5)
    assert breaks["precision"] == pytest.approx(1.0)


def test_edition_words_count_text_lost_but_not_text_filed_elsewhere():
    gold = _edition("Story text.")
    gold["ads"] = [{"business_name": "Shop", "body": "Open late daily"}]
    candidate = _edition("Story text.")
    candidate["ads"] = [{"business_name": "Shop", "body": "Open late"}]
    candidate["other_content"] = [{"title": "", "body": "daily"}]

    assert score_editions(gold, candidate, auto_map=True)["edition_words"]["missing"] == 0

    candidate["other_content"] = []
    words = score_editions(gold, candidate, auto_map=True)["edition_words"]
    assert (words["missing"], words["extra"]) == (1, 0)
