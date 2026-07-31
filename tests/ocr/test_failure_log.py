import json

from transcript_ocr.diagnostics.failure_log import append_failure


def test_failure_log_is_metadata_only_and_sanitized(tmp_path):
    target = tmp_path / "failures.jsonl"
    append_failure(
        edition="1990-02-21",
        canvas=2,
        page="2",
        stage="page_structuring",
        attempt=3,
        model="gemini-3.5-flash-lite",
        config_id="page-v1",
        error="bad\nresponse at /private/tmp/secret/raw.json",
        tokens={"prompt": 4, "thoughts": 2},
        log_path=target,
    )
    record = json.loads(target.read_text())
    assert record["stage"] == "page_structuring"
    assert "\n" not in record["error"]
    assert "/private/tmp" not in record["error"]
    assert "prompt" not in record
    assert "response" not in record
