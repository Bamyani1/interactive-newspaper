"""Timing helpers."""

from __future__ import annotations

import time
from contextlib import contextmanager
from collections.abc import Iterator


@contextmanager
def timed_section(timings: dict[str, float], key: str) -> Iterator[None]:
    start = time.time()
    try:
        yield
    finally:
        timings[key] = timings.get(key, 0.0) + (time.time() - start)


def now_s() -> float:
    return time.time()


__all__ = ["now_s", "timed_section"]
