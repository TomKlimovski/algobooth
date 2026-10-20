import numpy as np

from algorip.audio import SR
from algorip.chords import chord_name, estimate_chords
from algorip.grid import Grid
from tests.synth import mix, pad_chords, silence


def test_chords_per_bar():
    y = pad_chords([(57, "minor"), (53, "major"), (48, "major"), (55, "major")], 120)
    g = Grid(bpm=120, first_downbeat=0.0, bars=4)
    assert estimate_chords(y, SR, g) == ["Am", "F", "C", "G"]


def test_silent_bar_repeats_previous_chord():
    y = mix(pad_chords([(48, "major")], 120), silence(4.0))
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=2)) == ["C", "C"]


def test_chord_names_use_sharps():
    assert chord_name(10, False) == "A#" and chord_name(6, True) == "F#m"


def test_first_silent_bar_has_no_chord():
    y = np.concatenate([silence(2.0), pad_chords([(57, "minor")], 120)])
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=2)) == ["~", "Am"]
