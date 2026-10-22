"""Band filtering and onset detection shared by the drum classifier and the grid.

A voice's onsets come from its own frequency band through a zero-phase Butterworth and librosa's
onset envelope, behind a lead-in of silence so a hit at t=0 is not lost (see _detect and _lead_in).
"""

import librosa
import numpy as np
from scipy import signal

_HOP = 512  # librosa's default onset-strength hop
_DELTA = 0.2  # peak threshold as a fraction of the envelope's range (_detect min-max normalises it)

_WAIT_SECONDS = 0.05  # minimum gap between onsets in one band
# librosa's onset envelope is zero for its first few frames, so a hit at t=0 would be lost.
# Detection runs on y behind this much silence, shifted back after. The silence goes in before
# the band filter: the zero-phase filter rings ahead of each hit, and a hit at sample 0 with its
# pre-ringing cut off reads as a much louder onset than the same hit mid-file.
_LEAD_IN_SECONDS = 0.1
_EDGE_SECONDS = 0.03  # frames past the lead-in's end left out of the envelope's maximum


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


def _detect(filtered: np.ndarray, sr: int, delta: float) -> np.ndarray:
    """Onset times in seconds, in the filtered (lead-in padded) signal's own timeline.

    The envelope is min-max normalised as librosa would, except that its maximum skips the frames
    where the lead-in silence meets the clip: a stem that starts on a continuous bed (a separated
    hat band always does) jumps out of digital silence there, and that one jump would otherwise
    set the scale and bury every real onset under delta.
    """
    env = librosa.onset.onset_strength(y=filtered.astype(np.float32), sr=sr, hop_length=_HOP)
    wait_frames = max(1, round(_WAIT_SECONDS * sr / _HOP))
    edge = round((_LEAD_IN_SECONDS + _EDGE_SECONDS) * sr / _HOP)
    low = float(env.min()) if len(env) else 0.0
    peak = float(env[edge:].max()) if len(env) > edge else float(env.max(initial=0.0))
    env = (env - low) / (peak - low) if peak > low else env - low
    return librosa.onset.onset_detect(
        onset_envelope=env,
        sr=sr,
        hop_length=_HOP,
        units="time",
        backtrack=False,
        normalize=False,
        delta=delta,
        wait=wait_frames,
    )


def _lead_in(y: np.ndarray, sr: int) -> tuple[np.ndarray, int]:
    lead = round(_LEAD_IN_SECONDS * sr)
    return np.concatenate([np.zeros(lead), np.asarray(y, dtype=float)]), lead


def band_onsets(
    y: np.ndarray, sr: int, low: float | None, high: float | None, delta: float = _DELTA
) -> np.ndarray:
    """Onset times in seconds of y's energy in one band.

    librosa takes `wait` in frames, so 50 ms is converted at the onset envelope's hop. The envelope
    is min-max normalised before peak picking (see _detect), and the lead-in silence pins its
    minimum at zero, so `delta` (0.2 by default) is a fraction of the envelope's maximum. A peak
    must clear the local mean of the envelope by delta.
    """
    padded, lead = _lead_in(y, sr)
    return _detect(band(padded, sr, low, high), sr, delta) - lead / sr
