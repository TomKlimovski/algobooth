import numpy as np

from algorip.audio import SR
from algorip.bass import candidates, choose_bass_loop, harmonic_ratio, transcribe_bass
from algorip.bassgrid import BassGrid
from algorip.grid import Grid
from algorip.key import Key
from algorip.mini import loop_mini
from algorip.notes import Note, monophonic, quantise, snap_to_key
from tests.synth import bass_line

G = Grid(bpm=120, first_downbeat=0.0, bars=1)   # step = 0.125 s
AMIN = Key(tonic=9, mode="minor")
GMIN = Key(tonic=7, mode="minor")


def test_quantise_rounds_to_steps_and_drops_quiet_notes():
    notes = quantise([(0.01, 0.49, 33, 0.9), (1.02, 1.1, 40, 0.8), (1.5, 1.6, 45, 0.02)], G)
    assert notes == [Note(bar=0, step=0, length=4, midi=33), Note(bar=0, step=8, length=1, midi=40)]


def test_quantise_drops_events_outside_the_grid():
    assert quantise([(-0.5, -0.2, 33, 0.9), (2.0, 2.2, 33, 0.9)], G) == []


def test_snap_to_key_moves_out_of_scale_notes_by_a_semitone():
    out = snap_to_key([Note(bar=0, step=0, length=1, midi=34)], AMIN)   # A#1 -> A1
    assert out[0].midi == 33
    assert snap_to_key([Note(bar=0, step=0, length=1, midi=33)], AMIN)[0].midi == 33


def test_snap_to_key_prefers_down_then_up():
    c_major = Key(tonic=0, mode="major")
    # F#: F (down) and G (up) both in C major -> down
    assert snap_to_key([Note(bar=0, step=0, length=1, midi=66)], c_major)[0].midi == 65
    # D# in A minor: D (down) is in scale -> D
    assert snap_to_key([Note(bar=0, step=0, length=1, midi=51)], AMIN)[0].midi == 50


def test_monophonic_truncates_overlaps():
    out = monophonic([Note(bar=0, step=0, length=8, midi=33), Note(bar=0, step=2, length=2, midi=40)])
    assert [(n.step, n.length) for n in out] == [(0, 2), (2, 2)]


def test_monophonic_same_step_keeps_louder_or_lower():
    a = Note(bar=0, step=4, length=2, midi=40)
    b = Note(bar=0, step=4, length=2, midi=33)
    assert monophonic([a, b]) == [b]
    assert monophonic([a, b], {(0, 4, 40): 0.9, (0, 4, 33): 0.2}) == [a]


def test_monophonic_overlap_across_bars():
    out = monophonic([Note(bar=1, step=0, length=2, midi=33), Note(bar=0, step=14, length=8, midi=40)])
    assert [(n.bar, n.step, n.length) for n in out] == [(0, 14, 2), (1, 0, 2)]


SOLO = [(0, 2, 1, 31), (0, 3, 1, 31), (0, 5, 1, 31), (0, 7, 1, 31), (0, 10, 1, 31), (0, 11, 1, 31), (0, 13, 1, 31), (0, 14, 1, 31), (0, 15, 1, 43)]


def solomun_audio(bars=4, build_from=None):
    notes = [(b, s, n, m) for b in range(bars) for (_, s, n, m) in SOLO]
    if build_from is not None:
        notes += [(b, s, 1, 31) for b in range(build_from, bars) for s in range(16) if s not in {2, 3, 5, 7, 10, 11, 13, 14, 15}]
    return bass_line(notes, 129, bars)


def test_transcribe_bass_snaps_and_folds_into_the_register():
    g = Grid(bpm=129, first_downbeat=0.0, bars=1)
    # B0 (23, 30.9 Hz) folds up; A0 (21, 27.5 Hz) would be under bassgrid's FMIN and heard as a rest.
    bg, notes = transcribe_bass(bass_line([(0, 0, 4, 70), (0, 8, 4, 23)], 129, 1), SR, g, AMIN)
    assert [n.midi for n in notes] == [57, 35] and bg.midi[0][0] == 57


def test_choose_bass_loop_finds_the_one_bar_loop_and_the_build_layer():
    g = Grid(bpm=129, first_downbeat=0.0, bars=9)
    # Not build_from=4: five identical full bars of nine are a strict majority, so by the vote they are the loop.
    bg, notes = transcribe_bass(solomun_audio(9, build_from=5), SR, g, GMIN)
    loop = choose_bass_loop(bg, g, notes)
    assert loop.period == 1
    assert loop_mini(loop.templates) == "[~ ~ g1 g1] [~ g1 ~ g1] [~ ~ g1 g1] [~ g1 g1 g2]"
    assert loop.layer_bars == (6, 9) and loop.layer is not None
    # Controller ruling: match is the loop alone over all nine bars, so the build bars cap it well
    # under 0.9 by construction (0.78 with four build bars); the brief's >= 0.9 cannot hold.
    assert 0.7 <= loop.match < loop.match_with_layer


def test_candidates():
    t = [[Note(bar=0, step=0, length=1, midi=31), Note(bar=0, step=1, length=1, midi=31), Note(bar=0, step=8, length=1, midi=31)]]
    named = dict(candidates(t))
    assert [n.step for n in named["b"][0]] == [0, 8]            # the odd 16th merged into its even neighbour
    assert [n.length for n in named["b"][0]] == [2, 1]          # reaching to where the moved note ended
    assert [(n.step, n.length) for n in named["c"][0]] == [(0, 2), (8, 1)]


def test_retriggers_are_kept_because_sustaining_them_loses_onsets():
    g = Grid(bpm=120, first_downbeat=0.0, bars=4)
    notes_in = [(b, 0, 1, 31) for b in range(4)] + [(b, 1, 1, 31) for b in range(4)] + [(b, 8, 1, 31) for b in range(4)]
    bg, notes = transcribe_bass(bass_line(notes_in, 120, 4), SR, g, GMIN)
    # (c) would write "[g1@2 ~ ~] ~ [g1 ~ ~ ~] ~", one character shorter, but its onset F1 is 0.8: outside the tolerance
    assert loop_mini(choose_bass_loop(bg, g, notes).templates) == "[g1 g1 ~ ~] ~ [g1 ~ ~ ~] ~"


def test_a_better_fitting_candidate_wins_over_a_shorter_one():
    # The truth has starts on steps 0 and 8; the notes put the first on step 1 (a late onset). (b) moves it to 0 and fits.
    g = Grid(bpm=120, first_downbeat=0.0, bars=4)
    starts = [[s in (0, 8) for s in range(16)]] * 4
    bg = BassGrid(bars=4, midi=[[31 if s in (0, 8) else None for s in range(16)]] * 4, starts=starts)
    notes = [Note(bar=b, step=s, length=1, midi=31) for b in range(4) for s in (1, 8)]
    loop = choose_bass_loop(bg, g, notes)
    assert loop_mini(loop.templates) == "[g1 ~ ~ ~] ~ [g1 ~ ~ ~] ~" and loop.match == 1.0


def test_no_loop_and_no_bass():
    g = Grid(bpm=120, first_downbeat=0.0, bars=4)
    bg, notes = transcribe_bass(bass_line([(b, 0, 4, 31 + 2 * b) for b in range(4)], 120, 4), SR, g, GMIN)
    assert choose_bass_loop(bg, g, notes) is None
    bg, notes = transcribe_bass(np.zeros(SR * 8, dtype=np.float32), SR, g, GMIN)
    assert notes == [] and choose_bass_loop(bg, g, notes) is None


def test_harmonic_ratio_is_higher_for_sawtooth_than_sine():
    saw = bass_line([(0, 0, 16, 45)], 120, 1)
    t = np.arange(SR * 2) / SR; sine = (0.8 * np.sin(2 * np.pi * 110 * t)).astype(np.float32)
    notes = [Note(bar=0, step=0, length=16, midi=45)]
    assert harmonic_ratio(saw, SR, notes, G) > 0.4 > harmonic_ratio(sine, SR, notes, G)


def test_harmonic_ratio_is_zero_without_notes():
    assert harmonic_ratio(np.zeros(SR, dtype=np.float32), SR, [], G) == 0.0


def test_a_phase_with_no_core_bar_does_not_raise():
    # The shape of test_loop's phase-without-core case as notes: E1 (28) drifting on even bars, A1 (33) steady.
    g = Grid(bpm=120, first_downbeat=0.0, bars=6)
    even = [(0, 8, 9, 12), (0, 4, 9, 12), (0, 2, 4, 8, 10, 12)]
    steps = [even[b // 2] if b % 2 == 0 else (0, 8) for b in range(6)]
    midi = [[(28 if b % 2 == 0 else 33) if s in steps[b] else None for s in range(16)] for b in range(6)]
    bg = BassGrid(bars=6, midi=midi, starts=[[m is not None for m in bar] for bar in midi])
    notes = [Note(bar=b, step=s, length=1, midi=midi[b][s]) for b in range(6) for s in steps[b]]
    assert choose_bass_loop(bg, g, notes) is None
