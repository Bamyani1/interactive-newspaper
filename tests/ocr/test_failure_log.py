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


def test_log_failure_cli_charges_a_discarded_candidates_cost(tmp_path, monkeypatch):
    from transcript_ocr.cli import log_failure

    provenance = tmp_path / "provenance.json"
    provenance.write_text(json.dumps({"estimated_cost_usd": 1.82}))
    seen: dict = {}
    monkeypatch.setattr(log_failure, "append_failure", lambda **fields: seen.update(fields))
    args = ["--edition", "1983-09-22", "--stage", "candidate-validation", "--error", "x"]

    assert log_failure.main([*args, "--provenance", str(provenance)]) == 0
    assert seen["estimated_cost_usd"] == 1.82

    seen.clear()
    assert log_failure.main([*args, "--provenance", str(tmp_path / "missing.json")]) == 0
    assert seen["estimated_cost_usd"] is None
