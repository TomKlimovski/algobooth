"""One rip end to end: download, separate, analyse, generate and (optionally) tidy.

Every heavy or networked step comes in through `Deps`, so tests run the whole
pipeline on synthetic audio with no network, no Demucs and no Basic Pitch (which hears only the melody now; the bass goes through pyin).
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from pydantic import BaseModel

from algorip.audio import SR, load_mono
from algorip.bass import bass_envelope, choose_bass_loop, harmonic_ratio, transcribe_bass
from algorip.chords import estimate_chords
from algorip.download import Fetcher, Runner, clip_key, fetch_clip, run_command, yt_dlp_fetch
from algorip.drumloop import drum_loops
from algorip.drums import VOICES, classify_drums, is_four_on_the_floor
from algorip.generate import generate
from algorip.grid import estimate_grid
from algorip.key import key_from_stems
from algorip.melody import transcribe_melody
from algorip.notes import Predictor, basic_pitch_predict
from algorip.schema import Analysis, DrumSummary, RipRequest, RipResult, Stage
from algorip.separate import STEMS, Separator, demucs_separator, separate
from algorip.sounds import choose_sounds
from algorip.tidy import Chat, anthropic_chat, tidy

Progress = Callable[[Stage, float], None]
RESULT_STEMS = [*STEMS, "mix"]


class Cancelled(Exception):
    """The job was cancelled; raised between stages."""


class Paths(BaseModel):
    cache_dir: Path
    models_dir: Path
    keep_downloads: bool


@dataclass
class Deps:
    fetch: Fetcher = yt_dlp_fetch
    run: Runner = run_command
    separator: Separator | None = None  # None means demucs_separator(models_dir), built on first use
    predict: Predictor = basic_pitch_predict
    chat: Chat = anthropic_chat
    cancelled: Callable[[], bool] = lambda: False


def stem_dir(paths: Paths, req: RipRequest) -> Path:
    return paths.cache_dir / "stems" / clip_key(req.url, req.start, req.end)


RESULT_FILE = "result.json"


def stored_result(paths: Paths, req: RipRequest) -> RipResult | None:
    """The result of this clip's last rip, or None when there is none or it no longer parses."""
    try:
        return RipResult.model_validate_json((stem_dir(paths, req) / RESULT_FILE).read_text())
    except (OSError, ValueError):
        return None


def _store_result(paths: Paths, req: RipRequest, result: RipResult) -> None:
    target = stem_dir(paths, req) / RESULT_FILE
    partial = target.with_name(f"{RESULT_FILE}.partial")
    partial.write_text(result.model_dump_json())
    partial.replace(target)


def run_rip(req: RipRequest, paths: Paths, progress: Progress, deps: Deps) -> RipResult:
    def enter(stage: Stage) -> None:
        if deps.cancelled():
            raise Cancelled()
        progress(stage, 0.0)

    if req.replay and (stored := stored_result(paths, req)) is not None:
        for stage in ("download", "separate", "analyse", "generate"):
            enter(stage)
            progress(stage, 1.0)
        return stored

    enter("download")
    keep = paths.keep_downloads if req.keep_downloads is None else req.keep_downloads
    clip, title = fetch_clip(req.url, req.start, req.end, paths.cache_dir, keep,
                             fetch=deps.fetch, run=deps.run)
    progress("download", 1.0)

    enter("separate")
    separator = deps.separator or demucs_separator(paths.models_dir)
    stems = separate(clip, stem_dir(paths, req), separator)
    progress("separate", 1.0)

    enter("analyse")
    analysis = _analyse(stems, deps.predict, lambda f: progress("analyse", f))

    enter("generate")
    sounds = choose_sounds(analysis)
    code = generate(analysis, sounds, title, req.start, req.end)
    progress("generate", 1.0)

    tidied_code, tidy_error = None, None
    if req.tidy and req.claude_api_key:
        enter("tidy")
        tidied_code, tidy_error = tidy(code, analysis, sounds, req.claude_api_key, chat=deps.chat)
        progress("tidy", 1.0)

    result = RipResult(title=title, analysis=analysis, sounds=sounds, code=code, tidied_code=tidied_code,
                       tidy_error=tidy_error, stems=list(RESULT_STEMS))
    _store_result(paths, req, result)
    return result


def _analyse(stems: dict[str, Path], predict: Predictor, report: Callable[[float], None]) -> Analysis:
    mix = load_mono(stems["mix"], SR)
    drums = load_mono(stems["drums"], SR)
    grid = estimate_grid(mix, drums, SR, len(mix) / SR)
    report(0.2)

    other = load_mono(stems["other"], SR)
    bass = load_mono(stems["bass"], SR)
    key = key_from_stems(other, bass, SR)
    report(0.3)

    hits = classify_drums(drums, SR, grid)
    report(0.5)

    bg, bass_notes = transcribe_bass(bass, SR, grid, key)
    bass_harmonics = harmonic_ratio(bass, SR, bass_notes, grid)
    report(0.7)

    chords = estimate_chords(other, SR, grid)
    report(0.9)

    melody = transcribe_melody(stems["other"], grid, key, predict=predict)
    analysis = Analysis(
        bpm=grid.bpm,
        key=key.name,
        bars=grid.bars,
        steps_per_bar=grid.steps_per_bar,
        first_downbeat=grid.first_downbeat,
        drums={voice: sorted(hits.get(voice, set())) for voice in VOICES},
        four_on_the_floor=is_four_on_the_floor(hits, grid.bars),
        bass=bass_notes,
        bass_harmonics=bass_harmonics,
        chords=chords,
        melody=melody,
        bass_loop=choose_bass_loop(bg, grid, bass_notes),
        bass_envelope=bass_envelope(bass, SR, bass_notes, grid),
    )
    analysis = analysis.model_copy(update={"drum_summary": _drum_summary(analysis)})
    report(1.0)
    return analysis


def _drum_summary(a: Analysis) -> DrumSummary | None:
    """The drum loops of the analysed hits, in brief, for the Rip tab; None when no voice has a hit."""
    loops = drum_loops(a)
    if not loops.voices:
        return None
    regular = [v.period for v in loops.voices.values() if any(v.templates)]
    return DrumSummary(period=max(regular, default=0), match=loops.match, fill_bars=loops.fill_bars)
