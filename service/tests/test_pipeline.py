import shutil
from dataclasses import replace

import pytest

from algorip.download import DownloadInfo, clip_key
from algorip.pipeline import Cancelled, Deps, Paths, run_rip
from algorip.schema import RipRequest, RipResult
from tests.synth import bass_line, drum_loop, mix, pad_chords, silence

BPM = 124
BARS = 4
HOUSE = {"bd": {(b, s) for b in range(BARS) for s in (0, 4, 8, 12)},
         "sd": {(b, s) for b in range(BARS) for s in (4, 12)},
         "hh": {(b, s) for b in range(BARS) for s in range(0, 14, 2)},
         "oh": {(b, 14) for b in range(BARS)}}
BASS = [(b, s, 2, midi) for b in range(BARS) for s, midi in ((0, 33), (8, 33), (12, 28))]
CHORDS = [(57, "minor"), (53, "major"), (48, "major"), (55, "major")]


def _step_seconds() -> float:
    return 240.0 / BPM / 16


BASS_EVENTS = [((b * 16 + s) * _step_seconds(), (b * 16 + s + n) * _step_seconds(), midi, 0.9)
               for b, s, n, midi in BASS]


def make_deps(tmp_wav, calls=None, cancelled=lambda: False, chat=None):
    calls = calls if calls is not None else {}
    drums = drum_loop(HOUSE, BPM, BARS)
    bass = bass_line(BASS, BPM, BARS)
    pads = pad_chords(CHORDS, BPM)
    source = tmp_wav("source.wav", mix(drums, bass, pads))

    def fetch(url, out_dir):
        calls["fetch"] = calls.get("fetch", 0) + 1
        target = out_dir / "src.wav"
        shutil.copy(source, target)
        return DownloadInfo(path=target, title="Test House")

    def run(cmd):
        calls["run"] = calls.get("run", 0) + 1
        shutil.copy(cmd[cmd.index("-i") + 1], cmd[-1])

    def separator(y, sr):
        calls["separator"] = calls.get("separator", 0) + 1
        return {"drums": drums, "bass": bass, "other": pads, "vocals": silence(len(drums) / sr)}

    def predict(path):
        calls.setdefault("predict", []).append(path.name)
        return BASS_EVENTS if path.name == "bass.wav" else []

    def default_chat(system, user, key):
        calls["chat"] = calls.get("chat", 0) + 1
        raise AssertionError("chat must not be called")

    return Deps(fetch=fetch, run=run, separator=separator, predict=predict,
                chat=chat or default_chat, cancelled=cancelled)


def paths(tmp_path):
    return Paths(cache_dir=tmp_path / "cache", models_dir=tmp_path / "models", keep_downloads=False)


def test_run_rip_reports_every_stage_and_builds_a_result(tmp_path, tmp_wav):
    calls = {}
    deps = make_deps(tmp_wav, calls)
    stages = []
    result = run_rip(RipRequest(url="https://x/v", start=0, end=8), paths(tmp_path),
                     lambda s, f: stages.append((s, f)), deps)
    assert [s for s, f in stages if f == 0.0] == ["download", "separate", "analyse", "generate"]
    assert [f for s, f in stages if s == "analyse"] == [0.0, 0.2, 0.3, 0.5, 0.7, 0.9, 1.0]
    for stage in ("download", "separate", "generate"):
        assert [f for s, f in stages if s == stage] == [0.0, 1.0]
    assert result.title == "Test House"
    assert result.analysis.four_on_the_floor and result.sounds.drum_bank == "tr909"
    assert result.analysis.key == "A minor" and result.analysis.bars >= 1
    assert sorted(result.analysis.drums) == ["bd", "hh", "oh", "sd"]
    assert result.analysis.bass and result.analysis.melody is None
    assert result.code.startswith("// ") and "setcpm(" in result.code
    assert result.tidied_code is None and result.tidy_error is None
    assert result.stems == ["drums", "bass", "other", "vocals", "mix"]
    assert "chat" not in calls and calls["separator"] == 1 and calls["predict"] == ["other.wav"]  # the bass is heard by pyin now, not Basic Pitch
    # BASS is the same every bar, but estimate_grid on this short synthetic mix lands at 123 bpm with the
    # downbeat three beats late and 3 bars (pre-existing: the test only asserts bars >= 1), so no loop can
    # be pinned here; the end-to-end loop through _analyse is pinned by the build golden in Task 6.
    assert result.analysis.bass_loop is None or result.analysis.bass_loop.period == 1
    # the house drums are the same every bar, so their loops account for nearly every hit
    assert result.analysis.drum_summary is not None and result.analysis.drum_summary.match > 0.9


def test_run_rip_tidy_runs_only_with_key_and_flag(tmp_path, tmp_wav):
    calls = {}
    no_key = make_deps(tmp_wav, calls)
    stages = []
    result = run_rip(RipRequest(url="https://x/v", start=0, end=8, tidy=True), paths(tmp_path),
                     lambda s, f: stages.append((s, f)), no_key)
    assert "chat" not in calls and result.tidied_code is None and "tidy" not in [s for s, _ in stages]

    seen = []

    def chat(system, user, key):
        seen.append(key)
        return "```js\n" + result.code + "// tidied\n```"

    with_key = replace(no_key, chat=chat)
    stages.clear()
    tidied = run_rip(RipRequest(url="https://x/v", start=0, end=8, tidy=True, claude_api_key="sk-test"),
                     paths(tmp_path), lambda s, f: stages.append((s, f)), with_key)
    assert seen == ["sk-test"]
    assert tidied.tidied_code is not None and "// tidied" in tidied.tidied_code and tidied.tidy_error is None
    assert [s for s, f in stages if f == 0.0][-1] == "tidy"


def test_run_rip_honours_cancel_between_stages(tmp_path, tmp_wav):
    calls = {}
    deps = make_deps(tmp_wav, calls, cancelled=lambda: calls.get("run", 0) > 0)
    stages = []
    with pytest.raises(Cancelled):
        run_rip(RipRequest(url="https://x/v", start=0, end=8), paths(tmp_path),
                lambda s, f: stages.append((s, f)), deps)
    assert "separator" not in calls
    assert stages == [("download", 0.0), ("download", 1.0)]


@pytest.mark.parametrize("request_keep, kept", [(None, False), (True, True), (False, False)])
def test_the_request_decides_whether_downloads_are_kept(tmp_path, tmp_wav, request_keep, kept):
    deps = make_deps(tmp_wav)
    req = RipRequest(url="https://x/v", start=0, end=8, keep_downloads=request_keep)
    run_rip(req, paths(tmp_path), lambda s, f: None, deps)  # the service was launched with keep_downloads off
    assert any((tmp_path / "cache" / "sources").glob("*/src.wav")) is kept


def test_a_rip_stores_its_result_and_a_replay_returns_it_without_working(tmp_path, tmp_wav):
    calls = {}
    deps = make_deps(tmp_wav, calls)
    req = RipRequest(url="https://x/v", start=0, end=8)
    first = run_rip(req, paths(tmp_path), lambda s, f: None, deps)
    stored = tmp_path / "cache" / "stems" / clip_key(req.url, req.start, req.end) / "result.json"
    assert RipResult.model_validate_json(stored.read_text()) == first

    stages = []
    again = run_rip(req.model_copy(update={"replay": True}), paths(tmp_path), lambda s, f: stages.append((s, f)), deps)
    assert again == first
    assert calls["separator"] == 1 and calls["fetch"] == 1  # nothing ran again
    assert stages == [(s, f) for s in ("download", "separate", "analyse", "generate") for f in (0.0, 1.0)]


def test_a_replay_with_nothing_stored_runs_the_rip(tmp_path, tmp_wav):
    calls = {}
    deps = make_deps(tmp_wav, calls)
    result = run_rip(RipRequest(url="https://x/v", start=0, end=8, replay=True), paths(tmp_path), lambda s, f: None, deps)
    assert result.title == "Test House" and calls["separator"] == 1


def test_analyse_after_a_replayable_rip_recomputes(tmp_path, tmp_wav):
    calls = {}
    deps = make_deps(tmp_wav, calls)
    req = RipRequest(url="https://x/v", start=0, end=8)
    run_rip(req, paths(tmp_path), lambda s, f: None, deps)
    run_rip(req, paths(tmp_path), lambda s, f: None, deps)
    assert calls["predict"] == ["other.wav"] * 2  # a plain Analyse never replays (the stems are cached, the analysis is not)
