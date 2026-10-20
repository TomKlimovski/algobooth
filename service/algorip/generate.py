"""Deterministic Strudel code from an analysis and a sound choice: a thin assembly over mini.py."""

import math

from algorip.mini import cycle, fold_octaves, loop_mini, notes_mini, voice_mini
from algorip.schema import Analysis, SoundChoice


def fmt_time(seconds: float) -> str:
    """Whole seconds (floored) as m:ss, or h:mm:ss from an hour."""
    total = math.floor(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _bars(a: Analysis, voice: str) -> list[set[int]]:
    bars: list[set[int]] = [set() for _ in range(a.bars)]
    for bar, step in a.drums.get(voice, []):
        if 0 <= bar < a.bars:
            bars[bar].add(step)
    return bars


def _drum_line(label: str, a: Analysis, s: SoundChoice, voices: list[tuple[str, str]]) -> str | None:
    """voices are (analysis voice, Strudel name) pairs; voices with no hits are left out."""
    parts = [voice_mini(name, _bars(a, voice)) for voice, name in voices if a.drums.get(voice)]
    if not parts:
        return None
    return f'{label}: s("{", ".join(parts)}").bank("{s.drum_bank}")'


def bass_lines(a: Analysis, s: SoundChoice) -> list[str]:
    """The bass voice: the loop's phases when one was found, else the consensus line; a muted layer after it."""
    if not a.bass:
        return []
    lpf = f".lpf({s.bass_lpf})" if s.bass_lpf is not None else ""
    loop = a.bass_loop
    if loop is None:
        return [f'bass: note("{notes_mini(fold_octaves(a.bass), a.bars)}").s("{s.bass_sound}"){lpf}']
    lines = [f'bass: note("{loop_mini(loop.templates)}").s("{s.bass_sound}"){lpf}']
    if loop.layer is not None and loop.layer_bars is not None:
        lo, hi = loop.layer_bars
        lines.append(
            f"// bars {lo}–{hi} add this under the bass (a build): remove the underscore to hear it "
            f"(match {loop.match:.2f} without, {loop.match_with_layer:.2f} with)"
        )
        lines.append(f'_bass2: note("{loop_mini(loop.layer)}").s("{s.bass_sound}"){lpf}.gain(0.6)')
    return lines


def generate(a: Analysis, s: SoundChoice, title: str, start: float, end: float) -> str:
    cpm = round(a.bpm)
    head = [
        f"// {title} {fmt_time(start)} to {fmt_time(end)} · {cpm} cpm · {a.key} · {a.bars} bar{'' if a.bars == 1 else 's'}",
        f"setcpm({cpm}/4)",
        "",
    ]
    # Each part is a named pattern (`bass: ...` rather than `$: ...`), matching the stems it was transcribed
    # from: a name can be muted by writing `_bass:` in front of it, the way a stem button isolates a part.
    body = [
        _drum_line("drums", a, s, [("bd", "bd"), ("sd", s.snare_name)]),
        _drum_line("hats", a, s, [("hh", "hh"), ("oh", "oh")]),
    ]
    body.extend(bass_lines(a, s))
    if a.chords:
        body.append(
            f'chords: chord("{cycle(a.chords)}").voicing().s("{s.chord_sound}")'
            f".lpf({s.chord_lpf}).room({s.room}).gain(0.6)"
        )
    if a.melody:  # None (no melody stem) or an empty line: no melody voice
        body.append(f'melody: note("{notes_mini(a.melody, a.bars)}").s("triangle").gain(0.5)')
    return "\n".join(head + [line for line in body if line is not None]) + "\n"
