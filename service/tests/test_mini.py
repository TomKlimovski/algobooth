from algorip.mini import (
    bar_mini,
    bjorklund,
    consensus,
    cycle,
    euclid_match,
    fold_octaves,
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


def test_a_note_sustaining_past_its_beat_group_renders_the_bar_flat():
    assert notes_bar_mini([Note(bar=0, step=2, length=5, midi=33)]) == "~@2 a1@5 ~@9"
    g1 = [Note(bar=0, step=6, length=6, midi=31), Note(bar=0, step=14, length=1, midi=31)]
    assert notes_bar_mini(g1) == "~@6 g1@6 ~@2 g1 ~"
    assert notes_bar_mini([Note(bar=0, step=8, length=8, midi=33)]) == "~ a1"  # weights over their gcd
    assert notes_bar_mini([Note(bar=0, step=0, length=16, midi=33)]) == "a1"


def test_a_note_stops_at_the_bar_end_and_within_its_group_keeps_the_groups():
    assert notes_bar_mini([Note(bar=0, step=14, length=8, midi=33)]) == "~ ~ ~ [~ ~ a1@2]"
    assert notes_bar_mini([]) == "~ ~ ~ ~"


def test_repeated_and_short_notes_are_kept():
    notes = [Note(bar=0, step=0, length=1, midi=31), Note(bar=0, step=1, length=1, midi=31)]
    assert notes_bar_mini(notes) == "[g1 g1 ~ ~] ~ ~ ~"


def test_notes_bar_mini_cuts_a_note_at_the_next_start():
    notes = [Note(bar=0, step=0, length=4, midi=33), Note(bar=0, step=2, length=1, midi=40)]
    assert notes_bar_mini(notes) == "[a1@2 e2 ~] ~ ~ ~"


def test_notes_mini_cycles_bars():
    a = [Note(bar=0, step=0, length=16, midi=33)]
    b = [Note(bar=1, step=0, length=16, midi=36)]
    assert notes_mini(a + b, 2) == "<a1 c2>"
    assert notes_mini(a + [n.model_copy(update={"bar": 1}) for n in a], 2) == "a1"


OFFBEATS = {2, 6, 10, 14}


def test_a_stray_hit_in_one_bar_is_outvoted():
    bars = [set(OFFBEATS) for _ in range(8)]
    bars[1] |= {11, 12}  # 4 of the 6 occupied steps agree
    bars[6].discard(6)
    assert voice_mini("oh", bars) == "[~ oh]*4"


def test_a_bar_that_differs_keeps_its_own_line():
    # a fill: 3 of the 5 occupied steps agree, under two thirds
    assert voice_mini("bd", [{0, 4, 8, 12}] * 3 + [{0, 4, 8, 10}]) == \
        "<bd*4 bd*4 bd*4 [[bd ~ ~ ~] [bd ~ ~ ~] [bd ~ bd ~] ~]>"
    # an alternation over 4 bars has two votes per phase, too few for a period of 2
    assert voice_mini("bd", [{0, 10}, {0, 6}] * 2) == "<[[bd ~ ~ ~] ~ [~ ~ bd ~] ~] [[bd ~ ~ ~] [~ ~ bd ~] ~ ~]>"


def test_a_fill_that_recurs_at_the_same_phrase_bar_is_kept():
    claps = [{4, 12}] * 8
    claps[3] = claps[7] = {4, 12, 14}  # the same fill closing each 4-bar phrase
    assert voice_mini("cp", claps) == "<[~ cp]*2 [~ cp]*2 [~ cp]*2 [~ [cp ~ ~ ~] ~ [cp ~ cp ~]]>"
    kicks = [{0, 4, 8, 12}] * 8
    kicks[3] = kicks[7] = {0, 4, 8, 12, 14, 15}
    assert voice_mini("bd", kicks) == "<bd*4 bd*4 bd*4 [[bd ~ ~ ~] [bd ~ ~ ~] [bd ~ ~ ~] [bd ~ bd bd]]>"


def test_a_stray_in_a_single_bar_is_absorbed():
    claps = [{4, 12}] * 8
    claps[3] = {4, 12, 14}
    assert voice_mini("cp", claps) == "[~ cp]*2"


def test_a_fill_every_other_bar_is_its_own_phase():
    claps = [{4, 12}, {4, 12, 14}] * 4
    assert voice_mini("cp", claps) == "<[~ cp]*2 [~ [cp ~ ~ ~] ~ [cp ~ cp ~]]>"


def test_consensus_takes_the_shortest_period_that_fits():
    a, b = {0: 1, 8: 1}, {0: 1, 4: 1}
    assert consensus([a, b] * 4) == [a, b] * 4                      # period 2, 4 votes a phase
    c = {0: 1, 4: 1, 8: 1}
    assert consensus([c] * 7 + [{0: 1, 4: 1}]) == [c] * 8           # period 1: 2 of 3 agree
    assert consensus([a] * 7 + [{0: 1}]) is None                    # 1 of 2 is too few
    assert consensus([a, b, a]) is None                             # 3 bars: only period 1, which fails
    assert consensus([{}, {}, {}]) == [{}, {}, {}]


def test_bass_consensus_votes_on_pitch_class_and_keeps_the_commonest_note():
    def bar(b):
        return [Note(bar=b, step=0, length=4, midi=31), Note(bar=b, step=8, length=2, midi=33),
                Note(bar=b, step=12, length=2, midi=31)]
    notes = [n for b in range(8) for n in bar(b)]
    notes[10] = notes[10].model_copy(update={"midi": 45})          # bar 3 an octave up: same pitch class
    notes[16] = notes[16].model_copy(update={"midi": 36})          # bar 5 plays c2 on step 8: 2 of 3 agree
    assert notes_mini(notes, 8) == "g1 ~ [a1@2 ~ ~] [g1@2 ~ ~]"


def test_fold_octaves_moves_outliers_towards_the_median():
    notes = [Note(bar=0, step=s, length=1, midi=m) for s, m in enumerate([31, 31, 33, 43, 55, 19, 30])]
    assert [n.midi for n in fold_octaves(notes)] == [31, 31, 33, 31, 31, 31, 30]
    assert fold_octaves([]) == []


def test_retriggered_sixteenths_use_star():
    four = [Note(bar=0, step=s, length=1, midi=31) for s in range(4)]
    assert notes_bar_mini(four + [Note(bar=0, step=8, length=1, midi=31)]) == "g1*4 ~ [g1 ~ ~ ~] ~"
    assert notes_bar_mini([Note(bar=0, step=s, length=1, midi=31) for s in range(16)]) == "g1*16"
    assert notes_bar_mini([Note(bar=0, step=s, length=1, midi=31 + (s % 2)) for s in range(4)]) == "[g1 g#1 g1 g#1] ~ ~ ~"
