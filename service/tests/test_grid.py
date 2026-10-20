import numpy as np
import pytest

from algorip.audio import SR
from algorip.grid import Grid, downbeat_phase, estimate_grid, estimate_tempo
from tests.synth import click_track, silence


def test_tempo_of_a_click_track():
    y = click_track(126, bars=4)
    bpm, beats = estimate_tempo(y, SR)
    assert abs(bpm - 126) < 1
    assert abs(beats[1] - beats[0] - 60 / 126) < 0.02


def test_tempo_is_folded_into_range():
    y = click_track(60, bars=4)  # a 60 bpm click reads as 120
    bpm, _ = estimate_tempo(y, SR)
    assert 70 <= bpm < 180


def test_downbeat_from_accented_drums():
    y = np.concatenate([silence(1.0), click_track(120, bars=4)])  # accents on beat 1, loop starts 1 s in
    _, beats = estimate_tempo(y, SR)
    phase = downbeat_phase(y, SR, beats)
    assert beats[phase] == pytest.approx(1.0, abs=0.03)


def test_grid_steps_and_bars():
    g = Grid(bpm=120, first_downbeat=0.5, bars=2)
    assert g.bar_seconds == 2.0
    assert g.step_at(0.5) == (0, 0)
    assert g.step_at(0.5 + 0.125 * 5 + 0.01) == (0, 5)
    assert g.step_at(2.5) == (1, 0)
    assert g.step_at(4.6) is None and g.step_at(0.2) is None
    assert g.time_of(1, 4) == 3.0


def test_estimate_grid_counts_whole_bars():
    y = click_track(120, bars=3)
    g = estimate_grid(y, y, SR, duration=len(y) / SR)
    assert (g.bars, round(g.bpm)) == (3, 120)
    assert g.first_downbeat == pytest.approx(0.0, abs=0.03)


def test_silence_has_no_beat():
    with pytest.raises(ValueError):
        estimate_grid(silence(4), None, SR, 4.0)


def test_step_at_clamps_the_last_half_step_to_the_last_step():
    g = Grid(bpm=120, first_downbeat=0.5, bars=2)
    assert g.step_at(g.end_time - 0.01) == (1, 15)
    assert g.step_at(g.end_time) is None
