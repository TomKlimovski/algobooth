import pytest

from algorip.loop import LAYER_MIN_STEPS, agreement, find_loop, vote

SOLOMUN = {2: 7, 3: 7, 5: 7, 7: 7, 10: 7, 11: 7, 13: 7, 14: 7, 15: 7}
BUILD = [{**SOLOMUN, 4: 7, 8: 7, 12: 7}, {**SOLOMUN, 0: 7, 8: 7, 12: 9}, {s: 7 for s in range(16)}, {s: 7 for s in range(16)}, {s: 7 for s in range(16)}]


def test_a_one_bar_loop_survives_five_build_bars():
    loop = find_loop([SOLOMUN] * 4 + BUILD)
    assert loop.period == 1 and loop.templates == [SOLOMUN]
    # the build bars contain the template, so they are core too; their extra steps are the variation
    assert loop.core == list(range(9)) and loop.deviating == [] and loop.extra_bars == (4, 8)
    # the build bars differ from each other (a gradual fill), so the variation is written per bar, verbatim
    assert loop.extra is not None and len(loop.extra) == 9 and loop.extra_from == [[i] for i in range(9)]
    assert loop.extra[:4] == [{}] * 4 and loop.extra[4] == {4: 7, 8: 7, 12: 7} and loop.extra[5] == {0: 7, 8: 7, 12: 9}
    assert set(loop.extra[6]) == set(range(16)) - set(SOLOMUN)


def test_a_variation_every_adding_bar_shares_is_written_once():
    # three identical build bars after five clean ones: the variation is one bar, drawn from bars 5 to 7
    build = {**SOLOMUN, 0: 7, 4: 7, 8: 7, 12: 7}
    loop = find_loop([SOLOMUN] * 5 + [build] * 3)
    assert loop.extra == [{0: 7, 4: 7, 8: 7, 12: 7}] and loop.extra_from == [[5, 6, 7]] and loop.extra_bars == (5, 7)
    # two variations differing in one step share the rest; the differing step is a stray, like the loop's own
    other = {**SOLOMUN, 0: 7, 4: 7, 8: 7, 12: 9}
    loop = find_loop([SOLOMUN] * 4 + [build, other] * 2)
    assert loop.extra == [{0: 7, 4: 7, 8: 7}] and loop.extra_from == [[4, 5, 6, 7]]
    # a stray on top of the shared variation in one bar does not break it: it is under the per-bar minimum
    stray = {**build, 9: 7}
    loop = find_loop([SOLOMUN] * 5 + [build, stray, build])
    assert loop.extra == [{0: 7, 4: 7, 8: 7, 12: 7}] and loop.extra_from == [[5, 6, 7]]


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
    assert loop.templates == [SOLOMUN] and loop.core == [0, 1, 2, 3] and loop.extra is None and loop.extra_bars is None


def test_agreement_is_containment_and_vote_is_a_strict_majority():
    # the share of the template's steps the bar plays: extra steps in the bar do not count against it
    assert agreement({0: 1, 4: 1}, {0: 1, 8: 1}) == pytest.approx(1 / 2)
    assert agreement({0: 1, 4: 1, 9: 1}, {0: 1, 4: 1}) == 1.0
    assert agreement({0: 1}, {}) == 1.0
    assert vote([{0: 1}, {0: 1}, {0: 2}], 1) == [{0: 1}]


def test_a_sparse_loop_with_a_varying_last_beat():
    # Solomun 48:50: three D# onsets every bar, beat 4 varying, a C# and an F added in bars 4 and 5
    d = 3
    bars = [{1: d, 4: d, 8: d, 12: d}, {1: d, 4: d, 8: d, 13: d}, {1: d, 4: d, 8: d},
            {1: d, 4: d, 6: 1, 8: d, 12: d, 14: 5}, {1: d, 4: d, 6: 1, 8: d, 13: d, 14: 5}]
    loop = find_loop(bars)
    assert loop.period == 1 and loop.templates == [{1: d, 4: d, 8: d}]
    assert loop.core == [0, 1, 2, 3, 4] and loop.deviating == []
    # a bar adding one step adds a stray (bars 1 and 2 here); bars 4 and 5 share the C# and the F, their beat-4
    # D# differs by a step and is a stray too, so the variation is one bar drawn from both
    assert loop.extra == [{6: 1, 14: 5}] and loop.extra_from == [[3, 4]] and loop.extra_bars == (3, 4)


def test_a_bar_that_drops_a_template_step_is_not_core():
    # Period 2, phase 0: each bar plays only some of the five voted steps, so none contains 80% of the template.
    dropping = [{0: 4, 9: 4, 12: 4}, {0: 4, 4: 4, 12: 4}, {4: 4, 8: 4, 9: 4}]
    b = {0: 9, 8: 9}
    # Period 1 votes nothing in common (no strict majority), period 2 has no core bar at phase 0, six bars are too few for 4.
    assert find_loop([dropping[0], b, dropping[1], b, dropping[2], b]) is None


def test_an_all_empty_template_is_not_a_loop():
    # hits in one bar only: nothing repeats, so the verbatim path (None), not a loop of silence
    assert find_loop([{0: 1, 4: 1}, {}, {}, {}]) is None


def test_the_layer_is_measured_on_sounding_steps_when_given_them():
    # The build bars add only three starts each (under LAYER_MIN_STEPS) but hold the root over the
    # rests, so what sounds and the template does not is seven steps: a layer.
    held = {**SOLOMUN, 0: 7, 8: 7, 12: 7}  # three extra starts
    sounds = {s: 7 for s in range(16)}  # ...each run to the next template note
    starts = [SOLOMUN] * 4 + [held] * 4
    sounding = [dict(SOLOMUN)] * 4 + [sounds] * 4
    without = find_loop(starts)
    # three starts a bar, twelve over the clip: enough to be a variation; identical in every adding bar, so one phase
    assert without.extra == [{0: 7, 8: 7, 12: 7}] and without.extra_from == [[4, 5, 6, 7]] and without.extra_bars == (4, 7)
    loop = find_loop(starts, sounding=sounding)
    assert loop.period == 1 and loop.templates == [SOLOMUN] and loop.core == list(range(8))
    assert loop.extra == [{s: 7 for s in range(16) if s not in SOLOMUN}] and loop.extra_from == [[4, 5, 6, 7]]
    assert len(loop.extra[0]) >= LAYER_MIN_STEPS


def test_retriggers_under_a_held_template_note_are_still_extra_material():
    # The synthetic build: the template holds the root over steps 0-7 and the build bars retrigger
    # it as 16ths, so nothing new sounds but seven starts are extra.
    root = {0: 9, 8: 0, 12: 4}
    retriggered = {**{s: 9 for s in range(8)}, 8: 0, 12: 4}
    sounds = {**{s: 9 for s in range(8)}, **{s: 0 for s in range(8, 12)}, **{s: 4 for s in range(12, 16)}}
    loop = find_loop([root] * 4 + [retriggered] * 3, sounding=[sounds] * 7)
    assert loop.extra == [{s: 9 for s in range(1, 8)}] and loop.extra_from == [[4, 5, 6]] and loop.extra_bars == (4, 6)
