"""Note events from a pitch tracker, quantised onto the bar grid and cleaned into a monophonic line."""

from collections.abc import Callable
from pathlib import Path

from pydantic import BaseModel, Field

from algorip.grid import STEPS_PER_BAR, Grid
from algorip.key import Key

NoteEvent = tuple[float, float, int, float]  # (start_s, end_s, midi, amplitude)
Predictor = Callable[[Path], list[NoteEvent]]


class Note(BaseModel):
    bar: int
    step: int
    length: int = Field(ge=1)  # steps
    midi: int


def basic_pitch_predict(path: Path) -> list[NoteEvent]:
    """Basic Pitch's note events for the audio file at path, with the pitch bends dropped."""
    # Imported here: basic_pitch prints backend warnings on import and loads a model.
    from basic_pitch.inference import predict

    _, _, note_events = predict(str(path))
    return [(float(start), float(end), int(pitch), float(amp)) for start, end, pitch, amp, _ in note_events]


def quantise(events: list[NoteEvent], grid: Grid, min_amplitude: float = 0.1) -> list[Note]:
    """Each event's start to its nearest step and its length to whole steps (at least 1).

    Events quieter than min_amplitude, or starting outside the grid, are dropped.
    """
    notes = []
    for start, end, midi, amplitude in events:
        if amplitude < min_amplitude:
            continue
        position = grid.step_at(start)
        if position is None:
            continue
        length = max(1, round((end - start) / grid.step_seconds))
        notes.append(Note(bar=position[0], step=position[1], length=length, midi=midi))
    return notes


def snap_to_key(notes: list[Note], key: Key) -> list[Note]:
    """Out-of-scale notes move a semitone to a scale tone, down first, then up; others are unchanged."""
    scale = key.scale
    out = []
    for note in notes:
        midi = note.midi
        if midi % 12 not in scale:
            if (midi - 1) % 12 in scale:
                midi -= 1
            elif (midi + 1) % 12 in scale:
                midi += 1
        out.append(note.model_copy(update={"midi": midi}))
    return out


def _index(note: Note) -> int:
    return note.bar * STEPS_PER_BAR + note.step


def monophonic(
    notes: list[Note], events_amplitude: dict[tuple[int, int, int], float] | None = None
) -> list[Note]:
    """One note at a time, in (bar, step) order.

    Of notes on the same step, the louder survives (amplitude keyed by (bar, step, midi) when
    given, else the lower midi). A note that overlaps the previous one cuts the previous note
    down to the gap between their starts.
    """

    def rank(note: Note) -> tuple[float, int]:
        loudness = events_amplitude.get((note.bar, note.step, note.midi), 0.0) if events_amplitude else 0.0
        return (-loudness, note.midi)

    out: list[Note] = []
    for note in sorted(notes, key=lambda n: (_index(n), rank(n))):
        if out and _index(out[-1]) == _index(note):
            continue  # a quieter (or higher) note on a step already taken
        if out:
            prev = out[-1]
            gap = _index(note) - _index(prev)
            if prev.length > gap:
                out[-1] = prev.model_copy(update={"length": max(1, gap)})
        out.append(note.model_copy())
    return out
