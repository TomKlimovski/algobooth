"""Tempo, beat and bar-grid estimation.

A bar is four beats (240 / bpm seconds) split into sixteen steps. The grid is
anchored at the first downbeat and covers a whole number of bars.
"""

import math

import librosa
import numpy as np
from pydantic import BaseModel
from scipy import signal

from algorip.onsets import band, gated_band_onsets

STEPS_PER_BAR = 16
BEATS_PER_BAR = 4
STEPS_PER_BEAT = STEPS_PER_BAR // BEATS_PER_BAR

_MIN_BPM = 70.0
_MAX_BPM = 180.0
_LOW_BAND_HZ = 150.0
_ACCENT_WINDOW = 0.06  # seconds after each beat in which low-band energy is measured

# The kick is the beat. The tracker locks onto the offbeat hats on some clips (the 48:50 Solomun clip's
# kicks all land 2.3 steps after its beats), so the beats move onto the kicks when the kicks agree:
# at least KICK_AGREEMENT of them within half a step of their circular mean phase, and that mean more
# than KICK_DEAD_ZONE steps from the beat (the tracker reads every onset a frame late; a grid within
# half a step of the kicks is left where the tracker put it, so a clip it got right is unchanged).
KICK_AGREEMENT = 0.75
KICK_DEAD_ZONE = 0.5  # steps
# The kick band's peak RMS must reach this, relative to the stem's own peak RMS, for its onsets to be kicks at
# all (drums.GATE_DB["bd"]): a breakdown of hats alone leaks into the band and would read as offbeat kicks.
KICK_GATE_DB = -16.0
# The downbeat of a moved grid: the low-band accent rule when one phase leads the runner-up by ACCENT_LEAD
# dB; with four equal kicks, the backbeat decides: the phase with the most 1-6 kHz energy after its beats
# is 2 or 4. An unmoved grid keeps the tracker's rule (the loudest phase), which the 36:40 golden rests on:
# its loudest kick leads by 0.6 dB, and the backbeat test would move its bar line two beats.
ACCENT_LEAD = 1.0  # dB
_BACKBEAT_BAND = (1000.0, 6000.0)
_BACKBEAT_WINDOW = 0.1  # seconds
# trim=False keeps the tracker's first beat: a click at t=0 has no onset before it, so the
# default trimming of weak edge beats drops the downbeat a loop starts on.


class Grid(BaseModel):
    bpm: float
    first_downbeat: float  # seconds
    bars: int
    steps_per_bar: int = STEPS_PER_BAR

    @property
    def bar_seconds(self) -> float:
        return 240.0 / self.bpm

    @property
    def step_seconds(self) -> float:
        return self.bar_seconds / self.steps_per_bar

    @property
    def end_time(self) -> float:
        return self.first_downbeat + self.bars * self.bar_seconds

    def step_at(self, t: float) -> tuple[int, int] | None:
        """The (bar, step) nearest t, or None before the grid (by over half a step) or past its last bar.

        The last half step before end_time has no step after it inside the grid, so it clamps to the last step.
        """
        offset = (t - self.first_downbeat) / self.step_seconds
        if offset < -0.5 or t >= self.end_time:
            return None
        index = min(max(0, round(offset)), self.bars * self.steps_per_bar - 1)
        bar, step = divmod(index, self.steps_per_bar)
        return bar, step

    def time_of(self, bar: int, step: int) -> float:
        return self.first_downbeat + bar * self.bar_seconds + step * self.step_seconds


def _resample_beats(beats: np.ndarray, factor: float) -> np.ndarray:
    """Beat times at `factor` times the density, interpolated over the original beat indices."""
    if len(beats) < 2:
        return beats
    indices = np.arange(0, len(beats) - 1 + 1e-9, 1.0 / factor)
    return np.interp(indices, np.arange(len(beats)), beats)


def estimate_tempo(y: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    """Tempo in bpm folded into [70, 180) by octaves, and the beat times in seconds to match."""
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr, units="time", trim=False)
    bpm = float(np.atleast_1d(tempo)[0])
    beats = np.asarray(beats, dtype=float)
    if bpm <= 0:
        return bpm, beats
    factor = 1.0
    while bpm * factor < _MIN_BPM:
        factor *= 2.0
    while bpm * factor >= _MAX_BPM:
        factor /= 2.0
    if factor != 1.0:
        beats = _resample_beats(beats, factor)
    return bpm * factor, beats


def _phase_scores(y: np.ndarray, sr: int, beats: np.ndarray, window_seconds: float, mean: bool = False) -> list[float]:
    """RMS of y in the window after each beat, summed per beat phase (or averaged, with `mean`, since a clip's
    beat count is rarely a multiple of four and a phase with one beat more would lead on the sum alone).
    A window before the clip's start is skipped; one cut by the clip's end counts as it stands on the sum (the
    tracker's rule, as it was) and is skipped on the mean."""
    window = round(window_seconds * sr)
    scores = []
    for phase in range(BEATS_PER_BAR):
        values = []
        for t in beats[phase::BEATS_PER_BAR]:
            start = round(t * sr)
            chunk = y[start : start + window] if start >= 0 else y[:0]
            if not len(chunk) or (mean and len(chunk) < window):
                continue
            values.append(float(np.sqrt(np.mean(chunk**2))))
        scores.append((float(np.mean(values)) if mean else float(np.sum(values))) if values else 0.0)
    return scores


def downbeat_phase(drums: np.ndarray, sr: int, beats: np.ndarray, backbeat: bool = False) -> int:
    """Which of the first four beats starts a bar: the phase with the most low-band energy on its beats.

    With `backbeat` (beats the kicks moved, whose tracker downbeat means nothing), that rule holds only
    when the phase leads the runner-up by ACCENT_LEAD dB; otherwise (four equal kicks) the backbeat
    decides: the phase with the most 1-6 kHz energy after its beats is beat 2 or 4, and of the two
    downbeats that allows, the earlier.
    """
    if len(beats) < BEATS_PER_BAR:
        return 0
    sos = signal.butter(4, _LOW_BAND_HZ, btype="lowpass", fs=sr, output="sos")
    low = signal.sosfilt(sos, np.asarray(drums, dtype=float))
    if not backbeat:
        return int(np.argmax(_phase_scores(low, sr, beats, _ACCENT_WINDOW)))  # the tracker's rule, as it was
    scores = _phase_scores(low, sr, beats, _ACCENT_WINDOW, mean=True)
    ranked = sorted(scores, reverse=True)
    if ranked[1] <= 0 or ranked[0] >= ranked[1] * 10.0 ** (ACCENT_LEAD / 20.0):
        return int(np.argmax(scores))
    loudest = int(np.argmax(_phase_scores(band(drums, sr, *_BACKBEAT_BAND), sr, beats, _BACKBEAT_WINDOW, mean=True)))
    return min((loudest - 1) % BEATS_PER_BAR, (loudest - 3) % BEATS_PER_BAR)


def align_beats_to_kicks(beats: np.ndarray, drums: np.ndarray, sr: int, bpm: float) -> np.ndarray:
    """The beats moved the shorter way onto the kick onsets when the kicks agree on one phase; else as given.

    Each kick's phase is its offset from the nearest tracked beat (the tracker's first beats can be
    uneven); the circular mean is the shift. The beats move only when at least KICK_AGREEMENT of the
    kicks lie within half a step of that mean and the mean is more than KICK_DEAD_ZONE steps from the beat.
    """
    if len(beats) < 2 or bpm <= 0:
        return beats
    kicks = gated_band_onsets(drums, sr, None, _LOW_BAND_HZ, KICK_GATE_DB)
    if len(kicks) < max(2, len(beats) / BEATS_PER_BAR):  # at least a kick a bar, or there is nothing to align to
        return beats
    beat = 60.0 / bpm
    nearest = np.clip(np.searchsorted(beats, kicks), 1, len(beats) - 1)
    nearest = np.where(np.abs(beats[nearest - 1] - kicks) <= np.abs(beats[nearest] - kicks), nearest - 1, nearest)
    phases = ((kicks - beats[nearest]) / beat) % 1.0  # in beats
    mean = float(np.angle(np.mean(np.exp(2j * np.pi * phases))) / (2 * np.pi))  # in (-0.5, 0.5]
    deviation = np.abs(((phases - mean + 0.5) % 1.0) - 0.5)  # in beats, circular
    half_step = 0.5 / STEPS_PER_BEAT  # in beats
    if np.mean(deviation <= half_step) < KICK_AGREEMENT or abs(mean) <= KICK_DEAD_ZONE / STEPS_PER_BEAT:
        return beats
    moved = beats + mean * beat
    return moved[moved >= -half_step * beat]  # a beat moved more than half a step before the clip is dropped


def estimate_grid(mix: np.ndarray, drums: np.ndarray | None, sr: int, duration: float) -> Grid:
    """Tempo from the mix, downbeat from the drums (or the mix), and as many whole bars as fit."""
    bpm, beats = estimate_tempo(mix, sr)
    if len(beats) < 2 or bpm <= 0:
        raise ValueError("Could not find a beat")
    bpm = round(bpm, 1)

    def grid_from(beats: np.ndarray, moved: bool = False) -> Grid | None:
        phase = downbeat_phase(mix if drums is None else drums, sr, beats, backbeat=moved)
        first_downbeat = max(0.0, float(beats[phase]))  # a beat just before the clip's start (see below) starts it
        # The beat tracker reads each onset about one analysis frame (~12 ms) late, so a clip cut
        # exactly on a bar line would lose its last bar; a bar short by under half a step still counts.
        bars = math.floor((duration - first_downbeat) / (240.0 / bpm) + 0.5 / STEPS_PER_BAR)
        return Grid(bpm=bpm, first_downbeat=first_downbeat, bars=bars) if bars >= 1 else None

    grid = None
    if drums is not None:
        aligned = align_beats_to_kicks(beats, drums, sr, bpm)
        if aligned is not beats:
            # Moved forward, the beats can leave a kick at the clip's very start without a beat (the 48:50
            # clip opens on one): a beat is added before them while it lies within half a step of the start.
            beat, half_step = 60.0 / bpm, 60.0 / bpm / STEPS_PER_BEAT / 2
            while aligned[0] - beat >= -half_step:
                aligned = np.concatenate([[aligned[0] - beat], aligned])
            grid = grid_from(aligned, moved=True)  # None when the move lost the only bar: the tracker's beats stand
    if grid is None:
        grid = grid_from(beats)
    if grid is None:
        raise ValueError("Could not find a beat")
    return grid
