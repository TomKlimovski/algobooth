from itertools import combinations
from pathlib import Path

import numpy as np
import pytest

from algorip.grid import Grid
from algorip.key import Key
from algorip.melody import overlap_share, transcribe_melody
from algorip.notes import Note, fold_octaves

AMIN = Key(tonic=9, mode="minor")


def test_melody_needs_enough_monophonic_notes():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    few = lambda p: [(i * 0.5, i * 0.5 + 0.4, 72, 0.9) for i in range(4)]
    assert transcribe_melody(Path("x"), g, AMIN, predict=few) is None
    line = lambda p: [(i * 0.25, i * 0.25 + 0.2, 69 + (i % 3), 0.9) for i in range(12)]
    out = transcribe_melody(Path("x"), g, AMIN, predict=line)
    assert out is not None and len(out) == 12


def test_chordal_other_stem_yields_no_melody():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    stacked = lambda p: [(i * 0.5, i * 0.5 + 0.45, m, 0.9) for i in range(8) for m in (60, 64, 67)]
    assert transcribe_melody(Path("x"), g, AMIN, predict=stacked) is None


def test_melody_is_folded_into_its_register():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    high = lambda p: [(i * 0.25, i * 0.25 + 0.2, 93 + 2 * (i % 2), 0.9) for i in range(8)]  # A6, B6
    out = transcribe_melody(Path("x"), g, AMIN, predict=high)
    assert out is not None and [n.midi for n in out[:2]] == [81, 83]
    assert all(48 <= n.midi <= 84 for n in out)


def _brute_force_share(notes, steps_per_bar):
    spans = [(n.bar * steps_per_bar + n.step, n.bar * steps_per_bar + n.step + n.length) for n in notes]
    overlap = sum(max(0, min(a[1], b[1]) - max(a[0], b[0])) for a, b in combinations(spans, 2))
    return overlap / sum(n.length for n in notes)


def test_overlap_sweep_matches_pairwise_sum():
    rng = np.random.default_rng(8)
    notes = [
        Note(bar=int(rng.integers(0, 8)), step=int(rng.integers(0, 16)), length=int(rng.integers(1, 9)), midi=60)
        for _ in range(200)
    ]
    assert overlap_share(notes, 16) == _brute_force_share(notes, 16)


def _line_with_early_notes(early: set[int]):
    """Ten two-step notes every two steps; the ones in `early` start a step sooner, overlapping by one."""
    step = 0.125  # at 120 bpm
    starts = [2 * i - (1 if i in early else 0) for i in range(10)]
    return lambda p: [(s * step, (s + 2) * step, 69, 0.9) for s in starts]


def test_overlap_at_exactly_ten_percent_is_no_melody():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    assert transcribe_melody(Path("x"), g, AMIN, predict=_line_with_early_notes({4, 8})) is None  # 2 / 20
    assert transcribe_melody(Path("x"), g, AMIN, predict=_line_with_early_notes({4})) is not None  # 1 / 20


def test_fold_octaves_needs_a_whole_octave():
    with pytest.raises(AssertionError):
        fold_octaves(60, 48, 58)
