"""Bass stem transcription on the step grid, the loop it repeats, and a brightness measure of the bass sound."""

import numpy as np

from algorip.bassgrid import BassGrid, bass_grid, grid_to_notes
from algorip.grid import STEPS_PER_BAR, Grid
from algorip.key import Key
from algorip.loop import find_loop
from algorip.mini import OCTAVE, one_per_step, loop_mini, template_note
from algorip.notes import Note, fold_octaves, snap_to_key
from algorip.schema import BassLoop
from algorip.score import expand, score

BASS_LOW = 24  # C1
BASS_HIGH = 60  # C4
# A candidate scoring within this of the best is close enough: among those, the shortest notation wins.
SIMPLER_TOLERANCE = 0.05


def _in_register(note: Note, key: Key) -> Note:
    snapped = snap_to_key([note], key)[0]
    return snapped.model_copy(update={"midi": fold_octaves(snapped.midi, BASS_LOW, BASS_HIGH)})


def transcribe_bass(y: np.ndarray, sr: int, grid: Grid, key: Key) -> tuple[BassGrid, list[Note]]:
    """The bass stem's step grid and its notes, both in key and folded into the bass register.

    The grid's pitches are snapped and folded like the notes so that, as the scorer's truth, it sits in
    the same register as anything written from them.
    """
    bg = bass_grid(y, sr, grid)
    notes = [_in_register(n, key) for n in grid_to_notes(bg)]

    def step_midi(m: int | None) -> int | None:
        return None if m is None else _in_register(Note(bar=0, step=0, length=1, midi=m), key).midi

    bg = bg.model_copy(update={"midi": [[step_midi(m) for m in bar] for bar in bg.midi]})
    return bg, notes


def _clip(line: list[Note]) -> list[Note]:
    """Notes in step order, each cut short where the next starts or the bar ends."""
    line = sorted(line, key=lambda n: n.step)
    ends = [n.step for n in line[1:]] + [STEPS_PER_BAR]
    return [n.model_copy(update={"length": max(1, min(n.length, end - n.step))}) for n, end in zip(line, ends)]


def _eighths(line: list[Note]) -> list[Note]:
    """Every start on an even step: an odd start moves to the even step below, or else the one above.

    Moving onto a note of the same pitch merges into it (the earlier start, the longer-reaching end);
    a note whose even neighbours both start other pitches is dropped. The note moves whole, keeping
    its length, so a late onset lands where it belongs without sounding a step longer.
    """
    placed = {n.step: n for n in line if n.step % 2 == 0}
    for note in sorted((n for n in line if n.step % 2), key=lambda n: n.step):
        # Below first: an odd start is more often a late onset than an early one.
        for target in (note.step - 1, note.step + 1):
            if target >= STEPS_PER_BAR:
                continue
            there = placed.get(target)
            if there is None:
                placed[target] = note.model_copy(update={"step": target})
            elif there.midi == note.midi:  # both now start on target: keep the longer-reaching end
                placed[target] = there.model_copy(update={"length": max(there.length, note.length)})
            else:
                continue
            break
    return _clip(list(placed.values()))


def _sustained(line: list[Note]) -> list[Note]:
    """A note merged into the one before it when it starts where that one ends, on the same midi."""
    merged: list[Note] = []
    for note in sorted(line, key=lambda n: n.step):
        prev = merged[-1] if merged else None
        if prev is not None and prev.step + prev.length == note.step and prev.midi == note.midi:
            merged[-1] = prev.model_copy(update={"length": prev.length + note.length})
        else:
            merged.append(note)
    return merged


def candidates(templates: list[list[Note]]) -> list[tuple[str, list[list[Note]]]]:
    """The loop written four ways: as heard, on the eighth grid, sustained, and both."""
    eighths = [_eighths(t) for t in templates]
    return [
        ("a", templates),
        ("b", eighths),
        ("c", [_sustained(t) for t in templates]),
        ("d", [_sustained(t) for t in eighths]),
    ]


def _phase_notes(heard: list[dict[int, Note]], templates: list[dict[int, int]]) -> list[list[Note]]:
    """Each phase's template as notes, from the bars at that phase (commonest midi and length)."""
    period = len(templates)
    return [
        [template_note(heard[phase::period], step, pc) for step, pc in sorted(template.items())]
        for phase, template in enumerate(templates)
    ]


def choose_bass_loop(bg: BassGrid, grid: Grid, notes: list[Note]) -> BassLoop | None:
    """The loop the bass repeats, written as the shortest candidate that scores near the best, and its layer.

    None when the bars do not repeat (or there is no bass).
    """
    heard = [one_per_step([n for n in notes if n.bar == b]) for b in range(grid.bars)]
    loop = find_loop([{step: n.midi % OCTAVE for step, n in bar.items()} for bar in heard])
    if loop is None or not any(loop.templates):
        return None  # no repeat, or the only thing that repeats is silence (a silent stem)
    # Only the core bars name the template's notes; a build must not pick their midi or length.
    core = [heard[i] if i in loop.core else {} for i in range(grid.bars)]
    templates = _phase_notes(core, loop.templates)

    best_match, chosen = None, []
    for letter, written in candidates(templates):
        match = score(bg, grid, expand(written, grid.bars)).match
        chosen.append((letter, written, match, len(loop_mini(written))))
        best_match = match if best_match is None else max(best_match, match)
    # min keeps the first of equals, so a tie in length goes to the earlier letter
    _, winner, match, _ = min(
        (c for c in chosen if c[2] >= best_match - SIMPLER_TOLERANCE), key=lambda c: c[3]
    )

    layer = layer_bars = match_with_layer = None
    if loop.extra is not None and loop.extra_bars is not None:
        # The deviating bars' notes on steps the template leaves silent or gives another pitch class,
        # in the order find_loop searched them for the layer's own loop.
        extras = [
            {step: n for step, n in heard[i].items() if loop.templates[i % loop.period].get(step) != n.midi % OCTAVE}
            for i in loop.deviating
        ]
        layer = _phase_notes(extras, loop.extra)
        layer_bars = (loop.extra_bars[0] + 1, loop.extra_bars[1] + 1)
        match_with_layer = score(bg, grid, expand(winner, grid.bars), expand(layer, grid.bars)).match

    return BassLoop(
        period=loop.period,
        templates=winner,
        layer=layer,
        layer_bars=layer_bars,
        match=match,
        match_with_layer=match_with_layer,
    )


def _midi_hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12)


def harmonic_ratio(y: np.ndarray, sr: int, notes: list[Note], grid: Grid) -> float:
    """The median over notes of the share of spectral magnitude above twice the note's fundamental.

    Each note is measured over its own window on the grid (Hann-windowed); 0.0 with no notes.
    Notes whose window holds no samples or no signal are skipped.
    """
    ratios = []
    for note in notes:
        start = round(grid.time_of(note.bar, note.step) * sr)
        end = round(grid.time_of(note.bar, note.step + note.length) * sr)
        chunk = np.asarray(y[max(0, start) : end], dtype=float)
        if len(chunk) < 2:
            continue
        spectrum = np.abs(np.fft.rfft(chunk * np.hanning(len(chunk))))
        total = spectrum.sum()
        if total <= 0:
            continue
        freqs = np.fft.rfftfreq(len(chunk), 1.0 / sr)
        ratios.append(float(spectrum[freqs > 2 * _midi_hz(note.midi)].sum() / total))
    return float(np.median(ratios)) if ratios else 0.0
