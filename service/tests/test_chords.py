import numpy as np
import pytest

from algorip.audio import SR
from algorip.chords import _parse, _third, chord_name, colour_chords, estimate_chords, peak_chroma_bars, spell
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


@pytest.mark.parametrize("cents", [-40, -25, -10, 10, 25, 40])
def test_a_detuned_pad_reads_the_same_chord(cents):
    # The tuning is estimated to the semitone, so a stem off A440 still lands each note on its centre bin.
    y = pad_chords([(55, "m7")], 120, detune_cents=cents)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["Gm7"]


def test_a_wobbling_fifth_gets_no_seventh_or_ninth():
    y = pad_chords([(55, "5wobble")], 120)
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1), G_MINOR) == ["Gm"]


@pytest.mark.parametrize(
    "root,minor,seventh,ninth,symbol",
    [
        (9, True, 10, False, "Am7"),
        (9, True, 11, True, "Am^9"),
        (7, False, None, True, "Gadd9"),
        (7, True, None, True, "Gmadd9"),
        (7, False, 10, True, "G9"),
        (7, False, None, False, "G"),
    ],
)
def test_spelling(root, minor, seventh, ninth, symbol):
    assert spell(root, minor, seventh, ninth) == symbol


def test_spell_takes_only_a_minor_or_major_seventh():
    with pytest.raises(ValueError):
        spell(7, False, 9, False)


def test_both_sevenths_heard_writes_neither():
    y = pad_chords([(57, "7+^7")], 120)  # A7 with a major 7th an octave up: both clear EXT_SHARE, at different levels
    bar = peak_chroma_bars(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1))[0]
    assert bar[7] >= 0.4 * bar[9] and bar[8] >= 0.4 * bar[9] and bar[7] != bar[8]
    assert estimate_chords(y, SR, Grid(bpm=120, first_downbeat=0.0, bars=1)) == ["A"]


def test_every_degree_borrows_the_keys_seventh():
    assert colour_chords(["Gm", "A#", "Cm", "Dm", "D#", "F"], G_MINOR) == ["Gm7", "A#^7", "Cm7", "Dm7", "D#^7", "F7"]
    c_major = Key(tonic=0, mode="major")
    assert colour_chords(["C", "Dm", "Em", "F", "G", "Am"], c_major) == ["C^7", "Dm7", "Em7", "F^7", "G7", "Am7"]


def test_no_colour_outside_the_key_on_the_diminished_degree_or_as_m_maj7():
    assert colour_chords(["G#", "Am", "A#m"], G_MINOR) == ["G#", "Am", "A#m"]  # outside; ii; III's ^7 on a minor


def test_a_heard_quality_the_key_would_not_give_takes_the_scales_seventh():
    assert colour_chords(["D"], G_MINOR) == ["D7"]


def test_a_heard_seventh_wins_and_a_heard_ninth_spells_a_ninth_chord():
    assert colour_chords(["Gm^7", "Gmadd9"], G_MINOR) == ["Gm^7", "Gm9"]
    assert colour_chords(["A#add9"], G_MINOR) == ["A#^9"]  # III's borrowed major 7th with a heard 9th


def test_no_chord_stays_no_chord():
    assert colour_chords(["~", "Gm"], G_MINOR) == ["~", "Gm7"]


@pytest.mark.parametrize("root", [7, 10])  # G, and a sharp root (A#)
@pytest.mark.parametrize("minor", [False, True])
@pytest.mark.parametrize("seventh", [None, 10, 11])
@pytest.mark.parametrize("ninth", [False, True])
def test_parse_inverts_spell(root, minor, seventh, ninth):
    assert _parse(spell(root, minor, seventh, ninth)) == (root, minor, seventh, ninth)
