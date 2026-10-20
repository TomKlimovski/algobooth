from pathlib import Path

import pytest

from algorip.generate import bass_lines, fmt_time, generate
from algorip.notes import Note
from algorip.schema import Analysis, BassLoop
from algorip.sounds import choose_sounds

GOLDEN = Path(__file__).parent / "golden"


@pytest.mark.parametrize("name", ["house", "breaks", "drums_only", "sustain"])
def test_golden(name):
    a = Analysis.model_validate_json((GOLDEN / f"{name}.analysis.json").read_text())
    code = generate(a, choose_sounds(a), title="Around The World", start=72, end=88)
    assert code == (GOLDEN / f"{name}.strudel").read_text()


def test_fmt_time():
    assert (fmt_time(72), fmt_time(5), fmt_time(3723.9)) == ("1:12", "0:05", "1:02:03")


def test_generated_code_has_no_walls_of_numbers():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    code = generate(a, choose_sounds(a), "t", 0, 16)
    assert max(len(line) for line in code.splitlines()) < 100
    assert [line.split(":")[0] for line in code.splitlines() if ": " in line and not line.startswith("//")] == ["drums", "hats", "bass", "chords"]


def test_one_bar_is_singular_and_an_empty_melody_writes_no_voice():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    one = a.model_copy(update={"bars": 1, "melody": []})
    code = generate(one, choose_sounds(one), "t", 0, 2)
    assert "· 1 bar\n" in code and "triangle" not in code
    assert "· 4 bars\n" in generate(a, choose_sounds(a), "t", 0, 8)


def test_bass_lines_write_the_loop_and_a_muted_layer():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    t = [Note(bar=0, step=s, length=1, midi=31) for s in (2, 3, 5, 7, 10, 11, 13, 14)] + [Note(bar=0, step=15, length=1, midi=43)]
    layer = [Note(bar=0, step=s, length=1, midi=31) for s in (0, 1, 4, 6, 8, 9, 12)]
    with_loop = a.model_copy(update={"bass_loop": BassLoop(period=1, templates=[t], layer=[layer], layer_bars=(5, 9), match=0.92, match_with_layer=0.97)})
    s = choose_sounds(with_loop)
    assert bass_lines(with_loop, s) == [
        f'bass: note("[~ ~ g1 g1] [~ g1 ~ g1] [~ ~ g1 g1] [~ g1 g1 g2]").s("{s.bass_sound}").lpf({s.bass_lpf})',
        "// bars 5–9 add this under the bass (a build): remove the underscore to hear it (match 0.92 without, 0.97 with)",
        f'_bass2: note("[g1 g1 ~ ~] [g1 ~ g1 ~] [g1 g1 ~ ~] [g1 ~ ~ ~]").s("{s.bass_sound}").lpf({s.bass_lpf}).gain(0.6)',
    ]
    assert bass_lines(a.model_copy(update={"bass": []}), s) == []
    no_layer = with_loop.model_copy(update={"bass_loop": with_loop.bass_loop.model_copy(update={"layer": None, "layer_bars": None, "match_with_layer": None})})
    assert len(bass_lines(no_layer, s)) == 1
