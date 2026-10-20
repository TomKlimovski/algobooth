import numpy as np
import pytest

from algorip.audio import SR
from algorip.bass import harmonic_ratio, transcribe_bass
from algorip.grid import Grid
from algorip.key import Key
from algorip.notes import Note, monophonic, quantise, snap_to_key
from tests.synth import bass_line

G = Grid(bpm=120, first_downbeat=0.0, bars=1)   # step = 0.125 s
AMIN = Key(tonic=9, mode="minor")


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


def test_transcribe_bass_with_a_fake_predictor(tmp_path):
    fake = lambda path: [(0.0, 0.5, 33, 0.9), (1.0, 1.25, 28, 0.9), (1.25, 1.5, 70, 0.9)]
    notes = transcribe_bass(tmp_path / "bass.wav", G, AMIN, predict=fake)
    assert [n.midi for n in notes] == [33, 28, 57]     # 70 (A#4) snaps to A, then folds an octave into the bass register


def test_transcribe_bass_folds_low_notes_up(tmp_path):
    notes = transcribe_bass(tmp_path / "bass.wav", G, AMIN, predict=lambda p: [(0.0, 0.5, 21, 0.9)])
    assert [n.midi for n in notes] == [33]


@pytest.mark.slow
def test_real_basic_pitch_hears_a_sawtooth_bass(tmp_wav):
    y = bass_line([(0, 0, 8, 45), (0, 8, 8, 40)], bpm=120, bars=1)  # A2 then E2
    notes = transcribe_bass(tmp_wav("bass.wav", y), G, AMIN)
    classes = {n.midi % 12 for n in notes}
    assert {9, 4} <= classes


def test_harmonic_ratio_is_higher_for_sawtooth_than_sine():
    saw = bass_line([(0, 0, 16, 45)], 120, 1)
    t = np.arange(SR * 2) / SR; sine = (0.8 * np.sin(2 * np.pi * 110 * t)).astype(np.float32)
    notes = [Note(bar=0, step=0, length=16, midi=45)]
    assert harmonic_ratio(saw, SR, notes, G) > 0.4 > harmonic_ratio(sine, SR, notes, G)


def test_harmonic_ratio_is_zero_without_notes():
    assert harmonic_ratio(np.zeros(SR, dtype=np.float32), SR, [], G) == 0.0
