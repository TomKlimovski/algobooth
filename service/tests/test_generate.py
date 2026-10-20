from pathlib import Path

import pytest

from algorip.generate import fmt_time, generate
from algorip.schema import Analysis
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
    assert code.count("$:") == 4


def test_one_bar_is_singular_and_an_empty_melody_writes_no_voice():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    one = a.model_copy(update={"bars": 1, "melody": []})
    code = generate(one, choose_sounds(one), "t", 0, 2)
    assert "· 1 bar\n" in code and "triangle" not in code
    assert "· 4 bars\n" in generate(a, choose_sounds(a), "t", 0, 8)
