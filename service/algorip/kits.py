"""The drum banks' samples by shape: kits.json, built by scripts/measure_kits.py from the app's sample packs.

`nearest_sample` picks, for a voice, the bank sample whose first 12 dB of fall takes nearest the time the
stem's does (on a log scale), so a long held kick gets the 909's long kick and a short tick its shortest hat.
Level is matched afterwards by gain (sounds.choose_sounds), not by sample.
"""

import json
from functools import cache
from pathlib import Path

import numpy as np
from pydantic import BaseModel

# The classifier's bands, shared with drums.drum_tone so the stem and the samples are measured alike.
VOICE_BANDS: dict[str, tuple[float | None, float | None]] = {
    "bd": (None, 150.0),
    "sd": (1000.0, 6000.0),
    "cp": (1000.0, 6000.0),
    "hh": (6000.0, None),
    "oh": (6000.0, None),
}
FALL_DB = 12.0  # the fall is timed from the band's peak to this far under it
ENV_HOP_SECONDS = 0.005


class KitSample(BaseModel):
    n: int
    file: str
    level_db: float  # the voice band's peak 5 ms RMS, dB re full scale
    fall_ms: float


def _rms_envelope(y: np.ndarray, sr: int) -> np.ndarray:
    hop = max(1, round(ENV_HOP_SECONDS * sr))
    frames = len(y) // hop
    if frames == 0:
        return np.zeros(1)
    return np.sqrt(np.mean(np.asarray(y[: frames * hop]).reshape(frames, hop) ** 2, axis=1))


def _fall_ms(env: np.ndarray, peak: int, until: int | None = None) -> float:
    """Milliseconds from frame `peak` to the first frame FALL_DB under it, before `until`; the span to `until`
    (or the envelope's end) when it never gets there."""
    stop = len(env) if until is None else min(until, len(env))
    tail = env[peak:stop]
    below = np.flatnonzero(tail < env[peak] * 10.0 ** (-FALL_DB / 20.0))
    frames = int(below[0]) if len(below) else max(len(tail) - 1, 1)
    return round(frames * ENV_HOP_SECONDS * 1000.0, 1)


@cache
def _table() -> dict[str, dict[str, list[KitSample]]]:
    raw = json.loads((Path(__file__).with_name("kits.json")).read_text())
    return {bank: {voice: [KitSample(**row) for row in rows] for voice, rows in voices.items()} for bank, voices in raw.items()}


def kit_samples(bank: str, voice: str) -> list[KitSample]:
    """The bank's samples for a voice, in index order; empty for a bank or voice the table lacks."""
    return list(_table().get(bank, {}).get(voice, []))


def nearest_sample(bank: str, voice: str, fall_ms: float) -> KitSample | None:
    """The sample whose fall is nearest fall_ms on a log scale; ties go to the lower index. None without samples."""
    samples = kit_samples(bank, voice)
    if not samples:
        return None
    target = np.log(max(fall_ms, 1.0))
    return min(samples, key=lambda s: (abs(np.log(max(s.fall_ms, 1.0)) - target), s.n))
