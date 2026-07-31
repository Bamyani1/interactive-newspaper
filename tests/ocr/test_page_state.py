from transcript_ocr.contracts.page_state import (
    PageOutcome,
    PageState,
    may_publish,
    publication_ratio,
)


def test_manifest_canvas_count_is_always_denominator():
    outcomes = [
        PageOutcome(i, PageState.PASSED_CONTENT) for i in range(1, 8)
    ]
    assert publication_ratio(outcomes, 10) == 0.7
    assert may_publish(outcomes, 10)
    assert not may_publish(outcomes, 11)


def test_failed_and_missing_outcomes_do_not_pass():
    outcomes = [
        PageOutcome(1, PageState.PASSED_VISUAL),
        PageOutcome(2, PageState.CONFIRMED_BLANK),
        PageOutcome(3, PageState.FAILED),
    ]
    assert publication_ratio(outcomes, 4) == 0.5
