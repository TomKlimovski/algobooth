"""One chord per bar from the "other" stem: the best-matching major or minor triad."""

import librosa
import numpy as np

from algorip.grid import Grid
from algorip.key import PITCH_NAMES

SILENT_BAR = 0.01  # a bar under this share of the loudest bar's chroma energy has no chord of its own
NO_CHORD = "~"
_HOP = 512

_TRIADS = {False: (0, 4, 7), True: (0, 3, 7)}  # minor -> intervals


def chord_name(root: int, minor: bool) -> str:
    """Sharps-only root name, with "m" for minor: "A#", "F#m"."""
    return PITCH_NAMES[root % 12] + ("m" if minor else "")


def _templates() -> list[tuple[str, np.ndarray]]:
    out = []
    for minor in (False, True):
        for root in range(12):
            template = np.zeros(12)
            template[[(root + i) % 12 for i in _TRIADS[minor]]] = 1.0
            out.append((chord_name(root, minor), template / np.linalg.norm(template)))
    return out


def _bar_means(chroma: np.ndarray, sr: int, grid: Grid) -> list[np.ndarray]:
    """Each bar's mean chroma over the frames centred in [bar start, next bar start); zeros if none."""
    frame_times = librosa.frames_to_time(np.arange(chroma.shape[1]), sr=sr, hop_length=_HOP)
    means = []
    for bar in range(grid.bars):
        in_bar = (frame_times >= grid.time_of(bar, 0)) & (frame_times < grid.time_of(bar + 1, 0))
        means.append(chroma[:, in_bar].mean(axis=1) if in_bar.any() else np.zeros(12))
    return means


def estimate_chords(other: np.ndarray, sr: int, grid: Grid) -> list[str]:
    """Per bar, the triad whose binary template has the highest cosine similarity with the bar's mean chroma.

    The template match uses librosa's CQT chroma, which separates the triads cleanly. The silence
    gate uses STFT chroma: the CQT's long low-frequency kernels smear a chord ~0.3 s into a silent
    neighbour (about 3% of a pad bar's energy), while STFT chroma keeps it near 0.01%. Neither is
    normalised per frame, so loudness carries into each bar's energy. A bar under 1% of the loudest
    bar's chroma energy repeats the previous bar's chord ("~" if it is the first bar). Ties go to the
    earlier template: major before minor, then lower root.
    """
    y = np.asarray(other, dtype=np.float32)
    means = _bar_means(librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=_HOP, norm=None), sr, grid)
    gate = _bar_means(librosa.feature.chroma_stft(y=y, sr=sr, hop_length=_HOP, norm=None), sr, grid)
    energies = [float(m.sum()) for m in gate]
    loudest = max(energies, default=0.0)
    templates = _templates()
    chords: list[str] = []
    for mean, energy in zip(means, energies):
        size = float(np.linalg.norm(mean))
        if loudest <= 0 or energy < SILENT_BAR * loudest or size <= 0:
            chords.append(chords[-1] if chords else NO_CHORD)
            continue
        unit = mean / size
        scores = [float(unit @ t) for _, t in templates]
        chords.append(templates[int(np.argmax(scores))][0])
    return chords
