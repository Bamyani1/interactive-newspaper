"""Architecture boundary tests for transcript_ocr package."""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Iterable

PKG_ROOT = Path(__file__).resolve().parents[3] / "ocr" / "src" / "transcript_ocr"
OCR_ROOT = Path(__file__).resolve().parents[3] / "ocr"


def _resolve_relative_module(path: Path, module: str, level: int) -> str:
    try:
        rel = path.relative_to(PKG_ROOT).with_suffix("")
    except ValueError:
        # Non-package files (e.g. top-level wrappers) are handled without
        # relative-module expansion.
        return module
    package_parts = ("transcript_ocr", *rel.parts[:-1])
    if level <= 0:
        return module
    # level=1 means current package, level=2 means parent package, etc.
    trim = level - 1
    if trim > len(package_parts):
        return module
    base_parts = package_parts[: len(package_parts) - trim]
    if module:
        return ".".join((*base_parts, module))
    return ".".join(base_parts)


def _imports_from(path: Path) -> list[str]:
    tree = ast.parse(path.read_text())
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            imports.append(_resolve_relative_module(path, module, node.level))
    return imports


def _assert_no_import_prefixes(path: Path, forbidden_prefixes: Iterable[str]) -> None:
    imports = _imports_from(path)
    bad = [imp for imp in imports if imp.startswith(tuple(forbidden_prefixes))]
    assert not bad, f"{path} has forbidden imports: {bad}"


def test_contracts_do_not_import_non_contract_layers():
    forbidden_prefixes = (
        "transcript_ocr.application",
        "transcript_ocr.postprocessing",
        "transcript_ocr.recognition",
        "transcript_ocr.detection",
        "transcript_ocr.preprocessing",
        "transcript_ocr.image_linking",
        "transcript_ocr.merging",
        "transcript_ocr.export",
        "transcript_ocr.diagnostics",
    )

    contracts_dir = PKG_ROOT / "contracts"
    for path in contracts_dir.glob("*.py"):
        if path.name == "__init__.py":
            continue
        _assert_no_import_prefixes(path, forbidden_prefixes)


def test_shared_does_not_import_domain_layers():
    forbidden_prefixes = (
        "transcript_ocr.application",
        "transcript_ocr.recognition",
        "transcript_ocr.detection",
        "transcript_ocr.preprocessing",
        "transcript_ocr.postprocessing",
        "transcript_ocr.image_linking",
        "transcript_ocr.merging",
        "transcript_ocr.export",
        "transcript_ocr.diagnostics",
        "transcript_ocr.evaluation",
    )

    shared_dir = PKG_ROOT / "shared"
    for path in shared_dir.glob("*.py"):
        if path.name == "__init__.py":
            continue
        _assert_no_import_prefixes(path, forbidden_prefixes)


def test_stage_modules_do_not_import_application_layer():
    stage_dirs = [
        "ingestion",
        "preprocessing",
        "detection",
        "recognition",
        "postprocessing",
        "image_linking",
        "merging",
        "export",
        "diagnostics",
    ]
    for stage in stage_dirs:
        for path in (PKG_ROOT / stage).glob("*.py"):
            if path.name == "__init__.py":
                continue
            _assert_no_import_prefixes(path, ("transcript_ocr.application",))


def test_evaluation_does_not_import_runtime_layers():
    forbidden_prefixes = (
        "transcript_ocr.application",
    )
    eval_dir = PKG_ROOT / "evaluation"
    for path in eval_dir.glob("*.py"):
        if path.name == "__init__.py":
            continue
        _assert_no_import_prefixes(path, forbidden_prefixes)


def test_docai_provider_does_not_import_gemini_or_page_extractor():
    """
    docai_provider.py must stay cleanly separated from Gemini and page_extractor.
    Document AI (deterministic OCR) and Gemini (semantic structuring) must not be coupled.
    """
    docai_path = PKG_ROOT / "recognition" / "docai_provider.py"
    if not docai_path.exists():
        return  # Skip if file not yet created
    forbidden_prefixes = (
        "transcript_ocr.recognition.page_extractor",
        "google.genai",
        "transcript_ocr.shared.retry",
    )
    _assert_no_import_prefixes(docai_path, forbidden_prefixes)


def test_top_level_wrappers_import_cli_only():
    wrapper_to_expected = {
        OCR_ROOT / "convert_scans.py": "transcript_ocr.cli.convert_scans",
        OCR_ROOT / "enrich_ads.py": "transcript_ocr.cli.enrich_ads",
    }
    for path, expected in wrapper_to_expected.items():
        imports = _imports_from(path)
        assert expected in imports, f"{path} must import {expected}"
