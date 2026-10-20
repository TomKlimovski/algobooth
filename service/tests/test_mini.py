from algorip.mini import (
    bar_mini,
    bjorklund,
    cycle,
    euclid_match,
    note_name,
    notes_bar_mini,
    notes_mini,
    period,
    voice_mini,
)
from algorip.notes import Note


def test_bjorklund_and_match():
    assert bjorklund(3, 8) == [True, False, False, True, False, False, True, False]
    assert euclid_match({0, 3, 6}, 8) == (3, 8, 0)
    assert euclid_match({0, 6, 12}) == (3, 8, 0)           # even steps collapse to m=8
    assert euclid_match({0, 4, 8, 12}) == (4, 8, 0)        # matches, but bar_mini's rule 2 wins first
    assert euclid_match({0, 3, 10}) is None


def test_bjorklund_is_the_strudel_distribution():
    # Bjorklund's grouping, not Bresenham's: (5,8) is x.xx.xx. as in Strudel and Tidal
    assert bjorklund(5, 8) == [True, False, True, True, False, True, True, False]
    assert bjorklund(3, 16) == [i in (0, 5, 10) for i in range(16)]
    assert bjorklund(4, 4) == [True] * 4
    assert bjorklund(0, 4) == [False] * 4


def test_euclid_match_rotation_is_to_the_right():
    assert euclid_match({1, 4, 7}, 8) == (3, 8, 1)
    assert euclid_match({2, 8, 14}) == (3, 8, 1)
    assert euclid_match({0, 5, 10}) == (3, 16, 0)
    assert euclid_match(set()) is None


def test_bar_mini_simple_forms():
    assert bar_mini("bd", set()) == "~"
    assert bar_mini("bd", {0, 4, 8, 12}) == "bd*4"
    assert bar_mini("hh", set(range(0, 16, 2))) == "hh*8"
    assert bar_mini("cp", {4, 12}) == "[~ cp]*2"
    assert bar_mini("oh", {2, 6, 10, 14}) == "[~ oh]*4"
    assert bar_mini("bd", {0, 6, 12}) == "bd(3,8)"
    assert bar_mini("bd", {0, 3, 10}) == "[bd ~ ~ bd] ~ [~ ~ bd ~] ~"


def test_bar_mini_every_period():
    assert bar_mini("hh", set(range(16))) == "hh*16"
    assert bar_mini("bd", {0}) == "bd"
    assert bar_mini("bd", {0, 8}) == "bd*2"
    assert bar_mini("cp", {8}) == "[~ cp]"
    assert bar_mini("hh", set(range(1, 16, 2))) == "[~ hh]*8"


def test_bar_mini_euclid_forms():
    assert bar_mini("bd", {0, 4, 6, 10, 12}) == "bd(5,8)"
    assert bar_mini("bd", {2, 8, 14}) == "bd(3,8,1)"
    assert bar_mini("rim", {0, 5, 10}) == "rim(3,16)"
    assert bar_mini("bd", {6}) == "~ [~ ~ bd ~] ~ ~"   # a one-hit Euclid (k=1) is not used


def test_period():
    assert period(["a", "a", "a", "a"]) == 1
    assert period(["a", "b", "a", "b"]) == 2
    assert period(["a", "a", "a", "b"]) == 4
    assert period(["a", "b", "c"]) == 3


def test_cycle_collapses_repeats():
    assert cycle(["a", "a", "a", "a"]) == "a"
    assert cycle(["a", "b", "a", "b"]) == "<a b>"
    assert cycle(["[~ cp]*2", "bd ~ bd ~"]) == "<[~ cp]*2 [bd ~ bd ~]>"   # only a top-level space gets wrapped
    assert voice_mini("bd", [{0, 4, 8, 12}, {0, 4, 8, 12}, {0, 4, 8, 12}, {0, 4, 8, 10}]) == \
        "<bd*4 bd*4 bd*4 [[bd ~ ~ ~] [bd ~ ~ ~] [bd ~ bd ~] ~]>"


def test_cycle_chords():
    assert cycle(["Am", "F", "C", "G"]) == "<Am F C G>"
    assert cycle(["Dm"] * 4) == "Dm"
    assert cycle(["a b", "a b"]) == "a b"           # one part is returned as is, unwrapped


def test_voice_mini_golden_drums():
    assert voice_mini("bd", [{0, 4, 8, 12}] * 4) == "bd*4"
    assert voice_mini("cp", [{4, 12}] * 4) == "[~ cp]*2"
    assert voice_mini("hh", [set(range(0, 16, 2))] * 4) == "hh*8"
    assert voice_mini("oh", [{2, 6, 10, 14}] * 4) == "[~ oh]*4"
    assert voice_mini("bd", [{0, 6, 12}]) == "bd(3,8)"


def test_note_name():
    assert note_name(33) == "a1"
    assert note_name(37) == "c#2"
    assert note_name(28) == "e1"


def test_notes_bar_mini():
    notes = [Note(bar=0, step=0, length=4, midi=33), Note(bar=0, step=8, length=1, midi=33),
             Note(bar=0, step=10, length=1, midi=33), Note(bar=0, step=13, length=2, midi=28)]
    assert notes_bar_mini(notes) == "a1 ~ [a1 ~ a1 ~] [~ e1@2 ~]"
    assert notes_mini(notes, 1) == "a1 ~ [a1 ~ a1 ~] [~ e1@2 ~]"


def test_notes_bar_mini_clips_to_the_beat_group():
    # a note running past its beat group (or the bar end) stops at the group end
    assert notes_bar_mini([Note(bar=0, step=2, length=5, midi=33)]) == "[~ ~ a1@2] ~ ~ ~"
    assert notes_bar_mini([Note(bar=0, step=14, length=8, midi=33)]) == "~ ~ ~ [~ ~ a1@2]"
    assert notes_bar_mini([]) == "~ ~ ~ ~"


def test_notes_bar_mini_cuts_a_note_at_the_next_start():
    notes = [Note(bar=0, step=0, length=4, midi=33), Note(bar=0, step=2, length=1, midi=40)]
    assert notes_bar_mini(notes) == "[a1@2 e2 ~] ~ ~ ~"


def test_notes_mini_cycles_bars():
    # The brief expected "<[a1@4 ~ ~ ~] [c2@4 ~ ~ ~]>", but that contradicts its own rule that a group
    # filled by one note is just the name (and "a1@4 ~ ~ ~" would give a1 4/7 of the bar).
    a = [Note(bar=0, step=0, length=16, midi=33)]
    b = [Note(bar=1, step=0, length=16, midi=36)]
    assert notes_mini(a + b, 2) == "<[a1 ~ ~ ~] [c2 ~ ~ ~]>"
    assert notes_mini(a + [n.model_copy(update={"bar": 1}) for n in a], 2) == "a1 ~ ~ ~"
