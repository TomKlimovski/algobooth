"""The service's wire types: what the TypeScript client mirrors, all JSON-serialisable."""

from typing import Literal

from pydantic import BaseModel, model_validator

from algorip.notes import Note

MAX_CLIP_SECONDS = 60
_CLIP_EPSILON = 1e-6  # 64.4 - 4.4 is 60.00000000000001 in binary floating point, still 60 s


class BassLoop(BaseModel):
    """The bass as a loop: the bars it repeats, a layer some bars add on top, and how well each fits the stem."""

    period: int
    templates: list[list[Note]]  # one per phase; every note has bar == 0
    layer: list[list[Note]] | None  # one per phase of the layer's own period
    layer_bars: tuple[int, int] | None  # 1-based inclusive
    match: float  # the loop alone against the stem's step grid, over every bar
    match_with_layer: float | None  # the loop plus the layer, over every bar


class MeasuredEnvelope(BaseModel):
    """How the bass stem's notes shape over time, each a median over the transcribed notes."""

    attack_ms: float  # from a note's onset (20 dB under its peak) to within 3 dB of it
    hold_ms: float  # from the onset to the last moment within 3 dB of the peak
    fall_ms: float  # from the end of the hold to 20 dB down, capped at the note's end
    end_db: float  # the level just before the note's end, relative to its peak
    hold_share: float  # hold_ms over the note's written length


class StrudelEnvelope(BaseModel):
    """The gate written on the bass lines, in Strudel's units: a fast attack, full level for the hold, a short release."""

    attack: float  # seconds
    clip: float | None  # the hold as a share of the written note; None when the note holds to its end
    release: float  # seconds


class BassTone(BaseModel):
    """How the bass stem's notes sound, each a median over the transcribed notes."""

    open_hz: float  # the 85% spectral rolloff over a note's first 25 ms
    hold_hz: float  # ...and over its hold
    close_ms: float  # from the onset until the rolloff settles within a quarter octave of the hold
    wobble_hz: float | None  # the strongest periodic level wobble on the hold, 5 to 20 Hz, when the notes carry one
    wobble_db: float | None  # ...and its peak-to-trough depth


class FilterEnvelope(BaseModel):
    """The lowpass envelope written on the bass lines: opens `octaves` above the cutoff, closes over `close` seconds."""

    octaves: float
    close: float


class Tremolo(BaseModel):
    rate: float  # Hz
    depth: float  # 0..1, superdough's: the level swings between 1 - depth and 1


class DrumSummary(BaseModel):
    """The drum voices as loops, in brief: how long the longest loop is and how much of the hits they play."""

    period: int  # the longest period among voices with a regular part; 0 when none has one
    match: float  # F1 of the hits the loops play against the classified hits
    fill_bars: tuple[int, int] | None  # 1-based inclusive; None when no voice fills


class DrumTone(BaseModel):
    """Each drum voice on the stem, by shape and level: the voice band's median peak (dB) and the median time
    for the first 12 dB of its fall (ms), over the voice's hits. The kick is the level reference."""

    levels: dict[str, float]
    falls: dict[str, float]


class Analysis(BaseModel):
    bpm: float
    key: str
    meter: str = "4/4"
    bars: int
    steps_per_bar: int = 16
    first_downbeat: float
    drums: dict[str, list[tuple[int, int]]]  # voice -> sorted (bar, step) hits
    four_on_the_floor: bool
    bass: list[Note]
    bass_harmonics: float
    chords: list[str]
    melody: list[Note] | None
    bass_loop: BassLoop | None = None
    drum_summary: DrumSummary | None = None
    drum_tone: DrumTone | None = None
    bass_envelope: MeasuredEnvelope | None = None
    bass_tone: BassTone | None = None
    tuning_cents: float = 0.0  # the clip's offset from 440 tuning, removed before the bass was rounded


class SoundChoice(BaseModel):
    drum_bank: str
    snare_name: Literal["sd", "cp"]
    bass_sound: Literal["sawtooth", "triangle", "sine"]
    bass_lpf: int | None
    chord_sound: str = "sawtooth"
    chord_lpf: int = 1200
    room: float = 0.4
    bass_envelope: StrudelEnvelope | None = None
    bass_filter_env: FilterEnvelope | None = None
    bass_tremolo: Tremolo | None = None
    drum_samples: dict[str, int] = {}  # voice -> the bank sample's index, when not 0 (chosen by shape)
    drum_gains: dict[str, float] = {}  # voice -> the line's gain, when 2 dB or more from Strudel's 0.8


class RipRequest(BaseModel):
    url: str
    start: float
    end: float
    tidy: bool = False
    claude_api_key: str | None = None
    keep_downloads: bool | None = None  # None: the service's launch setting (ALGOBOOTH_KEEP_DOWNLOADS)
    # True: return the result stored by this clip's last rip, if there is one, without running anything
    # (the Recent menu); a plain Analyse recomputes.
    replay: bool = False

    @model_validator(mode="after")
    def _check(self) -> "RipRequest":
        if not self.url.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        if not 0 <= self.start < self.end:
            raise ValueError("Start must be at least 0 and before the end")
        if self.end - self.start > MAX_CLIP_SECONDS + _CLIP_EPSILON:
            raise ValueError("Clip must be 60 seconds or less")
        return self


class RipResult(BaseModel):
    title: str
    analysis: Analysis
    sounds: SoundChoice
    code: str
    tidied_code: str | None
    tidy_error: str | None
    stems: list[str]  # names only


Stage = Literal["download", "separate", "analyse", "generate", "tidy"]


class JobStatus(BaseModel):
    id: str
    status: Literal["queued", "running", "done", "failed", "cancelled"]
    stage: Stage | None
    progress: float  # 0..1 within the stage
    result: RipResult | None
    error: str | None


class ModelStatus(BaseModel):
    ready: bool
    torch_installed: bool
    weights_present: bool
    installing: bool
    stage: str | None
    progress: float
    error: str | None
