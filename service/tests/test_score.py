import pytest

from algorip.bassgrid import BassGrid
from algorip.grid import Grid
from algorip.notes import Note
from algorip.score import Score, expand, score


def grid_of(rows: list[list[int | None]], starts: list[list[bool]]) -> BassGrid:
    return BassGrid(bars=len(rows), midi=rows, starts=starts)


def test_a_perfect_candidate_scores_one():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    truth = grid_of([[31, 31, None, 43] + [None] * 12] * 2, [[True, False, False, True] + [False] * 12] * 2)
    notes = expand([[Note(bar=0, step=0, length=2, midi=31), Note(bar=0, step=3, length=1, midi=43)]], 2)
    assert score(truth, g, notes) == Score(frame=1.0, onset_f1=1.0, match=1.0)


def test_octaves_are_ignored_but_wrong_pitch_classes_and_missed_onsets_count():
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    truth = grid_of([[31, None, 31, None] + [None] * 12], [[True, False, True, False] + [False] * 12])
    up = [Note(bar=0, step=0, length=1, midi=43), Note(bar=0, step=2, length=1, midi=43)]
    assert score(truth, g, up).match == 1.0
    wrong = [Note(bar=0, step=0, length=1, midi=33), Note(bar=0, step=2, length=1, midi=31)]
    assert score(truth, g, wrong) == Score(frame=0.5, onset_f1=0.5, match=0.5)
    half = [Note(bar=0, step=0, length=1, midi=31)]
    assert score(truth, g, half).onset_f1 == pytest.approx(2 / 3)


def test_a_layer_adds_pitch_classes_and_onsets():
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    truth = grid_of([[31, 31, 31, 31] + [None] * 12], [[True] * 4 + [False] * 12])
    loop = [Note(bar=0, step=0, length=1, midi=31), Note(bar=0, step=2, length=1, midi=31)]
    layer = [Note(bar=0, step=1, length=1, midi=31), Note(bar=0, step=3, length=1, midi=31)]
    assert score(truth, g, loop).match < score(truth, g, loop, layer).match == 1.0


def test_silence_against_nothing_is_one_and_against_notes_is_zero():
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    empty = grid_of([[None] * 16], [[False] * 16])
    assert score(empty, g, []).match == 1.0
    assert score(empty, g, [Note(bar=0, step=0, length=1, midi=31)]).match == 0.0


def test_expand_repeats_each_phase_in_its_bars():
    a, b = Note(bar=0, step=0, length=1, midi=31), Note(bar=0, step=4, length=2, midi=33)
    out = expand([[a], [b]], 4)
    assert [(n.bar, n.step) for n in out] == [(0, 0), (1, 4), (2, 0), (3, 4)]
    assert expand([], 3) == []
