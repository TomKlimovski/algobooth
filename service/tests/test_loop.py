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
