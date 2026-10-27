import numpy as np
import pytest

from algorip.audio import SR
from algorip.chords import chord_name, estimate_chords, peak_chroma_bars, spell
from algorip.grid import Grid
from algorip.key import Key
from tests.synth import mix, pad_chords, silence

# A 1-bar fixture is shorter than one STFT frame in the CQT's lowest, most downsampled octave.
pytestmark = pytest.mark.filterwarnings("ignore:n_fft=.* is too large for input signal:UserWarning")

G_MINOR = Key(tonic=7, mode="minor")
G_MAJOR = Key(tonic=7, mode="major")


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


def test_a_bare_fifth_takes_the_keys_third():
    y = pad_chords([(55, "5")], 120)
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    assert estimate_chords(y, SR, g, G_MINOR) == ["Gm"]
    assert estimate_chords(y, SR, g, G_MAJOR) == ["G"]


def test_a_heard_third_beats_the_key():
    y = pad_chords([(55, "major")], 120)  # G major heard, in G minor
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["G"]


def test_a_root_outside_the_key_keeps_the_templates_pick():
    y = pad_chords([(56, "5")], 120)  # G# is not in G minor
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    assert estimate_chords(y, SR, g, G_MINOR) == estimate_chords(y, SR, g)
    assert estimate_chords(y, SR, g)[0] in ("G#", "G#m")


def test_the_diminished_degree_keeps_the_templates_pick():
    y = pad_chords([(57, "5")], 120)  # A is ii in G minor, a diminished triad
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    assert estimate_chords(y, SR, g, G_MINOR) == estimate_chords(y, SR, g)
    # Every bare fifth's template pick is minor, so the rule itself is pinned on a peak chroma: a template A major
    # with no third heard stays major on ii in G minor and on vii in A# major, where a full degree would follow the key.
    from algorip.chords import _third
    peak = np.zeros(12)
    peak[[9, 4]] = 1.0, 0.5  # A and E
    assert _third(9, False, peak, G_MINOR) is False
    assert _third(9, False, peak, Key(tonic=10, mode="major")) is False
    assert _third(9, False, peak, Key(tonic=9, mode="minor")) is True  # i in A minor takes the key's third


def test_both_thirds_heard_the_louder_decides():
    g = Grid(bpm=120, first_downbeat=0.0, bars=1)
    minor = (pad_chords([(55, "minor")], 120) + 0.4 * pad_chords([(55, "major")], 120)).astype(np.float32)
    major = (pad_chords([(55, "major")], 120) + 0.4 * pad_chords([(55, "minor")], 120)).astype(np.float32)
    assert estimate_chords(minor, SR, g, G_MAJOR) == ["Gm"]
    assert estimate_chords(major, SR, g, G_MINOR) == ["G"]


def test_a_noise_bar_repeats_the_previous_chord():
    from tests.synth import _noise  # white noise: no clear pitch class
    bar = len(pad_chords([(57, "minor")], 120))
    y = np.concatenate([pad_chords([(57, "minor")], 120), 0.3 * _noise(bar, seed=3)]).astype(np.float32)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=2)) == ["Am", "Am"]


def test_peak_chroma_names_the_notes_not_their_smear():
    y = pad_chords([(55, "5wobble")], 120)
    bar = peak_chroma_bars(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1))[0]
    bar = bar / bar.max()
    assert bar[7] == 1.0                             # G is the loudest
    assert bar[6] < 0.25 and bar[8] < 0.25          # no F# or G# from the wobble
    assert bar[6] < bar[2] and bar[8] < bar[2]      # and each under the D that is played


@pytest.mark.parametrize("quality,symbol", [("m7", "Am7"), ("7", "A7"), ("^7", "A^7"), ("m9", "Am9"), ("9", "A9")])
def test_heard_extensions_round_trip(quality, symbol):
    y = pad_chords([(57, quality)], 120)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1)) == [symbol]


def test_a_wobbling_fifth_gets_no_seventh_or_ninth():
    y = pad_chords([(55, "5wobble")], 120)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["Gm"]


def test_spelling():
    assert spell(9, True, 10, False) == "Am7" and spell(9, True, 11, True) == "Am^9"
    assert spell(7, False, None, True) == "Gadd9" and spell(7, True, None, True) == "Gmadd9"
    assert spell(7, False, 10, True) == "G9" and spell(7, False, None, False) == "G"
