"""Download audio with yt-dlp and trim a window with ffmpeg, caching both."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Callable

import yt_dlp
from pydantic import BaseModel


class DownloadInfo(BaseModel):
    path: Path
    title: str


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


def _cached_source(url: str, cache_dir: Path, fetch: Fetcher) -> tuple[DownloadInfo, Path]:
    folder = cache_dir / "sources" / source_key(url)
    sidecar = folder / "info.json"
    if sidecar.exists():
        data = json.loads(sidecar.read_text())
        info = DownloadInfo(path=Path(data["path"]), title=data["title"])
        if info.path.exists():
            return info, folder
    folder.mkdir(parents=True, exist_ok=True)
    info = fetch(url, folder)
    sidecar.write_text(json.dumps({"path": str(info.path), "title": info.title}))
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
    if clip.exists() and meta.exists():
        return clip, json.loads(meta.read_text())["title"]

    clips.mkdir(parents=True, exist_ok=True)
    info, folder = _cached_source(url, cache_dir, fetch)
    tmp = clips / f"{key}.tmp.wav"
    try:
        run(trim_command(info.path, start, end, tmp))
        tmp.replace(clip)
    finally:
        tmp.unlink(missing_ok=True)
    meta.write_text(json.dumps({"title": info.title}))
    if not keep_downloads:
        shutil.rmtree(folder, ignore_errors=True)
    return clip, info.title
