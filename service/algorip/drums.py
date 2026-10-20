"""Drum onset classification: kick, snare, closed and open hat on the 16-step grid.

Each voice comes from its own frequency band, detected independently, so hits that
coincide on a step (a kick under a hat, a kick under a snare) are all kept. There is
no cross-band exclusion. The 4th-order Butterworth band filters, with a higher peak
threshold in the snare band, keep one voice's energy out of another's band.
"""

import librosa
import numpy as np
from scipy import signal

from algorip.grid import Grid

VOICES = ("bd", "sd", "hh", "oh")
DrumHits = dict[str, set[tuple[int, int]]]

_HOP = 512  # librosa's default onset-strength hop
_DELTA = 0.2  # peak threshold as a fraction of the envelope's range (librosa min-max normalises it)
# The snare band picks up hat and kick leakage on the log-scaled onset envelope at up to 0.43 of
# its max, against 0.61 for the weakest real snare. Hats under an open-hat tail peak at 0.34 in
# theirs, so no single delta serves both bands; the snare band uses a higher one.
_SNARE_DELTA = 0.4
_WAIT_SECONDS = 0.05  # minimum gap between onsets in one band
# librosa's onset envelope is zero for its first few frames, so a hit at t=0 would be lost.
# Detection runs on y behind this much silence, shifted back after. The silence goes in before
# the band filter: the zero-phase filter rings ahead of each hit, and a hit at sample 0 with its
# pre-ringing cut off reads as a much louder onset than the same hit mid-file.
_LEAD_IN_SECONDS = 0.1

_KICK_BAND = (None, 150.0)
_SNARE_BAND = (200.0, 2500.0)
_HAT_BAND = (6000.0, None)

_DECAY_HIGHPASS_HZ = 6000.0
_DECAY_HOP_SECONDS = 0.005
_DECAY_WINDOW_SECONDS = 0.4
_DECAY_ATTACK_SECONDS = 0.03
_OPEN_HAT_MS = 120.0

_FOUR_ON_THE_FLOOR_STEPS = (0, 4, 8, 12)
_FOUR_ON_THE_FLOOR_SHARE = 0.75


def band(y: np.ndarray, sr: int, low: float | None, high: float | None) -> np.ndarray:
    """y through a zero-phase 4th-order Butterworth: band-pass, low-pass (low=None) or high-pass (high=None)."""
    if low is None and high is None:
        return np.asarray(y, dtype=float)
    if low is None:
        sos = signal.butter(4, high, btype="lowpass", fs=sr, output="sos")
    elif high is None:
        sos = signal.butter(4, low, btype="highpass", fs=sr, output="sos")
    else:
        sos = signal.butter(4, [low, high], btype="bandpass", fs=sr, output="sos")
    return signal.sosfiltfilt(sos, np.asarray(y, dtype=float))


def band_onsets(
    y: np.ndarray, sr: int, low: float | None, high: float | None, delta: float = _DELTA
) -> np.ndarray:
    """Onset times in seconds of y's energy in one band.

    librosa takes `wait` in frames, so 50 ms is converted at the onset envelope's hop. librosa
    min-max normalises the envelope (normalize=True) before peak picking, and the lead-in silence
    pins its minimum at zero, so `delta` (0.2 by default) is a fraction of the envelope's maximum.
    A peak must clear the local mean of the envelope by delta.
    """
    lead = round(_LEAD_IN_SECONDS * sr)
    padded = np.concatenate([np.zeros(lead), np.asarray(y, dtype=float)])
    filtered = band(padded, sr, low, high).astype(np.float32)
    env = librosa.onset.onset_strength(y=filtered, sr=sr, hop_length=_HOP)
    wait_frames = max(1, round(_WAIT_SECONDS * sr / _HOP))
    onsets = librosa.onset.onset_detect(
        onset_envelope=env,
        sr=sr,
        hop_length=_HOP,
        units="time",
        backtrack=False,
        normalize=True,
        delta=delta,
        wait=wait_frames,
    )
    return onsets - lead / sr


def decay_ms(y: np.ndarray, sr: int, t: float, floor_db: float = -20) -> float:
    """Milliseconds after t until the 6 kHz high-passed RMS envelope falls floor_db below its peak in the next 400 ms.

    The envelope is RMS over 5 ms hops. The peak is the hit at t's own: the loudest frame in the first
    30 ms (onsets land within about a frame of the hit). A later, louder hit in the window would
    otherwise set the reference and the count. The fall is the first frame after that peak below
    the threshold. Capped at 400.
    """
    cap = _DECAY_WINDOW_SECONDS * 1000.0
    hop = max(1, round(_DECAY_HOP_SECONDS * sr))
    start = max(0, round(t * sr))
    high = band(y, sr, _DECAY_HIGHPASS_HZ, None)[start : start + round(_DECAY_WINDOW_SECONDS * sr)]
    frames = len(high) // hop
    if frames == 0:
        return 0.0
    rms = np.sqrt(np.mean(high[: frames * hop].reshape(frames, hop) ** 2, axis=1))
    attack = rms[: max(1, round(_DECAY_ATTACK_SECONDS / _DECAY_HOP_SECONDS))]
    peak = int(np.argmax(attack))
    if rms[peak] <= 0:
        return 0.0
    threshold = rms[peak] * 10.0 ** (floor_db / 20.0)
    below = np.nonzero(rms[peak:] < threshold)[0]
    if len(below) == 0:
        return cap
    return min(cap, (peak + int(below[0])) * _DECAY_HOP_SECONDS * 1000.0)


def _place(onsets: np.ndarray, grid: Grid) -> set[tuple[int, int]]:
    steps = (grid.step_at(float(t)) for t in onsets)
    return {s for s in steps if s is not None}


def classify_drums(drums: np.ndarray, sr: int, grid: Grid) -> DrumHits:
    """Kick, snare and hat hits from three independent band detections, placed on the grid."""
    hits: DrumHits = {voice: set() for voice in VOICES}
    hits["bd"] = _place(band_onsets(drums, sr, *_KICK_BAND), grid)
    hits["sd"] = _place(band_onsets(drums, sr, *_SNARE_BAND, delta=_SNARE_DELTA), grid)
    for t in band_onsets(drums, sr, *_HAT_BAND):
        step = grid.step_at(float(t))
        if step is not None:
            voice = "oh" if decay_ms(drums, sr, float(t)) >= _OPEN_HAT_MS else "hh"
            hits[voice].add(step)
    return hits


def is_four_on_the_floor(hits: DrumHits, bars: int) -> bool:
    """A kick on steps 0, 4, 8 and 12 in at least 75% of bars."""
    if bars <= 0:
        return False
    kicks = hits.get("bd", set())
    full = sum(all((bar, s) in kicks for s in _FOUR_ON_THE_FLOOR_STEPS) for bar in range(bars))
    return full >= _FOUR_ON_THE_FLOOR_SHARE * bars
