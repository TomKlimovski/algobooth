"""Deterministic Strudel code from an analysis and a sound choice: a thin assembly over mini.py."""

import math

from algorip.drumloop import VOICE_LINES, drum_loops
from algorip.mini import bar_mini, cycle, fold_octaves, loop_mini, notes_mini
from algorip.schema import Analysis, SoundChoice

LAYER_GAIN = 0.75  # the muted bass layer under the loop, as a share of the bass's own gain
FM_DECAY = 0.1  # seconds: a sine bass's FM fades this fast, so only the attack carries its harmonics
PAD_VOICES = ".unison(5).detune(0.2)"  # the supersaw as a pad: five detuned saws per note
# The sidechain: the kick ducks the deck's lane 2, where the bass and chords play (engine/lanes.ts), by the middle of
# the house examples' settings (attack 0.1 to 0.2 s, depth 0.5 to 0.8; Strudel's default depth 1 silences the lane).
DUCK = ".duckorbit(2).duckattack(0.15).duckdepth(0.6)"
LANE = ".orbit(2)"


def fmt_time(seconds: float) -> str:
    """Whole seconds (floored) as m:ss, or h:mm:ss from an hour."""
    total = math.floor(seconds)
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _voice_name(voice: str, s: SoundChoice) -> str:
    """The sample a voice plays, with the bank index inline (Strudel's `bd:3`) when the shape chose one."""
    base = s.snare_name if voice == "sd" else "hh" if voice == "gh" else voice
    n = s.drum_samples.get(voice)
    return f"{base}:{n}" if n else base


def drum_lines(a: Analysis, s: SoundChoice, duck: str = "") -> list[str]:
    """One line per drum voice (its loop, the bank, its gain, `duck` on the kick's); every hit a loop does not play on a muted fills line after them."""
    loops = drum_loops(a)
    lines = []
    for label, voices in VOICE_LINES.items():
        present = [v for v in voices if (loop := loops.voices.get(v)) is not None and any(loop.templates)]
        if not present:
            continue
        parts = [cycle([bar_mini(_voice_name(v, s), t) for t in loops.voices[v].templates]) for v in present]
        if label == "snare" and s.snare_name == "cp":
            label = "claps"
        main = max(present, key=lambda v: len(a.drums.get(v, [])))  # a line with two voices takes the busier one's gain
        gain = s.drum_gains.get(main)
        lines.append(f'{label}: s("{", ".join(parts)}").bank("{s.drum_bank}")' + (f".gain({gain:g})" if gain is not None else "")
                     + (duck if label == "drums" else ""))
    if loops.fill_bars is not None:
        lo, hi = loops.fill_bars
        fills = [
            cycle([bar_mini(_voice_name(voice, s), f) for f in loop.fills])
            for voices in VOICE_LINES.values()
            for voice in voices
            if (loop := loops.voices.get(voice)) is not None and any(loop.fills)
        ]
        lines.append(f"// bars {lo}–{hi} add these hits (a fill): remove the underscore to hear them")
        lines.append(f'_fills: s("{", ".join(fills)}").bank("{s.drum_bank}")')
    return lines


def bass_lines(a: Analysis, s: SoundChoice, lane: str = "") -> list[str]:
    """The bass voice: the loop's phases when one was found, else the consensus line; a muted layer after it; `lane` last."""
    if not a.bass:
        return []
    suffix = f".fm({s.bass_fm:g}).fmdecay({FM_DECAY:g})" if s.bass_fm is not None else ""
    if s.bass_lpf is not None:
        suffix += f".lpf({s.bass_lpf})"
    # the filter's opening and closing, measured on the stem, when it moves at least an octave
    f = s.bass_filter_env
    if f is not None and s.bass_lpf is not None:
        suffix += f".lpenv({f.octaves:g}).lpdecay({f.close:g}).lpsustain(0)"
    # the measured gate, when the stem's notes die before their end; a held bass gets none
    e = s.bass_envelope
    if e is not None:
        suffix += f".attack({e.attack:g})" + (f".clip({e.clip:g})" if e.clip is not None else "") + f".release({e.release:g})"
    # the level wobble the notes carry, as a tremolo
    tr = s.bass_tremolo
    if tr is not None:
        suffix += f".tremolo({tr.rate:g}).tremolodepth({tr.depth:g})"
    if s.bass_shape is not None:
        suffix += f".shape({s.bass_shape:g})"
    gain = (f".gain({s.bass_gain:g})" if s.bass_gain is not None else "") + lane
    loop = a.bass_loop
    if loop is None:
        return [f'bass: note("{notes_mini(fold_octaves(a.bass), a.bars)}").s("{s.bass_sound}"){suffix}{gain}']
    lines = [f'bass: note("{loop_mini(loop.templates)}").s("{s.bass_sound}"){suffix}{gain}']
    if loop.layer is not None and loop.layer_bars is not None:
        lo, hi = loop.layer_bars
        lines.append(
            f"// bars {lo}–{hi} add this under the bass (a variation): remove the underscore to hear it "
            f"(match {loop.match:.2f} without, {loop.match_with_layer:.2f} with)"
        )
        layer_gain = round((s.bass_gain if s.bass_gain is not None else 0.8) * LAYER_GAIN, 2)
        lines.append(f'_bass2: note("{loop_mini(loop.layer)}").s("{s.bass_sound}"){suffix}.gain({layer_gain:g}){lane}')
    return lines


def _instrument(s: SoundChoice) -> str:
    """The "other" stem's instrument as written on the chords and melody: the sound, a pad's voices, its lowpass."""
    voices = PAD_VOICES if s.chord_sound == "supersaw" else ""
    lpf = f".lpf({s.chord_lpf})" if s.chord_lpf is not None else ""
    return f'.s("{s.chord_sound}"){voices}{lpf}'


def _chord_line(name: str, chords: list[str], s: SoundChoice, lane: str) -> str:
    """A chord voice: one helper so `chords:` and `_triads:` cannot drift apart."""
    return f'{name}: chord("{cycle(chords)}").voicing(){_instrument(s)}.room({s.room:g}).gain({s.chord_gain:g}){lane}'


def generate(a: Analysis, s: SoundChoice, title: str, start: float, end: float) -> str:
    cpm = round(a.bpm)
    head = [
        f"// {title} {fmt_time(start)} to {fmt_time(end)} · {cpm} cpm · {a.key} · {a.bars} bar{'' if a.bars == 1 else 's'}",
        f"setcpm({cpm}/4)",
        "",
    ]
    # Each part is a named pattern (`bass: ...` rather than `$: ...`), matching the stems it was transcribed
    # from: a name can be muted by writing `_bass:` in front of it, the way a stem button isolates a part.
    # The sidechain only when there is a kick to duck with and a bass or chords line to duck.
    kick = any(line.startswith("drums:") for line in drum_lines(a, s))
    side = kick and bool(a.bass or a.chords)
    lane = LANE if side else ""
    body = drum_lines(a, s, DUCK if side else "")
    body.extend(bass_lines(a, s, lane))
    if a.chords:
        body.append(_chord_line("chords", a.chords, s, lane))
    if a.melody:  # None (no melody stem) or an empty line: no melody voice
        body.append(f'melody: note("{notes_mini(a.melody, a.bars)}"){_instrument(s)}.gain({s.melody_gain:g})')
    # The chords as heard, muted: unmute `_triads:` to hear the stem's own. It goes last, not under `chords:`,
    # because every named line takes a key on the method keyboard's line row (7 slots, the rest dropped): an A/B
    # line must not push `melody:` off it.
    if a.chords and a.heard_chords and a.heard_chords != a.chords:
        body.append(_chord_line("_triads", a.heard_chords, s, lane))
    return "\n".join(head + body) + "\n"
