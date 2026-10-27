"""One chord per bar from the "other" stem: the best-matching major or minor triad; and how the stem sounds.

The triad's root comes from a template match on CQT chroma. Its third, and whether the bar has a chord of its own,
come from a peak chroma (`peak_chroma_bars`), which measures notes rather than their smear: on Solomun 36:40 the CQT
chroma puts G# 0.44 to 0.58 and F# 0.30 to 0.43 either side of a bare G. Measured with the peak chroma, bars 0 to 6
read G and D with A# at most 0.17 of G and B at most 0.16: a root and a fifth, which takes G minor's third.
"""

import librosa
import numpy as np

from algorip.grid import Grid
from algorip.key import PITCH_NAMES, Key
from algorip.schema import OtherTone

SILENT_BAR = 0.01  # a bar under this share of the loudest bar's chroma energy has no chord of its own
NO_CHORD = "~"
_HOP = 512
_TONE_HOP = 256
DECAY_AFTER = 0.25  # seconds after an onset's peak at which its level is read
PEAK_WITHIN = 0.05  # seconds: an onset's peak is the loudest frame this soon after it
LOUD_SHARE = 0.1  # an onset or frame under this share of the stem's loudest frame is not measured
CLEAR_SHARE = 0.45  # a bar whose four strongest peak pitch classes hold less than this share has no chord of its own
THIRD_SHARE = 0.25  # a third under this share of the root's peak chroma is not heard
EXT_SHARE = 0.4  # a 7th or 9th under this share of the root's peak chroma is not heard
_PEAK_BINS_PER_SEMITONE = 3
_PEAK_OCTAVES = 7

_TRIADS = {False: (0, 4, 7), True: (0, 3, 7)}  # minor -> intervals


def chord_name(root: int, minor: bool) -> str:
    """Sharps-only root name, with "m" for minor: "A#", "F#m"."""
    return PITCH_NAMES[root % 12] + ("m" if minor else "")


def spell(root: int, minor: bool, seventh: int | None, ninth: bool) -> str:
    """The symbol for a root, its third, a 7th (10 or 11 semitones, or None) and a 9th: "Am7", "G^9", "Gmadd9".

    The single place chord symbols are formed: a 9th with a 7th is a 9 chord ("9"/"^9", "m9"/"m^9"), a 7th alone
    "7"/"^7" ("m7"/"m^7"), a 9th alone "add9" ("madd9").
    """
    name = chord_name(root, minor)
    major_seventh = "^" if seventh == 11 else ""
    if seventh is not None:
        return name + major_seventh + ("9" if ninth else "7")
    return name + ("add9" if ninth else "")


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


def peak_chroma_bars(other: np.ndarray, sr: int, grid: Grid) -> list[np.ndarray]:
    """Per bar, the mean peak chroma: each semitone by how far its centre bin stands above its neighbours.

    A CQT at 3 bins per semitone from C1 over 7 octaves, tuned by the clip's own tuning, so bin 3k is semitone k's
    centre and 3k-1, 3k+1 its neighbours. Per frame a semitone scores max(0, centre - max(neighbours)), and the
    octaves sum into 12 pitch classes. A pitch wobble or a neighbour's skirt raises a centre bin and its neighbours
    together, so it scores little; a held note stands alone. Measured on 36:40: G and D (D from 0.35 of G to louder
    than G) where the CQT chroma shows F# and G# around the G; on a fifth wobbling +-40 cents, F# 0.01 and G# 0.00
    of G, against D 0.24. Zeros for a bar with no frames.
    """
    y = np.asarray(other, dtype=np.float32)
    per_octave = 12 * _PEAK_BINS_PER_SEMITONE
    # librosa.cqt reads tuning in fractions of one of its own bins, so it is estimated at the same resolution.
    tuning = librosa.estimate_tuning(y=y, sr=sr, bins_per_octave=per_octave)
    c = np.abs(
        librosa.cqt(
            y,
            sr=sr,
            hop_length=_HOP,
            fmin=librosa.note_to_hz("C1"),
            n_bins=_PEAK_OCTAVES * per_octave,
            bins_per_octave=per_octave,
            tuning=tuning,
        )
    )
    padded = np.pad(c, ((1, 1), (0, 0)))  # an edge bin's missing neighbour counts as silent
    centres = padded[1:-1:_PEAK_BINS_PER_SEMITONE]
    neighbours = np.maximum(padded[0:-2:_PEAK_BINS_PER_SEMITONE], padded[2::_PEAK_BINS_PER_SEMITONE])
    peaks = np.maximum(0.0, centres - neighbours)  # (semitones, frames), semitone 0 is C1
    chroma = peaks.reshape(_PEAK_OCTAVES, 12, -1).sum(axis=0)
    return _bar_means(chroma, sr, grid)


def _is_clear(peak: np.ndarray) -> bool:
    """Whether the bar's four strongest peak pitch classes hold at least CLEAR_SHARE of its peak chroma.

    A chord concentrates the weight, flat chroma spreads it. Measured top-four shares: synthetic triads and fifths
    1.0, white noise 0.38 to 0.43 (three seeds), 36:40's bars 0.53 to 0.78, 48:50's bars 0.69, 0.42, 0.43, 0.447 and
    0.54. So 48:50's bars 1 to 3 repeat bar 0's chord, bar 3 by 0.003 under the line: an open finding (see the
    design), and the margins either side are thin, so a bar that moves on a rerun is a finding, not a reason to tune.
    """
    total = float(peak.sum())
    return total > 0 and float(np.sort(peak)[-4:].sum()) >= CLEAR_SHARE * total


def _third(root: int, minor: bool, peak: np.ndarray, key: Key | None) -> bool:
    """Whether the chord on root is minor, by the third the peak chroma hears, else the key's, else the template's.

    A third counts as heard at THIRD_SHARE of the root's peak chroma. If both are heard, the louder decides (an exact
    tie keeps the template's pick). If neither is, a root in the key's scale takes the key's diatonic quality: minor
    if the minor third is in the scale and the major third is not, major the other way. A root outside the key, or
    on its diminished degree (no perfect fifth in the scale), keeps the template's pick.

    Measured on 36:40 (of G): A# at most 0.17 and B at most 0.16 in bars 0 to 6, so they take G minor's third; bar 7
    A# 0.77; bar 8 B 0.40 against A# 0.37, so it writes `G`. On 48:50, bar 0 reads G 0.29 of D#, so it writes `D#`,
    and bar 4 D 0.40 against C# 0.39 of A#, so it writes `A#`. Those three are open findings (see the design).
    """
    lower, upper = peak[(root + 3) % 12], peak[(root + 4) % 12]
    floor = THIRD_SHARE * peak[root]
    heard_minor, heard_major = bool(lower >= floor), bool(upper >= floor)
    if heard_minor and heard_major:
        return bool(lower > upper) if lower != upper else minor
    if heard_minor or heard_major:
        return heard_minor
    if key is None or root not in key.scale or (root + 7) % 12 not in key.scale:
        return minor  # outside the key, or its diminished degree (ii in minor, vii in major)
    has_minor, has_major = (root + 3) % 12 in key.scale, (root + 4) % 12 in key.scale
    if has_minor != has_major:
        return has_minor
    return minor


def _extensions(root: int, peak: np.ndarray) -> tuple[int | None, bool]:
    """The 7th (10, 11 or None) and whether the 9th is heard: each at EXT_SHARE of the root's peak chroma.

    If both 7ths clear it the louder is written (an exact tie, the minor 7th). A minor 9th is never written. The
    peak chroma keeps a smear out: the wobbling fifth reads F# 0.01 and G# 0.00 of G.

    Measured on 36:40 (of G): 7ths at most 0.23 and 9ths at most 0.33 in bars 0 to 7, except bar 3's F# 0.49, which
    writes `Gm^7`; bar 8 A 1.00, F# 0.6675 and F 0.6656, so `G^9` by 0.002. On 48:50, bar 0 F 0.44 of D#
    (`D#add9`), bar 4 G# 0.43 and C 0.62 of A# (`A#9`). Bar 3's F#, and bar 8's 7th, are open findings (see the design).
    """
    floor = EXT_SHARE * peak[root]
    if floor <= 0:
        return None, False
    sevenths = [s for s in (10, 11) if peak[(root + s) % 12] >= floor]
    seventh = max(sevenths, key=lambda s: (peak[(root + s) % 12], -s)) if sevenths else None
    return seventh, bool(peak[(root + 2) % 12] >= floor)


def estimate_chords(other: np.ndarray, sr: int, grid: Grid, key: Key | None = None) -> list[str]:
    """Per bar, the chord heard: the triad whose binary template best matches the bar's mean chroma, plus a 7th or 9th.

    The template match uses librosa's CQT chroma, which separates the triads cleanly. The silence
    gate uses STFT chroma: the CQT's long low-frequency kernels smear a chord ~0.3 s into a silent
    neighbour (about 3% of a pad bar's energy), while STFT chroma keeps it near 0.01%. Neither is
    normalised per frame, so loudness carries into each bar's energy. A bar under 1% of the loudest
    bar's chroma energy repeats the previous bar's chord ("~" if it is the first bar). Ties go to the
    earlier template: major before minor, then lower root.

    Then the peak chroma (`peak_chroma_bars`) has the last word on two things. A bar with no clear notes
    (`_is_clear`) repeats the previous chord as a silent bar does: before, 48:50's noisy bars 1 and 2 wrote `Em`,
    outside D# minor. And the third comes from what the stem plays, or from the key when it plays none (`_third`):
    before, 36:40's bare G stab tied to `G` against a G minor key. A 7th or 9th the peak chroma hears
    (`_extensions`) is added, and `spell` writes the symbol.
    """
    y = np.asarray(other, dtype=np.float32)
    means = _bar_means(librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=_HOP, norm=None), sr, grid)
    gate = _bar_means(librosa.feature.chroma_stft(y=y, sr=sr, hop_length=_HOP, norm=None), sr, grid)
    peaks = peak_chroma_bars(y, sr, grid)
    energies = [float(m.sum()) for m in gate]
    loudest = max(energies, default=0.0)
    templates = _templates()
    chords: list[str] = []
    for mean, energy, peak in zip(means, energies, peaks):
        size = float(np.linalg.norm(mean))
        if loudest <= 0 or energy < SILENT_BAR * loudest or size <= 0 or not _is_clear(peak):
            chords.append(chords[-1] if chords else NO_CHORD)
            continue
        unit = mean / size
        scores = [float(unit @ t) for _, t in templates]
        pick = int(np.argmax(scores))
        root, minor = pick % 12, pick >= 12
        chords.append(spell(root, _third(root, minor, peak, key), *_extensions(root, peak)))
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
