from pathlib import Path

from algorip.grid import Grid
from algorip.key import Key
from algorip.melody import transcribe_melody

AMIN = Key(tonic=9, mode="minor")


def test_melody_needs_enough_monophonic_notes():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    few = lambda p: [(i * 0.5, i * 0.5 + 0.4, 72, 0.9) for i in range(4)]
    assert transcribe_melody(Path("x"), g, AMIN, predict=few) is None
    line = lambda p: [(i * 0.25, i * 0.25 + 0.2, 69 + (i % 3), 0.9) for i in range(12)]
    out = transcribe_melody(Path("x"), g, AMIN, predict=line)
    assert out is not None and len(out) == 12


def test_chordal_other_stem_yields_no_melody():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    stacked = lambda p: [(i * 0.5, i * 0.5 + 0.45, m, 0.9) for i in range(8) for m in (60, 64, 67)]
    assert transcribe_melody(Path("x"), g, AMIN, predict=stacked) is None


def test_melody_is_folded_into_its_register():
    g = Grid(bpm=120, first_downbeat=0.0, bars=2)
    high = lambda p: [(i * 0.25, i * 0.25 + 0.2, 93 + 2 * (i % 2), 0.9) for i in range(8)]  # A6, B6
    out = transcribe_melody(Path("x"), g, AMIN, predict=high)
    assert out is not None and [n.midi for n in out[:2]] == [81, 83]
    assert all(48 <= n.midi <= 84 for n in out)
