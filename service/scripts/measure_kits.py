"""Build algorip/kits.json: every 909 and 808 sample's level and fall, for the sound choice by shape.

Run from service/: `uv run python scripts/measure_kits.py`. Reads the app's sample index
(app/public/samples/tidal-drum-machines.json) and each wav; writes the table beside kits.py.

For each bank (tr909, tr808), voice (bd, sd, cp, hh, oh) and index n: the file, the voice band's
peak level (5 ms RMS, dB) and fall_ms, the time from that peak to 12 dB under it (the first 12 dB
of the fall, which every voice reaches before a stem's floor). The bands are the classifier's:
kick under 150 Hz, snare and clap 1 to 6 kHz, hats from 6 kHz. drums.drum_tone measures a stem
the same way, so the two are comparable.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # service/, so algorip imports when run as a script

from algorip.kits import FALL_DB, VOICE_BANDS, _fall_ms, _rms_envelope
from algorip.onsets import band

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "app" / "public" / "samples" / "tidal-drum-machines.json"
OUT = ROOT / "service" / "algorip" / "kits.json"
BANKS = {"RolandTR909": "tr909", "RolandTR808": "tr808"}


def measure(path: Path) -> list[dict]:
    index = json.loads(path.read_text())
    table: dict[str, dict[str, list[dict]]] = {}
    for folder, bank in BANKS.items():
        for voice, (low, high) in VOICE_BANDS.items():
            rows = []
            for n, rel in enumerate(index.get(f"{folder}_{voice}", [])):
                y, sr = sf.read(path.parent / "tidal-drum-machines" / rel)
                y = np.asarray(y, dtype=float)
                y = y.mean(axis=1) if y.ndim > 1 else y
                env = _rms_envelope(band(y, sr, low, high), sr)
                peak = int(np.argmax(env))
                rows.append({
                    "n": n,
                    "file": rel.split("/")[-1],
                    "level_db": round(float(20 * np.log10(max(env[peak], 1e-9))), 1),
                    "fall_ms": _fall_ms(env, peak),
                })
            table.setdefault(bank, {})[voice] = rows
    return table


if __name__ == "__main__":
    OUT.write_text(json.dumps(measure(INDEX), indent=1) + "\n")
    print(f"wrote {OUT}")
