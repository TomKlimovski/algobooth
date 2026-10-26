import pytest

from algorip.notes import Note
from algorip.schema import Analysis, JobStatus, ModelStatus, RipRequest, RipResult
from algorip.sounds import choose_sounds


def analysis(**over):
    base = dict(bpm=126, key="A minor", bars=4, first_downbeat=0.0, drums={}, four_on_the_floor=True,
                bass=[], bass_harmonics=0.7, chords=[], melody=None)
    return Analysis(**{**base, **over})


def test_house_gets_909_and_claps():
    s = choose_sounds(analysis())
    assert (s.drum_bank, s.snare_name, s.bass_sound, s.bass_lpf) == ("tr909", "cp", "sawtooth", 800)


def test_breaks_get_808_and_snares():
    s = choose_sounds(analysis(four_on_the_floor=False, bpm=160))
    assert (s.drum_bank, s.snare_name) == ("tr808", "sd")


def test_slow_four_on_the_floor_is_still_808():
    assert choose_sounds(analysis(bpm=100)).drum_bank == "tr808"


def test_bass_sound_by_harmonics():
    assert choose_sounds(analysis(bass_harmonics=0.3)).bass_sound == "triangle"
    clean = choose_sounds(analysis(bass_harmonics=0.1))
    assert (clean.bass_sound, clean.bass_lpf) == ("sine", None)


def test_measured_sawtooth_harmonics_get_a_sawtooth():
    # harmonic_ratio is magnitude-based: a real sawtooth measures about 0.435-0.52
    s = choose_sounds(analysis(bass_harmonics=0.45))
    assert (s.bass_sound, s.bass_lpf) == ("sawtooth", 800)


def test_bass_threshold_edges():
    assert choose_sounds(analysis(bass_harmonics=0.4)).bass_sound == "sawtooth"
    tri = choose_sounds(analysis(bass_harmonics=0.2))
    assert (tri.bass_sound, tri.bass_lpf) == ("triangle", 1200)
    assert choose_sounds(analysis(bass_harmonics=0.19)).bass_sound == "sine"


def test_rip_request_validation():
    with pytest.raises(ValueError, match="60 seconds"):
        RipRequest(url="https://x", start=0, end=61)
    with pytest.raises(ValueError):
        RipRequest(url="https://x", start=10, end=5)
    with pytest.raises(ValueError):
        RipRequest(url="ftp://x", start=0, end=5)
    with pytest.raises(ValueError):
        RipRequest(url="https://x", start=-1, end=5)
    assert RipRequest(url="https://x", start=72, end=88).tidy is False
    assert RipRequest(url="http://x", start=0, end=60).end == 60


def test_job_status_round_trips_as_json():
    a = analysis(drums={"bd": [(0, 0), (0, 4)]}, bass=[Note(bar=0, step=0, length=4, midi=33)],
                 chords=["Am"], melody=[Note(bar=0, step=2, length=1, midi=69)])
    result = RipResult(title="t", analysis=a, sounds=choose_sounds(a), code="s(\"bd\")",
                       tidied_code=None, tidy_error=None, stems=["drums", "bass"])
    job = JobStatus(id="j1", status="done", stage="generate", progress=1.0, result=result, error=None)
    data = job.model_dump(mode="json")
    assert data["result"]["analysis"]["drums"] == {"bd": [[0, 0], [0, 4]]}
    assert data["result"]["analysis"]["meter"] == "4/4"
    assert data["result"]["analysis"]["steps_per_bar"] == 16
    assert data["result"]["sounds"]["chord_sound"] == "gm_epiano1"
    assert JobStatus.model_validate(data) == job
    m = ModelStatus(ready=False, torch_installed=True, weights_present=False, installing=True,
                    stage="weights", progress=0.5, error=None)
    assert ModelStatus.model_validate(m.model_dump(mode="json")) == m


def test_drum_samples_by_shape_and_gains_by_level():
    # 2026-10-22-drum-deep-dive-design.md, measured on the 48:50 Solomun stem against the 909's samples
    from algorip.schema import DrumTone
    from algorip.sounds import gain_for

    a = analysis(bpm=129, drum_tone=DrumTone(levels={"bd": -8.0, "oh": -21.5, "sd": -25.0, "hh": -16.5},
                                             falls={"bd": 150, "oh": 62, "sd": 65, "hh": 40}))
    s = choose_sounds(a)
    assert s.drum_samples == {"bd": 3, "oh": 2, "sd": 4, "hh": 1}
    # against the kick at 0.65 (the house examples' kick): the open hats 2 dB under it, the claps 6 dB under
    assert s.drum_gains["bd"] == 0.65
    assert s.drum_gains["oh"] == pytest.approx(0.42, abs=0.03)
    assert s.drum_gains["sd"] == pytest.approx(0.26, abs=0.03)
    # the closed hats here sit where the samples put them: about the kick's gain
    assert s.drum_gains["hh"] == pytest.approx(0.65, abs=0.1)
    assert gain_for(0.0) == 0.65 and gain_for(-6.0) == pytest.approx(0.33, abs=0.01) and gain_for(6.0) == 1.0
    # nothing measured: the house examples' gains
    assert choose_sounds(analysis()).drum_samples == {}
    assert choose_sounds(analysis()).drum_gains == {"bd": 0.65, "sd": 0.5, "hh": 0.35, "oh": 0.35, "gh": 0.15}


def test_the_other_stems_instrument_by_its_decay_and_brightness():
    from algorip.schema import OtherTone

    def chosen(**tone):
        s = choose_sounds(analysis(other_tone=OtherTone(**tone)))
        return s.chord_sound, s.chord_lpf, s.chord_gain, s.melody_gain

    assert chosen(decay_db=-0.4, rolloff_hz=495) == ("supersaw", 500, 0.2, 0.3)  # a held pad, lowpassed where it sits
    assert chosen(decay_db=-1.0, rolloff_hz=20000)[1] == 8000
    assert chosen(decay_db=-16.6, rolloff_hz=1324) == ("gm_epiano1", None, 0.6, 0.6)  # Solomun 36:40's mellow stabs
    assert chosen(decay_db=-6.0, rolloff_hz=5254) == ("piano", None, 0.55, 0.55)  # 48:50's bright part
    assert (choose_sounds(analysis()).chord_sound, choose_sounds(analysis()).chord_lpf) == ("gm_epiano1", None)


def test_the_bass_keeps_its_oscillator_and_gains_a_little_richness():
    sine = choose_sounds(analysis(bass_harmonics=0.05))
    assert (sine.bass_sound, sine.bass_fm, sine.bass_shape, sine.bass_gain) == ("sine", 1.5, 0.3, 0.5)
    saw = choose_sounds(analysis(bass_harmonics=0.7))
    assert (saw.bass_sound, saw.bass_fm, saw.bass_shape, saw.bass_gain) == ("sawtooth", None, 0.3, 0.55)
