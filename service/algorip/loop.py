"""The period a line's bars repeat at, found by a two-pass majority vote, and the variation on top of it.

Bars are dicts of step -> hashable value, as in mini.consensus. For each period, shortest first, the
bars vote a template per phase (a step is kept when a strict majority of that phase's bars have it
with that value). A first vote over every bar picks the core: the bars that contain their template,
that is, play what the loop plays, whatever else they add. Voting again over the core alone gives the
real template, so bars that do not belong (a bar that drops half the loop) neither veto the loop nor
pollute its template. Containment rather than a ratio over every occupied step is what lets a sparse
line keep its loop: one extra onset in a three-onset bar is a quarter of the steps but none of the
loop. Containment alone would make every period 1 (whatever bars share is "the loop" and the rest
variation), so two more rules hold it: the template is voted by the cleanest core bars (those adding
the least, so a long build cannot outvote a short loop), and a longer period replaces a shorter one
only when it explains at least LOOP_GAIN more of the steps (an alternation is a two-bar loop, a
varying beat is not). Every bar's steps beyond its template, core bars included, form the variation
(`extra`), kept per bar at its own position like the drum fills; it is not folded into a loop of its
own, since the majority of a variation can hide the build it carries.
"""

from collections import Counter
from collections.abc import Hashable
from dataclasses import dataclass
from typing import Generic, TypeVar

H = TypeVar("H", bound=Hashable)

LOOP_AGREE = 0.8  # share of its template's steps a bar must play to belong to the core
LOOP_CORE_SHARE = 0.4  # the core must be at least this share of all bars...
LOOP_MIN_CORE = 2  # ...and at least this many bars
VARIATION_MIN_STEPS = 2  # a bar adding fewer steps than this adds a stray, not a variation
LAYER_MIN_STEPS = 4  # fewer extra steps than this over the whole clip is no variation at all
LOOP_GAIN = 0.2  # a longer period must explain this much more of the steps to replace a shorter one
LOOP_PERIODS = (1, 2, 4, 8)
VARIATION_PERIODS = (1, 2, 4)  # a variation shared by the adding bars is written as a loop this short


@dataclass
class Loop(Generic[H]):
    period: int
    templates: list[dict[int, H]]  # one per phase
    core: list[int]  # bar indexes containing their template
    clean: list[int]  # the core bars that voted the template: the ones adding the least
    deviating: list[int]
    extra: list[dict[int, H]] | None  # the variation: one dict per phase of its own period (see extra_from)
    extra_from: list[list[int]] | None  # per phase of `extra`, the bars it was drawn from
    extra_bars: tuple[int, int] | None  # 0-based inclusive range of the bars that add a variation


def agreement(bar: dict[int, H], template: dict[int, H]) -> float:
    """The share of the template's steps on which the bar holds the same value (containment); 1.0 for an empty template."""
    if not template:
        return 1.0
    return sum(bar.get(step) == value for step, value in template.items()) / len(template)


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
    """The loop the bars' starts repeat at, and the variation every bar adds to it.

    sounding, when given, is one dict per bar of the value sounding on each step; the variation is then
    measured on those as well as on the starts (see the module docstring).
    """
    best: tuple[float, int, list[dict[int, H]], list[int], list[int], list[int]] | None = None
    for period in periods:
        found = _loop_at(bars, period)
        if found is None:
            continue
        explained = _explained(bars, found[0])
        # shortest first: a longer period has to earn its length
        if best is None or explained >= best[0] + LOOP_GAIN:
            best = (explained, period, *found)
    if best is None:
        return None
    _, period, templates, core, clean, deviating = best
    heard = [bars]
    heard_templates = [templates]
    if sounding is not None:
        heard.append(sounding)
        heard_templates.append(_vote_of(sounding, clean, period))
    extra, extra_from, extra_bars = _variation(heard, heard_templates)
    return Loop(period, templates, core, clean, deviating, extra, extra_from, extra_bars)


def _loop_at(bars: list[dict[int, H]], period: int) -> tuple[list[dict[int, H]], list[int], list[int], list[int]] | None:
    """The templates, core, clean and deviating bars at one period, or None when the bars do not loop at it."""
    if len(bars) < 2 * period:  # one voter per phase is a bar nobody repeated
        return None
    first = vote(bars, period)
    if not any(first):  # nothing repeats at this period: not a loop of silence
        return None
    core, _ = _split(bars, first)
    if _phase_unplayed(bars, first, core):
        return None
    # second pass: the cleanest core bars of each phase vote the real template
    clean = _cleanest(bars, first, core, period)
    templates = _vote_of(bars, clean, period)
    if not any(templates):
        return None
    core, deviating = _split(bars, templates)
    if len(core) < max(LOOP_MIN_CORE, LOOP_CORE_SHARE * len(bars)):
        return None
    if _phase_unplayed(bars, templates, core):
        return None
    return templates, core, clean, deviating


def _phase_unplayed(bars: list[dict[int, H]], templates: list[dict[int, H]], core: list[int]) -> bool:
    """Whether some phase is not a loop: no core bar at it, or an empty template while its bars have steps."""
    period = len(templates)
    for phase, template in enumerate(templates):
        at_phase = range(phase, len(bars), period)
        if not any(i in core for i in at_phase):
            return True
        if not template and any(bars[i] for i in at_phase):
            return True
    return False


def _explained(bars: list[dict[int, H]], templates: list[dict[int, H]]) -> float:
    """The share of the steps the bars play and the templates claim that both agree on.

    A template step a bar lacks counts against the loop as much as a bar step the template lacks, so a
    hat every fourth bar is not read as one every second bar with half its bars dropping out.
    """
    period = len(templates)
    hit = lacking = 0
    for i, bar in enumerate(bars):
        for step, value in templates[i % period].items():
            if bar.get(step) == value:
                hit += 1
            else:
                lacking += 1
    total = sum(len(bar) for bar in bars) + lacking
    return hit / total if total else 0.0


def _vote_of(bars: list[dict[int, H]], voters: list[int], period: int) -> list[dict[int, H]]:
    return [_majority([bars[i] for i in voters if i % period == phase]) for phase in range(period)]


def _cleanest(bars: list[dict[int, H]], templates: list[dict[int, H]], core: list[int], period: int) -> list[int]:
    """Each phase's core bars that add the least beyond the first vote: at least half of them, the median extra count and under.

    Voting over every core bar would let a build that is longer than the loop outvote it; the bars with
    the fewest extra steps are the loop as the track states it.
    """
    clean: list[int] = []
    for phase in range(period):
        at_phase = [i for i in core if i % period == phase]
        template = templates[phase]
        extra = {i: len([s for s in bars[i] if template.get(s) != bars[i][s]]) for i in at_phase}
        counts = sorted(extra.values())
        cutoff = counts[(len(counts) - 1) // 2]  # the median: at least half the bars qualify
        clean.extend(i for i in at_phase if extra[i] <= cutoff)
    return sorted(clean)


def _variation(
    heard: list[list[dict[int, H]]], templates: list[list[dict[int, H]]]
) -> tuple[list[dict[int, H]] | None, list[list[int]] | None, tuple[int, int] | None]:
    """Every bar's material beyond its template: each kind of hearing (starts, sounding) against its own template.

    A bar adding fewer than VARIATION_MIN_STEPS adds a stray, which is dropped (as a drum bar under the
    fills threshold is); None when what is left is under LAYER_MIN_STEPS in all. When the adding bars all
    contain one variation of their own (a build repeated as is, or alternating), that short loop is the
    variation, drawn from those bars; otherwise (a gradual fill) it is one phase per clip bar, verbatim.
    The bounds are the bars that add a variation, or None when none does.
    """
    n = len(heard[0])
    extras = [
        {
            step: value
            for bars, phases in zip(heard, templates)
            for step, value in bars[i].items()
            if phases[i % len(phases)].get(step) != value
        }
        for i in range(n)
    ]
    extras = [e if len(e) >= VARIATION_MIN_STEPS else {} for e in extras]
    adding = [i for i, e in enumerate(extras) if e]
    if not adding:
        return None, None, None
    bounds = (min(adding), max(adding))
    if sum(len(e) for e in extras) < LAYER_MIN_STEPS:
        return None, None, bounds
    compact = _shared_variation([extras[i] for i in adding])
    if compact is not None:
        period = len(compact)
        return compact, [adding[phase::period] for phase in range(period)], bounds
    return extras, [[i] for i in range(n)], bounds


def _shared_variation(added: list[dict[int, H]]) -> list[dict[int, H]] | None:
    """The one short loop every adding bar contains, with nothing but strays beyond it; None when they differ."""
    for period in VARIATION_PERIODS:
        found = _loop_at(added, period)
        if found is None:
            continue
        templates, _, _, deviating = found
        if deviating:
            continue
        beyond = [len([s for s in bar if templates[i % period].get(s) != bar[s]]) for i, bar in enumerate(added)]
        if all(b < VARIATION_MIN_STEPS for b in beyond):
            return templates
    return None
