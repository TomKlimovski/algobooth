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


# The kick is the beat (2026-10-22-drum-deep-dive-design.md): a house loop whose tracker beats sit off the kicks.
from algorip.drums import classify_drums
from algorip.grid import align_beats_to_kicks
from tests.synth import drum_loop

HOUSE = {"bd": {(b, s) for b in range(4) for s in (0, 4, 8, 12)},
         "sd": {(b, s) for b in range(4) for s in (4, 12)},
         "oh": {(b, s) for b in range(4) for s in (2, 6, 10, 14)}}
BEAT = 60 / 124


def _on_the_kicks(beats):
    rem = beats % BEAT
    return bool(np.all((rem < 0.02) | (rem > BEAT - 0.02)))


def test_beats_half_a_beat_off_move_onto_the_kicks():
    y = drum_loop(HOUSE, 124, 4)
    beats = np.arange(16) * BEAT + 0.6 * BEAT  # the tracker locked on the offbeat hats
    aligned = align_beats_to_kicks(beats, y, SR, 124)
    assert _on_the_kicks(aligned) and len(aligned) == 16


def test_beats_a_frame_late_are_left_alone():
    y = drum_loop(HOUSE, 124, 4)
    beats = np.arange(16) * BEAT + 0.03  # 30 ms: under half a step (121 ms)
    assert np.array_equal(align_beats_to_kicks(beats, y, SR, 124), beats)


def test_a_backward_move_drops_a_beat_before_the_clip():
    # the clip is cut a quarter beat into a bar (first kick at 0.75 beat) and the tracker's beats sit at 0.05:
    # the beats move back 0.3 beat, and the one that lands at -0.25 beat is dropped rather than clamped
    y = np.concatenate([silence(0.75 * BEAT), drum_loop(HOUSE, 124, 4)])
    beats = np.arange(16) * BEAT + 0.05 * BEAT
    aligned = align_beats_to_kicks(beats, y, SR, 124)
    assert aligned[0] == pytest.approx(0.75 * BEAT, abs=0.02) and len(aligned) == 15


def test_a_stem_without_kicks_does_not_move_the_grid():
    hats_only = {"oh": {(b, s) for b in range(4) for s in (2, 6, 10, 14)}}
    beats = np.arange(16) * BEAT
    assert np.array_equal(align_beats_to_kicks(beats, drum_loop(hats_only, 124, 4), SR, 124), beats)


def test_the_backbeat_rule_averages_over_unequal_beat_counts():
    # 21 beats: phase 0 has six, the others five; summed, four equal kicks would read as a 1.6 dB lead for phase 0
    claps_on_one_and_three = dict(HOUSE, sd={(b, s) for b in range(6) for s in (0, 8)})
    y = drum_loop(claps_on_one_and_three, 124, 6)
    assert downbeat_phase(y, SR, np.arange(21) * BEAT, backbeat=True) == 1


def test_disagreeing_kicks_do_not_move_the_grid():
    breaks = {"bd": {(0, 0), (0, 10), (1, 0), (1, 6), (2, 0), (2, 10), (3, 0), (3, 6)}}
    y = drum_loop(breaks, 124, 4)
    beats = np.arange(16) * BEAT + 0.6 * BEAT
    assert np.array_equal(align_beats_to_kicks(beats, y, SR, 124), beats)


def test_four_equal_kicks_put_the_claps_on_two_and_four():
    beats = np.arange(16) * BEAT
    # only for beats the kicks moved (backbeat=True); an unmoved grid keeps the tracker's loudest-phase rule
    assert downbeat_phase(drum_loop(HOUSE, 124, 4), SR, beats, backbeat=True) == 0  # claps on 4 and 12: the earlier of 0 and 2
    claps_on_one_and_three = dict(HOUSE, sd={(b, s) for b in range(4) for s in (0, 8)})
    assert downbeat_phase(drum_loop(claps_on_one_and_three, 124, 4), SR, beats, backbeat=True) == 1


def test_estimate_grid_puts_the_kicks_on_the_beats():
    eight = {v: {(b, s) for b in range(8) for (_, s) in hits} for v, hits in HOUSE.items()}
    y = np.concatenate([silence(0.6 * BEAT), drum_loop(eight, 124, 8)])
    g = estimate_grid(y, y, SR, len(y) / SR)
    hits = classify_drums(y, SR, g)
    # the first four bars: the tracker's tempo (124.5 for 124) drifts the later ones by half a step
    assert {h for h in hits["bd"] if h[0] < 4} == {(b, s) for b in range(4) for s in (0, 4, 8, 12)}
