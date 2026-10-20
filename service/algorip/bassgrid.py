"""A bass stem as a 16th-step grid: the pitch each step holds and the steps where a note starts.

Pitch comes from pyin at a low sample rate (the bass sits under 400 Hz). A note starts where sound
follows a rest, where the pitch class changes, or where the onset strength peaks, which catches a
note retriggered on the same pitch.
"""

import librosa
import numpy as np
from pydantic import BaseModel

from algorip.grid import STEPS_PER_BAR, Grid
from algorip.notes import Note

PYIN_SR = 11025
FMIN = 30.0
FMAX = 400.0
FRAME = 2048
HOP = 256
RMS_FLOOR = 0.02  # of the stem's peak step RMS; quieter steps are rests
VOICED_SHARE = 1 / 3  # of a step's frames that must be voiced for the step to be pitched
# pyin's default (35.92 octaves/s) cannot leap an octave in one 23 ms hop, so a lone G2 between
# G1s and an A1 is read an octave down; 60 lets a sixteenth jump an octave.
MAX_TRANSITION_RATE = 60.0
# Pitch bins per semitone are 1 / this. pyin's default 0.1 spends ~4 s of Viterbi on a minute of
# bass; 0.2 takes ~1 s, and each step's pitch is rounded to a semitone anyway.
PYIN_RESOLUTION = 0.2
# pyin marks every frame of a note below FMIN voiced (pinned at FMIN) but with a voiced
# probability near 0.01; a real note's frames reach well above this.
VOICED_PROB = 0.1
# Bounded below by the weakest retriggered sixteenth on one pitch (1.1) and above by the
# strongest peak in a plucked note's release tail (0.1); see tests/test_bassgrid.py.
ONSET_THRESHOLD = 0.5
_RMS_FRAME = 2 * HOP  # short, so a rest between two notes does not hear them; centred like pyin's frames


class BassGrid(BaseModel):
    bars: int
    steps_per_bar: int = STEPS_PER_BAR
    midi: list[list[int | None]]  # [bar][step]; None when unpitched or quiet
    starts: list[list[bool]]  # [bar][step]; a note starts here


def _step_frames(grid: Grid, n_frames: int) -> list[np.ndarray]:
    """Indices of the frames whose centres fall inside each step, in grid order."""
    centres = librosa.frames_to_time(np.arange(n_frames), sr=PYIN_SR, hop_length=HOP)
    edges = np.array([grid.time_of(0, i) for i in range(grid.bars * grid.steps_per_bar + 1)])
    index = np.searchsorted(edges, centres, side="right") - 1
    return [np.flatnonzero(index == i) for i in range(len(edges) - 1)]


def bass_grid(y: np.ndarray, sr: int, grid: Grid) -> BassGrid:
    """Each step's midi (None for a rest or an unpitched step) and whether a note starts on it."""
    y = librosa.resample(np.asarray(y, dtype=np.float32), orig_sr=sr, target_sr=PYIN_SR)
    f0, voiced_flag, voiced_prob = librosa.pyin(
        y,
        fmin=FMIN,
        fmax=FMAX,
        sr=PYIN_SR,
        frame_length=FRAME,
        hop_length=HOP,
        max_transition_rate=MAX_TRANSITION_RATE,
        resolution=PYIN_RESOLUTION,
    )
    voiced = voiced_flag & (voiced_prob >= VOICED_PROB)
    rms = librosa.feature.rms(y=y, frame_length=_RMS_FRAME, hop_length=HOP)[0]
    onset = librosa.onset.onset_strength(y=y, sr=PYIN_SR, hop_length=HOP)
    steps = _step_frames(grid, min(len(f0), len(rms), len(onset)))

    # The median ignores the frames at a step's edges, which hear its neighbours.
    level = np.array([np.median(rms[f]) if len(f) else 0.0 for f in steps])
    floor = max(RMS_FLOOR * level.max(), np.finfo(np.float32).tiny)
    midi: list[int | None] = []
    for frames, loud in zip(steps, level):
        hz = f0[frames][voiced[frames]]
        if loud >= floor and len(frames) and len(hz) >= VOICED_SHARE * len(frames):
            midi.append(int(round(float(np.median(librosa.hz_to_midi(hz))))))
        else:
            midi.append(None)

    starts = []
    for i, (m, frames) in enumerate(zip(midi, steps)):
        prev = midi[i - 1] if i else None
        struck = len(frames) > 0 and float(onset[frames].max()) > ONSET_THRESHOLD
        starts.append(m is not None and (prev is None or prev % 12 != m % 12 or struck))

    spb = grid.steps_per_bar
    return BassGrid(
        bars=grid.bars,
        steps_per_bar=spb,
        midi=[midi[b * spb : (b + 1) * spb] for b in range(grid.bars)],
        starts=[starts[b * spb : (b + 1) * spb] for b in range(grid.bars)],
    )


def grid_to_notes(bg: BassGrid) -> list[Note]:
    """Each start as a note running to the next start or the first rest, at its start step's midi."""
    midi = [m for bar in bg.midi for m in bar]
    starts = [s for bar in bg.starts for s in bar]
    notes = []
    for i, start in enumerate(starts):
        if not start:
            continue
        end = i + 1
        while end < len(midi) and midi[end] is not None and not starts[end]:
            end += 1
        bar, step = divmod(i, bg.steps_per_bar)
        notes.append(Note(bar=bar, step=step, length=end - i, midi=midi[i]))
    return notes
