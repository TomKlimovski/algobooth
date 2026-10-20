"""Download audio with yt-dlp and trim a window with ffmpeg, caching both."""

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Callable

import yt_dlp
from pydantic import BaseModel


class DownloadInfo(BaseModel):
    path: Path
    title: str


class ClipInfo(BaseModel):
    """A clip in the cache: enough to rip it again without the download."""

    url: str
    start: float
    end: float
    title: str
    fetched_at: float


Fetcher = Callable[[str, Path], DownloadInfo]
Runner = Callable[[list[str]], None]


def yt_dlp_fetch(url: str, out_dir: Path) -> DownloadInfo:
    opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": str(out_dir / "%(id)s.%(ext)s"),
        "quiet": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return DownloadInfo(path=Path(info["requested_downloads"][0]["filepath"]), title=info["title"])


def run_command(cmd: list[str]) -> None:
    result = subprocess.run(cmd, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace"))


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def clip_key(url: str, start: float, end: float) -> str:
    return _digest(f"{url.strip()}|{start:.3f}|{end:.3f}")


def source_key(url: str) -> str:
    return _digest(url.strip())


def trim_command(source: Path, start: float, end: float, out: Path) -> list[str]:
    return [
        "ffmpeg", "-y", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
        "-i", str(source),
        "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le",
        str(out),
    ]


def probe_ffmpeg() -> str | None:
    return shutil.which("ffmpeg")


def _write_json(path: Path, data: dict) -> None:
    """Write via a temporary sibling, so an interrupted write never leaves a half-written sidecar."""
    partial = path.with_name(f"{path.name}.partial")
    partial.write_text(json.dumps(data))
    os.replace(partial, path)


def _read_json(path: Path, *keys: str) -> dict | None:
    """The sidecar's data, or None when it is missing, unreadable or lacks a key: a cache miss."""
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) for k in keys):
        return None
    return data


def _clip_meta(url: str, start: float, end: float, title: str) -> dict:
    return {"url": url.strip(), "start": float(start), "end": float(end), "title": title, "fetched_at": time.time()}


def _clip_info(data: dict) -> ClipInfo | None:
    try:
        return ClipInfo.model_validate(data)
    except ValueError:
        return None  # a sidecar from before the window was recorded, or a damaged one


def list_clips(cache_dir: Path) -> list[ClipInfo]:
    """The cached clips that can be ripped again, newest first (those whose audio or window is gone are left out)."""
    clips = cache_dir / "clips"
    found: list[ClipInfo] = []
    for meta in clips.glob("*.json") if clips.is_dir() else []:
        data = _read_json(meta, "title")
        info = _clip_info(data) if data is not None else None
        if info is not None and meta.with_suffix(".wav").exists():
            found.append(info)
    return sorted(found, key=lambda c: c.fetched_at, reverse=True)


def _cached_source(url: str, cache_dir: Path, fetch: Fetcher) -> tuple[DownloadInfo, Path]:
    folder = cache_dir / "sources" / source_key(url)
    sidecar = folder / "info.json"
    data = _read_json(sidecar, "path", "title")
    if data is not None:
        info = DownloadInfo(path=Path(data["path"]), title=data["title"])
        if info.path.exists():
            return info, folder
    folder.mkdir(parents=True, exist_ok=True)
    info = fetch(url, folder)
    _write_json(sidecar, {"path": str(info.path), "title": info.title})
    return info, folder


def fetch_clip(
    url: str,
    start: float,
    end: float,
    cache_dir: Path,
    keep_downloads: bool,
    fetch: Fetcher = yt_dlp_fetch,
    run: Runner = run_command,
) -> tuple[Path, str]:
    key = clip_key(url, start, end)
    clips = cache_dir / "clips"
    clip = clips / f"{key}.wav"
    meta = clips / f"{key}.json"
    cached = _read_json(meta, "title")
    if clip.exists() and cached is not None:
        if _clip_info(cached) is None:  # recorded before the window was kept: list it from now on
            _write_json(meta, _clip_meta(url, start, end, cached["title"]))
        return clip, cached["title"]

    clips.mkdir(parents=True, exist_ok=True)
    info, folder = _cached_source(url, cache_dir, fetch)
    tmp = clips / f"{key}.tmp.wav"
    try:
        run(trim_command(info.path, start, end, tmp))
        tmp.replace(clip)
    finally:
        tmp.unlink(missing_ok=True)
    _write_json(meta, _clip_meta(url, start, end, info.title))
    if not keep_downloads:
        shutil.rmtree(folder, ignore_errors=True)
    return clip, info.title
