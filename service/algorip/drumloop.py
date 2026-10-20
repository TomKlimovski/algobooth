"""Each drum voice as a loop, with the hits the loop does not play kept as per-bar fills.

The voices' (bar, step) hits go through loop.find_loop as the bass does, so bars that differ neither
veto the loop nor pollute it. Every bar's hits beyond its phase template are fills, core bars included:
the main line is exactly the loop and nothing the classifier heard is lost. Fills are kept per bar,
at their own position, rather than as find_loop's layer, so a one-off fill or a phrase-end fill stays
in its bar.

A drum voice differs from the bass in one way: a phase template with no hits, while that phase's bars
do have some (open hats every fourth bar vote a period-4 loop with three silent bars), is not a loop.
When the found loop has such an empty phase, the voice's loop is its one-bar majority vote instead
(find_loop already tried the shorter periods, so there is nothing to retry), and the hits off it are fills. When that vote is empty too, the voice has no
regular part and every hit is a fill. This rule lives here so the bass is untouched.
"""

from dataclasses import dataclass

from algorip.loop import Loop, find_loop, vote
from algorip.schema import Analysis

VOICE_LINES: dict[str, tuple[str, ...]] = {"drums": ("bd", "sd"), "hats": ("hh", "oh")}


@dataclass
class VoiceLoop:
    period: int
    templates: list[set[int]]  # one per phase; all empty when the voice has no regular part
    fills: list[set[int]]  # one per clip bar: hits the loop does not play there


@dataclass
class DrumLoops:
    voices: dict[str, VoiceLoop]  # only voices with any hit
    fill_bars: tuple[int, int] | None  # 1-based inclusive, over all voices; None when no fills
    match: float  # F1 of the hits the loops play against the classified hits


def _has_empty_phase(found: Loop[bool], bars: list[set[int]]) -> bool:
    return any(
        not template and any(bars[i] for i in range(phase, len(bars), found.period))
        for phase, template in enumerate(found.templates)
    )


def _loop(period: int, templates: list[set[int]], bars: list[set[int]]) -> VoiceLoop:
    return VoiceLoop(period, templates, [bar - templates[i % period] for i, bar in enumerate(bars)])


def voice_loop(bars: list[set[int]]) -> VoiceLoop:
    """One voice's loop over its bars of steps hit."""
    steps = [dict.fromkeys(bar, True) for bar in bars]
    found = find_loop(steps)
    if found is None:  # nothing repeats, or the clip is too short: the bars as heard
        return _loop(len(bars), [set(bar) for bar in bars], bars)
    # the spec's retry over shorter periods is vacuous: find_loop returns the shortest qualifying period
    if not _has_empty_phase(found, bars):
        return _loop(found.period, [set(t) for t in found.templates], bars)
    # the one-bar vote; when it is empty the voice has no regular part and every hit is a fill
    return _loop(1, [set(vote(steps, 1)[0])], bars)


def _f1(played: set[tuple[str, int, int]], heard: set[tuple[str, int, int]]) -> float:
    if not played and not heard:
        return 1.0
    return round(2 * len(played & heard) / (len(played) + len(heard)), 2)


def drum_loops(a: Analysis) -> DrumLoops:
    """Every voice with hits as a loop, the bars any voice fills, and how much of the hits the loops play."""
    voices: dict[str, VoiceLoop] = {}
    played: set[tuple[str, int, int]] = set()
    heard: set[tuple[str, int, int]] = set()
    for voice, all_hits in a.drums.items():
        hits = [(bar, step) for bar, step in all_hits if 0 <= bar < a.bars]  # as generate._bars
        if not hits:
            continue
        bars: list[set[int]] = [set() for _ in range(a.bars)]
        for bar, step in hits:
            bars[bar].add(step)
            heard.add((voice, bar, step))
        v = voices[voice] = voice_loop(bars)
        played |= {(voice, b, s) for b in range(a.bars) for s in v.templates[b % v.period]}
    filled = [b for v in voices.values() for b, fill in enumerate(v.fills) if fill]
    fill_bars = (min(filled) + 1, max(filled) + 1) if filled else None
    return DrumLoops(voices, fill_bars, _f1(played, heard))
