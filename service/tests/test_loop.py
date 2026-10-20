import pytest

from algorip.loop import agreement, find_loop, vote

SOLOMUN = {2: 7, 3: 7, 5: 7, 7: 7, 10: 7, 11: 7, 13: 7, 14: 7, 15: 7}
BUILD = [{**SOLOMUN, 4: 7, 8: 7, 12: 7}, {**SOLOMUN, 0: 7, 8: 7, 12: 9}, {s: 7 for s in range(16)}, {s: 7 for s in range(16)}, {s: 7 for s in range(16)}]


def test_a_one_bar_loop_survives_five_build_bars():
    loop = find_loop([SOLOMUN] * 4 + BUILD)
    assert loop.period == 1 and loop.templates == [SOLOMUN]
    assert loop.core == [0, 1, 2, 3] and loop.deviating == [4, 5, 6, 7, 8] and loop.extra_bars == (4, 8)
    assert loop.extra is not None and set(loop.extra[0]) >= {0, 1, 4, 6, 8, 9, 12}


def test_a_two_bar_loop():
    a, b = {0: 0, 8: 7}, {0: 5, 8: 7}
    loop = find_loop([a, b, a, b, a, b])
    assert loop.period == 2 and loop.templates == [a, b] and loop.deviating == [] and loop.extra is None


def test_no_loop_when_bars_do_not_repeat_or_there_are_too_few():
    assert find_loop([{0: 0}, {0: 2}, {0: 4}, {0: 5}]) is None
    assert find_loop([SOLOMUN]) is None


def test_a_stray_hit_is_tolerated_without_becoming_a_layer():
    bars = [SOLOMUN, {**SOLOMUN, 9: 7}, SOLOMUN, SOLOMUN]
    loop = find_loop(bars)
    assert loop.templates == [SOLOMUN] and loop.core == [0, 1, 2, 3] and loop.extra is None


def test_agreement_and_vote():
    assert agreement({0: 1, 4: 1}, {0: 1, 8: 1}) == pytest.approx(1 / 3)
    assert vote([{0: 1}, {0: 1}, {0: 2}], 1) == [{0: 1}]


def test_a_period_whose_phase_has_no_core_bar_after_the_second_vote_is_not_a_loop():
    # Phase 0's first vote keeps bars 0 and 2 (each misses one of 4/8 and adds 9); their own vote drops
    # 4 and 8, and against that template neither reaches 0.8, so phase 0 ends with no core bar.
    drifting = [{0: 4, 8: 4, 9: 4, 12: 4}, {0: 4, 4: 4, 9: 4, 12: 4}, {0: 4, 2: 4, 4: 4, 8: 4, 10: 4, 12: 4}]
    b = {0: 9, 8: 9}
    # Period 1 fails, period 2 is refused, and six bars are too few for period 4.
    assert find_loop([drifting[0], b, drifting[1], b, drifting[2], b]) is None
