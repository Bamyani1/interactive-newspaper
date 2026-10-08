"""Rebuild Document AI text into column-pure blocks from token geometry.

Document AI's own lines and paragraphs splice words from neighbouring narrow
newspaper columns. Here tokens are regrouped: same-line runs that never cross
a gutter, runs chained down one column, chains split at paragraph indents.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass

Box = tuple[float, float, float, float]

# Thresholds, in multiples of the line height.
_MAX_WORD_GAP = 4.0  # widest gap still treated as a word space
_GUTTER_LINES = 7.0  # a gutter stays clear this far above or below the gap
_GUTTER_MIN_WIDTH = 0.2
_SAME_LINE = 0.35  # max vertical-centre offset between tokens on one line
_MAX_LINE_STEP = 1.5  # max centre-to-centre step between lines of one column
_INDENT = 0.6
# Height ratios beyond these mean a different type size (headline vs body).
_TOKEN_SIZE_CHANGE = 1.6
_LINE_SIZE_CHANGE = 1.4


@dataclass(frozen=True)
class Token:
    """One Document AI token: text with its trailing break, box in page pixels."""

    text: str
    box: Box
    start: int
    end: int


def _height(box: Box) -> float:
    return box[3] - box[1]


def _centre_y(box: Box) -> float:
    return (box[1] + box[3]) / 2


def _union(boxes: list[Box]) -> Box:
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def _clear_band(
    tokens: list[Token], x0: float, x1: float, y0: float, y1: float, min_width: float
) -> bool:
    """True if some strip of min_width inside (x0, x1) has no token over [y0, y1]."""
    covered = sorted(
        (max(x0, t.box[0]), min(x1, t.box[2]))
        for t in tokens
        if t.box[3] > y0 and t.box[1] < y1 and t.box[2] > x0 and t.box[0] < x1
    )
    cursor = x0
    for left, right in covered:
        if left - cursor >= min_width:
            return True
        cursor = max(cursor, right)
    return x1 - cursor >= min_width


def _is_gutter(tokens: list[Token], last: Token, token: Token, h: float) -> bool:
    """A gap is a gutter when a clear strip runs through it, above or below, and
    same-size text on other lines flanks it on both sides (empty space is no evidence)."""
    x0, x1 = last.box[2], token.box[0]
    min_width = _GUTTER_MIN_WIDTH * h
    if x1 - x0 < min_width:
        return False
    y0 = min(token.box[1], last.box[1])
    y1 = max(token.box[3], last.box[3])
    line_y = (_centre_y(last.box) + _centre_y(token.box)) / 2
    reach = _GUTTER_LINES * h
    windows = [(y0 - reach, y1), (y0, y1 + reach)]
    # A headline over the gap blocks those bands; also try the same
    # height of band slid to start below (or end above) that headline.
    for t in tokens:
        if t.box[0] < x1 and t.box[2] > x0 and _height(t.box) > _TOKEN_SIZE_CHANGE * h:
            if y0 - reach < t.box[3] <= y0:
                windows.append((t.box[3], t.box[3] + reach + y1 - y0))
            elif y1 <= t.box[1] < y1 + reach:
                windows.append((t.box[1] - reach - (y1 - y0), t.box[1]))
    for top, bottom in windows:
        if not _clear_band(tokens, x0, x1, top, bottom, min_width):
            continue
        flanking = [
            t
            for t in tokens
            if t.box[3] > top
            and t.box[1] < bottom
            and abs(_centre_y(t.box) - line_y) > _SAME_LINE * h
            and 0.5 < _height(t.box) / h < 1.6
        ]
        left = [
            _centre_y(t.box)
            for t in flanking
            if t.box[0] < x0 and x0 - 2 * h <= t.box[2] <= x1
        ]
        right = [
            _centre_y(t.box)
            for t in flanking
            if t.box[2] > x1 and x0 <= t.box[0] <= x1 + 2 * h
        ]
        tolerance = _SAME_LINE * h
        if _count_lines(left, tolerance) >= 2 and _count_lines(right, tolerance) >= 2:
            return True
    return False


def _count_lines(centres: list[float], tolerance: float) -> int:
    """Number of distinct lines among token centre heights."""
    count, previous = 0, None
    for y in sorted(centres):
        if previous is None or y - previous > tolerance:
            count += 1
        previous = y
    return count


def _lines(tokens: list[Token], line_height: float) -> list[list[Token]]:
    """Group tokens into left-to-right line runs that never cross a gutter."""
    runs: list[list[Token]] = []
    for token in sorted(tokens, key=lambda t: t.box[0]):
        best: tuple[float, list[Token], float] | None = None
        for run in runs:
            last = run[-1]
            h = max(_height(token.box), _height(last.box), line_height)
            gap = token.box[0] - last.box[2]
            if gap < -0.3 * h or gap > _MAX_WORD_GAP * h:
                continue
            if abs(_centre_y(token.box) - _centre_y(last.box)) > _SAME_LINE * h:
                continue
            sizes = (
                max(_height(token.box), line_height),
                max(_height(last.box), line_height),
            )
            if max(sizes) / min(sizes) > _TOKEN_SIZE_CHANGE:
                continue
            if best is None or gap < best[0]:
                best = (gap, run, h)
        if best is not None:
            _, run, h = best
            if not _is_gutter(tokens, run[-1], token, h):
                run.append(token)
                continue
        runs.append([token])
    return runs


Chain = list[list[Token]]


def _run_box(run: list[Token]) -> Box:
    return _union([t.box for t in run])


def _run_size(run: list[Token], line_height: float) -> float:
    """Type size of a line run; the median resists Document AI's noisy token heights."""
    return max(statistics.median(_height(t.box) for t in run), line_height)


def _same_size(a: float, b: float, limit: float) -> bool:
    return max(a, b) / min(a, b) <= limit


def _chains(runs: list[list[Token]], line_height: float) -> list[Chain]:
    """Link each line run to the nearest same-size run below it in the same column."""
    items = sorted(
        ((_run_box(run), run, _run_size(run, line_height)) for run in runs),
        key=lambda item: (_centre_y(item[0]), item[0][0]),
    )
    following: dict[int, int] = {}
    linked: set[int] = set()
    for i, (a, _, ha) in enumerate(items):
        best: tuple[float, int] | None = None
        for j in range(i + 1, len(items)):
            b, _, hb = items[j]
            dy = _centre_y(b) - _centre_y(a)
            if dy > _MAX_LINE_STEP * ha:
                break
            if dy < 0.4 * min(ha, hb) or j in linked:
                continue
            overlap = min(a[2], b[2]) - max(a[0], b[0])
            if overlap < 0.5 * min(a[2] - a[0], b[2] - b[0]):
                continue
            if not _same_size(ha, hb, _LINE_SIZE_CHANGE):
                continue
            if best is None or dy < best[0]:
                best = (dy, j)
        if best is not None:
            following[i] = best[1]
            linked.add(best[1])
    chains: list[Chain] = []
    for i in range(len(items)):
        if i in linked:
            continue
        chain = [items[i][1]]
        j = i
        while j in following:
            j = following[j]
            chain.append(items[j][1])
        chains.append(chain)
    return chains


def _merge_orphans(chains: list[Chain], line_height: float) -> list[Chain]:
    """Put a one-line fragment back into the line it was split from, when it
    sits inside that line's column (a false gutter, not a real column)."""
    kept = [chain for chain in chains if len(chain) > 1]
    # A column's typical line edges, measured before any merge widens a line.
    spans = []
    for column in kept:
        boxes = [_run_box(run) for run in column]
        left = statistics.median(b[0] for b in boxes) - 0.5 * line_height
        right = statistics.median(b[2] for b in boxes) + 0.5 * line_height
        spans.append((column, left, right))
    for chain in chains:
        if len(chain) > 1:
            continue
        orphan = chain[0]
        ob, size = _run_box(orphan), _run_size(orphan, line_height)
        best: tuple[float, list[Token]] | None = None
        for column, left, right in spans:
            if ob[0] < left or ob[2] > right:
                continue
            for run in column:
                rb = _run_box(run)
                h = max(size, _run_size(run, line_height))
                if abs(_centre_y(rb) - _centre_y(ob)) > _SAME_LINE * h:
                    continue
                if not _same_size(size, _run_size(run, line_height), _LINE_SIZE_CHANGE):
                    continue
                gap = ob[0] - rb[2] if ob[0] >= rb[0] else rb[0] - ob[2]
                if -0.3 * h <= gap <= _MAX_WORD_GAP * h and (
                    best is None or gap < best[0]
                ):
                    best = (gap, run)
        if best is None:
            kept.append(chain)
        else:
            best[1].extend(orphan)
            best[1].sort(key=lambda t: t.box[0])
    return kept


def _reading_order(chains: list[Chain]) -> list[Chain]:
    """Order chains top to bottom within a column and left to right across
    columns that share height; ties and cycles fall back to (top, left)."""
    boxes = [_union([t.box for run in chain for t in run]) for chain in chains]
    count = len(chains)
    successors: list[list[int]] = [[] for _ in range(count)]
    indegree = [0] * count
    for i, a in enumerate(boxes):
        for j, b in enumerate(boxes):
            if i == j:
                continue
            x_overlap = min(a[2], b[2]) - max(a[0], b[0])
            y_overlap = min(a[3], b[3]) - max(a[1], b[1])
            if x_overlap > 0.2 * min(a[2] - a[0], b[2] - b[0]):
                first = a[1] < b[1] or (a[1] == b[1] and i < j)
            else:
                first = y_overlap > 0 and a[0] < b[0]
            if first:
                successors[i].append(j)
                indegree[j] += 1
    order: list[int] = []
    remaining = set(range(count))
    while remaining:
        ready = [i for i in remaining if indegree[i] == 0] or list(remaining)
        pick = min(ready, key=lambda i: (boxes[i][1], boxes[i][0]))
        order.append(pick)
        remaining.remove(pick)
        for j in successors[pick]:
            indegree[j] -= 1
    return [chains[i] for i in order]


def _line_text(run: list[Token]) -> str:
    parts = []
    for token, after in zip(run, run[1:] + [None]):
        text = token.text.replace("\n", " ")
        if after is not None and after.start != token.end and not text[-1:].isspace():
            text += " "
        parts.append(text)
    return "".join(parts).strip()


def column_blocks(tokens: list[Token]) -> list[tuple[str, Box]]:
    """Return (text, pixel box) blocks, one per paragraph of one column, in page order."""
    if not tokens:
        return []
    line_height = statistics.median(_height(t.box) for t in tokens)
    chains = _chains(_lines(tokens, line_height), line_height)
    blocks = []
    for chain in _reading_order(_merge_orphans(chains, line_height)):
        left = statistics.median(_run_box(run)[0] for run in chain)
        paragraphs = [[chain[0]]]
        for run in chain[1:]:
            if _run_box(run)[0] - left > _INDENT * line_height:
                paragraphs.append([run])
            else:
                paragraphs[-1].append(run)
        for paragraph in paragraphs:
            text = "\n".join(_line_text(run) for run in paragraph)
            if text:
                blocks.append((text, _union([_run_box(run) for run in paragraph])))
    return blocks
