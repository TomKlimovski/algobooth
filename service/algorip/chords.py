"""One chord per bar from the "other" stem: the best-matching major or minor triad; and how the stem sounds."""

import librosa
import numpy as np

from algorip.grid import Grid
from algorip.key import PITCH_NAMES
from algorip.schema import OtherTone

SILENT_BAR = 0.01  # a bar under this share of the loudest bar's chroma energy has no chord of its own
NO_CHORD = "~"
_HOP = 512
_TONE_HOP = 256
DECAY_AFTER = 0.25  # seconds after an onset's peak at which its level is read
PEAK_WITHIN = 0.05  # seconds: an onset's peak is the loudest frame this soon after it
LOUD_SHARE = 0.1  # an onset or frame under this share of the stem's loudest frame is not measured

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


def other_tone(other: np.ndarray, sr: int) -> OtherTone | None:
    """The stem's median decay over DECAY_AFTER from each loud onset's peak, and its median brightness.

    The decay tells a held part (a pad stays near 0 dB) from struck keys and stabs (a pluck falls more than 20 dB;
    Solomun 36:40's stabs 16.6, 48:50's part 6); only onsets whose peak is loud count, since a quiet onset under a
    held chord reads as no decay at all. The 85% rolloff over the loud frames tells a mellow part from a bright
    one (1.3 kHz at 36:40, 5.3 kHz at 48:50). None for a silent stem or one with no loud onset.
    """
    y = np.asarray(other, dtype=np.float32)
    env = librosa.feature.rms(y=y, frame_length=4 * _TONE_HOP, hop_length=_TONE_HOP)[0]
    loud = float(env.max()) if len(env) else 0.0
    if loud <= 0:
        return None
    later = int(round(DECAY_AFTER * sr / _TONE_HOP))
    within = max(1, int(round(PEAK_WITHIN * sr / _TONE_HOP)))
    drops = []
    for onset in librosa.onset.onset_detect(y=y, sr=sr, hop_length=_TONE_HOP):
        peak = onset + int(np.argmax(env[onset : onset + within]))
        if env[peak] < LOUD_SHARE * loud or peak + later >= len(env):
            continue
        drops.append(20 * np.log10(env[peak + later] / env[peak] + 1e-9))
    if not drops:
        return None
    rolloff = librosa.feature.spectral_rolloff(y=y, sr=sr, hop_length=_TONE_HOP, roll_percent=0.85)[0]
    n = min(len(rolloff), len(env))
    bright = float(np.median(rolloff[:n][env[:n] >= LOUD_SHARE * loud]))
    return OtherTone(decay_db=round(float(np.median(drops)), 1), rolloff_hz=round(bright))
