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
# The snare band picks up hat and kick leakage on the log-scaled onset envelope: in the house
# loop at up to 0.43 of its max, against 0.61 for the weakest real snare; under full kicks a
# gain-0.15 snare lets the kick on step 8 through at 0.4 but not at 0.6. Hats under an open-hat
# tail peak at 0.34 in theirs, so no single delta serves both bands; the snare band uses a higher one.
_SNARE_DELTA = 0.6
_WAIT_SECONDS = 0.05  # minimum gap between onsets in one band
# librosa's onset envelope is zero for its first few frames, so a hit at t=0 would be lost.
# Detection runs on y behind this much silence, shifted back after. The silence goes in before
# the band filter: the zero-phase filter rings ahead of each hit, and a hit at sample 0 with its
# pre-ringing cut off reads as a much louder onset than the same hit mid-file.
_LEAD_IN_SECONDS = 0.1

# A band whose peak RMS (5 ms hops) is under its voice's gate, relative to the whole stem's
# peak RMS, carries only leakage from other voices and gets no onsets: the onset threshold is
# relative to the band's own envelope, so leakage alone would otherwise read as hits.
# Measured on the synthetic kit, in band peak RMS re stem peak RMS:
#   leakage, each voice alone at full level:
#     kick band:  hats -20.3, snare -30.9, open hat -67.3
#     snare band: hats -18.8, kick -29.4, open hat -50.5
#     hat band:   snare -31.1, kick -77.0
#   quiet voices under full-level kicks (noise voices read ~9 dB under their sample gain):
#     hats at gain 0.1 (-20 dB): -29.2 in the hat band; snare at gain 0.15 (-16.5 dB): -21.8
# Each gate sits between its band's worst leakage and the quietest voice it keeps. Hats: -30
# keeps gain 0.1 and rejects the snare's -31.1. Kick: -16 is 4 dB clear of the hats' -20.3.
# Snare: the hats' -18.8 leakage is louder than a gain-0.15 snare's -21.8, so no split keeps
# both; -18 rejects hats-only leakage and keeps snares under full kicks down to gain 0.25
# (-12 dB; gain 0.22 is gated out).
GATE_DB = {"bd": -16.0, "sd": -18.0, "hh": -30.0}

_KICK_BAND = (None, 150.0)
_SNARE_BAND = (200.0, 2500.0)
_HAT_BAND = (6000.0, None)

_DECAY_HIGHPASS_HZ = _HAT_BAND[0]  # decay is measured on the hat band's own signal
_DECAY_FLOOR_DB = -30.0
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


def _rms_envelope(y: np.ndarray, sr: int) -> np.ndarray:
    """RMS of y over consecutive 5 ms hops."""
    hop = max(1, round(_DECAY_HOP_SECONDS * sr))
    frames = len(y) // hop
    return np.sqrt(np.mean(np.asarray(y[: frames * hop]).reshape(frames, hop) ** 2, axis=1))


def _peak_rms(y: np.ndarray, sr: int) -> float:
    env = _rms_envelope(y, sr)
    return float(env.max()) if len(env) else 0.0


def _detect(filtered: np.ndarray, sr: int, delta: float) -> np.ndarray:
    """Onset times in seconds, in the filtered signal's own timeline."""
    env = librosa.onset.onset_strength(y=filtered.astype(np.float32), sr=sr, hop_length=_HOP)
    wait_frames = max(1, round(_WAIT_SECONDS * sr / _HOP))
    return librosa.onset.onset_detect(
        onset_envelope=env,
        sr=sr,
        hop_length=_HOP,
        units="time",
        backtrack=False,
        normalize=True,
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

    librosa takes `wait` in frames, so 50 ms is converted at the onset envelope's hop. librosa
    min-max normalises the envelope (normalize=True) before peak picking, and the lead-in silence
    pins its minimum at zero, so `delta` (0.2 by default) is a fraction of the envelope's maximum.
    A peak must clear the local mean of the envelope by delta.
    """
    padded, lead = _lead_in(y, sr)
    return _detect(band(padded, sr, low, high), sr, delta) - lead / sr


def _decay_ms_at(high: np.ndarray, sr: int, start: int, floor_db: float) -> float:
    """decay_ms on an already high-passed signal, from sample `start`."""
    cap = _DECAY_WINDOW_SECONDS * 1000.0
    rms = _rms_envelope(high[max(0, start) : max(0, start) + round(_DECAY_WINDOW_SECONDS * sr)], sr)
    if len(rms) == 0:
        return 0.0
    attack = rms[: max(1, round(_DECAY_ATTACK_SECONDS / _DECAY_HOP_SECONDS))]
    peak = int(np.argmax(attack))
    if rms[peak] <= 0:
        return 0.0
    threshold = rms[peak] * 10.0 ** (floor_db / 20.0)
    below = np.nonzero(rms[peak:] < threshold)[0]
    if len(below) == 0:
        return cap
    return min(cap, (peak + int(below[0])) * _DECAY_HOP_SECONDS * 1000.0)


def decay_ms(y: np.ndarray, sr: int, t: float, floor_db: float = _DECAY_FLOOR_DB) -> float:
    """Milliseconds after t until the 6 kHz high-passed RMS envelope falls floor_db below its peak, within 400 ms.

    At -30 dB closed hats sit well under 80 ms and open hats well over 150 ms, so the 120 ms
    open-hat threshold splits them; at -20 dB a 300 ms (to -60 dB) open hat reads only 100 ms.
    The envelope is RMS over 5 ms hops. The peak is the hit at t's own: the loudest frame in the first
    30 ms (onsets land within about a frame of the hit). A later, louder hit in the window would
    otherwise set the reference and the count. The fall is the first frame after that peak below
    the threshold. Capped at 400.
    """
    return _decay_ms_at(band(y, sr, _DECAY_HIGHPASS_HZ, None), sr, round(t * sr), floor_db)


def _place(onsets: np.ndarray, grid: Grid) -> set[tuple[int, int]]:
    steps = (grid.step_at(float(t)) for t in onsets)
    return {s for s in steps if s is not None}


def classify_drums(drums: np.ndarray, sr: int, grid: Grid) -> DrumHits:
    """Kick, snare and hat hits from three independent band detections, placed on the grid.

    Each band is filtered once; the hat band's own high-passed signal (the same 6 kHz high-pass
    decay_ms uses) is sliced per hit to measure decay.
    """
    padded, lead = _lead_in(drums, sr)
    reference = _peak_rms(padded, sr)

    def onsets(voice: str, low: float | None, high: float | None, delta: float) -> tuple[np.ndarray, np.ndarray]:
        filtered = band(padded, sr, low, high)
        if _peak_rms(filtered, sr) < reference * 10.0 ** (GATE_DB[voice] / 20.0):
            return filtered, np.array([])
        return filtered, _detect(filtered, sr, delta) - lead / sr

    hits: DrumHits = {voice: set() for voice in VOICES}
    hits["bd"] = _place(onsets("bd", *_KICK_BAND, _DELTA)[1], grid)
    hits["sd"] = _place(onsets("sd", *_SNARE_BAND, _SNARE_DELTA)[1], grid)
    high, hat_onsets = onsets("hh", *_HAT_BAND, _DELTA)
    for t in hat_onsets:
        step = grid.step_at(float(t))
        if step is not None:
            open_hat = _decay_ms_at(high, sr, round(t * sr) + lead, _DECAY_FLOOR_DB) >= _OPEN_HAT_MS
            hits["oh" if open_hat else "hh"].add(step)
    return hits


def is_four_on_the_floor(hits: DrumHits, bars: int) -> bool:
    """A kick on steps 0, 4, 8 and 12 in at least 75% of bars."""
    if bars <= 0:
        return False
    kicks = hits.get("bd", set())
    full = sum(all((bar, s) in kicks for s in _FOUR_ON_THE_FLOOR_STEPS) for bar in range(bars))
    return full >= _FOUR_ON_THE_FLOOR_SHARE * bars
