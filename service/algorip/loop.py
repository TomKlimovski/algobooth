"""The period a line's bars repeat at, found by a two-pass majority vote, and the layer on top of it.

Bars are dicts of step -> hashable value, as in mini.consensus. For each period, shortest first, the
bars vote a template per phase (a step is kept when a strict majority of that phase's bars have it
with that value). A first vote over every bar picks the core: the bars that agree with their
template. Voting again over the core alone gives the real template, so bars that do not belong
(a build with Solomun's pattern buried in it) neither veto the loop nor pollute its template. The
bars left out are deviating; the steps they add or change form a layer, itself searched for a short
loop (periods 1, 2, 4), so a repeated build reads as a part rather than as noise.
"""

from collections import Counter
from collections.abc import Hashable
from dataclasses import dataclass
from typing import Generic, TypeVar

H = TypeVar("H", bound=Hashable)

LOOP_AGREE = 0.8  # share of occupied steps a bar must agree on to belong to the core
LOOP_CORE_SHARE = 0.4  # the core must be at least this share of all bars...
LOOP_MIN_CORE = 2  # ...and at least this many bars
LAYER_MIN_STEPS = 4  # fewer extra steps per deviating bar than this is not a layer
LOOP_PERIODS = (1, 2, 4, 8)
LAYER_PERIODS = (1, 2, 4)


@dataclass
class Loop(Generic[H]):
    period: int
    templates: list[dict[int, H]]  # one per phase
    core: list[int]  # bar indexes agreeing with their template
    deviating: list[int]
    extra: list[dict[int, H]] | None  # the layer, one dict per phase of its own period
    extra_bars: tuple[int, int] | None  # 0-based inclusive range of the deviating bars


def agreement(bar: dict[int, H], template: dict[int, H]) -> float:
    """The share of steps either dict occupies on which they hold the same value."""
    occupied = set(bar) | set(template)
    if not occupied:
        return 1.0
    return sum(bar.get(step) == template.get(step) for step in occupied) / len(occupied)


def _majority(voters: list[dict[int, H]]) -> dict[int, H]:
    votes = Counter((step, value) for bar in voters for step, value in bar.items())
    return {step: value for (step, value), n in votes.items() if 2 * n > len(voters)}


def vote(bars: list[dict[int, H]], period: int) -> list[dict[int, H]]:
    """The strict-majority template of each phase."""
    return [_majority(bars[phase::period]) for phase in range(period)]


def _split(bars: list[dict[int, H]], templates: list[dict[int, H]]) -> tuple[list[int], list[int]]:
    period = len(templates)
    core, deviating = [], []
    for i, bar in enumerate(bars):
        (core if agreement(bar, templates[i % period]) >= LOOP_AGREE else deviating).append(i)
    return core, deviating


def find_loop(
    bars: list[dict[int, H]],
    periods: tuple[int, ...] = LOOP_PERIODS,
    sounding: list[dict[int, H]] | None = None,
) -> Loop[H] | None:
    """The loop the bars' starts repeat at, and the layer the deviating bars add.

    sounding, when given, is one dict per bar of the value sounding on each step; the layer is then
    measured on those as well as on the starts (see the module docstring).
    """
    for period in periods:
        if len(bars) < 2 * period:  # one voter per phase is a bar nobody repeated
            continue
        core, _ = _split(bars, vote(bars, period))
        if not core:
            continue
        # second pass: the core bars alone vote, each in its own phase
        templates = _core_vote(bars, core, period)
        core, deviating = _split(bars, templates)
        if len(core) < max(LOOP_MIN_CORE, LOOP_CORE_SHARE * len(bars)):
            continue
        # The re-split can leave a phase with no core bar (its first-pass core bars each drift from the
        # narrower second-pass template); a phase template that no core bar plays is not a loop.
        if any(not any(i % period == phase for i in core) for phase in range(period)):
            continue
        heard = [bars]
        heard_templates = [templates]
        if sounding is not None:
            heard.append(sounding)
            heard_templates.append(_core_vote(sounding, core, period))
        extra, extra_bars = _layer(heard, heard_templates, deviating)
        return Loop(period, templates, core, deviating, extra, extra_bars)
    return None


def _core_vote(bars: list[dict[int, H]], core: list[int], period: int) -> list[dict[int, H]]:
    return [_majority([bars[i] for i in core if i % period == phase]) for phase in range(period)]


def _layer(
    heard: list[list[dict[int, H]]], templates: list[list[dict[int, H]]], deviating: list[int]
) -> tuple[list[dict[int, H]] | None, tuple[int, int] | None]:
    """The deviating bars' extra material, as its own loop: each kind of hearing (starts, sounding) against its template."""
    if not deviating:
        return None, None
    extras = [
        {
            step: value
            for bars, phases in zip(heard, templates)
            for step, value in bars[i].items()
            if phases[i % len(phases)].get(step) != value
        }
        for i in deviating
    ]
    bounds = (min(deviating), max(deviating))
    if sum(len(e) for e in extras) < LAYER_MIN_STEPS * len(extras):
        return None, bounds
    found = find_loop(extras, LAYER_PERIODS)
    # No loop among the extras: they are one-off material, so there is no layer to write.
    return (found.templates if found else None), bounds
