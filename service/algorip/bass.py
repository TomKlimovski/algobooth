"""Bass stem transcription on the step grid, the loop it repeats, and a brightness measure of the bass sound."""

from collections import Counter

import librosa
import numpy as np

from algorip.bassgrid import BassGrid, bass_grid, grid_to_notes
from algorip.grid import STEPS_PER_BAR, Grid
from algorip.key import Key
from algorip.loop import find_loop
from algorip.mini import OCTAVE, one_per_step, loop_mini, template_note
from algorip.notes import Note, fold_octaves, snap_to_key
from algorip.schema import BassLoop, BassTone, MeasuredEnvelope
from algorip.score import expand, score

BASS_LOW = 24  # C1
BASS_HIGH = 60  # C4
# A step whose pitch, with the clip's tuning removed, is still this far from a semitone is an ambiguous
# reading and snaps to the key; a clear reading keeps its note, in key or not (the 48:50 clip's E3 in D# minor).
SNAP_CENTS = 35
TUNING_MIN_STEPS = 4  # fewer pitched steps than this cannot say what the clip's tuning is
TUNING_WRAP_CENTS = 30  # past this the offset is read both ways round the semitone (see _tuning_cents)
# A candidate scoring within this of the best is close enough: among those, the shortest notation wins.
SIMPLER_TOLERANCE = 0.05


def _in_register(note: Note, key: Key) -> Note:
    snapped = snap_to_key([note], key)[0]
    return snapped.model_copy(update={"midi": fold_octaves(snapped.midi, BASS_LOW, BASS_HIGH)})


def _offsets(hz: list[list[float | None]]) -> list[float]:
    """Each pitched step's exact midi, in order."""
    return [float(librosa.hz_to_midi(h)) for bar in hz for h in bar if h is not None]


def _in_key_share(exact: list[float], tuning: float, key: Key) -> float:
    return sum(round(m - tuning / 100) % 12 in key.scale for m in exact) / len(exact)


def _tuning_cents(hz: list[list[float | None]], key: Key) -> float:
    """The clip's offset from 440 tuning: the median, over the pitched steps, of each step's cents from the
    nearest semitone. An offset past TUNING_WRAP_CENTS is read both ways (a record 40 cents sharp could be
    60 cents flat of the next semitone up); the reading that keeps more steps in the key wins."""
    exact = _offsets(hz)
    if len(exact) < TUNING_MIN_STEPS:
        return 0.0
    cents = np.array([100 * (m - round(m)) for m in exact])
    tuning = float(np.median(cents))
    if abs(tuning) > TUNING_WRAP_CENTS:
        # the steps near the wrap point sit on both sides of it: measure around the candidate, not the median
        wrapped = tuning - 100 * np.sign(tuning)
        centred = lambda t: float(np.median(((cents - t + 50) % 100) - 50 + t))  # noqa: E731
        candidates = [centred(tuning), centred(wrapped)]
        shares = [_in_key_share(exact, t, key) for t in candidates]
        tuning = candidates[int(np.argmax(shares))]
    return tuning


def _retuned(bg: BassGrid, key: Key) -> BassGrid:
    """The grid's midi re-read from its Hz with the clip's tuning removed; an ambiguous step snaps to the key,
    a clear one keeps its note; all folded into the bass register. Starts are the grid's retriggers plus
    every change of pitch class in the retuned midi."""
    hz = bg.hz if bg.hz else [[None] * len(bar) for bar in bg.midi]
    retriggers = bg.retriggers if bg.retriggers else [[False] * len(bar) for bar in bg.midi]
    tuning = _tuning_cents(hz, key)
    midi: list[list[int | None]] = []
    for bar_hz, bar_midi in zip(hz, bg.midi):
        row: list[int | None] = []
        for h, m in zip(bar_hz, bar_midi):
            if h is None:
                row.append(None if m is None else _in_register(Note(bar=0, step=0, length=1, midi=m), key).midi)
                continue
            exact = float(librosa.hz_to_midi(h)) - tuning / 100
            nearest = int(round(exact))
            note = Note(bar=0, step=0, length=1, midi=nearest)
            if abs(exact - nearest) * 100 > SNAP_CENTS:
                note = snap_to_key([note], key)[0]
            row.append(fold_octaves(note.midi, BASS_LOW, BASS_HIGH))
        midi.append(row)
    starts = []
    prev: int | None = None
    first = True
    for bar_midi, bar_starts, bar_retrig in zip(midi, bg.starts, retriggers):
        row_starts = []
        for m, original, retrig in zip(bar_midi, bar_starts, bar_retrig):
            if m is None:
                row_starts.append(False)
            elif first or prev is None:
                # the grid's own call: it compared the first step with the step before the window
                row_starts.append(original)
            else:
                row_starts.append(retrig or prev % 12 != m % 12)
            prev = m
            first = False
        starts.append(row_starts)
    return bg.model_copy(update={"midi": midi, "starts": starts, "tuning_cents": round(tuning, 1)})


def transcribe_bass(y: np.ndarray, sr: int, grid: Grid, key: Key) -> tuple[BassGrid, list[Note]]:
    """The bass stem's step grid and its notes, retuned to the clip, in key where ambiguous, folded into the bass register.

    The grid's pitches are rounded, snapped and folded like the notes so that, as the scorer's truth, it
    sits in the same register as anything written from them.
    """
    bg = _retuned(bass_grid(y, sr, grid), key)
    return bg, grid_to_notes(bg)


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
                end = max(there.step + there.length, note.step + note.length)
                placed[target] = there.model_copy(update={"length": end - there.step})
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
    """Each phase's template as notes, from the bars at that phase (commonest midi and length).

    A template step no bar at that phase plays (template_note gives None) is dropped.
    """
    period = len(templates)
    return [
        [
            n
            for step, pc in sorted(template.items())
            if (n := template_note(heard[phase::period], step, pc)) is not None
        ]
        for phase, template in enumerate(templates)
    ]


def _layer_notes(bg: BassGrid, extra: list[dict[int, int]], extra_from: list[list[int]]) -> list[list[Note]]:
    """Each phase of the variation as notes: a run of steps on one pitch class is one held note, split where the
    bars it was drawn from mostly retrigger it, at the midi they mostly sound it at.
    """
    phases = []
    for phase, template in enumerate(extra):
        bars = extra_from[phase]
        notes: list[Note] = []
        for step in sorted(template):
            pc = template[step]
            sounding = [b for b in bars if (m := bg.midi[b][step]) is not None and m % OCTAVE == pc]
            retriggered = 2 * sum(bg.starts[b][step] for b in sounding) > len(sounding)
            last = notes[-1] if notes else None
            if last is not None and last.step + last.length == step and last.midi % OCTAVE == pc and not retriggered:
                notes[-1] = last.model_copy(update={"length": last.length + 1})
                continue
            votes = Counter(bg.midi[b][step] for b in sounding)
            midi = votes.most_common(1)[0][0] if votes else pc + BASS_LOW
            notes.append(Note(bar=0, step=step, length=1, midi=midi))
        phases.append(notes)
    return phases


def choose_bass_loop(bg: BassGrid, grid: Grid, notes: list[Note]) -> BassLoop | None:
    """The loop the bass repeats, written as the shortest candidate that scores near the best, and its layer.

    None when the bars do not repeat (or there is no bass).
    """
    heard = [one_per_step([n for n in notes if n.bar == b]) for b in range(grid.bars)]
    # The layer is measured on the steps that sound as well as on the starts: a fill that sustains
    # is heard as fewer, longer notes than it has steps.
    sounding = [{step: m % OCTAVE for step, m in enumerate(bar) if m is not None} for bar in bg.midi]
    loop = find_loop([{step: n.midi % OCTAVE for step, n in bar.items()} for bar in heard], sounding=sounding)
    if loop is None or not any(loop.templates):
        return None  # no repeat, or the only thing that repeats is silence (a silent stem)
    # Only the bars that voted the template name its notes; a build must not pick their midi or length.
    clean = [heard[i] if i in loop.clean else {} for i in range(grid.bars)]
    templates = _phase_notes(clean, loop.templates)

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
        assert loop.extra_from is not None  # find_loop sets both or neither
        layer = _layer_notes(bg, loop.extra, loop.extra_from)
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


ENVELOPE_HOP = 128  # 2.9 ms at the service rate (44.1 kHz)
ENVELOPE_FRAME = 2048  # 46 ms: two periods of a low bass note, so its ripple does not read as a fall
ONSET_DB = -20.0  # a note is sounding from here, relative to its peak
HOLD_DB = -3.0  # ...and holding while within this of it
# An RMS window sliding over an instant edge takes this share of its length from -20 dB to -3 dB (1% of the
# window to half of it), so a measured rise or fall is shortened by it.
_SMEAR = 0.49 * ENVELOPE_FRAME


def bass_envelope(y: np.ndarray, sr: int, notes: list[Note], grid: Grid) -> MeasuredEnvelope | None:
    """The median attack, hold, fall and end level of the stem's notes, each measured on the note's own span.

    On the RMS envelope: the onset is the first moment within ONSET_DB of the note's peak, the hold runs from
    there to the last moment within HOLD_DB of it, the attack is the rise between the two (less the window's
    own smear), the fall the time from the hold's end to ONSET_DB (likewise), capped at the note's end; end_db
    is the level a frame before the end. None with no notes. The 48:50 Solomun stem holds each note within
    2 dB for half to three quarters of its length and then cuts it in about 40 ms: a gate, not a pluck.
    """
    if not notes:
        return None
    env = librosa.feature.rms(y=np.asarray(y, dtype=np.float32), frame_length=ENVELOPE_FRAME, hop_length=ENVELOPE_HOP)[0]
    times = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=ENVELOPE_HOP)
    smear = _SMEAR / sr
    hop = ENVELOPE_HOP / sr
    attacks, holds, falls, ends, shares = [], [], [], [], []
    for note in notes:
        start = grid.time_of(note.bar, note.step)
        end = grid.time_of(note.bar, note.step + note.length)
        lo, hi = np.searchsorted(times, [start, end])
        span = env[lo:hi]
        if len(span) < 2 or span.max() <= 0:
            continue
        db = 20 * np.log10(span / span.max() + 1e-9)
        onset = int(np.flatnonzero(db >= ONSET_DB)[0])
        top = int(np.flatnonzero(db >= HOLD_DB)[0])
        hold_end = int(np.flatnonzero(db >= HOLD_DB)[-1])
        after = np.flatnonzero(db[hold_end:] <= ONSET_DB)
        fall_end = hold_end + (int(after[0]) if len(after) else len(db) - 1 - hold_end)
        attacks.append(max(0.0, (top - onset) * hop - smear) * 1000)
        holds.append((hold_end - onset) * hop * 1000)
        falls.append(max(0.0, (fall_end - hold_end) * hop - smear) * 1000)
        ends.append(float(db[max(top, len(db) - 1 - ENVELOPE_FRAME // ENVELOPE_HOP)]))
        shares.append(holds[-1] / 1000 / (end - start))
    if not attacks:
        return None
    med = lambda xs: round(float(np.median(xs)), 1)  # noqa: E731
    return MeasuredEnvelope(
        attack_ms=med(attacks), hold_ms=med(holds), fall_ms=med(falls), end_db=med(ends), hold_share=round(float(np.median(shares)), 2)
    )


TONE_FFT = 2048
TONE_HOP = 441  # 10 ms
ROLLOFF = 0.85
ONSET_WITHIN_DB = 6.0  # the note sounds from the first frame this close to its loudest; the grid line comes earlier
TONE_OPEN_FRAMES = 2  # the opening is read over this many frames from the onset
HOLD_SPAN = (0.6, 0.9)  # the hold's filter is read over this part of the sounding frames: after the close, before the cut
WOBBLE_SPAN = (0.3, 0.95)  # the wobble is read over this part: as much of the note as is clear of the attack
CLOSE_OCTAVES = 0.25  # the filter has closed once the rolloff is within this of the hold's
WOBBLE_LOW, WOBBLE_HIGH = 5.0, 20.0  # Hz: a tremolo lives here; slower is the gate, faster is the note
WOBBLE_FRAME = 220  # 5 ms, so the envelope follows a tremolo and not a low note's own cycles
WOBBLE_HOP = 44  # 1 ms
WOBBLE_DB = 3.0  # a periodic swing under this is not a tremolo
WOBBLE_MIN_CYCLES = 1  # a span shorter than this many cycles of WOBBLE_LOW (200 ms) cannot resolve a rate


def _sounding(x: np.ndarray, sr: int) -> tuple[np.ndarray, int, int] | None:
    """The 10 ms RMS envelope of a note's span, and the frames it sounds in: from the first frame within
    ONSET_WITHIN_DB of its loudest to the last within 20 dB of it. None when there is nothing to hear."""
    env = librosa.feature.rms(y=x, frame_length=TONE_FFT, hop_length=TONE_HOP, center=False)[0]
    if len(env) < 4 or env.max() <= 0:
        return None
    db = 20 * np.log10(env / env.max() + 1e-9)
    onset = int(np.flatnonzero(db >= -ONSET_WITHIN_DB)[0])
    last = int(np.flatnonzero(db >= -20.0)[-1])
    return env, onset, max(last, onset + 1)


def _note_filter(x: np.ndarray, sr: int) -> tuple[float, float, float] | None:
    """(open_hz, hold_hz, close_ms) of one note, read from its onset, not from the grid line."""
    heard = _sounding(x, sr)
    if heard is None:
        return None
    _, onset, last = heard
    roll = librosa.feature.spectral_rolloff(y=x, sr=sr, n_fft=TONE_FFT, hop_length=TONE_HOP, roll_percent=ROLLOFF, center=False)[0]
    roll = roll[onset : last + 1]
    if len(roll) < 3:
        return None
    hold_from, hold_to = int(len(roll) * HOLD_SPAN[0]), max(int(len(roll) * HOLD_SPAN[0]) + 1, int(len(roll) * HOLD_SPAN[1]))
    hold = float(np.median(roll[hold_from:hold_to]))
    if hold <= 0:
        return None
    opening = float(np.median(roll[:TONE_OPEN_FRAMES]))
    settled = np.flatnonzero(roll <= hold * 2**CLOSE_OCTAVES)
    close = (int(settled[0]) if len(settled) else len(roll)) * TONE_HOP / sr * 1000
    return opening, hold, close


def _note_wobble(x: np.ndarray, sr: int) -> tuple[float, float] | None:
    """(rate_hz, swing_db) of the strongest periodic level wobble on a note's hold, with the hold's own slope
    (a closing filter, a decay) removed first; None when the hold is too short to resolve one or it is under WOBBLE_DB."""
    heard = _sounding(x, sr)
    if heard is None:
        return None
    _, onset, last = heard
    lo = int((onset + (last - onset) * WOBBLE_SPAN[0]) * TONE_HOP)
    hi = int((onset + (last - onset) * WOBBLE_SPAN[1]) * TONE_HOP)
    if hi - lo < WOBBLE_MIN_CYCLES / WOBBLE_LOW * sr:
        return None
    env = librosa.feature.rms(y=x[lo:hi], frame_length=WOBBLE_FRAME, hop_length=WOBBLE_HOP, center=False)[0]
    if len(env) < 50 or env.max() <= 0:
        return None
    db = 20 * np.log10(env / env.max() + 1e-9)
    t = np.arange(len(db))
    db = db - np.polyval(np.polyfit(t, db, 1), t)  # the slope out: what is left is the wobble
    spectrum = np.abs(np.fft.rfft(db * np.hanning(len(db)), n=8192))
    freqs = np.fft.rfftfreq(8192, WOBBLE_HOP / sr)
    band = (freqs >= WOBBLE_LOW) & (freqs <= WOBBLE_HIGH)
    k = int(np.argmax(spectrum[band]))
    # a Hann-windowed sinusoid of amplitude A peaks at A * N / 4 in the magnitude spectrum: back to a dB swing
    swing = 2 * spectrum[band][k] * 4 / len(db)
    return (float(freqs[band][k]), float(swing)) if swing >= WOBBLE_DB else None


def bass_tone(y: np.ndarray, sr: int, notes: list[Note], grid: Grid) -> BassTone | None:
    """The median filter opening, hold and closing time of the stem's notes, and their level wobble, if any.

    Per note (see _note_filter and _note_wobble): the 85% spectral rolloff over the two frames from the note's
    onset (open) and over the later part of its sounding frames (hold), the time from the onset for the rolloff
    to settle within CLOSE_OCTAVES of the hold (close); and the strongest periodic component of the hold's level
    between WOBBLE_LOW and WOBBLE_HIGH Hz, kept when it swings WOBBLE_DB or more. The clip's wobble is the
    median over the notes that carry one, when at least half of the measured notes do. None with no notes.
    """
    if not notes:
        return None
    y32 = np.asarray(y, dtype=np.float32)
    opens, holds, closes, rates, depths = [], [], [], [], []
    for note in notes:
        start = grid.time_of(note.bar, note.step)
        end = grid.time_of(note.bar, note.step + note.length)
        x = y32[int(start * sr) : int(end * sr)]
        if len(x) < 2 * TONE_FFT:
            continue
        measured = _note_filter(x, sr)
        if measured is None:
            continue
        opens.append(measured[0])
        holds.append(measured[1])
        closes.append(measured[2])
        wobble = _note_wobble(x, sr)
        if wobble is not None:
            rates.append(wobble[0])
            depths.append(wobble[1])
    if not holds:
        return None
    wobbling = len(rates) * 2 >= len(holds)
    return BassTone(
        open_hz=round(float(np.median(opens)), 1),
        hold_hz=round(float(np.median(holds)), 1),
        close_ms=round(float(np.median(closes)), 1),
        wobble_hz=round(float(np.median(rates)), 1) if wobbling else None,
        wobble_db=round(float(np.median(depths)), 1) if wobbling else None,
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
