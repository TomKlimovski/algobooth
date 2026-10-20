"""Tempo, beat and bar-grid estimation.

A bar is four beats (240 / bpm seconds) split into sixteen steps. The grid is
anchored at the first downbeat and covers a whole number of bars.
"""

import math

import librosa
import numpy as np
from pydantic import BaseModel
from scipy import signal

STEPS_PER_BAR = 16
BEATS_PER_BAR = 4

_MIN_BPM = 70.0
_MAX_BPM = 180.0
_LOW_BAND_HZ = 150.0
_ACCENT_WINDOW = 0.06  # seconds after each beat in which low-band energy is measured
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
        """The (bar, step) nearest t, or None before the grid (by over half a step) or past its last bar."""
        offset = (t - self.first_downbeat) / self.step_seconds
        if offset < -0.5:
            return None
        index = max(0, round(offset))
        if index >= self.bars * self.steps_per_bar:
            return None
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


def downbeat_phase(drums: np.ndarray, sr: int, beats: np.ndarray) -> int:
    """Which of the first four beats starts a bar: the phase with the most low-band energy on its beats."""
    if len(beats) < BEATS_PER_BAR:
        return 0
    sos = signal.butter(4, _LOW_BAND_HZ, btype="lowpass", fs=sr, output="sos")
    low = signal.sosfilt(sos, np.asarray(drums, dtype=float))
    window = round(_ACCENT_WINDOW * sr)
    scores = []
    for phase in range(BEATS_PER_BAR):
        total = 0.0
        for t in beats[phase::BEATS_PER_BAR]:
            start = round(t * sr)
            chunk = low[start : start + window]
            if len(chunk):
                total += float(np.sqrt(np.mean(chunk**2)))
        scores.append(total)
    return int(np.argmax(scores))


def estimate_grid(mix: np.ndarray, drums: np.ndarray | None, sr: int, duration: float) -> Grid:
    """Tempo from the mix, downbeat from the drums (or the mix), and as many whole bars as fit."""
    bpm, beats = estimate_tempo(mix, sr)
    if len(beats) < 2 or bpm <= 0:
        raise ValueError("Could not find a beat")
    phase = downbeat_phase(mix if drums is None else drums, sr, beats)
    first_downbeat = float(beats[phase])
    bpm = round(bpm, 1)
    # The beat tracker reads each onset about one analysis frame (~12 ms) late, so a clip cut
    # exactly on a bar line would lose its last bar; a bar short by under half a step still counts.
    bars = math.floor((duration - first_downbeat) / (240.0 / bpm) + 0.5 / STEPS_PER_BAR)
    if bars < 1:
        raise ValueError("Could not find a beat")
    return Grid(bpm=bpm, first_downbeat=first_downbeat, bars=bars)
