"""Strudel mini-notation from step hits and notes: repeats, offbeats, Euclid, beat groups, cycles."""

from collections.abc import Sequence

import librosa

from algorip.grid import STEPS_PER_BAR
from algorip.notes import Note

BEAT = 4  # slots per beat group
_OPEN, _CLOSE = "[<({", "]>)}"


def bjorklund(k: int, n: int) -> list[bool]:
    """The Euclidean rhythm of k hits in n slots, first slot a hit (Tidal's and Strudel's algorithm)."""
    if k <= 0:
        return [False] * n
    if k >= n:
        return [True] * n
    a, b = k, n - k
    xs: list[list[bool]] = [[True]] * k
    ys: list[list[bool]] = [[False]] * (n - k)
    while min(a, b) > 1:
        if a > b:
            xs, ys = [x + y for x, y in zip(xs[:b], ys)], xs[b:]
            a, b = b, a - b
        else:
            xs, ys = [x + y for x, y in zip(xs, ys[:a])], ys[a:]
            b = b - a
    return [slot for group in xs + ys for slot in group]


def _euclid_in(steps: set[int], m: int) -> tuple[int, int, int] | None:
    for k in range(1, m):
        hits = [i for i, hit in enumerate(bjorklund(k, m)) if hit]
        for rotation in range(m):  # rotated right: each hit moves rotation slots later
            if {(h + rotation) % m for h in hits} == steps:
                return (k, m, rotation)
    return None


def euclid_match(steps: set[int], n: int = 16) -> tuple[int, int, int] | None:
    """The first (k, m, rotation) whose rotated Euclidean rhythm is steps, trying m=8 for even 16ths first."""
    if n == 16 and steps and all(s % 2 == 0 for s in steps):
        match = _euclid_in({s // 2 for s in steps}, 8)
        if match:
            return match
    return _euclid_in(set(steps), n)


def _times(text: str, count: int) -> str:
    return text if count == 1 else f"{text}*{count}"


def bar_mini(name: str, steps: set[int]) -> str:
    """One 16-step bar of a voice's hits; the first rule that applies wins."""
    steps = {s for s in steps if 0 <= s < STEPS_PER_BAR}
    if not steps:
        return "~"
    for k in (16, 8, 4, 2, 1):
        if steps == set(range(0, STEPS_PER_BAR, k)):
            return _times(name, STEPS_PER_BAR // k)
    for k in (16, 8, 4, 2):
        if steps == set(range(k // 2, STEPS_PER_BAR, k)):
            return _times(f"[~ {name}]", STEPS_PER_BAR // k)
    match = euclid_match(steps)
    if match and match[0] >= 2:
        k, m, rotation = match
        return f"{name}({k},{m})" if rotation == 0 else f"{name}({k},{m},{rotation})"
    groups = []
    for start in range(0, STEPS_PER_BAR, BEAT):
        slots = [name if s in steps else "~" for s in range(start, start + BEAT)]
        groups.append("[" + " ".join(slots) + "]" if name in slots else "~")
    return " ".join(groups)


def period(seq: Sequence) -> int:
    """The smallest p dividing len(seq) with seq[i] == seq[i % p] for all i."""
    n = len(seq)
    for p in range(1, n + 1):
        if n % p == 0 and all(seq[i] == seq[i % p] for i in range(n)):
            return p
    return 0


def _has_top_level_space(text: str) -> bool:
    depth = 0
    for ch in text:
        if ch in _OPEN:
            depth += 1
        elif ch in _CLOSE:
            depth -= 1
        elif ch == " " and depth == 0:
            return True
    return False


def cycle(parts: list[str]) -> str:
    """Bars as one alternation per cycle, reduced to their period; one bar is returned as is."""
    parts = parts[: period(parts)]
    if not parts:
        return "~"
    if len(parts) == 1:
        return parts[0]
    return "<" + " ".join(f"[{p}]" if _has_top_level_space(p) else p for p in parts) + ">"


def voice_mini(name: str, bars: list[set[int]]) -> str:
    return cycle([bar_mini(name, b) for b in bars])


def note_name(midi: int) -> str:
    return librosa.midi_to_note(midi, unicode=False).lower()


def notes_bar_mini(notes: list[Note]) -> str:
    """One bar of notes in four beat groups; a note sustains to at most the end of its beat group."""
    starts: dict[int, Note] = {}
    for note in sorted(notes, key=lambda n: (n.step, n.midi)):
        if 0 <= note.step < STEPS_PER_BAR:
            starts.setdefault(note.step, note)  # one note per step
    groups = []
    for start in range(0, STEPS_PER_BAR, BEAT):
        end = start + BEAT
        items: list[str] = []
        slot = start
        while slot < end:
            note = starts.get(slot)
            if note is None:
                items.append("~")
                slot += 1
                continue
            next_start = next((s for s in range(slot + 1, end) if s in starts), end)
            length = min(note.length, next_start - slot)
            name = note_name(note.midi)
            items.append(name if length == 1 else f"{name}@{length}")
            slot += length
        if items == ["~"] * BEAT:
            groups.append("~")
        elif len(items) == 1:
            groups.append(note_name(starts[start].midi))  # one note filling the group
        else:
            groups.append("[" + " ".join(items) + "]")
    return " ".join(groups)


def notes_mini(notes: list[Note], bars: int) -> str:
    return cycle([notes_bar_mini([n for n in notes if n.bar == b]) for b in range(bars)])
