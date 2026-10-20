"""Synthetic audio with known ground truth for the analysis tests.

Everything is float32 mono at SR. Time is laid out the same way everywhere:
a bar is 240 / bpm seconds (four beats), a step is a sixteenth of a bar, and
an event at time t starts at sample round(t * SR). Noise is drawn from fixed
seeds, so every call with the same arguments returns the same samples.

A drum voice's "decay" is the time its exponential envelope takes to fall by
60 dB; the voice is cut off there, so a hit occupies exactly that long.
"""

import numpy as np
from scipy import signal

from algorip.audio import SR

STEPS_PER_BAR = 16
_DECAY_60DB = np.log(1000.0)
_FILTER_LEAD_IN = 4096  # noise discarded ahead of each filtered burst, past the filter's startup transient


def _samples(seconds: float) -> int:
    return round(seconds * SR)


def _bar_seconds(bpm: float) -> float:
    return 240.0 / bpm


def _step_start(bar: int, step: int, bpm: float) -> int:
    return _samples((bar * STEPS_PER_BAR + step) * _bar_seconds(bpm) / STEPS_PER_BAR)


def _noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).uniform(-1.0, 1.0, n)


def _decay(n: int) -> np.ndarray:
    """Exponential envelope that falls 60 dB over n samples."""
    return np.exp(-_DECAY_60DB * np.arange(n) / n)


def _ramps(n: int, seconds: float) -> np.ndarray:
    """Linear fade in and fade out of `seconds` each over an n-sample note."""
    ramp = min(_samples(seconds), n // 2)
    env = np.ones(n)
    if ramp:
        env[:ramp] = np.arange(1, ramp + 1) / ramp
        env[n - ramp :] = np.arange(ramp, 0, -1) / ramp
    return env


def _normalise(y: np.ndarray) -> np.ndarray:
    return y / np.abs(y).max()


def _filtered_noise(n: int, seed: int, sos: np.ndarray) -> np.ndarray:
    return signal.sosfilt(sos, _noise(n + _FILTER_LEAD_IN, seed))[_FILTER_LEAD_IN:]


def _place(out: np.ndarray, start: int, sound: np.ndarray) -> None:
    """Add sound into out at start, truncated at the end of out."""
    end = min(len(out), start + len(sound))
    if end > start:
        out[start:end] += sound[: end - start]


def _harmonic_tone(freq: float, n: int, harmonics: int) -> np.ndarray:
    t = np.arange(n) / SR
    return sum(np.sin(2 * np.pi * k * freq * t) / k for k in range(1, harmonics + 1))


def _midi_hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12)


def click_track(bpm: float, bars: int, accent_downbeats: bool = True) -> np.ndarray:
    """A 2 ms noise click (peak 1.0) on every beat; with accents, a 100 ms 60 Hz sine at 0.8 on each beat 1."""
    out = np.zeros(_samples(bars * _bar_seconds(bpm)))
    click = _normalise(_noise(_samples(0.002), seed=1))
    thump = 0.8 * np.sin(2 * np.pi * 60 * np.arange(_samples(0.1)) / SR)
    for beat in range(bars * 4):
        start = _samples(beat * 60.0 / bpm)
        _place(out, start, click)
        if accent_downbeats and beat % 4 == 0:
            _place(out, start, thump)
    return out.astype(np.float32)


_CLICK_DB = -18.0  # the kick's beater click, re the kick's peak


def _bd(click: bool = False) -> np.ndarray:
    """A swept sine kick at peak 1.0; with click, a 3 ms broadband noise burst at -18 dB on top of its start."""
    n = _samples(0.15)
    t = np.arange(n) / SR
    freq = 80.0 * (45.0 / 80.0) ** (t / 0.15)  # exponential sweep 80 -> 45 Hz
    phase = 2 * np.pi * np.cumsum(freq) / SR
    attack = np.minimum(1.0, np.arange(1, n + 1) / _samples(0.005))
    kick = _normalise(np.sin(phase) * attack * _decay(n))
    if click:
        burst = _normalise(_noise(_samples(0.003), seed=6)) * 10.0 ** (_CLICK_DB / 20.0)
        kick[: len(burst)] += burst
    return kick


def _sd() -> np.ndarray:
    n = _samples(0.12)
    sos = signal.butter(4, [200, 2000], btype="bandpass", fs=SR, output="sos")
    return _normalise(_filtered_noise(n, seed=2, sos=sos) * _decay(n))


def _hat(seconds: float, seed: int) -> np.ndarray:
    n = _samples(seconds)
    sos = signal.butter(4, 6000, btype="highpass", fs=SR, output="sos")
    return _normalise(_filtered_noise(n, seed=seed, sos=sos) * _decay(n))


_CP_BURST_GAP = 0.01
_CP_AIR_DB = -10.0  # the clap's air above 6 kHz, re its 1-4 kHz body


def _cp() -> np.ndarray:
    """A hand clap at peak 1.0: three noise bursts 10 ms apart, then a 120 ms exponential tail.

    The noise is band-passed 1-4 kHz (4th-order Butterworth) plus the same noise high-passed at
    6 kHz at -10 dB: a real clap's air, which reaches the hat band.
    """
    gap = _samples(_CP_BURST_GAP)
    tail = _samples(0.12)
    n = 2 * gap + tail
    env = np.zeros(n)
    for k in range(2):  # the first two bursts; each falls 60 dB over its 10 ms
        env[k * gap : (k + 1) * gap] = _decay(gap)
    env[2 * gap :] = _decay(tail)  # the third burst opens the tail
    noise = _noise(n + _FILTER_LEAD_IN, seed=5)
    body = signal.sosfilt(signal.butter(4, [1000, 4000], btype="bandpass", fs=SR, output="sos"), noise)
    air = signal.sosfilt(signal.butter(4, 6000, btype="highpass", fs=SR, output="sos"), noise)
    sound = (body + air * 10.0 ** (_CP_AIR_DB / 20.0))[_FILTER_LEAD_IN:]
    return _normalise(sound * env)


_VOICES = {
    "bd": _bd,
    "sd": _sd,
    "cp": _cp,
    "hh": lambda: _hat(0.03, seed=3),
    "oh": lambda: _hat(0.3, seed=4),
}


def drum_loop(hits: dict[str, set[tuple[int, int]]], bpm: float, bars: int, click: bool = False) -> np.ndarray:
    """Each voice ("bd", "sd", "cp", "hh", "oh") at peak 1.0 on its (bar, step) keys of a 16-step grid.

    click gives the kick its beater click (see _bd).
    """
    unknown = set(hits) - set(_VOICES)
    if unknown:
        raise ValueError(f"unknown drum voice(s): {sorted(unknown)}")
    out = np.zeros(_samples(bars * _bar_seconds(bpm)))
    for name, keys in hits.items():
        sound = _bd(click) if name == "bd" else _VOICES[name]()
        for bar, step in keys:
            _place(out, _step_start(bar, step, bpm), sound)
    return out.astype(np.float32)


def bass_line(notes: list[tuple[int, int, int, int]], bpm: float, bars: int) -> np.ndarray:
    """Each (bar, step, length_steps, midi) as harmonics 1..6 at amplitude 1/n, with 10 ms attack and release."""
    out = np.zeros(_samples(bars * _bar_seconds(bpm)))
    for bar, step, length, midi in notes:
        start = _step_start(bar, step, bpm)
        n = _step_start(bar, step + length, bpm) - start
        _place(out, start, _harmonic_tone(_midi_hz(midi), n, harmonics=6) * _ramps(n, 0.01))
    return out.astype(np.float32)


def plucked_bass(notes: list[tuple[int, int, int, int]], bpm: float, bars: int, release_seconds: float) -> np.ndarray:
    """Like bass_line, but each note rings on past its length, fading linearly to silence over release_seconds.

    The 10 ms attack is kept; the tail runs into whatever follows (a rest, or the next note, summed).
    """
    out = np.zeros(_samples(bars * _bar_seconds(bpm)))
    release = _samples(release_seconds)
    for bar, step, length, midi in notes:
        start = _step_start(bar, step, bpm)
        n = _step_start(bar, step + length, bpm) - start
        env = np.ones(n + release)
        attack = min(_samples(0.01), n)
        env[:attack] = np.arange(1, attack + 1) / attack
        env[n:] = np.arange(release, 0, -1) / release
        _place(out, start, _harmonic_tone(_midi_hz(midi), n + release, harmonics=6) * env)
    return out.astype(np.float32)


_TRIADS = {"major": (0, 4, 7), "minor": (0, 3, 7)}


def pad_chords(chords: list[tuple[int, str]], bpm: float) -> np.ndarray:
    """One (root_midi, "major" | "minor") triad per bar; each note harmonics 1 and 2 at 1/n, held the whole bar.

    Each bar gets 10 ms fades so chord changes do not click.
    """
    out = np.zeros(_samples(len(chords) * _bar_seconds(bpm)))
    for bar, (root, quality) in enumerate(chords):
        if quality not in _TRIADS:
            raise ValueError(f"unknown chord quality: {quality!r}")
        start = _step_start(bar, 0, bpm)
        n = _step_start(bar + 1, 0, bpm) - start
        chord = sum(_harmonic_tone(_midi_hz(root + i), n, harmonics=2) for i in _TRIADS[quality])
        _place(out, start, chord * _ramps(n, 0.01))
    return out.astype(np.float32)


def hf_floor(seconds: float, level_db: float) -> np.ndarray:
    """A continuous noise bed high-passed at 6 kHz, at an RMS of level_db re full scale.

    A separated drum stem carries such a bed under its hats; it keeps the hat band from ever
    falling far below its hits.
    """
    n = _samples(seconds)
    sos = signal.butter(4, 6000, btype="highpass", fs=SR, output="sos")
    bed = _filtered_noise(n, seed=7, sos=sos)
    return (bed * 10.0 ** (level_db / 20.0) / np.sqrt(np.mean(bed**2))).astype(np.float32)


def silence(seconds: float) -> np.ndarray:
    return np.zeros(_samples(seconds), dtype=np.float32)


def mix(*parts: np.ndarray) -> np.ndarray:
    """Zero-pad to the longest part, sum, and scale so the peak is 0.9 (all-silent input stays silent)."""
    out = np.zeros(max(len(p) for p in parts))
    for p in parts:
        out[: len(p)] += p
    peak = np.abs(out).max()
    if peak > 0:
        out *= 0.9 / peak
    return out.astype(np.float32)
