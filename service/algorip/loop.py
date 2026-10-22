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
only when it explains RESIDUAL_GAIN of what the shorter leaves unexplained and does more than add to
it in a minority of phases (an alternation is a two-bar loop; a varying beat or a phrase-end fill is
not). Every bar's steps beyond its template, core bars included, form the variation (`extra`): one
short loop when every adding bar contains it at its own phase of the clip, else one phase per bar,
verbatim, like the drum fills.
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
RESIDUAL_GAIN = 0.5  # a longer period must explain this share of what the shorter one leaves unexplained
LOOP_PERIODS = (1, 2, 4, 8)
VARIATION_PERIODS = (1, 2, 4)  # a variation shared by the adding bars is written as a loop this short
_EPS = 1e-9


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
    best = _best_period(bars, periods)
    if best is None:
        return None
    period, (templates, core, clean, deviating) = best
    heard = [bars]
    heard_templates = [templates]
    if sounding is not None:
        heard.append(sounding)
        heard_templates.append(_vote_of(sounding, clean, period))
    extra, extra_from, extra_bars = _variation(heard, heard_templates)
    return Loop(period, templates, core, clean, deviating, extra, extra_from, extra_bars)


# A period's reading of the bars: templates, core, clean (the template's voters) and deviating bar indexes.
Candidate = tuple[list[dict[int, H]], list[int], list[int], list[int]]


def _best_period(bars: list[dict[int, H]], periods: tuple[int, ...]) -> tuple[int, Candidate[H]] | None:
    """The shortest period the bars loop at, unless a longer one earns its length (see `_earns_its_length`)."""
    best: tuple[float, int, Candidate[H]] | None = None
    for period in periods:
        cand = _loop_at(bars, period)
        if cand is None:
            continue
        explained = _explained(bars, cand[0])
        if best is None or _earns_its_length(best[0], best[2][0], period, cand[0], explained):
            best = (explained, period, cand)
    return None if best is None else (best[1], best[2])


def _earns_its_length(
    short_explained: float, short: list[dict[int, H]], period: int, templates: list[dict[int, H]], explained: float
) -> bool:
    """Whether a longer period's reading replaces the shorter one's.

    Phases that only add to the shorter loop, in a minority of phases, are a fill or a variation on it,
    never a longer loop; a phase that drops something the shorter loop claims is a correction and counts.
    Beyond that it must explain at least RESIDUAL_GAIN of what the shorter loop leaves unexplained (an
    alternation of one note is still an alternation).
    """
    additions = corrections = 0
    for phase in range(period):
        own, shorter = templates[phase], short[phase % len(short)]
        if own == shorter:
            continue
        if all(own.get(step) == value for step, value in shorter.items()):
            additions += 1
        else:
            corrections += 1
    if corrections == 0 and 2 * additions < period:
        return False
    return explained - short_explained >= RESIDUAL_GAIN * (1 - short_explained) - _EPS


def _loop_at(bars: list[dict[int, H]], period: int) -> Candidate[H] | None:
    """The bars' reading at one period, or None when they do not loop at it.

    The first vote is over every bar: a step most bars play is in the loop, and the bars lacking it are
    dropouts (so a clip whose build outnumbers its clean bars reads the build as the loop; the majority
    decides). When that vote settles on no loop, a vote over the sparsest half seeds a second try, which
    counts only if a majority of bars contain what it finds (Solomun 36:40's open hats: the full vote fails
    the core share, the sparse one finds the three-hit bar the busier bars contain).
    """
    if len(bars) < 2 * period:  # one voter per phase is a bar nobody repeated
        return None
    cand = _settle(bars, vote(bars, period), period)
    if cand is not None:
        return cand
    cand = _settle(bars, _vote_of(bars, _sparsest(bars, period), period), period)
    if cand is None or 2 * len(cand[1]) <= len(bars):
        return None
    return cand


def _settle(bars: list[dict[int, H]], first: list[dict[int, H]], period: int) -> Candidate[H] | None:
    """The two-pass vote from a first template: core by containment, the cleanest core bars re-vote, split again."""
    if not any(first):  # nothing repeats at this period: not a loop of silence
        return None
    core, _ = _split(bars, first)
    if _phase_unplayed(bars, first, core):
        return None
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


def _lower_half(scores: dict[int, int]) -> list[int]:
    """The indexes scoring at or under the lower half's top score: at least half of them, ties included."""
    counts = sorted(scores.values())
    cutoff = counts[max(0, len(counts) // 2 - 1)]
    return [i for i, n in scores.items() if n <= cutoff]


def _sparsest(bars: list[dict[int, H]], period: int) -> list[int]:
    """Each phase's bars with the fewest steps (the lower half), the seed a build cannot outvote."""
    voters: list[int] = []
    for phase in range(period):
        voters.extend(_lower_half({i: len(bars[i]) for i in range(phase, len(bars), period)}))
    return sorted(voters)


def _cleanest(bars: list[dict[int, H]], templates: list[dict[int, H]], core: list[int], period: int) -> list[int]:
    """Each phase's core bars that add the least beyond the first vote (the lower half), the template's voters.

    Voting over every core bar would let a build that is longer than the loop outvote it; the bars with
    the fewest extra steps are the loop as the track states it.
    """
    clean: list[int] = []
    for phase in range(period):
        template = templates[phase]
        extra = {i: len([s for s in bars[i] if template.get(s) != bars[i][s]]) for i in core if i % period == phase}
        clean.extend(_lower_half(extra))
    return sorted(clean)


def _variation(
    heard: list[list[dict[int, H]]], templates: list[list[dict[int, H]]]
) -> tuple[list[dict[int, H]] | None, list[list[int]] | None, tuple[int, int] | None]:
    """Every bar's material beyond its template: each kind of hearing (starts, sounding) against its own template.

    A bar adding fewer than VARIATION_MIN_STEPS adds a stray, which is dropped (as a drum bar under the
    fills threshold is); None when what is left is under LAYER_MIN_STEPS in all. When the adding bars all
    contain one variation of their own (a build repeated as is, or alternating), that short loop is the
    variation, voted at the bars' own phases of the clip so it is written where they are; otherwise (a
    gradual fill) it is one phase per clip bar, verbatim. The bounds are the bars that add a variation,
    or None when none does.
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
    compact = _shared_variation(extras, adding)
    if compact is not None:
        return compact[0], compact[1], bounds
    return extras, [[i] for i in range(n)], bounds


def _shared_variation(
    extras: list[dict[int, H]], adding: list[int]
) -> tuple[list[dict[int, H]], list[list[int]]] | None:
    """The one short loop every adding bar contains at its clip phase, with only strays beyond it; None when they differ.

    The loop's steps promise 80% containment (LOOP_AGREE), so a step some adding bar lacks can be written;
    muted, that is harmless.
    """
    for period in VARIATION_PERIODS:
        if len(adding) < 2 * period:
            continue
        phases = [[i for i in adding if i % period == phase] for phase in range(period)]
        templates = [_majority([extras[i] for i in ph]) for ph in phases]
        if not any(templates):
            continue
        if any(agreement(extras[i], templates[i % period]) < LOOP_AGREE for i in adding):
            continue
        beyond = [len([s for s in extras[i] if templates[i % period].get(s) != extras[i][s]]) for i in adding]
        if all(b < VARIATION_MIN_STEPS for b in beyond):
            return templates, phases
    return None
