"""Strudel mini-notation from step hits and notes: repeats, offbeats, Euclid, beat groups, cycles."""

import math
import statistics
from collections import Counter
from collections.abc import Hashable, Sequence
from typing import TypeVar

import librosa

from algorip.grid import STEPS_PER_BAR
from algorip.notes import Note

BEAT = 4  # slots per beat group
_OPEN, _CLOSE = "[<({", "]>)}"

# Bar consensus: a line heard over several bars is written as the template its bars agree on, so
# a missed or stray hit in one bar does not turn a loop into eight different bars. Periods are
# tried shortest first; a period's template takes, at each phase, every step (and pitch class)
# that a strict majority of that phase's bars have. It is accepted when every bar agrees with its
# template on at least two thirds of the steps either of them occupies. Each phase needs at least
# three bars to vote: with two, a majority is both, and the template would be a bar nobody played.
# (The reviewer's starting share was 75%; on One More Time a bar with the four off-beat hats and
# two stray ones agrees on 4 of 6, and it is the stray hits that the consensus is for.)
# A fill is never outvoted: a period is refused when, at some longer phrase length (2 or 4 bars,
# with at least two bars at each phase), every bar at one phase is the same bar and differs from
# its template, e.g. the same fill in bars 3 and 7. The whole bar must recur, not just a step: on
# One More Time stray hats recur at the same phase by chance (step 12 in bars 1 and 5, step 15 in
# bars 2 and 6), but never as the same whole bar.
CONSENSUS_PHRASES = (2, 4)
CONSENSUS_PERIODS = (1, 2, 4)
CONSENSUS_MIN_VOTES = 3
CONSENSUS_SHARE = (2, 3)  # numerator, denominator
OCTAVE = 12

H = TypeVar("H", bound=Hashable)


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


def _agrees(bar: dict[int, Hashable], template: dict[int, Hashable]) -> bool:
    occupied = set(bar) | set(template)
    matches = sum(bar.get(step) == template.get(step) for step in occupied)
    numerator, denominator = CONSENSUS_SHARE
    return matches * denominator >= len(occupied) * numerator


def consensus(bars: list[dict[int, H]]) -> list[dict[int, H]] | None:
    """Each bar's phase template for the shortest period that fits, or None if none does."""
    for p in CONSENSUS_PERIODS:
        if len(bars) < CONSENSUS_MIN_VOTES * p:
            break
        templates = []
        for phase in range(p):
            voters = bars[phase::p]
            votes = Counter((step, value) for bar in voters for step, value in bar.items())
            templates.append({step: value for (step, value), n in votes.items() if 2 * n > len(voters)})
        if all(_agrees(bar, templates[i % p]) for i, bar in enumerate(bars)) and not _recurring_fill(bars, templates):
            return [templates[i % p] for i in range(len(bars))]
    return None


def _recurring_fill(bars: list[dict[int, H]], templates: list[dict[int, H]]) -> bool:
    """Whether some phrase phase holds one bar, repeated in every phrase, that its template would erase."""
    p = len(templates)
    for q in CONSENSUS_PHRASES:
        if q <= p or q % p or len(bars) < 2 * q:
            continue
        for phase in range(q):
            same = bars[phase::q]
            if all(bar == same[0] for bar in same) and same[0] != templates[phase % p]:
                return True
    return False


def note_name(midi: int) -> str:
    return librosa.midi_to_note(midi, unicode=False).lower()


def one_per_step(notes: list[Note]) -> dict[int, Note]:
    starts: dict[int, Note] = {}
    for note in sorted(notes, key=lambda n: (n.step, n.midi)):
        if 0 <= note.step < STEPS_PER_BAR:
            starts.setdefault(note.step, note)  # one note per step: the lowest
    return starts


def _length(starts: dict[int, Note], slot: int, end: int) -> int:
    """The steps the note on slot sounds before the next start or end."""
    next_start = next((s for s in range(slot + 1, end) if s in starts), end)
    return min(starts[slot].length, next_start - slot)


def _flat_bar(starts: dict[int, Note]) -> str:
    """The bar as one sequence of @-weighted notes and rests, for notes that sustain across beat groups."""
    items: list[tuple[str, int]] = []
    slot = 0
    while slot < STEPS_PER_BAR:
        if slot not in starts:
            if items and items[-1][0] == "~":
                items[-1] = ("~", items[-1][1] + 1)
            else:
                items.append(("~", 1))
            slot += 1
            continue
        length = _length(starts, slot, STEPS_PER_BAR)
        items.append((note_name(starts[slot].midi), length))
        slot += length
    scale = math.gcd(*(weight for _, weight in items))
    return " ".join(text if weight == scale else f"{text}@{weight // scale}" for text, weight in items)


def _retriggered(starts: dict[int, Note], lo: int, hi: int) -> str | None:
    """The note name when every slot in lo..hi starts a note of one midi (so each lasts one slot), else None."""
    notes = [starts.get(slot) for slot in range(lo, hi)]
    if any(n is None for n in notes) or len({n.midi for n in notes}) != 1:
        return None
    return note_name(notes[0].midi)


def notes_bar_mini(notes: list[Note]) -> str:
    """One bar of notes in four beat groups, or one flat @-weighted sequence when a note sustains past its group.

    A note sounds until the next note starts or the bar ends. A bar with no notes is a rest.
    """
    starts = one_per_step(notes)
    if not starts:
        return "~"
    if any(slot + _length(starts, slot, STEPS_PER_BAR) > slot - slot % BEAT + BEAT for slot in starts):
        return _flat_bar(starts)
    if (retriggered := _retriggered(starts, 0, STEPS_PER_BAR)) is not None:
        return f"{retriggered}*{STEPS_PER_BAR}"
    groups = []
    for start in range(0, STEPS_PER_BAR, BEAT):
        end = start + BEAT
        if (retriggered := _retriggered(starts, start, end)) is not None:
            groups.append(f"{retriggered}*{BEAT}")
            continue
        items: list[str] = []
        slot = start
        while slot < end:
            note = starts.get(slot)
            if note is None:
                items.append("~")
                slot += 1
                continue
            length = _length(starts, slot, end)
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


def fold_octaves(notes: list[Note]) -> list[Note]:
    """Notes an octave or more from the line's median pitch moved by octaves until they are within one."""
    if not notes:
        return []
    centre = statistics.median_low(n.midi for n in notes)
    folded = []
    for note in notes:
        midi = note.midi
        while abs(midi - centre) >= OCTAVE:
            midi += OCTAVE if midi < centre else -OCTAVE
        folded.append(note if midi == note.midi else note.model_copy(update={"midi": midi}))
    return folded


def notes_mini(notes: list[Note], bars: int) -> str:
    """Bars of notes through the bar consensus, voting per step on pitch class."""
    heard = [one_per_step([n for n in notes if n.bar == b]) for b in range(bars)]
    agreed = consensus([{step: n.midi % OCTAVE for step, n in bar.items()} for bar in heard])
    if agreed is None:
        lines = [list(bar.values()) for bar in heard]
    else:
        lines = [
            [n for step, pc in template.items() if (n := template_note(heard, step, pc)) is not None]
            for template in agreed
        ]
    return cycle([notes_bar_mini(line) for line in lines])


def template_note(heard: list[dict[int, Note]], step: int, pc: int) -> Note | None:
    """The commonest (midi, length) among the bars that play pitch class pc on step; None when none does."""
    votes = Counter((n.midi, n.length) for bar in heard if (n := bar.get(step)) is not None and n.midi % OCTAVE == pc)
    if not votes:
        return None
    midi, length = votes.most_common(1)[0][0]
    return Note(bar=0, step=step, length=length, midi=midi)


def loop_mini(templates: list[list[Note]]) -> str:
    """A loop's phases, one bar each, as one alternation per cycle."""
    return cycle([notes_bar_mini(t) for t in templates])
