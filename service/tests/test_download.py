from pathlib import Path

import pytest

from algorip.audio import SR, load_mono
from algorip.download import (
    DownloadInfo,
    clip_key,
    fetch_clip,
    list_clips,
    probe_ffmpeg,
    run_command,
    trim_command,
)
from tests.synth import click_track

URL = "https://x/v"


def make_fakes():
    calls = {"fetch": 0, "run": 0}

    def fetch(url, out_dir):
        calls["fetch"] += 1
        p = out_dir / "abc.m4a"
        p.write_bytes(b"src")
        return DownloadInfo(path=p, title="Song")

    def run(cmd):
        calls["run"] += 1
        Path(cmd[-1]).write_bytes(b"wav")

    return calls, fetch, run


def test_clip_key_is_stable_and_window_sensitive():
    assert clip_key("https://x/v", 72, 88) == clip_key(" https://x/v ", 72.0, 88.0)
    assert clip_key("https://x/v", 72, 88) != clip_key("https://x/v", 72, 89)
    assert len(clip_key("u", 0, 1)) == 16


def test_trim_command_shape():
    cmd = trim_command(Path("/s.m4a"), 72, 88.5, Path("/c.wav"))
    assert cmd[:2] == ["ffmpeg", "-y"]
    assert cmd[cmd.index("-ss") + 1] == "72.000"
    assert cmd[cmd.index("-to") + 1] == "88.500"
    assert cmd[-1] == "/c.wav" and "-ar" in cmd and cmd[cmd.index("-ar") + 1] == "44100"


def test_fetch_clip_caches_and_honours_keep_downloads(tmp_path):
    calls, fetch, run = make_fakes()
    clip, title = fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    assert title == "Song" and clip.read_bytes() == b"wav"
    assert not (tmp_path / "sources").exists() or not any((tmp_path / "sources").iterdir())
    again, again_title = fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    assert again == clip and again_title == "Song" and calls == {"fetch": 1, "run": 1}


def test_fetch_clip_keeps_source_when_asked_and_reuses_it(tmp_path):
    calls, fetch, run = make_fakes()
    first, _ = fetch_clip(URL, 72, 88, tmp_path, keep_downloads=True, fetch=fetch, run=run)
    assert any((tmp_path / "sources").iterdir())
    second, title = fetch_clip(URL, 10, 20, tmp_path, keep_downloads=True, fetch=fetch, run=run)
    assert second != first and title == "Song"
    assert calls == {"fetch": 1, "run": 2}


def test_ffmpeg_failure_surfaces_stderr(tmp_path):
    _, fetch, _ = make_fakes()

    def run(cmd):
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    assert list((tmp_path / "clips").glob("*")) == []


@pytest.mark.skipif(probe_ffmpeg() is None, reason="ffmpeg not installed")
def test_real_ffmpeg_trims_to_the_window(tmp_path, tmp_wav):
    src = tmp_wav("src.wav", click_track(120, 2))
    out = tmp_path / "out.wav"
    run_command(trim_command(src, 1.0, 2.5, out))
    assert abs(len(load_mono(out)) - int(1.5 * SR)) <= 50


@pytest.mark.parametrize("broken", ["", "{\"tit", "[]", "{\"title\": 3}"])
def test_an_unreadable_clip_sidecar_is_a_cache_miss(tmp_path, broken):
    calls, fetch, run = make_fakes()
    clip, _ = fetch_clip(URL, 1, 2, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    clip.with_suffix(".json").write_text(broken)  # a write cut short by a crash, or a foreign file
    again, title = fetch_clip(URL, 1, 2, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    assert (again, title) == (clip, "Song") and calls == {"fetch": 2, "run": 2}
    assert fetch_clip(URL, 1, 2, tmp_path, keep_downloads=False, fetch=fetch, run=run)[1] == "Song"
    assert calls == {"fetch": 2, "run": 2}  # the rewritten sidecar serves the cache again


def test_an_unreadable_source_sidecar_is_a_cache_miss(tmp_path):
    calls, fetch, run = make_fakes()
    fetch_clip(URL, 1, 2, tmp_path, keep_downloads=True, fetch=fetch, run=run)
    (sidecar,) = (tmp_path / "sources").glob("*/info.json")
    sidecar.write_text("{\"path\": ")
    _, title = fetch_clip(URL, 3, 4, tmp_path, keep_downloads=True, fetch=fetch, run=run)
    assert title == "Song" and calls["fetch"] == 2
    assert fetch_clip(URL, 5, 6, tmp_path, keep_downloads=True, fetch=fetch, run=run)[1] == "Song"
    assert calls["fetch"] == 2


def test_sidecars_are_written_through_a_temporary_file(tmp_path, monkeypatch):
    import algorip.download as download
    replaced = []
    real = download.os.replace
    monkeypatch.setattr(download.os, "replace", lambda a, b: (replaced.append((Path(a).name, Path(b).name)), real(a, b)))
    calls, fetch, run = make_fakes()
    fetch_clip(URL, 1, 2, tmp_path, keep_downloads=True, fetch=fetch, run=run)
    key = clip_key(URL, 1, 2)
    assert ("info.json.partial", "info.json") in replaced
    assert (f"{key}.json.partial", f"{key}.json") in replaced
    assert not list(tmp_path.rglob("*.partial"))


def test_list_clips_names_each_cached_clip_newest_first(tmp_path):
    calls, fetch, run = make_fakes()
    fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    fetch_clip("https://x/w", 10, 20.5, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    clips = list_clips(tmp_path)
    assert [(c.url, c.start, c.end, c.title) for c in clips] == [
        ("https://x/w", 10.0, 20.5, "Song"),
        (URL, 72.0, 88.0, "Song"),
    ]
    assert clips[0].fetched_at >= clips[1].fetched_at
    assert list_clips(tmp_path / "nowhere") == []


def test_list_clips_skips_clips_whose_audio_or_window_is_missing(tmp_path):
    calls, fetch, run = make_fakes()
    clip, _ = fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    # A sidecar from before the window was recorded is still a cache hit, but it cannot be listed...
    meta = clip.with_suffix(".json")
    meta.write_text('{"title": "Song"}')
    assert list_clips(tmp_path) == []
    # ...until the next cache hit rewrites it with the window.
    fetch_clip(URL, 72, 88, tmp_path, keep_downloads=False, fetch=fetch, run=run)
    assert calls == {"fetch": 1, "run": 1}
    assert [c.url for c in list_clips(tmp_path)] == [URL]
    clip.unlink()
    assert list_clips(tmp_path) == []
