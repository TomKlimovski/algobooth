from pathlib import Path

import pytest

from algorip.generate import bass_lines, drum_lines, fmt_time, generate
from algorip.notes import Note
from algorip.schema import Analysis, BassLoop
from algorip.sounds import choose_sounds

GOLDEN = Path(__file__).parent / "golden"
HOUSE = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())


def analysis(drums: dict[str, list[tuple[int, int]]], bars: int) -> Analysis:
    return HOUSE.model_copy(update={"drums": drums, "bars": bars})


@pytest.mark.parametrize(
    "name, title, start, end",
    [
        ("house", "Around The World", 72, 88),
        ("breaks", "Around The World", 72, 88),
        ("drums_only", "Around The World", 72, 88),
        ("sustain", "Around The World", 72, 88),
        ("solomun", "Solomun – Live at Alexandra Palace, London (2026) (Official Film)", 2200, 2220),
        ("solomun2", "Solomun – Live at Alexandra Palace, London (2026) (Official Film)", 2930, 2940),
        ("build", "Build", 0, 16),  # the header bass_fixture.py writes for the synthetic build
    ],
)
def test_golden(name, title, start, end):
    a = Analysis.model_validate_json((GOLDEN / f"{name}.analysis.json").read_text())
    code = generate(a, choose_sounds(a), title=title, start=start, end=end)
    assert code == (GOLDEN / f"{name}.strudel").read_text()


def test_fmt_time():
    assert (fmt_time(72), fmt_time(5), fmt_time(3723.9)) == ("1:12", "0:05", "1:02:03")


def test_generated_code_has_no_walls_of_numbers():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    code = generate(a, choose_sounds(a), "t", 0, 16)
    assert max(len(line) for line in code.splitlines()) < 100
    assert [line.split(":")[0] for line in code.splitlines() if ": " in line and not line.startswith("//")] == ["drums", "claps", "hats", "bass", "chords"]


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
        "// bars 5–9 add this under the bass (a variation): remove the underscore to hear it (match 0.92 without, 0.97 with)",
        f'_bass2: note("[g1 g1 ~ ~] [g1 ~ g1 ~] [g1 g1 ~ ~] [g1 ~ ~ ~]").s("{s.bass_sound}").lpf({s.bass_lpf}).gain(0.6)',
    ]
    assert bass_lines(a.model_copy(update={"bass": []}), s) == []
    no_layer = with_loop.model_copy(update={"bass_loop": with_loop.bass_loop.model_copy(update={"layer": None, "layer_bars": None, "match_with_layer": None})})
    assert len(bass_lines(no_layer, s)) == 1


def test_drum_lines_write_the_loop_and_a_muted_fills_line():
    a = analysis(drums={"bd": [(b, s) for b in range(8) for s in (0, 4, 8, 12)],
                        "sd": [(b, s) for b in range(8) for s in (4, 12)] + [(3, 13), (3, 14), (3, 15), (7, 14)],
                        "hh": [(b, s) for b in range(8) for s in range(0, 16, 2)] + [(1, 5)], "oh": []}, bars=8)
    s = choose_sounds(a)  # snare_name is "cp" or "sd": the test uses s.snare_name
    # bar 4 has three snare strays (a fill); the lone strays in bars 2 and 8 are under FILL_MIN_HITS
    snare_line = "claps" if s.snare_name == "cp" else "snare"
    assert drum_lines(a, s) == [
        f'drums: s("bd*4").bank("{s.drum_bank}")',
        f'{snare_line}: s("[~ {s.snare_name}]*2").bank("{s.drum_bank}")',
        f'hats: s("hh*8").bank("{s.drum_bank}")',
        "// bars 4–4 add these hits (a fill): remove the underscore to hear them",
        f'_fills: s("<~ ~ ~ [~ ~ ~ [~ {s.snare_name} {s.snare_name} {s.snare_name}]] ~ ~ ~ ~>").bank("{s.drum_bank}")',
    ]


def test_no_fills_line_without_fills_and_no_drum_lines_without_hits():
    a = Analysis.model_validate_json((GOLDEN / "house.analysis.json").read_text())
    assert not any(line.startswith("_fills") for line in drum_lines(a, choose_sounds(a)))
    assert drum_lines(analysis(drums={}, bars=4), choose_sounds(a)) == []


def test_a_voice_every_fourth_bar_is_written_as_a_four_bar_cycle():
    bars = {b: {2, 6, 10, 14} for b in (0, 4, 8)}
    a = analysis(drums={"bd": [(b, s) for b in range(9) for s in (0, 4, 8, 12)], "sd": [], "hh": [], "oh": [(b, s) for b, steps in bars.items() for s in steps]}, bars=9)
    lines = drum_lines(a, choose_sounds(a))
    assert lines[-1] == f'hats: s("<[~ oh]*4 ~ ~ ~>").bank("{choose_sounds(a).drum_bank}")'


def test_the_gate_is_written_on_both_bass_lines_and_on_the_fallback_line():
    from algorip.schema import StrudelEnvelope

    a = Analysis.model_validate_json((GOLDEN / "solomun.analysis.json").read_text())
    s = choose_sounds(a).model_copy(update={"bass_envelope": StrudelEnvelope(attack=0.005, clip=0.5, release=0.04)})
    lines = bass_lines(a, s)
    assert lines[0].endswith('.attack(0.005).clip(0.5).release(0.04)')
    assert lines[-1].endswith('.attack(0.005).clip(0.5).release(0.04).gain(0.6)')
    fallback = bass_lines(a.model_copy(update={"bass_loop": None}), s)
    assert fallback[0].endswith('.attack(0.005).clip(0.5).release(0.04)')
    no_clip = choose_sounds(a).model_copy(update={"bass_envelope": StrudelEnvelope(attack=0.012, clip=None, release=0.025)})
    assert bass_lines(a, no_clip)[0].endswith('.attack(0.012).release(0.025)')
    assert not any('.attack(' in line for line in bass_lines(a, choose_sounds(a)))


def test_the_filter_envelope_and_tremolo_are_written_after_the_filter():
    from algorip.schema import FilterEnvelope, Tremolo

    a = Analysis.model_validate_json((GOLDEN / "solomun.analysis.json").read_text())
    s = choose_sounds(a).model_copy(update={"bass_lpf": 210, "bass_filter_env": FilterEnvelope(octaves=3.0, close=0.118), "bass_tremolo": Tremolo(rate=9.4, depth=0.5)})
    lines = bass_lines(a, s)
    assert lines[0].endswith('.s("sawtooth").lpf(210).lpenv(3).lpdecay(0.118).lpsustain(0).tremolo(9.4).tremolodepth(0.5)')
    assert lines[-1].endswith('.lpsustain(0).tremolo(9.4).tremolodepth(0.5).gain(0.6)')


def test_drum_lines_carry_the_shaped_samples_and_the_stems_gains():
    # 2026-10-22-drum-deep-dive-design.md: the kit index inline per voice, one gain per line, none on the fills
    from algorip.schema import DrumTone

    drums = {"bd": [(b, s) for b in range(4) for s in (0, 4, 8, 12)], "sd": [(b, s) for b in range(4) for s in (4, 12)],
             "oh": [(b, s) for b in range(4) for s in (2, 6, 10, 14)], "gh": [(b, s) for b in range(4) for s in (5, 13)], "hh": []}
    a = analysis(drums=drums, bars=4).model_copy(update={
        "four_on_the_floor": True, "bpm": 129.0,
        "drum_tone": DrumTone(levels={"bd": -8.0, "sd": -25.0, "oh": -21.5, "gh": -39.0}, falls={"bd": 150, "sd": 65, "oh": 62, "gh": 40})})
    s = choose_sounds(a)
    assert (s.drum_bank, s.snare_name) == ("tr909", "cp")
    lines = drum_lines(a, s)
    assert lines[0] == 'drums: s("bd:3*4").bank("tr909")'
    assert lines[1].startswith('claps: s("[~ cp:4]*2").bank("tr909").gain(0.3')
    assert lines[2].startswith('hats: s("[~ oh:2]*4").bank("tr909").gain(0.5')
    assert lines[3].startswith('ghosts: s("hh:1(2,16,5)").bank("tr909").gain(0.0')  # 18 dB under the hats
    assert not any(".gain(" in line for line in lines if line.startswith("_fills"))


def test_the_snare_line_is_named_snare_on_the_808():
    a = analysis(drums={"bd": [(0, 0), (0, 10), (1, 0), (1, 6)], "sd": [(b, s) for b in range(2) for s in (4, 12)], "hh": [], "oh": []}, bars=2)
    a = a.model_copy(update={"four_on_the_floor": False})
    lines = drum_lines(a, choose_sounds(a))
    assert any(line.startswith('snare: s("[~ sd]*2").bank("tr808")') for line in lines)
