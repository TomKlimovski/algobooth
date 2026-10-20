"""Bass stem transcription and a brightness measure of the bass sound."""

from pathlib import Path

import numpy as np

from algorip.grid import Grid
from algorip.key import Key
from algorip.notes import Note, Predictor, basic_pitch_predict, monophonic, quantise, snap_to_key

BASS_LOW = 24  # C1
BASS_HIGH = 60  # C4


def _fold(midi: int) -> int:
    """midi moved by octaves into BASS_LOW..BASS_HIGH."""
    while midi < BASS_LOW:
        midi += 12
    while midi > BASS_HIGH:
        midi -= 12
    return midi


def transcribe_bass(stem: Path, grid: Grid, key: Key, predict: Predictor = basic_pitch_predict) -> list[Note]:
    """The bass stem as a monophonic, in-key line on the grid, every note folded into the bass register."""
    notes = monophonic(snap_to_key(quantise(predict(stem), grid), key))
    return [n.model_copy(update={"midi": _fold(n.midi)}) for n in notes]


def _midi_hz(midi: int) -> float:
    return 440.0 * 2.0 ** ((midi - 69) / 12)


def harmonic_ratio(y: np.ndarray, sr: int, notes: list[Note], grid: Grid) -> float:
    """The median over notes of the share of spectral magnitude above twice the note's fundamental.

    Each note is measured over its own window on the grid (Hann-windowed); 0.0 with no notes.
    Notes whose window holds no samples or no signal are skipped.
    """
    ratios = []
    for note in notes:
        start = round(grid.time_of(note.bar, note.step) * sr)
        end = round(grid.time_of(note.bar, note.step + note.length) * sr)
        chunk = np.asarray(y[max(0, start) : end], dtype=float)
        if len(chunk) < 2:
            continue
        spectrum = np.abs(np.fft.rfft(chunk * np.hanning(len(chunk))))
        total = spectrum.sum()
        if total <= 0:
            continue
        freqs = np.fft.rfftfreq(len(chunk), 1.0 / sr)
        ratios.append(float(spectrum[freqs > 2 * _midi_hz(note.midi)].sum() / total))
    return float(np.median(ratios)) if ratios else 0.0
