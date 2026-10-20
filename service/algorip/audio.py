"""Loading and writing audio at the service's working sample rate."""

from pathlib import Path

import librosa
import numpy as np
import soundfile as sf

SR = 44100


def load_mono(path: Path, sr: int = SR) -> np.ndarray:
    """Decode any file librosa can read to a float32 mono signal at `sr`."""
    y, _ = librosa.load(path, sr=sr, mono=True)
    return y.astype(np.float32, copy=False)


def load_stereo(path: Path, sr: int = SR) -> np.ndarray:
    """Decode to float32 of shape (2, n) at `sr`; a mono file is duplicated to both channels."""
    y, _ = librosa.load(path, sr=sr, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    return y[:2].astype(np.float32, copy=False)


def write_wav(path: Path, y: np.ndarray, sr: int = SR) -> None:
    """Write a (n,) mono or (2, n) stereo signal as 16-bit PCM WAV."""
    if y.ndim == 2 and y.shape[0] == 2:
        data = y.T
    elif y.ndim == 1:
        data = y
    else:
        raise ValueError(f"expected shape (n,) or (2, n), got {y.shape}")
    sf.write(path, data, sr, subtype="PCM_16")
