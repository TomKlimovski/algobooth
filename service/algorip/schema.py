"""The service's wire types: what the TypeScript client mirrors, all JSON-serialisable."""

from typing import Literal

from pydantic import BaseModel, model_validator

from algorip.notes import Note

MAX_CLIP_SECONDS = 60


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


class SoundChoice(BaseModel):
    drum_bank: str
    snare_name: Literal["sd", "cp"]
    bass_sound: Literal["sawtooth", "triangle", "sine"]
    bass_lpf: int | None
    chord_sound: str = "sawtooth"
    chord_lpf: int = 1200
    room: float = 0.4


class RipRequest(BaseModel):
    url: str
    start: float
    end: float
    tidy: bool = False
    claude_api_key: str | None = None

    @model_validator(mode="after")
    def _check(self) -> "RipRequest":
        if not self.url.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        if not 0 <= self.start < self.end:
            raise ValueError("Start must be at least 0 and before the end")
        if self.end - self.start > MAX_CLIP_SECONDS:
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
