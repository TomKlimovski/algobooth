import time

import numpy as np
import pytest

from algorip.audio import SR
from algorip.bassgrid import bass_grid, grid_to_notes
from algorip.grid import Grid
from tests.synth import bass_line, plucked_bass, swept_bass

BPM = 120
G = Grid(bpm=BPM, first_downbeat=0.0, bars=2)


def test_grid_hears_a_two_bar_line_with_retriggered_sixteenths():
    # bar 0: G1 on steps 2,3,5,7 (length 1 each), G2 on 15; bar 1: A1 held 8 steps from step 0
    notes = [(0, 2, 1, 31), (0, 3, 1, 31), (0, 5, 1, 31), (0, 7, 1, 31), (0, 15, 1, 43), (1, 0, 8, 33)]
    bg = bass_grid(bass_line(notes, BPM, 2), SR, G)
    assert bg.midi[0][:8] == [None, None, 31, 31, None, 31, None, 31]
    assert bg.starts[0][2] and bg.starts[0][3] and not bg.starts[0][4]
    assert bg.midi[1][:8] == [33] * 8 and bg.starts[1][0] and not any(bg.starts[1][1:8])
    assert [(n.bar, n.step, n.length, n.midi) for n in grid_to_notes(bg)] == notes


def test_a_tail_sustains_rather_than_retriggers():
    bg = bass_grid(plucked_bass([(0, 0, 2, 31)], BPM, 1, release_seconds=0.3), SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert bg.starts[0][0] and not any(bg.starts[0][1:6])


def test_pitch_outside_the_bass_range_is_a_rest():
    bg = bass_grid(bass_line([(0, 0, 4, 19), (0, 8, 4, 31)], BPM, 1), SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))  # 19 = G0, 24.5 Hz
    assert bg.midi[0][0] is None and bg.midi[0][8] == 31


def test_silence_is_all_rests():
    bg = bass_grid(np.zeros(SR * 2, dtype=np.float32), SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert all(m is None for m in bg.midi[0]) and grid_to_notes(bg) == []


def test_short_hits_with_a_swept_attack_and_no_fundamental_are_heard():
    # A real stem's lone 16ths start sharp and carry little fundamental, so pyin's 186 ms frame finds
    # only a weak period: voiced probability 0.02-0.15. A 0.1 voicing cut dropped steps 2, 10, 13, 14.
    line = [(0, 2, 1, 31), (0, 3, 1, 31), (0, 5, 1, 31), (0, 7, 1, 31), (0, 10, 1, 31), (0, 11, 1, 31), (0, 13, 1, 31), (0, 14, 1, 31), (0, 15, 1, 43)]
    g = Grid(bpm=129, first_downbeat=0.0, bars=2)
    y = swept_bass([(b, s, n, m) for b in range(2) for (_, s, n, m) in line], 129, 2, sweep_semitones=7, sweep_seconds=0.03)
    notes = grid_to_notes(bass_grid(y, SR, g))
    assert [(n.step, n.length, n.midi) for n in notes if n.bar == 0] == [(s, n, m) for (_, s, n, m) in line]


def test_a_note_sounding_across_the_first_downbeat_does_not_start_there():
    # The audio holds G1 from 0.0 s to 0.5 s; the grid starts at 0.25 s, half way through it.
    bg = bass_grid(bass_line([(0, 0, 4, 31), (0, 8, 2, 33)], BPM, 1), SR, Grid(bpm=BPM, first_downbeat=0.25, bars=1))
    assert bg.midi[0][:2] == [31, 31] and not bg.starts[0][0] and bg.starts[0][6]


@pytest.mark.slow
def test_a_sixty_second_stem_tracks_in_under_five_seconds():
    y = bass_line([(b, s, 1, 31) for b in range(30) for s in range(0, 16, 2)], BPM, 30)  # 60 s
    t = time.perf_counter(); bass_grid(y, SR, Grid(bpm=BPM, first_downbeat=0.0, bars=30))
    assert time.perf_counter() - t < 5.0
