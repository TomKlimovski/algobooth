"""A bass stem as a 16th-step grid: the pitch each step holds and the steps where a note starts.

Pitch comes from pyin at a low sample rate (the bass sits under 400 Hz). Loudness and attacks come
from short RMS frames, because pyin's 2048-sample frame (186 ms) is wider than a 16th step at dance
tempos and smears both voicing and level across neighbouring steps. A note starts where sound
follows a rest, where the pitch class changes, or where the level dips and recovers across the step
boundary, which is how a note retriggered on the same pitch is heard.
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
# Of the stem's peak step RMS; quieter steps are rests. The spec's "0.02 of full scale" was measured
# on the Solomun stem, whose peak step RMS is 0.188 FS, so it is 0.106 of that peak. 0.02 of the peak
# (five times lower) admitted that stem's fading swells on rest steps (0.03-0.10 of the peak) and
# pushed its loop to period 2; 0.1 and 0.12 both give the one-bar loop.
RMS_FLOOR = 0.1
VOICED_SHARE = 1 / 3  # of a step's frames that must be voiced for the step to be pitched
# pyin's default (35.92 octaves/s) cannot leap an octave in one 23 ms hop, so a lone G2 between
# G1s and an A1 is read an octave down; 60 lets a sixteenth jump an octave.
MAX_TRANSITION_RATE = 60.0
# Pitch bins per semitone are 1 / this. pyin's default 0.1 spends ~4 s of Viterbi on a minute of
# bass; 0.2 takes ~1 s, and each step's pitch is rounded to a semitone anyway.
PYIN_RESOLUTION = 0.2
# Twice pyin's no_trough_prob (0.01): a frame where YIN finds no trough under any threshold gets
# exactly that 0.01, which is how the frames of a note below FMIN (pinned at FMIN) read. Any real
# periodicity lifts a frame above it. 0.1 was too high: a lone 16th at 129 BPM fills at most ~60%
# of pyin's 186 ms frame, and on a real stem (Solomun, steps 5/7/13) its frames read 0.02-0.15 while
# pitch was tracked correctly, so those hits were dropped as rests.
VOICED_PROB = 0.02
# A same-pitch step is a retrigger when the short RMS around its start dips below this share of the
# quieter of the two steps' levels. Synthetic retriggers (10 ms release + 10 ms attack) dip to 0.35
# (G1 to G1) and 0.36 (G1 to G2); held notes and plucked tails stay at or above 0.89, and the
# Solomun stem's legato 16th pairs (no gap, no phase reset) at or above 0.98. 0.56 sits between.
# (Onset strength, used before, peaked as high on that stem's silent steps, from drum bleed, as on
# its attacks, so it fired on tails and missed nothing it could tell apart.)
RETRIGGER_DIP = 0.56
_RMS_FRAME = 2 * HOP  # short, so a rest between two notes does not hear them; centred like pyin's frames
# The envelope for dips, every 2.9 ms: 17 ms frames see a 20 ms gap (at 23 ms a G1-to-G2 retrigger
# dipped only to 0.68), while a held note still reads within ~10% of steady.
_DIP_FRAME = 192
_DIP_HOP = 32
_DIP_REACH = 0.25  # of a step, either side of its start, where a retrigger's dip may fall


class BassGrid(BaseModel):
    bars: int
    steps_per_bar: int = STEPS_PER_BAR
    midi: list[list[int | None]]  # [bar][step]; None when unpitched or quiet
    starts: list[list[bool]]  # [bar][step]; a note starts here


def _step_edges(grid: Grid) -> np.ndarray:
    """The step boundaries, starting one step before the grid so the first step has a step before it."""
    return np.array([grid.time_of(0, i) for i in range(-1, grid.bars * grid.steps_per_bar + 1)])


def _step_frames(edges: np.ndarray, n_frames: int, hop: int) -> list[np.ndarray]:
    """Indices of the frames whose centres fall inside each step, in step order."""
    centres = librosa.frames_to_time(np.arange(n_frames), sr=PYIN_SR, hop_length=hop)
    index = np.searchsorted(edges, centres, side="right") - 1
    return [np.flatnonzero(index == i) for i in range(len(edges) - 1)]


def _retriggered(env: np.ndarray, t: np.ndarray, edges: np.ndarray, i: int) -> bool:
    """Whether the short RMS (env, at frame times t) dips at the start of step i (i > 0) below both steps' levels."""
    reach = _DIP_REACH * (edges[i + 1] - edges[i])
    prev, here, after_end = np.searchsorted(t, edges[i - 1 : i + 2])
    lo, hi = np.searchsorted(t, [edges[i] - reach, edges[i] + reach])
    around, before, after = env[lo:hi], env[prev:here], env[here:after_end]
    if not (len(around) and len(before) and len(after)):
        return False
    return float(around.min()) < RETRIGGER_DIP * min(float(np.median(before)), float(np.median(after)))


def _strongest_midi(hz: np.ndarray, prob: np.ndarray) -> int:
    """The semitone the frames hear most surely: the one with the largest summed voiced probability.

    Not the median: a step's frames reach into its neighbours, so a lone G2 between G1s holds G1 frames
    too (weakly) and the median of two pitches is a third that nobody played.
    """
    semitones = np.round(librosa.hz_to_midi(hz)).astype(int)
    values = np.unique(semitones)
    return int(values[np.argmax([prob[semitones == v].sum() for v in values])])


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
    env = librosa.feature.rms(y=y, frame_length=_DIP_FRAME, hop_length=_DIP_HOP)[0]
    env_t = librosa.frames_to_time(np.arange(len(env)), sr=PYIN_SR, hop_length=_DIP_HOP)
    # Step 0 here is the step before the grid. It is heard only as the first step's predecessor, and
    # only when the whole step lies inside the audio: then a note sounding across the first downbeat is
    # not a start, and grid_to_notes writes nothing for it (a sound carried over from before the clip
    # is not a note of the clip). Cut short by the start of the audio, it holds only the first note's
    # own attack (the downbeat is placed to one 11.6 ms hop, often just after it), so it is ignored.
    edges = _step_edges(grid)
    steps = _step_frames(edges, min(len(f0), len(rms)), HOP)
    whole_before = edges[0] >= 0 and len(steps[0]) >= len(steps[1]) - 1

    # The median ignores the frames at a step's edges, which hear its neighbours.
    level = np.array([np.median(rms[f]) if len(f) else 0.0 for f in steps])
    floor = max(RMS_FLOOR * level[1:].max(initial=0.0), np.finfo(np.float32).tiny)  # the grid's own steps
    midi: list[int | None] = []
    for i, (frames, loud) in enumerate(zip(steps, level)):
        heard = frames[voiced[frames]]
        if loud >= floor and len(frames) and len(heard) >= VOICED_SHARE * len(frames):
            midi.append(_strongest_midi(f0[heard], voiced_prob[heard]))
        else:
            midi.append(None)
    if not whole_before:
        midi[0] = None

    starts = [False]
    for i in range(1, len(midi)):
        m, prev = midi[i], midi[i - 1]
        starts.append(
            m is not None and (prev is None or prev % 12 != m % 12 or _retriggered(env, env_t, edges, i))
        )

    spb = grid.steps_per_bar
    midi, starts = midi[1:], starts[1:]
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
