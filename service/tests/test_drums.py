import numpy as np
import pytest

from algorip.audio import SR
from algorip.drums import classify_drums, is_four_on_the_floor
from algorip.grid import Grid
from tests.synth import drum_loop, silence

HOUSE = {"bd": {(b, s) for b in range(2) for s in (0, 4, 8, 12)},
         "sd": {(b, s) for b in range(2) for s in (4, 12)},
         "hh": {(b, s) for b in range(2) for s in range(0, 14, 2)},  # the open hat takes step 14
         "oh": {(b, 14) for b in range(2)}}


def grid_for(bpm, bars): return Grid(bpm=bpm, first_downbeat=0.0, bars=bars)


def test_house_pattern_round_trips_including_coincident_kicks_and_hats():
    y = drum_loop(HOUSE, bpm=124, bars=2)
    hits = classify_drums(y, SR, grid_for(124, 2))
    assert hits["bd"] == HOUSE["bd"]
    assert hits["hh"] == HOUSE["hh"]         # review focus 1: hats on the beats survive the kick
    assert hits["sd"] == HOUSE["sd"]
    assert hits["oh"] == HOUSE["oh"]


def test_open_and_closed_hats_split_by_decay():
    y = drum_loop({"hh": {(0, 0)}, "oh": {(0, 8)}}, 120, 1)
    hits = classify_drums(y, SR, grid_for(120, 1))
    assert hits["hh"] == {(0, 0)} and hits["oh"] == {(0, 8)}


def test_breakbeat_is_not_four_on_the_floor():
    hits = {"bd": {(0, 0), (0, 10), (1, 0), (1, 6)}, "sd": set(), "hh": set(), "oh": set()}
    assert not is_four_on_the_floor(hits, 2)
    assert is_four_on_the_floor(HOUSE, 2)


def test_onsets_before_the_first_downbeat_are_dropped():
    y = np.concatenate([silence(0.5), drum_loop({"bd": {(0, 0)}}, 120, 1)])  # the loop starts 0.5 s in
    hits = classify_drums(y, SR, Grid(bpm=120, first_downbeat=0.5, bars=1))
    assert hits["bd"] == {(0, 0)}


def test_a_band_with_only_leakage_has_no_onsets():
    hats = {(b, s) for b in range(2) for s in range(0, 16, 2)}
    y = drum_loop({"hh": hats}, 124, 2)
    hits = classify_drums(y, SR, grid_for(124, 2))
    assert hits["bd"] == set() and hits["sd"] == set()
    assert hits["hh"] == hats and hits["oh"] == set()


KICKS = {(b, s) for b in range(2) for s in (0, 4, 8, 12)}
EIGHTHS = {(b, s) for b in range(2) for s in range(0, 16, 2)}


def test_quiet_hats_under_full_kicks_are_kept():
    y = drum_loop({"bd": KICKS}, 124, 2) + 0.1 * drum_loop({"hh": EIGHTHS}, 124, 2)  # hats at -20 dB
    hits = classify_drums(y, SR, grid_for(124, 2))
    assert hits["hh"] == EIGHTHS  # including the beats, under the kicks
    assert hits["bd"] == KICKS


@pytest.mark.xfail(
    strict=True,
    reason="a gain-0.15 snare reads -21.8 dB in its band, under the hats' -18.8 dB leakage that the snare gate must reject",
)
def test_quiet_snare_under_full_kicks_is_kept():
    snares = {(b, s) for b in range(2) for s in (4, 12)}
    y = drum_loop({"bd": KICKS}, 124, 2) + 0.15 * drum_loop({"sd": snares}, 124, 2)  # snare at -16.5 dB
    hits = classify_drums(y, SR, grid_for(124, 2))
    assert hits["sd"] == snares
    assert hits["bd"] == KICKS
