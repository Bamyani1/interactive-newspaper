"""archive:run's contract with scripts/iiif/download.py: paced, targeted, honest exit."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def download(monkeypatch: pytest.MonkeyPatch):
    spec = importlib.util.spec_from_file_location(
        "iiif_download", ROOT / "scripts/iiif/download.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "fetch_manifest", lambda url: (url, {"label": "x"}))
    monkeypatch.setattr(module, "_write_source_metadata", lambda *args: None)
    monkeypatch.setattr(module, "image_exists", lambda *args: False)
    monkeypatch.setattr(
        module,
        "build_download_tasks",
        lambda manifest, output_dir: [
            {
                "index": i,
                "image_service_url": f"https://iiif/{i}",
                "output_dir": output_dir,
                "filename_base": f"{i:04d}",
            }
            for i in range(1, 4)
        ],
    )
    return module


def test_pace_downloads_one_image_at_a_time_with_a_pause_between(download, tmp_path):
    order: list[int] = []
    sleeps: list[float] = []
    download.download_image = lambda task: (
        order.append(task["index"]) or {**task, "successful": True}
    )

    result = download.download_manifest(
        "https://m",
        output_root=str(tmp_path),
        output_dir_name="d",
        pace_seconds=1.5,
        sleep=sleeps.append,
    )

    assert order == [1, 2, 3]
    assert sleeps == [1.5, 1.5]
    assert result["successful"] == 3


def test_cli_writes_to_output_dir_and_exits_1_when_a_canvas_failed(
    download, tmp_path, monkeypatch
):
    seen: list[str] = []

    def fake(task):
        seen.append(task["output_dir"])
        return {**task, "successful": task["index"] != 2}

    download.download_image = fake
    target = tmp_path / "1983-09-22-contentdm-12"
    monkeypatch.setattr(download.time, "sleep", lambda _s: None)
    monkeypatch.setattr(
        "sys.argv",
        ["download.py", "https://m", "--output-dir", str(target), "--pace", "1"],
    )

    assert download.main() == 1
    assert set(seen) == {str(target)}


def test_cli_exits_0_when_every_canvas_downloaded(download, tmp_path, monkeypatch):
    download.download_image = lambda task: {**task, "successful": True}
    monkeypatch.setattr(
        "sys.argv", ["download.py", "https://m", "--output-dir", str(tmp_path / "d")]
    )

    assert download.main() == 0


def test_cli_exits_1_when_the_manifest_cannot_be_fetched(
    download, tmp_path, monkeypatch
):
    def broken(url):
        raise RuntimeError("HTTP 500")

    monkeypatch.setattr(download, "fetch_manifest", broken)
    monkeypatch.setattr(
        "sys.argv", ["download.py", "https://m", "--output-dir", str(tmp_path / "d")]
    )

    assert download.main() == 1
