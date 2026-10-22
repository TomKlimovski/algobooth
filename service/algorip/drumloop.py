"""Each drum voice as a loop, with the hits the loop does not play kept as per-bar fills.

The voices' (bar, step) hits go through loop.find_loop as the bass does, so bars that differ neither
veto the loop nor pollute it. Every bar's hits beyond its phase template are fills, core bars included:
the main line is exactly the loop and nothing the classifier heard is lost. Fills are kept per bar,
at their own position, rather than as find_loop's layer, so a one-off fill or a phrase-end fill stays
in its bar.

A loop with an empty phase over bars that do have hits is refused by find_loop itself, so a voice
either loops (open hats every fourth bar are a period-4 loop with three silent phases) or, when nothing
repeats over more than one bar, has no regular part: no main line, every hit a fill at its bar. A
one-bar clip is its own loop.
"""

from dataclasses import dataclass

from algorip.loop import find_loop
from algorip.schema import Analysis

VOICE_LINES: dict[str, tuple[str, ...]] = {"drums": ("bd", "sd"), "hats": ("hh", "oh")}

# A bar's strays over the voices that have a loop are written as a fill only from this many hits; below it
# they are dropped from the fills line (they still count as unplayed in `match`). Set on Solomun, where the
# kick and clap stray 4, 2, 1, 2, 1, 2, 2, 1, 1 times per bar: 3 keeps the bar-1 pickup only. A voice with no
# regular part has no loop to stray from, so every hit of it stays a fill.
FILL_MIN_HITS = 3


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


def _loop(period: int, templates: list[set[int]], bars: list[set[int]]) -> VoiceLoop:
    return VoiceLoop(period, templates, [bar - templates[i % period] for i, bar in enumerate(bars)])


def voice_loop(bars: list[set[int]]) -> VoiceLoop:
    """One voice's loop over its bars of steps hit."""
    steps = [dict.fromkeys(bar, True) for bar in bars]
    found = find_loop(steps)
    if found is None:
        if len(bars) == 1:  # one bar is its own loop
            return _loop(1, [set(bars[0])], bars)
        return _loop(1, [set()], bars)  # nothing repeats: no regular part, every hit a fill
    return _loop(found.period, [set(t) for t in found.templates], bars)


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
    looped = [v for v in voices.values() if any(v.templates)]
    for b in range(a.bars):
        if sum(len(v.fills[b]) for v in looped) < FILL_MIN_HITS:
            for v in looped:
                v.fills[b] = set()
    filled = [b for v in voices.values() for b, fill in enumerate(v.fills) if fill]
    fill_bars = (min(filled) + 1, max(filled) + 1) if filled else None
    return DrumLoops(voices, fill_bars, _f1(played, heard))
