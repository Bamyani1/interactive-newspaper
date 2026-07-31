import json

import pytest

from transcript_ocr.export.validation import CandidateValidationError, validate_candidate_file


def _candidate():
    return {
        "edition_date": "1990-02-21",
        "publication_info": "The Transcript",
        "articles": [{
            "headline": "Headline",
            "author": "",
            "writer_position": "",
            "category": "News",
            "continues_on": "",
            "continued_from": "",
            "body": "Body",
            "images": [],
            "image_files": [],
            "source_pages": ["1"],
        }],
        "ads": [],
        "other_content": [],
    }


def test_valid_candidate(tmp_path):
    path = tmp_path / "edition.json"
    path.write_text(json.dumps(_candidate()))
    assert validate_candidate_file(path, expected_date="1990-02-21")["articles"]


def test_invalid_category_fails(tmp_path):
    payload = _candidate()
    payload["articles"][0]["category"] = "Campus"
    path = tmp_path / "edition.json"
    path.write_text(json.dumps(payload))
    with pytest.raises(CandidateValidationError, match="invalid category"):
        validate_candidate_file(path)
