"""Golden files for the bass loop: a clip's analysis, its bass step grid, its Strudel code and its loop as events.

`scripts/bass_fixture.py` writes them, from cached stems or from the synthetic build below; the tests
read them back. No audio is ever written here or committed.
"""

import json
from pathlib import Path

import numpy as np

from algorip.audio import SR, load_mono
from algorip.bass import transcribe_bass
from algorip.bassgrid import BassGrid
from algorip.generate import generate
from algorip.grid import Grid
from algorip.key import key_from_stems
from algorip.mini import note_name
from algorip.schema import Analysis, BassLoop
from algorip.sounds import choose_sounds

# Ruling 20: librosa's beat_track reads tempo from a tempogram, so it is quantised to 60 * SR / (hop * k)
# (here 126.05, 123.05, ...); a tempo between steps, like 124, reads 123.0 and drifts about a step over
# 8 bars. This is the k = 42 step, which the estimator reads exactly (a grid.py follow-up for the owner).
BUILD_BPM = 60 * 44100 / (512 * 42)  # 123.046875
BUILD_BARS = 8
BUILD_ROOT = 33  # A1; the build is in A minor
# Ruling 5: two bars that share only the held root at step 0 (so period 1 fails), each then running
# six short notes over steps 8-15, no two neighbours on one pitch class: seven onsets a bar, so the
# 21 extra onsets of the three build bars leave the loop alone an onset F1 near 0.84.
_BUILD_TAILS = (
    ((8, 36), (10, 40), (11, 33), (12, 31), (14, 40), (15, 38)),  # C2 E2 A1 G1 E2 D2
    ((8, 31), (9, 33), (10, 38), (12, 40), (13, 36), (14, 33)),  # G1 A1 D2 E2 C2 A1
)
BUILD_LAYER_BARS = range(5, 8)  # 0-based; bars 6-8 to a reader
_BUILD_CHORDS = [(57, "minor"), (53, "major"), (48, "major"), (55, "major")]  # Am F C G, one per bar
_PAD_GAIN = 0.3


def bass_events(loop: BassLoop | None) -> list[dict]:
    """The loop's notes as {cycle, step, length, note}, cycle being the phase; [] with no loop."""
    if loop is None:
        return []
    events = [
        {"cycle": p, "step": n.step, "length": n.length, "note": note_name(n.midi)}
        for p, template in enumerate(loop.templates)
        for n in template
    ]
    return sorted(events, key=lambda e: (e["cycle"], e["step"]))


def bass_grid_of(stems: dict[str, Path], analysis: Analysis) -> BassGrid:
    """The bass step grid `pipeline._analyse` built for this analysis.

    Ruling 12: `_analyse` returns only the Analysis, so the grid is rebuilt here from the same stems,
    key and grid; transcription is deterministic, so it is the same grid.
    """
    bass = load_mono(stems["bass"], SR)
    other = load_mono(stems["other"], SR)
    key = key_from_stems(other, bass, SR)
    grid = Grid(bpm=analysis.bpm, first_downbeat=analysis.first_downbeat, bars=analysis.bars)
    return transcribe_bass(bass, SR, grid, key)[0]


def write_golden(golden_dir: Path, name: str, analysis: Analysis, bg: BassGrid,
                 title: str, start: float, end: float) -> None:
    """<name>.analysis.json, .bassgrid.json, .strudel and .bass-events.json under golden_dir."""
    golden_dir.mkdir(parents=True, exist_ok=True)
    (golden_dir / f"{name}.analysis.json").write_text(analysis.model_dump_json(indent=2) + "\n")
    (golden_dir / f"{name}.bassgrid.json").write_text(bg.model_dump_json(indent=2) + "\n")
    (golden_dir / f"{name}.strudel").write_text(generate(analysis, choose_sounds(analysis), title, start, end))
    events = bass_events(analysis.bass_loop)
    (golden_dir / f"{name}.bass-events.json").write_text(json.dumps(events, indent=2, ensure_ascii=False) + "\n")


def build_bass_notes() -> list[tuple[int, int, int, int]]:
    """The build's bass as (bar, step, length, midi).

    Ruling 5: every bar opens on the root held two beats; bars 6-8 retrigger it as eight 16ths
    instead, so steps 1-7 are extra (at least LAYER_MIN_STEPS) and the layer writes
    `[~ a1 a1 a1] a1*4 ~ ~`, over the same pitch so the frame score stays whole.
    """
    notes = []
    for bar in range(BUILD_BARS):
        if bar in BUILD_LAYER_BARS:
            notes += [(bar, s, 1, BUILD_ROOT) for s in range(8)]
        else:
            notes.append((bar, 0, 8, BUILD_ROOT))
        notes += [(bar, s, 1, midi) for s, midi in _BUILD_TAILS[bar % 2]]
    return notes


def build_fixture_audio() -> tuple[dict[str, np.ndarray], float, int]:
    """The synthetic build's stems (drums, bass, other, vocals, mix), its bpm and its bars."""
    # The synthesiser lives with the tests; the fixture script puts the service root on sys.path.
    from tests.synth import bass_line, click_track, drum_loop, mix, pad_chords, silence

    bars = BUILD_BARS
    house = {"bd": {(b, s) for b in range(bars) for s in (0, 4, 8, 12)},
             "sd": {(b, s) for b in range(bars) for s in (4, 12)},
             "hh": {(b, s) for b in range(bars) for s in range(0, 14, 2)},
             "oh": {(b, 14) for b in range(bars)}}
    # Ruling 14: with four identical kicks a bar, estimate_grid's downbeat phase (the beat with the most
    # energy under 150 Hz) is a coin toss; it read the bar three beats late. click_track's 60 Hz thump on
    # each beat 1 (with its clicks, which land on the kicks) gives beat 1 the most low-band energy.
    drums = drum_loop(house, BUILD_BPM, bars) + click_track(BUILD_BPM, bars)
    bass = bass_line(build_bass_notes(), BUILD_BPM, bars)
    other = (pad_chords(_BUILD_CHORDS * (bars // len(_BUILD_CHORDS)), BUILD_BPM) * _PAD_GAIN).astype(np.float32)
    vocals = silence(len(drums) / SR)
    stems = {"drums": drums, "bass": bass, "other": other, "vocals": vocals, "mix": mix(drums, bass, other)}
    return stems, BUILD_BPM, bars
