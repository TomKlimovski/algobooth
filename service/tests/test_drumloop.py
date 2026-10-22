from pathlib import Path

import pytest

from algorip.drumloop import FILL_MIN_HITS, drum_loops, voice_loop
from algorip.schema import Analysis

GOLDEN = Path(__file__).parent / "golden"
HOUSE = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())

FOUR = {0, 4, 8, 12}
OFF = {2, 6, 10, 14}


def analysis(drums: dict[str, list[tuple[int, int]]], bars: int) -> Analysis:
    return HOUSE.model_copy(update={"drums": drums, "bars": bars})


def test_a_one_bar_loop_with_a_fill_bar():
    v = voice_loop([FOUR] * 3 + [{0, 4, 8, 10}])
    assert v.period == 1 and v.templates == [FOUR]
    assert v.fills == [set(), set(), set(), {10}]


def test_a_stray_hit_in_a_core_bar_is_a_fill_too():
    bars = [OFF] * 8
    bars[1] = OFF | {11}
    v = voice_loop(bars)
    assert v.templates == [OFF] and v.fills[1] == {11} and all(not f for i, f in enumerate(v.fills) if i != 1)


def test_a_phrase_end_fill_becomes_fills_every_fourth_bar():
    claps = [{4, 12}] * 8
    claps[3] = claps[7] = {4, 12, 14}
    v = voice_loop(claps)
    assert v.period == 1 and v.templates == [{4, 12}]
    assert [bool(f) for f in v.fills] == [False, False, False, True] * 2 and v.fills[3] == {14}


def test_an_alternation_is_a_two_bar_loop():
    v = voice_loop([{0, 10}, {0, 6}] * 2)
    assert v.period == 2 and v.templates == [{0, 10}, {0, 6}] and not any(v.fills)


def test_a_hit_every_fourth_bar_is_a_four_bar_loop():
    # open hats on bars 0, 4 and 8 only, and nothing elsewhere: a loop of period 4 with three silent phases
    # (period 2 would claim hats on bars 2 and 6 too, which lack them, and so explains less)
    bars = [set() for _ in range(9)]
    for b in (0, 4, 8):
        bars[b] = OFF
    v = voice_loop(bars)
    assert v.period == 4 and v.templates == [OFF, set(), set(), set()]
    assert not any(v.fills)


def test_no_repetition_is_all_fills_and_a_one_bar_clip_is_its_own_loop():
    bars = [{0}, {2}, {4}, {6}]
    v = voice_loop(bars)
    assert v.period == 1 and v.templates == [set()] and v.fills == bars
    one = voice_loop([FOUR])
    assert one.period == 1 and one.templates == [FOUR] and one.fills == [set()]


def test_drum_loops_over_an_analysis():
    a = analysis(drums={"bd": [(b, s) for b in range(4) for s in FOUR] + [(3, 10)], "sd": [(b, s) for b in range(4) for s in (4, 12)], "hh": [], "oh": []}, bars=4)
    d = drum_loops(a)
    assert set(d.voices) == {"bd", "sd"}
    assert d.fill_bars is None  # one stray is under FILL_MIN_HITS
    assert d.match == pytest.approx(round(2 * 24 / (24 + 25), 2))   # 24 played, 25 classified
    assert drum_loops(analysis(drums={}, bars=4)).voices == {} and drum_loops(analysis(drums={}, bars=4)).match == 1.0


def test_hits_off_the_clip_are_ignored():
    drums = {"bd": [(b, s) for b in range(4) for s in FOUR] + [(3, 10)]}
    stray = {"bd": drums["bd"] + [(4, 2), (-1, 6)], "oh": [(9, 2)]}
    assert drum_loops(analysis(drums=stray, bars=4)) == drum_loops(analysis(drums=drums, bars=4))


def test_solomun_open_hats_are_a_one_bar_loop_with_strays_and_a_break():
    # Solomun 36:40's open hats: the full vote fails (the step-7 hit is in five bars of nine, and the bars
    # without it are then under the core share), the sparse seed finds the three-hit bar seven bars contain;
    # the step-7 hits are fills, and bars 5 and 6 (a break) are dropouts
    bars = [{1, 9, 15}, {1, 7, 9, 15}, {1, 7, 9, 15}, {1, 7, 9}, {1}, set(), {7, 9, 15}, {1, 7, 9, 15}, {1, 9, 15}]
    v = voice_loop(bars)
    assert v.period == 1 and v.templates == [{1, 9, 15}]
    assert v.fills == [set(), {7}, {7}, {7}, set(), set(), {7}, {7}, set()]


def test_a_bar_needs_three_strays_over_the_looped_voices_to_be_a_fill():
    assert FILL_MIN_HITS == 3
    bd = [(b, s) for b in range(4) for s in FOUR] + [(1, 2), (1, 3)]  # two strays in bar 2
    sd = [(b, s) for b in range(4) for s in (4, 12)] + [(1, 14), (2, 14), (2, 15)]  # one in bar 2, two in bar 3
    d = drum_loops(analysis(drums={"bd": bd, "sd": sd, "hh": [], "oh": []}, bars=4))
    assert d.voices["bd"].fills == [set(), {2, 3}, set(), set()]  # bar 2: 2 + 1 = 3, kept
    assert d.voices["sd"].fills == [set(), {14}, set(), set()]  # bar 3: 0 + 2 = 2, dropped
    assert d.fill_bars == (2, 2)


def test_dropped_strays_still_count_as_unplayed():
    bd = [(b, s) for b in range(4) for s in FOUR] + [(3, 10)]
    d = drum_loops(analysis(drums={"bd": bd, "sd": [], "hh": [], "oh": []}, bars=4))
    assert d.voices["bd"].fills == [set()] * 4 and d.fill_bars is None
    assert d.match == pytest.approx(round(2 * 16 / (16 + 17), 2))


def test_a_voice_looping_every_fourth_bar_has_no_fills():
    bd = [(b, s) for b in range(9) for s in FOUR]
    oh = [(b, s) for b in (0, 4, 8) for s in OFF]  # every fourth bar, as test_a_hit_every_fourth_bar_is_a_four_bar_loop
    d = drum_loops(analysis(drums={"bd": bd, "sd": [], "hh": [], "oh": oh}, bars=9))
    assert d.voices["oh"].period == 4 and d.voices["oh"].templates[0] == OFF
    assert not any(d.voices["oh"].fills) and d.fill_bars is None and d.match == 1.0


def test_ghost_strays_are_not_fills():
    from algorip.schema import Analysis
    from tests.test_generate import HOUSE

    a = HOUSE.model_copy(update={"bars": 4, "drums": {
        "bd": [(b, s) for b in range(4) for s in (0, 4, 8, 12)],
        "gh": [(b, 13) for b in range(4)] + [(2, 3), (2, 7), (2, 11)]}})
    loops = drum_loops(a)
    assert loops.voices["gh"].templates == [{13}]
    assert loops.fill_bars is None and all(not f for f in loops.voices["gh"].fills)
