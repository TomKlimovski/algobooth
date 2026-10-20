import json
from pathlib import Path

import pytest

from algorip.audio import write_wav
from algorip.bass import choose_bass_loop
from algorip.bassgrid import BassGrid
from algorip.fixtures import bass_events, build_fixture_audio
from algorip.generate import generate
from algorip.grid import Grid
from algorip.mini import loop_mini
from algorip.pipeline import _analyse
from algorip.schema import Analysis
from algorip.score import expand, score
from algorip.sounds import choose_sounds

GOLDEN = Path(__file__).parent / "golden"


@pytest.mark.parametrize("name", ["solomun", "build"])
def test_bass_events_match_the_committed_file(name):
    a = Analysis.model_validate_json((GOLDEN / f"{name}.analysis.json").read_text())
    assert json.loads((GOLDEN / f"{name}.bass-events.json").read_text()) == bass_events(a.bass_loop)


def test_bass_events_of_no_loop_is_empty():
    assert bass_events(None) == []


def test_bass_events_tag_each_line_and_the_layer_only_when_there_is_one():
    build = Analysis.model_validate_json((GOLDEN / "build.analysis.json").read_text()).bass_loop
    assert {e["line"] for e in bass_events(build)} == {"bass", "_bass2"}
    house = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text()).bass_loop
    assert house is None and bass_events(house) == []


# Held, not retriggered: the edges 2|3, 10|11 and 13|14 have no level dip (and no phase reset) in the
# audio; the plan's retriggered `[~ ~ g1 g1] ...` was the spike's guess. The build bars 5-9 are a
# gradual fill the grid reads as fewer, longer notes (2.8 extra starts a bar), so the layer is measured
# on the steps that sound G where the loop is silent: a beat and more a bar, repeating.
def test_solomun_loop_from_its_grid():
    bg = BassGrid.model_validate_json((GOLDEN / "solomun.bassgrid.json").read_text())
    a = Analysis.model_validate_json((GOLDEN / "solomun.analysis.json").read_text())
    g = Grid(bpm=a.bpm, first_downbeat=a.first_downbeat, bars=a.bars)
    loop = choose_bass_loop(bg, g, a.bass)
    assert loop.period == 1
    assert loop.match == pytest.approx(0.80, abs=0.02)
    assert loop_mini(loop.templates) == "[~ ~ g1@2] [~ g1 ~ g1] [~ ~ g1@2] [~ g1@2 g2]"
    assert 'bass: note("[~ ~ g1@2] [~ g1 ~ g1] [~ ~ g1@2] [~ g1@2 g2]")' in (GOLDEN / "solomun.strudel").read_text()


def test_solomun_build_is_a_layer_of_g1_over_bars_5_to_9():
    bg = BassGrid.model_validate_json((GOLDEN / "solomun.bassgrid.json").read_text())
    a = Analysis.model_validate_json((GOLDEN / "solomun.analysis.json").read_text())
    g = Grid(bpm=a.bpm, first_downbeat=a.first_downbeat, bars=a.bars)
    loop = choose_bass_loop(bg, g, a.bass)
    assert loop.layer is not None and loop.layer_bars == (5, 9)
    notes = [n for phase in loop.layer for n in phase]
    assert notes and all(n.midi == 31 for n in notes)  # G1
    assert sum(n.length for n in notes) >= 4  # at least a beat of the bar
    # Over its own bars the layer closes most of the gap. match_with_layer stacks it over every bar
    # (the spec's measure: what unmuting _bass2 plays), and bars 1-4 do not carry it, so there it is
    # no better than the loop alone.
    lo, hi = loop.layer_bars
    over_its_bars = [n for n in expand(loop.layer, a.bars) if lo - 1 <= n.bar <= hi - 1]
    assert score(bg, g, expand(loop.templates, a.bars), over_its_bars).match > loop.match + 0.05
    assert loop.match_with_layer == pytest.approx(loop.match, abs=0.01)
    assert a.bass_loop == loop
    assert "_bass2: note(" in (GOLDEN / "solomun.strudel").read_text()


def test_build_fixture_round_trips(tmp_path):
    stems, bpm, bars = build_fixture_audio()
    paths = {}
    for name, y in stems.items():
        paths[name] = tmp_path / f"{name}.wav"
        write_wav(paths[name], y)
    a = _analyse(paths, predict=lambda p: [], report=lambda f: None)
    loop = a.bass_loop
    assert loop is not None and loop.period == 2
    assert loop.layer_bars == (6, 8)
    assert loop.match >= 0.9
    code = generate(a, choose_sounds(a), "Build", 0, 16)
    bass2 = [line for line in code.splitlines() if line.startswith("_bass2:")]
    assert len(bass2) == 1 and "*4" in bass2[0]
    # End to end: the fresh run through _analyse is the committed golden, analysis and code. The goldens
    # carry no drum_summary (generate does not read it), so it is checked on its own.
    assert a.drum_summary is not None and a.drum_summary.match > 0.9
    assert a.model_copy(update={"drum_summary": None}) == Analysis.model_validate_json((GOLDEN / "build.analysis.json").read_text())
    assert code == (GOLDEN / "build.strudel").read_text()
