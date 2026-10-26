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


def test_other_tone_tells_a_held_pad_from_struck_keys():
    from algorip.chords import other_tone
    from tests.synth import decaying_bass

    pad = other_tone(pad_chords([(57, "minor"), (53, "major"), (48, "major"), (55, "major")], 120), SR)
    assert pad is not None and pad.decay_db > -3.0
    # a quarter-note C4 struck and dying over 80 ms, every beat
    keys = other_tone(decaying_bass([(b, s, 4, 60) for b in range(4) for s in (0, 4, 8, 12)], 120, 4, 0.08), SR)
    assert keys is not None and keys.decay_db < -15.0
    assert other_tone(silence(4.0), SR) is None
