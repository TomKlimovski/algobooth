import pytest

from algorip.audio import SR
from algorip.drums import classify_drums, is_four_on_the_floor
from algorip.grid import Grid
from tests.synth import drum_loop, hf_floor

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
    # kicks at 0 s and 1 s; the grid starts on the second, so the first is a whole second before it
    y = drum_loop({"bd": {(0, 0), (0, 8)}}, 120, 1)
    hits = classify_drums(y, SR, Grid(bpm=120, first_downbeat=1.0, bars=1))
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


def test_quiet_snare_under_full_kicks_is_kept():
    snares = {(b, s) for b in range(2) for s in (4, 12)}
    y = drum_loop({"bd": KICKS}, 124, 2) + 0.15 * drum_loop({"sd": snares}, 124, 2)  # snare at -16.5 dB
    hits = classify_drums(y, SR, grid_for(124, 2))
    assert hits["sd"] == snares
    assert hits["bd"] == KICKS


# A separated drum stem: kicks with a beater click and a continuous bed above 6 kHz under everything.
FLOOR_DB = -26.0
CLAPS = {(b, s) for b in range(2) for s in (4, 12)}
OFFBEATS = {(b, s) for b in range(2) for s in (2, 6, 10, 14)}


def stem(hits, bpm=124, bars=2):
    y = drum_loop(hits, bpm, bars, click=True)
    return y + hf_floor(len(y) / SR, FLOOR_DB)


def test_a_clap_with_air_over_kicks_and_open_hats_reads_as_snare_kick_and_open_hat():
    hits = classify_drums(stem({"bd": KICKS, "cp": CLAPS, "oh": OFFBEATS}), SR, grid_for(124, 2))
    assert hits["bd"] == KICKS
    assert hits["sd"] == CLAPS        # the clap's air is not a hat
    assert hits["oh"] == OFFBEATS     # open over the floor
    assert hits["hh"] == set()        # no click bleed on the kicks


def test_kick_clicks_over_a_floor_are_not_hats_or_snares():
    hits = classify_drums(stem({"bd": KICKS}), SR, grid_for(124, 2))
    assert hits["bd"] == KICKS
    assert hits["sd"] == set() and hits["hh"] == set() and hits["oh"] == set()


def test_closed_hats_over_a_floor_stay_closed():
    y = drum_loop({"hh": EIGHTHS}, 124, 2)
    hits = classify_drums(y + hf_floor(len(y) / SR, FLOOR_DB), SR, grid_for(124, 2))
    assert hits["hh"] == EIGHTHS and hits["oh"] == set()


def test_a_snare_on_every_kick_is_kept():
    hits = classify_drums(drum_loop({"bd": KICKS, "sd": KICKS}, 124, 2), SR, grid_for(124, 2))
    assert hits["bd"] == KICKS and hits["sd"] == KICKS


# The stem's drum tone (2026-10-22-drum-deep-dive-design.md): each voice's level and fall, as kits.json has them.
from algorip.drums import drum_tone


def test_drum_tone_reads_each_voices_fall():
    hits = {"bd": {(0, 0), (0, 8)}, "hh": {(0, 4)}, "oh": {(0, 12)}}
    tone = drum_tone(drum_loop(hits, 120, 1), SR, hits, grid_for(120, 1))
    assert tone is not None and set(tone.falls) == {"bd", "hh", "oh"}
    assert tone.falls["oh"] > tone.falls["hh"]  # a 300 ms hat against a 30 ms one
    assert 30 <= tone.falls["bd"] <= 150  # the synthetic kick's 150 ms decay


def test_drum_tone_levels_follow_the_mix():
    hits = {"bd": {(0, 0), (0, 8)}, "oh": {(0, 4), (0, 12)}}
    loud = drum_loop(hits, 120, 1)
    quiet = drum_loop({"bd": hits["bd"]}, 120, 1) + 0.3 * drum_loop({"oh": hits["oh"]}, 120, 1)
    a = drum_tone(loud, SR, hits, grid_for(120, 1))
    b = drum_tone(quiet, SR, hits, grid_for(120, 1))
    assert a is not None and b is not None
    assert (a.levels["oh"] - a.levels["bd"]) - (b.levels["oh"] - b.levels["bd"]) == pytest.approx(10.5, abs=1.0)


def test_drum_tone_is_none_without_hits():
    assert drum_tone(drum_loop({"bd": {(0, 0)}}, 120, 1), SR, {"bd": set(), "sd": set()}, grid_for(120, 1)) is None
