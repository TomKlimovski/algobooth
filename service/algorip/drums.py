"""Drum onset classification: kick, snare, closed and open hat on the 16-step grid.

Each voice starts from its own frequency band, detected independently, so hits that coincide
on a step (a kick under a hat, a kick under a snare) can all be kept. A separated drum stem
needs four more rules on top, because a clap's air reaches the hat band, a kick's click and
body reach the hat and snare bands, and a continuous bed sits under the hats:

- D1, clap vs hat: a hat-band onset whose attack adds little more 6-16 kHz than 1-4 kHz energy
  is a clap, a snare or a kick's click, unless it is a tight closed-hat burst.
- D2, hat prominence: a hat must clear the hat band's own floor; a hat-band onset on a kick or a
  snare must also reach the level of the track's other hats, or it is that drum's bleed.
- D3, open vs closed: judged by how fast the hat falls towards the floor, not by a fixed fall.
- D4, a snare under a kick: judged at each kick, against the track's own kicks.
"""

import librosa
import numpy as np
from scipy import signal

from algorip.grid import Grid
from algorip.onsets import _DELTA, _LEAD_IN_SECONDS, _detect, _lead_in, band, band_onsets  # noqa: F401  (re-exported)

VOICES = ("bd", "sd", "hh", "oh")
DrumHits = dict[str, set[tuple[int, int]]]

# The snare band picks up hat and kick leakage on the log-scaled onset envelope: in the house
# loop at up to 0.43 of its max, against 0.61 for the weakest real snare; under full kicks a
# gain-0.15 snare lets the kick on step 8 through at 0.4 but not at 0.6. Hats under an open-hat
# tail peak at 0.34 in theirs, so no single delta serves both bands; the snare band uses a higher one.
_SNARE_DELTA = 0.6

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
# both; -18 rejects hats-only leakage. (The gate only governs snare-band onsets away from kicks:
# a snare under a kick is found by D4 at the kick, which keeps the gain-0.15 snare.)
GATE_DB = {"bd": -16.0, "sd": -18.0, "hh": -30.0}

_KICK_BAND = (None, 150.0)
_SNARE_BAND = (200.0, 2500.0)
_HAT_BAND = (6000.0, None)

_ENV_HOP_SECONDS = 0.005  # RMS envelope hop
_ATTACK_SECONDS = 0.03  # a hit's attack peak is the loudest envelope frame this soon after its onset
_NEAR_SECONDS = 0.035  # onsets this close in different bands are one event (a kick under a snare)

# Onsets are placed by librosa to within a hop (~12 ms) and a 30 ms hat is mostly over by then,
# so the hat measures start from the attack: the steepest 3 ms rise of the hat band's own 1 ms
# log-energy envelope within [onset - 30 ms, onset + 15 ms].
_REFINE_BEFORE_SECONDS = 0.03
_REFINE_AFTER_SECONDS = 0.015
_REFINE_HOP_SECONDS = 0.001

# Spectral measures use the positive power-spectrum increment from [t - w, t] to [t, t + w]
# (Hann window, 2048-point FFT), which leaves out whatever was already ringing (an open hat's
# tail under a clap). Measured in dB over a band.
_INCREMENT_SECONDS = 0.03
_SPECTRUM_N = 2048
_BODY_BAND = (1000.0, 4000.0)  # a snare's or clap's body
_AIR_BAND = (6000.0, 16000.0)  # a hat, or a clap's air

# D1. A hat-band onset whose attack increment has under 3 dB more air than body is a clap, a
# snare or a kick's click, not a hat: it is dropped from the hats and, away from kicks and
# snare-band onsets, becomes a snare. (The reviewer's starting rule, an increment centroid under
# 5 kHz, puts the synthetic clap at 6.4 kHz and a hat over a snare at 3.8 kHz: the wrong way
# round.) The exception is a tight burst, falling at 1 dB/ms or faster: a closed hat over a
# snare. Measured, air minus body: real off-beat open hats 5.1 at the least (One More Time,
# 32 hits), real hat-band onsets on the claps -6.5 to 5.1 (13 of 16 under 3); synthetic hats
# +23.5 to +37.3, the synthetic clap -4.1 to -3.3, a hat over a snare -14.0 to -12.9. Fall
# rates of the flagged onsets: real 0.08 to 0.63 dB/ms, the synthetic clap 0.33 to 0.46, a
# synthetic closed hat over a snare 1.5 to 2.0.
_CLAP_AIR_DB = 3.0
_TIGHT_DB_PER_MS = 1.0

# D2. A hat must clear the hat band's floor (its envelope's 20th percentile over the clip) by
# 6 dB. Measured over the floor: real off-beat hats 13.2 to 18.1 dB; synthetic kick clicks 2.9
# to 3.9, synthetic closed hats over a -26 dB bed 9.7 to 14.5.
_FLOOR_PERCENTILE = 20
_OVER_FLOOR_DB = 6.0
# A hat-band onset on a kick or a snare must also reach the median of the track's other hats
# less 2 dB, or it is that drum's bleed. Measured against that median: real kick bleed -4.8 dB;
# synthetic hats on kicks and snares +1.0 to +1.1. With no other hats, only the floor applies.
_OWN_LEVEL_DB = 2.0

# D3. Open iff the envelope falls no faster than 30 dB per 80 ms on its way to max(peak - 30 dB,
# floor + 6 dB), cut at the next hat-band onset. A floor 14 dB under a real hat leaves only 8 dB
# to fall, so the time it takes (35 to 95 ms on the real off-beats) cannot carry a fixed 120 ms
# split; the rate can. Measured: real off-beat open hats 0.04 to 0.27 dB/ms, synthetic open hats
# 0.16 to 0.20, synthetic closed hats 0.73 (over a bed) to 2.0. With no floor the target is
# peak - 30 dB, as before, and the split sits at 80 ms to reach it.
_DECAY_FLOOR_DB = -30.0
_DECAY_WINDOW_SECONDS = 0.4
_OPEN_DB_PER_MS = 30.0 / 80.0

# D4. A snare under a kick is judged at every kick: the body increment over 45 ms windows split
# 10 ms after the kick's onset (a clap's body builds over its bursts, after the kick's own
# attack) must reach the lower quartile of that same measure over all the clip's kicks (which
# calibrates the kick's own bleed) by 16 dB. A snare-band or D1 onset near a kick is left to this
# test. Measured over the lower quartile: real clap kicks (4/12) 22.4 to 34.7 dB, real plain
# kicks (0/8) 11.2 at most; synthetic plain kicks with clicks 8.4 at most, claps +41 or more.
_SNARE_OVER_KICK_DB = 16.0
_KICK_BODY_DELAY_SECONDS = 0.01
_KICK_BODY_SECONDS = 0.045
# The lower quartile assumes at least a quarter of the kicks are plain; with a snare on (nearly)
# every kick it is itself a snare kick, and bd*4 + sd*4 kept 2 of 8 snares. So a kick that the
# snare band also fires on keeps its snare when its body increment stands 15 dB over the kick's
# own low band (RMS of the 150 Hz low-pass from 10 ms before the onset to 60 ms after): a
# kick-only reference that needs no other kicks. The snare band alone is not enough: on the real
# track it fires on 27 of 33 kicks, 13 of them plain. Measured, body over low band: real plain
# kicks -3.0 to 13.7 dB, real clap kicks 24.9 to 38.0; synthetic plain kicks with clicks 8.8 at
# most, a snare on every kick 16.0 to 36.0, claps 46 or more.
_SNARE_OVER_LOW_DB = 15.0
_LOW_BEFORE_SECONDS = 0.01
_LOW_AFTER_SECONDS = 0.06

_FOUR_ON_THE_FLOOR_STEPS = (0, 4, 8, 12)
_FOUR_ON_THE_FLOOR_SHARE = 0.75


def _rms_envelope(y: np.ndarray, sr: int) -> np.ndarray:
    """RMS of y over consecutive 5 ms hops."""
    hop = max(1, round(_ENV_HOP_SECONDS * sr))
    frames = len(y) // hop
    return np.sqrt(np.mean(np.asarray(y[: frames * hop]).reshape(frames, hop) ** 2, axis=1))


def _peak_rms(y: np.ndarray, sr: int) -> float:
    env = _rms_envelope(y, sr)
    return float(env.max()) if len(env) else 0.0


def _attack_time(y: np.ndarray, sr: int, t: float) -> float:
    """The steepest 3 ms rise in y's 1 ms log-energy envelope within [t - 30 ms, t + 15 ms]."""
    hop = max(1, round(_REFINE_HOP_SECONDS * sr))
    start = max(0, round((t - _REFINE_BEFORE_SECONDS) * sr))
    seg = y[start : round((t + _REFINE_AFTER_SECONDS) * sr)]
    m = len(seg) // hop
    if m < 7:
        return t
    log = 10.0 * np.log10(np.mean(seg[: m * hop].reshape(m, hop) ** 2, axis=1) + 1e-20)
    smooth = np.convolve(log, np.ones(3) / 3, mode="valid")  # smooth[j] is the mean of frames j..j+2
    rise = smooth[3:] - smooth[:-3]  # rise[j]: frames j+3..j+5 over frames j..j+2
    return (start + (int(np.argmax(rise)) + 3) * hop) / sr


def _power_spectrum(y: np.ndarray, start: int, n: int) -> np.ndarray:
    seg = np.zeros(n)
    lo, hi = max(0, start), min(len(y), start + n)
    if hi > lo:
        seg[lo - start : hi - start] = y[lo:hi]
    return np.abs(np.fft.rfft(seg * np.hanning(n), _SPECTRUM_N)) ** 2


def _increment(y: np.ndarray, sr: int, t: float, seconds: float = _INCREMENT_SECONDS) -> np.ndarray:
    """The positive power-spectrum increment from [t - seconds, t] to [t, t + seconds] (30 ms by default)."""
    n = round(seconds * sr)
    i = round(t * sr)
    return np.maximum(_power_spectrum(y, i, n) - _power_spectrum(y, i - n, n), 0.0)


def _band_db(power: np.ndarray, sr: int, low: float, high: float) -> float:
    f = np.fft.rfftfreq(_SPECTRUM_N, 1.0 / sr)
    return float(10.0 * np.log10(power[(f >= low) & (f < high)].sum() + 1e-20))


def _db(x: float) -> float:
    return float(20.0 * np.log10(max(x, 1e-12)))


def _hat_shape(env: np.ndarray, i: int, nxt: int, floor: float) -> tuple[float, float]:
    """(attack over the floor in dB, fall rate in dB/ms) of the hat-band envelope from frame i.

    The attack is the loudest frame in the first 30 ms. The fall runs from it to the first frame
    under max(attack - 30 dB, floor + 6 dB), within 400 ms and before frame nxt (the next onset);
    if it never gets there, to the lowest frame in that window.
    """
    window = env[i : i + max(1, round(_ATTACK_SECONDS / _ENV_HOP_SECONDS))]
    if len(window) == 0 or window.max() <= 0:
        return -np.inf, np.inf
    peak = i + int(np.argmax(window))
    attack = float(env[peak])
    target = max(attack * 10.0 ** (_DECAY_FLOOR_DB / 20.0), floor * 10.0 ** (_OVER_FLOOR_DB / 20.0))
    tail = env[peak : min(nxt, peak + round(_DECAY_WINDOW_SECONDS / _ENV_HOP_SECONDS), len(env))]
    below = np.nonzero(tail < target)[0]
    if len(below):
        frames, level = int(below[0]), target
    else:
        frames = int(np.argmin(tail))
        level = float(tail[frames])
    ms = max(frames, 1) * _ENV_HOP_SECONDS * 1000.0
    return _db(attack) - _db(floor), (_db(attack) - _db(level)) / ms


def _low_db(kick_band: np.ndarray, sr: int, t: float) -> float:
    """The kick band's power (dB) from 10 ms before t to 60 ms after."""
    seg = kick_band[max(0, round((t - _LOW_BEFORE_SECONDS) * sr)) : round((t + _LOW_AFTER_SECONDS) * sr)]
    return float(10.0 * np.log10(np.mean(seg**2) + 1e-30)) if len(seg) else -300.0


def _near(times: list[float], t: float) -> bool:
    return any(abs(u - t) <= _NEAR_SECONDS for u in times)


def classify_drums(drums: np.ndarray, sr: int, grid: Grid) -> DrumHits:
    """Kick, snare and hat hits from three band detections and rules D1 to D4, placed on the grid."""
    padded, lead = _lead_in(drums, sr)
    reference = _peak_rms(padded, sr)

    def onsets(voice: str, low: float | None, high: float | None, delta: float) -> tuple[np.ndarray, list[float]]:
        filtered = band(padded, sr, low, high)
        if _peak_rms(filtered, sr) < reference * 10.0 ** (GATE_DB[voice] / 20.0):
            return filtered, []
        return filtered, [float(t) for t in _detect(filtered, sr, delta)]

    kick_band, kicks = onsets("bd", *_KICK_BAND, _DELTA)
    _, snare_band = onsets("sd", *_SNARE_BAND, _SNARE_DELTA)
    high, hat_band = onsets("hh", *_HAT_BAND, _DELTA)

    hits: DrumHits = {voice: set() for voice in VOICES}

    def add(voice: str, t: float) -> None:  # t on the padded timeline
        step = grid.step_at(t - lead / sr)
        if step is not None:
            hits[voice].add(step)

    for t in kicks:
        add("bd", t)

    # D4
    body = [_band_db(_increment(padded, sr, t + _KICK_BODY_DELAY_SECONDS, _KICK_BODY_SECONDS), sr, *_BODY_BAND)
            for t in kicks]
    kick_body = float(np.percentile(body, 25)) if body else 0.0
    snares = [t for t, b in zip(kicks, body)
              if b >= kick_body + _SNARE_OVER_KICK_DB
              or (_near(snare_band, t) and b - _low_db(kick_band, sr, t) >= _SNARE_OVER_LOW_DB)]
    snares += [t for t in snare_band if not _near(kicks, t)]

    env = _rms_envelope(high, sr)
    floor = float(np.percentile(env, _FLOOR_PERCENTILE)) if len(env) else 0.0
    hop = max(1, round(_ENV_HOP_SECONDS * sr))
    attacks = [_attack_time(high, sr, t) for t in hat_band]
    frames = [round(a * sr / hop) for a in attacks]

    hats: list[tuple[float, float, float, bool]] = []  # (onset, over the floor, fall rate, on a kick or snare)
    for k, (t, a) in enumerate(zip(hat_band, attacks)):
        inc = _increment(padded, sr, a)
        air = _band_db(inc, sr, *_AIR_BAND) - _band_db(inc, sr, *_BODY_BAND)
        over, rate = _hat_shape(env, frames[k], frames[k + 1] if k + 1 < len(frames) else len(env), floor)
        if air < _CLAP_AIR_DB:  # D1
            if not _near(kicks, t) and not _near(snares, t):
                snares.append(t)
            if rate < _TIGHT_DB_PER_MS:
                continue
        if over >= _OVER_FLOOR_DB:  # D2
            hats.append((t, over, rate, _near(snares, t) or _near(kicks, t)))

    for t in snares:
        add("sd", t)

    others = [over for _, over, _, shared in hats if not shared]
    own_level = float(np.median(others)) - _OWN_LEVEL_DB if others else None
    for t, over, rate, shared in hats:
        if shared and own_level is not None and over < own_level:
            continue
        add("oh" if rate <= _OPEN_DB_PER_MS else "hh", t)  # D3
    return hits


def is_four_on_the_floor(hits: DrumHits, bars: int) -> bool:
    """A kick on steps 0, 4, 8 and 12 in at least 75% of bars."""
    if bars <= 0:
        return False
    kicks = hits.get("bd", set())
    full = sum(all((bar, s) in kicks for s in _FOUR_ON_THE_FLOOR_STEPS) for bar in range(bars))
    return full >= _FOUR_ON_THE_FLOOR_SHARE * bars
