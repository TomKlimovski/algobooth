"""How well a candidate notation matches the bass stem's step grid.

Two scores, each in 0..1, averaged into match. The frame score asks, step by step, whether the
candidate sounds the right pitch class where the bass is pitched, and stays quiet where it is not.
The onset score is mir_eval's transcription F1: do the candidate's note starts land on the bass's
within half a step, on the same pitch class. Pitches are folded to one octave (midi % 12 + 36)
before comparing, because pyin and a transcriber disagree about octaves often and a bassline
written an octave off still plays the same line; the pitch tolerance then only has to tell
semitones apart.
"""

from collections.abc import Sequence
from dataclasses import dataclass

import librosa
import mir_eval
import numpy as np

from algorip.bassgrid import BassGrid
from algorip.grid import Grid
from algorip.notes import Note

_FOLD_BASE = 36


@dataclass(frozen=True)
class Score:
    frame: float
    onset_f1: float
    match: float  # round(0.5 * frame + 0.5 * onset_f1, 2)


def expand(templates: list[list[Note]], bars: int) -> list[Note]:
    """The loop repeated over bars: phase p's notes land in every bar b with b % len(templates) == p."""
    return [
        note.model_copy(update={"bar": bar})
        for bar in range(bars)
        for note in (templates[bar % len(templates)] if templates else [])
    ]


def _frame(truth: BassGrid, notes: Sequence[Note]) -> float:
    steps = truth.steps_per_bar
    classes: dict[tuple[int, int], set[int]] = {}
    for note in notes:
        for step in range(note.step, min(note.step + note.length, steps)):
            classes.setdefault((note.bar, step), set()).add(note.midi % 12)
    considered = agreed = 0
    for bar in range(truth.bars):
        for step in range(steps):
            heard = truth.midi[bar][step]
            sounding = classes.get((bar, step))
            if heard is None and sounding is None:
                continue
            considered += 1
            if heard is not None and sounding is not None and heard % 12 in sounding:
                agreed += 1
    return agreed / considered if considered else 1.0


def _hz(midis: list[int]) -> np.ndarray:
    return librosa.midi_to_hz([m % 12 + _FOLD_BASE for m in midis])


def _onset_f1(truth: BassGrid, grid: Grid, notes: Sequence[Note]) -> float:
    steps = truth.steps_per_bar
    ref_intervals, ref_midis = [], []
    for bar in range(truth.bars):
        for step in range(steps):
            if not truth.starts[bar][step] or truth.midi[bar][step] is None:
                continue
            end = step + 1
            while end < steps and truth.midi[bar][end] is not None and not truth.starts[bar][end]:
                end += 1
            ref_intervals.append((grid.time_of(bar, step), grid.time_of(bar, end)))
            ref_midis.append(truth.midi[bar][step])
    est_intervals = [(grid.time_of(n.bar, n.step), grid.time_of(n.bar, n.step + n.length)) for n in notes]
    if not ref_intervals and not est_intervals:
        return 1.0
    if not ref_intervals or not est_intervals:
        return 0.0
    f1 = mir_eval.transcription.precision_recall_f1_overlap(
        np.array(ref_intervals),
        _hz(ref_midis),
        np.array(est_intervals),
        _hz([n.midi for n in notes]),
        onset_tolerance=grid.step_seconds / 2,
        pitch_tolerance=100.0,
        offset_ratio=None,
    )[2]
    return float(f1)


def score(truth: BassGrid, grid: Grid, notes: list[Note], layer: list[Note] = ()) -> Score:
    """The candidate (notes plus layer) against the truth: frame agreement, onset F1 and their mean."""
    heard = [*notes, *layer]
    frame = float(_frame(truth, heard))
    onset_f1 = _onset_f1(truth, grid, heard)
    return Score(frame=frame, onset_f1=onset_f1, match=round(0.5 * frame + 0.5 * onset_f1, 2))
