from pathlib import Path

import numpy as np
import pytest

from algorip.audio import SR
from algorip.bass import candidates, choose_bass_loop, harmonic_ratio, transcribe_bass
from algorip.bassgrid import BassGrid
from algorip.grid import Grid
from algorip.key import Key
from algorip.mini import loop_mini
from algorip.schema import Analysis
from algorip.notes import Note, monophonic, quantise, snap_to_key
from tests.synth import bass_line, filtered_bass, gated_bass

G = Grid(bpm=120, first_downbeat=0.0, bars=1)   # step = 0.125 s
AMIN = Key(tonic=9, mode="minor")
GOLDEN = Path(__file__).parent / "golden"
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
    # A#4 (70) is a clear reading, so it stays A# (not in A minor) and folds to 58; only an ambiguous reading snaps
    assert [n.midi for n in notes] == [58, 35] and bg.midi[0][0] == 58


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


def test_drifting_even_bars_over_a_steady_odd_bar_make_a_two_bar_loop():
    # E1 (28) on even bars sharing three onsets and adding others, A1 (33) steady on odd bars: by containment the
    # shared onsets are the loop and the rest is variation (this shape once had no core bar and returned None).
    g = Grid(bpm=120, first_downbeat=0.0, bars=6)
    even = [(0, 8, 9, 12), (0, 4, 9, 12), (0, 2, 4, 8, 10, 12)]
    steps = [even[b // 2] if b % 2 == 0 else (0, 8) for b in range(6)]
    midi = [[(28 if b % 2 == 0 else 33) if s in steps[b] else None for s in range(16)] for b in range(6)]
    bg = BassGrid(bars=6, midi=midi, starts=[[m is not None for m in bar] for bar in midi])
    notes = [Note(bar=b, step=s, length=1, midi=midi[b][s]) for b in range(6) for s in steps[b]]
    loop = choose_bass_loop(bg, g, notes)
    assert loop is not None and loop.period == 2 and loop.layer is not None


def test_a_flat_note_has_no_gate_and_a_held_then_cut_note_measures_its_hold_and_fall():
    from algorip.bass import bass_envelope

    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    line = [(b, s, 4, 31) for b in range(2) for s in (0, 4, 8, 12)]  # four beats a bar, each a whole beat (500 ms)
    flat_audio = bass_line(line, 120, 2)
    flat = transcribe_bass(flat_audio, SR, g, GMIN)[1]
    env = bass_envelope(flat_audio, SR, flat, g)
    assert env is not None and env.end_db > -3 and env.hold_share > 0.9 and env.attack_ms < 15
    # held at full level for half the note, then a 200 ms fall that keeps the later steps sounding, so the
    # transcribed note is longer than the hold: the measurement says how much of it is the hold
    gated_audio = gated_bass(line, 120, 2, hold_share=0.5, fall_seconds=0.2)
    gated = transcribe_bass(gated_audio, SR, g, GMIN)[1]
    env = bass_envelope(gated_audio, SR, gated, g)
    assert env is not None and env.attack_ms < 15
    # the hold runs to 3 dB down, which a linear 200 ms fall reaches 58 ms in: 250 + 58
    assert 0.5 <= env.hold_share <= 0.7 and 280 <= env.hold_ms <= 330
    assert 80 <= env.fall_ms <= 200 and env.end_db < -12
    assert bass_envelope(gated_audio, SR, [], g) is None
    # a 40 ms cut leaves nothing sounding after the hold: the grid writes the note as its hold, so no clip is needed
    cut_audio = gated_bass(line, 120, 2, hold_share=0.5, fall_seconds=0.04)
    env = bass_envelope(cut_audio, SR, transcribe_bass(cut_audio, SR, g, GMIN)[1], g)
    assert env is not None and env.hold_share > 0.9
    # a low note's ripple is not a fall: D#1 held flat reads as held
    low = [(b, s, 4, 27) for b in range(2) for s in (0, 4, 8, 12)]
    low_audio = bass_line(low, 120, 2)
    env = bass_envelope(low_audio, SR, transcribe_bass(low_audio, SR, g, GMIN)[1], g)
    assert env is not None and env.hold_share > 0.9 and env.attack_ms < 15


def test_choose_sounds_writes_a_gate_only_when_the_notes_die_before_their_end():
    from algorip.schema import MeasuredEnvelope
    from algorip.sounds import choose_sounds

    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    assert choose_sounds(a.model_copy(update={"bass_envelope": None})).bass_envelope is None
    held = a.model_copy(update={"bass_envelope": MeasuredEnvelope(attack_ms=8, hold_ms=480, fall_ms=20, end_db=-2.0, hold_share=0.96)})
    assert choose_sounds(held).bass_envelope is None
    gate = a.model_copy(update={"bass_envelope": MeasuredEnvelope(attack_ms=3, hold_ms=250, fall_ms=40, end_db=-20.0, hold_share=0.5)})
    e = choose_sounds(gate).bass_envelope
    assert e is not None and e.attack == 0.005 and e.clip == 0.5 and e.release == 0.04
    # a note that holds almost to its end but is cut hard: no clip, just the release
    late = a.model_copy(update={"bass_envelope": MeasuredEnvelope(attack_ms=12, hold_ms=460, fall_ms=25, end_db=-14.0, hold_share=0.92)})
    e = choose_sounds(late).bass_envelope
    assert e is not None and e.attack == 0.012 and e.clip is None and e.release == 0.025


def test_the_clip_tuning_is_removed_before_rounding_and_a_clear_chromatic_note_survives_the_snap():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    dsharp_minor = Key(tonic=3, mode="minor")
    # the 48:50 shape, 35 cents flat throughout: D#2, D#1, a chromatic E3 (21 cents flat of E, 79 sharp of D#), D#2
    flat = [(b, s, 2, m - 0.35) for b in range(2) for s, m in ((0, 39), (4, 27), (8, 52), (12, 39))]
    bg, notes = transcribe_bass(bass_line(flat, 120, 2), SR, g, dsharp_minor)
    assert -45 <= bg.tuning_cents <= -25
    assert [n.midi for n in notes if n.bar == 0] == [39, 27, 52, 39]  # the E3 stays E3: D# minor has no E, but the stem does
    # the same line in tune reads tuning 0; a note a quarter tone off (50 cents) is ambiguous and snaps to the key
    ambiguous = [(0, 0, 4, 39), (0, 4, 4, 40.4), (0, 8, 4, 39), (0, 12, 4, 39)]
    bg, notes = transcribe_bass(bass_line(ambiguous, 120, 1), SR, Grid(bpm=120, first_downbeat=0.0, bars=1), dsharp_minor)
    assert abs(bg.tuning_cents) <= 5  # read to the cent, not to pyin's 20-cent bins
    assert [n.midi for n in notes][1] == 39  # 40 cents sharp of E, which is not in key: ambiguous, snapped down to D#


def test_a_record_pitched_up_half_a_semitone_reads_as_sharp_not_as_the_next_note():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    dsharp_minor = Key(tonic=3, mode="minor")
    shape = [(b, s, 2, m) for b in range(2) for s, m in ((0, 39), (4, 27), (8, 52), (12, 39))]
    for cents in (40, 45, 50):
        sharp = [(b, s, n, m + cents / 100) for b, s, n, m in shape]
        bg, notes = transcribe_bass(bass_line(sharp, 120, 2), SR, g, dsharp_minor)
        # +40 could be read as -60 against the next semitone up; the reading that keeps more steps in key wins
        assert cents - 8 <= bg.tuning_cents <= cents + 8, cents
        assert [n.midi for n in notes if n.bar == 0] == [39, 27, 52, 39], cents
    flat = [(b, s, n, m - 0.45) for b, s, n, m in shape]
    bg, notes = transcribe_bass(bass_line(flat, 120, 2), SR, g, dsharp_minor)
    assert -53 <= bg.tuning_cents <= -37 and [n.midi for n in notes if n.bar == 0] == [39, 27, 52, 39]


def test_retuning_merges_a_boundary_the_raw_rounding_split_and_keeps_a_real_retrigger():
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    dsharp_minor = Key(tonic=3, mode="minor")
    # one held note 8 steps long, 40 cents sharp: step by step the raw rounding wobbles between 39 and 40,
    # which looked like pitch changes; retuned it is one D#2
    bg, notes = transcribe_bass(bass_line([(0, 0, 8, 39.4)], 120, 1), SR, g, dsharp_minor)
    assert [(n.step, n.length, n.midi) for n in notes] == [(0, 8, 39)]
    # two D#2s back to back, retriggered: still two notes
    bg, notes = transcribe_bass(bass_line([(0, 0, 4, 39.4), (0, 4, 4, 39.4)], 120, 1), SR, g, dsharp_minor)
    assert [(n.step, n.length) for n in notes] == [(0, 4), (4, 4)]


def test_bass_tone_measures_the_filter_and_the_wobble():
    from algorip.bass import bass_tone

    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    line = [(b, s, 4, 39) for b in range(2) for s in (0, 4, 8, 12)]
    # a flat, bright tone: the hold is as open as the attack, no envelope, no wobble
    flat_audio = bass_line(line, 120, 2)
    tone = bass_tone(flat_audio, SR, transcribe_bass(flat_audio, SR, g, GMIN)[1], g)
    assert tone is not None and tone.open_hz < 1.5 * tone.hold_hz and tone.wobble_hz is None
    # a filter that opens at 2 kHz and closes to 200 Hz in 120 ms, with a 9 Hz, 6 dB tremolo
    shaped_audio = filtered_bass(line, 120, 2, open_hz=2000, hold_hz=200, close_seconds=0.12, wobble_hz=9, wobble_depth=0.5)
    tone = bass_tone(shaped_audio, SR, transcribe_bass(shaped_audio, SR, g, GMIN)[1], g)
    assert tone is not None
    assert 150 <= tone.hold_hz <= 320 and tone.open_hz >= 3 * tone.hold_hz and 60 <= tone.close_ms <= 220
    assert tone.wobble_hz is not None and 8 <= tone.wobble_hz <= 10 and 4 <= tone.wobble_db <= 8
    assert bass_tone(shaped_audio, SR, [], g) is None
    # the stem's trap: the sound starts 30 ms after the grid line, with a quiet click in the gap; the opening
    # must be read where the note sounds, not from the gap (where the click's broadband noise reads as 3 octaves)
    lagged = filtered_bass(line, 120, 2, open_hz=600, hold_hz=300, close_seconds=0.12, onset_lag_seconds=0.03, click=True)
    tone = bass_tone(lagged, SR, transcribe_bass(lagged, SR, g, GMIN)[1], g)
    assert tone is not None and tone.open_hz <= 2.2 * tone.hold_hz and tone.wobble_hz is None
    # a plucked note that only decays is not a tremolo; a short note cannot resolve one at all
    from tests.synth import gated_bass

    plucked = gated_bass(line, 120, 2, hold_share=0.2, fall_seconds=0.3)
    tone = bass_tone(plucked, SR, transcribe_bass(plucked, SR, g, GMIN)[1], g)
    assert tone is not None and tone.wobble_hz is None
    short = [(b, s, 2, 39) for b in range(2) for s in (0, 4, 8, 12)]
    short_audio = filtered_bass(short, 129, 2, open_hz=2000, hold_hz=200, close_seconds=0.12, wobble_hz=9, wobble_depth=0.5)
    tone = bass_tone(short_audio, SR, transcribe_bass(short_audio, SR, g, GMIN)[1], g)
    assert tone is not None and tone.wobble_hz is None


def test_choose_sounds_writes_the_measured_filter_and_tremolo():
    from algorip.schema import BassTone
    from algorip.sounds import choose_sounds

    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    saw = a.model_copy(update={"bass_harmonics": 0.5})
    assert choose_sounds(saw.model_copy(update={"bass_tone": None})).bass_lpf == 800  # the old fixed value, with no measurement
    held_open = saw.model_copy(update={"bass_tone": BassTone(open_hz=900, hold_hz=840, close_ms=10, wobble_hz=None, wobble_db=None)})
    s = choose_sounds(held_open)
    assert s.bass_lpf == 840 and s.bass_filter_env is None and s.bass_tremolo is None
    closing = saw.model_copy(update={"bass_tone": BassTone(open_hz=1700, hold_hz=212, close_ms=118, wobble_hz=9.4, wobble_db=6.0)})
    s = choose_sounds(closing)
    assert s.bass_lpf == 210 and s.bass_filter_env is not None and s.bass_filter_env.octaves == 3.0 and s.bass_filter_env.close == 0.118
    assert s.bass_tremolo is not None and s.bass_tremolo.rate == 9.4 and s.bass_tremolo.depth == pytest.approx(0.5, abs=0.01)
    # a bright burst that is gone within a frame is an onset click, not a filter opening
    click = saw.model_copy(update={"bass_tone": BassTone(open_hz=4500, hold_hz=430, close_ms=20, wobble_hz=None, wobble_db=None)})
    assert choose_sounds(click).bass_filter_env is None and choose_sounds(click).bass_lpf == 430
    # a sine bass has no filter to write, whatever the tone says
    sine = a.model_copy(update={"bass_harmonics": 0.1, "bass_tone": BassTone(open_hz=1700, hold_hz=212, close_ms=118, wobble_hz=None, wobble_db=None)})
    s = choose_sounds(sine)
    assert s.bass_lpf is None and s.bass_filter_env is None


def test_a_note_starting_just_before_its_line_keeps_its_filter_opening():
    # with the grid on the kicks, a bass that leads the kick starts a little before its line (12 ms on the 48:50
    # clip); read from the line, its filter is already closing. The quarter step before the line is searched.
    from algorip.bass import bass_tone

    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    line = [(b, s, 3, 39) for b in range(2) for s in (1, 5, 9, 13)]
    early = filtered_bass(line, 120, 2, open_hz=2000, hold_hz=200, close_seconds=0.12, onset_lag_seconds=-0.012)
    notes = transcribe_bass(early, SR, g, GMIN)[1]
    assert len(notes) >= 6 and {(n.bar, n.step) for n in notes} <= {(b, s) for b, s, _, _ in line}
    tone = bass_tone(early, SR, notes, g)
    assert tone is not None and tone.open_hz >= 3 * tone.hold_hz and 150 <= tone.hold_hz <= 320


def test_a_note_after_a_held_note_takes_its_onset_at_the_line():
    # the quarter step before the second note's line is the first note, loud: the onset stays at the line
    from algorip.bass import bass_envelope

    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    pair = bass_line([(0, 0, 4, 39), (0, 4, 4, 39)], 120, 1)
    single = bass_line([(0, 4, 4, 39)], 120, 1)
    both = transcribe_bass(pair, SR, g, GMIN)[1]
    assert [(n.step, n.length) for n in both] == [(0, 4), (4, 4)]
    paired = bass_envelope(pair, SR, [n for n in both if n.step == 4], g)
    alone = bass_envelope(single, SR, transcribe_bass(single, SR, g, GMIN)[1], g)
    assert paired is not None and alone is not None
    assert abs(paired.attack_ms - alone.attack_ms) <= 5 and abs(paired.hold_ms - alone.hold_ms) <= 15
