"""Deterministic Strudel code from an analysis and a sound choice: a thin assembly over mini.py."""

import math

from algorip.drumloop import VOICE_LINES, drum_loops
from algorip.mini import bar_mini, cycle, fold_octaves, loop_mini, notes_mini
from algorip.schema import Analysis, SoundChoice


def fmt_time(seconds: float) -> str:
    """Whole seconds (floored) as m:ss, or h:mm:ss from an hour."""
    total = math.floor(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def drum_lines(a: Analysis, s: SoundChoice) -> list[str]:
    """Each drum voice's loop on its line; every hit a loop does not play on a muted fills line after them."""
    loops = drum_loops(a)
    names = {"sd": s.snare_name}
    lines = []
    for label, voices in VOICE_LINES.items():
        parts = [
            cycle([bar_mini(names.get(voice, voice), t) for t in loop.templates])
            for voice in voices
            if (loop := loops.voices.get(voice)) is not None and any(loop.templates)
        ]
        if parts:
            lines.append(f'{label}: s("{", ".join(parts)}").bank("{s.drum_bank}")')
    if loops.fill_bars is not None:
        lo, hi = loops.fill_bars
        fills = [
            cycle([bar_mini(names.get(voice, voice), f) for f in loop.fills])
            for voices in VOICE_LINES.values()
            for voice in voices
            if (loop := loops.voices.get(voice)) is not None and any(loop.fills)
        ]
        lines.append(f"// bars {lo}–{hi} add these hits (a fill): remove the underscore to hear them")
        lines.append(f'_fills: s("{", ".join(fills)}").bank("{s.drum_bank}")')
    return lines


def bass_lines(a: Analysis, s: SoundChoice) -> list[str]:
    """The bass voice: the loop's phases when one was found, else the consensus line; a muted layer after it."""
    if not a.bass:
        return []
    suffix = f".lpf({s.bass_lpf})" if s.bass_lpf is not None else ""
    # the measured gate, when the stem's notes die before their end; a held bass gets none
    e = s.bass_envelope
    if e is not None:
        suffix += f".attack({e.attack:g})" + (f".clip({e.clip:g})" if e.clip is not None else "") + f".release({e.release:g})"
    loop = a.bass_loop
    if loop is None:
        return [f'bass: note("{notes_mini(fold_octaves(a.bass), a.bars)}").s("{s.bass_sound}"){suffix}']
    lines = [f'bass: note("{loop_mini(loop.templates)}").s("{s.bass_sound}"){suffix}']
    if loop.layer is not None and loop.layer_bars is not None:
        lo, hi = loop.layer_bars
        lines.append(
            f"// bars {lo}–{hi} add this under the bass (a variation): remove the underscore to hear it "
            f"(match {loop.match:.2f} without, {loop.match_with_layer:.2f} with)"
        )
        lines.append(f'_bass2: note("{loop_mini(loop.layer)}").s("{s.bass_sound}"){suffix}.gain(0.6)')
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
    body = drum_lines(a, s)
    body.extend(bass_lines(a, s))
    if a.chords:
        body.append(
            f'chords: chord("{cycle(a.chords)}").voicing().s("{s.chord_sound}")'
            f".lpf({s.chord_lpf}).room({s.room}).gain(0.6)"
        )
    if a.melody:  # None (no melody stem) or an empty line: no melody voice
        body.append(f'melody: note("{notes_mini(a.melody, a.bars)}").s("triangle").gain(0.5)')
    return "\n".join(head + body) + "\n"
