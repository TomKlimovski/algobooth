"""Musical key estimation with Krumhansl-Schmuckler profiles."""

from typing import Literal

import librosa
import numpy as np
from pydantic import BaseModel

PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

_SCALE_STEPS = {"major": (0, 2, 4, 5, 7, 9, 11), "minor": (0, 2, 3, 5, 7, 8, 10)}
_PROFILES = {"major": MAJOR_PROFILE, "minor": MINOR_PROFILE}


class Key(BaseModel):
    tonic: int  # pitch class 0..11
    mode: Literal["major", "minor"]

    @property
    def name(self) -> str:
        return f"{PITCH_NAMES[self.tonic]} {self.mode}"

    @property
    def scale(self) -> set[int]:
        return {(self.tonic + s) % 12 for s in _SCALE_STEPS[self.mode]}


def _pearson(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = np.sqrt((a**2).sum() * (b**2).sum())
    return float((a * b).sum() / denom) if denom > 0 else float("-inf")


def estimate_key(y: np.ndarray, sr: int) -> Key:
    """The key whose rotated profile best correlates with the signal's mean chroma.

    Ties go to the lower tonic, then to major.
    """
    chroma = librosa.feature.chroma_cqt(y=np.asarray(y, dtype=np.float32), sr=sr).mean(axis=1)
    best: Key | None = None
    best_r = float("-inf")
    for tonic in range(12):
        for mode in ("major", "minor"):
            r = _pearson(chroma, np.roll(np.asarray(_PROFILES[mode]), tonic))
            if best is None or r > best_r:
                best, best_r = Key(tonic=tonic, mode=mode), r
    return best


def key_from_stems(other: np.ndarray, bass: np.ndarray, sr: int) -> Key:
    """The key of the "other" stem plus bass, zero-padded to the longer and summed."""
    both = np.zeros(max(len(other), len(bass)), dtype=np.float32)
    both[: len(other)] += other
    both[: len(bass)] += bass
    return estimate_key(both, sr)
