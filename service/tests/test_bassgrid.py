import time

import numpy as np
import pytest

from algorip.audio import SR
from algorip.bassgrid import PYIN_SR, bass_grid, grid_to_notes, hps_midi, sub_octave_supported
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


def test_a_note_starting_just_before_the_first_downbeat_is_kept():
    # estimate_grid places the downbeat to one 512-sample hop (11.6 ms), so it often lands just after
    # the first attack. The step before the grid is then cut short by the start of the audio and holds
    # only the first note, so it must not count as that note's predecessor.
    bg = bass_grid(bass_line([(0, 0, 8, 33), (0, 8, 2, 36)], BPM, 1), SR, Grid(bpm=BPM, first_downbeat=0.0116, bars=1))
    assert bg.starts[0][0]
    assert [(n.step, n.length, n.midi) for n in grid_to_notes(bg)] == [(0, 8, 33), (8, 2, 36)]


def test_a_quiet_swell_is_a_rest_while_a_quiet_hit_is_heard():
    # The floor is a tenth of the loudest step: on the Solomun stem, fading swells on rest steps sat at
    # 0.03-0.10 of the peak and real hits at 0.15 and up. A 0.02 floor heard the swells as notes.
    loud = bass_line([(0, 0, 2, 31)], BPM, 1)
    hit = bass_line([(0, 6, 1, 31)], BPM, 1)
    swell = bass_line([(0, 10, 2, 31)], BPM, 1)
    bg = bass_grid(loud + 0.16 * hit + 0.06 * swell, SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert bg.midi[0][6] == 31 and bg.starts[0][6]
    assert bg.midi[0][10] is None and bg.midi[0][11] is None
    assert [(n.step, n.length, n.midi) for n in grid_to_notes(bg)] == [(0, 2, 31), (6, 1, 31)]


@pytest.mark.slow
def test_a_sixty_second_stem_tracks_in_under_five_seconds():
    y = bass_line([(b, s, 1, 31) for b in range(30) for s in range(0, 16, 2)], BPM, 30)  # 60 s
    t = time.perf_counter(); bass_grid(y, SR, Grid(bpm=BPM, first_downbeat=0.0, bars=30))
    assert time.perf_counter() - t < 5.0


def _tone(midi: int, seconds: float, weights: tuple[float, ...]) -> np.ndarray:
    """Harmonics 1..n of a note at PYIN_SR with the given amplitudes."""
    t = np.arange(int(seconds * PYIN_SR)) / PYIN_SR
    hz = 440.0 * 2 ** ((midi - 69) / 12)
    return sum(w * np.sin(2 * np.pi * (k + 1) * hz * t) for k, w in enumerate(weights)).astype(np.float32)


def test_hps_midi_reads_the_fundamental_even_under_a_louder_second_harmonic():
    # D#2 (39): the 48:50 clip's beat 4, which pyin reads an octave down at no confidence
    assert hps_midi(_tone(39, 0.35, (1.0, 0.5, 0.2, 0.2)), PYIN_SR) == 39
    assert hps_midi(_tone(39, 0.35, (0.5, 1.0, 0.3)), PYIN_SR) == 39
    assert hps_midi(_tone(24, 0.35, (1.0, 0.5)), PYIN_SR) == 24  # C1, at FMIN's edge
    assert hps_midi(_tone(24, 0.232, (1.0, 0.5)), PYIN_SR) == 24  # ...even in a 232 ms window, re-read from its harmonics
    assert hps_midi(_tone(26, 0.232, (1.0, 0.5)), PYIN_SR) == 26
    assert hps_midi(_tone(51, 0.35, (1.0, 0.3)), PYIN_SR) == 51  # D#3, a semitone resolved against E3
    assert hps_midi(np.zeros(100, dtype=np.float32), PYIN_SR) is None  # too short to resolve a bass note
    assert hps_midi(_tone(70, 0.35, (1.0, 0.3)), PYIN_SR) is None  # out of the bass range: nothing in the band is a partial
    # a missing fundamental: the spectrum reads the octave above, and the sub-octave is supported by its third harmonic
    missing = _tone(31, 0.35, (0.0, 1.0, 0.6, 0.4, 0.3, 0.2))
    assert hps_midi(missing, PYIN_SR) == 43 and sub_octave_supported(missing, PYIN_SR, 31)
    assert not sub_octave_supported(_tone(39, 0.35, (1.0, 0.5, 0.3)), PYIN_SR, 27)


def test_a_loud_step_pyin_cannot_voice_gets_its_pitch_from_the_spectrum(monkeypatch):
    # pyin is confident on the first note and not on the second (its frames read an octave down at 0.03):
    # the second step still gets its pitch, from the spectrum, since it is as loud as the first
    import librosa

    from algorip import bassgrid

    real = librosa.pyin

    def unsure_after_half(y, **kw):
        f0, vf, vp = real(y, **kw)
        half = len(f0) // 2
        f0[half:] = f0[half:] / 2  # an octave down...
        vp[half:] = 0.03  # ...at no confidence, as on the clip
        return f0, vf, vp

    monkeypatch.setattr(bassgrid.librosa, "pyin", unsure_after_half)
    bg = bass_grid(bass_line([(0, 0, 8, 39), (0, 8, 8, 39)], BPM, 1), SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert bg.midi[0] == [39] * 16


def test_a_quiet_step_never_gets_a_fallback_pitch(monkeypatch):
    bg = bass_grid(bass_line([(0, 0, 4, 39)], BPM, 1), SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert bg.midi[0][:4] == [39] * 4 and bg.midi[0][4:] == [None] * 12
    # a step a quarter as loud as the loudest, which pyin cannot voice at all: a tail, and still a rest
    import librosa

    from algorip import bassgrid

    real = librosa.pyin

    def deaf_after_half(y, **kw):
        f0, vf, vp = real(y, **kw)
        vf[len(f0) // 2 :] = False
        vp[len(f0) // 2 :] = 0.01
        return f0, vf, vp

    monkeypatch.setattr(bassgrid.librosa, "pyin", deaf_after_half)
    y = bass_line([(0, 0, 8, 39)], BPM, 1) + 0.25 * bass_line([(0, 8, 8, 39)], BPM, 1)
    bg = bass_grid(y, SR, Grid(bpm=BPM, first_downbeat=0.0, bars=1))
    assert bg.midi[0][:8] == [39] * 8 and bg.midi[0][8:] == [None] * 8
