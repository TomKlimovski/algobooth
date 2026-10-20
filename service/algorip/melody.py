"""An optional lead line from the "other" stem, kept only when the stem plays one note at a time."""

from pathlib import Path

from algorip.grid import Grid
from algorip.key import Key
from algorip.notes import (
    Note,
    Predictor,
    basic_pitch_predict,
    fold_octaves,
    monophonic,
    quantise,
    snap_to_key,
)

MELODY_LOW = 48  # C3
MELODY_HIGH = 84  # C6
MIN_NOTES = 8
MAX_OVERLAP = 0.10  # share of total note time that pairs of notes may sound together


def _span(note: Note, steps_per_bar: int) -> tuple[int, int]:
    start = note.bar * steps_per_bar + note.step
    return start, start + note.length


def overlap_share(notes: list[Note], steps_per_bar: int) -> float:
    """Summed pairwise overlap of the notes' step spans over their summed lengths (0.0 with no notes)."""
    total = sum(n.length for n in notes)
    if total == 0:
        return 0.0
    # The grid's steps are uniform, so overlap in steps is overlap in seconds scaled by step_seconds.
    spans = sorted(_span(n, steps_per_bar) for n in notes)
    overlap = 0
    for i, (start, end) in enumerate(spans):
        for other_start, other_end in spans[i + 1 :]:
            if other_start >= end:
                break  # sorted by start: no later span can overlap this one
            overlap += min(end, other_end) - other_start
    return overlap / total


def transcribe_melody(
    stem: Path, grid: Grid, key: Key, predict: Predictor = basic_pitch_predict
) -> list[Note] | None:
    """The stem as a monophonic, in-key line folded into MELODY_LOW..MELODY_HIGH, or None.

    None unless the quantised, key-snapped notes number at least MIN_NOTES and their pairwise
    overlap is under MAX_OVERLAP of the total note time (a chordal part is not a melody).
    """
    notes = snap_to_key(quantise(predict(stem), grid), key)
    if len(notes) < MIN_NOTES or overlap_share(notes, grid.steps_per_bar) >= MAX_OVERLAP:
        return None
    return [
        n.model_copy(update={"midi": fold_octaves(n.midi, MELODY_LOW, MELODY_HIGH)}) for n in monophonic(notes)
    ]
