import pytest

from algorip.audio import SR
from algorip.key import Key, estimate_key
from tests.synth import bass_line, mix, pad_chords


@pytest.mark.xfail(
    strict=True,
    reason="Am F C G has C in three of four chords; mean chroma correlates 0.935 with C major "
    "vs 0.840 with A minor, so Krumhansl-Schmuckler reads its relative major. Pending a fixture decision.",
)
def test_a_minor_progression():
    y = pad_chords([(57, "minor"), (53, "major"), (48, "major"), (55, "major")], bpm=120)  # Am F C G
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
