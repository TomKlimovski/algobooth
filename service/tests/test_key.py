from algorip.audio import SR
from algorip.key import Key, estimate_key, key_from_stems
from tests.synth import bass_line, mix, pad_chords

A_MINOR_CHORDS = [(57, "minor"), (50, "minor"), (52, "major"), (57, "minor")]  # Am Dm E Am


def test_a_minor_progression():
    y = pad_chords(A_MINOR_CHORDS, bpm=120)
    k = estimate_key(y, SR)
    assert k.name == "A minor"


def test_c_major_from_a_bass_line_and_pad():
    y = mix(pad_chords([(48, "major"), (53, "major"), (55, "major"), (48, "major")], 120),
            bass_line([(b, 0, 16, 36 + d) for b, d in enumerate([0, 5, 7, 0])], 120, 4))
    assert estimate_key(y, SR).name == "C major"


def test_key_scale_and_names():
    k = Key(tonic=9, mode="minor")
    assert k.scale == {9, 11, 0, 2, 4, 5, 7}
    assert Key(tonic=6, mode="major").name == "F# major"


def test_key_from_a_bass_and_other_stem():
    other = pad_chords(A_MINOR_CHORDS, 120)
    bass = bass_line([(b, 0, 16, 33 + d) for b, d in enumerate([0, 7, 7, 0])], 120, 4)  # A E E A
    assert key_from_stems(other, bass, SR).name == "A minor"
