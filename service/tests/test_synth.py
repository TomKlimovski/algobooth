import numpy as np
import pytest

from tests.synth import bass_line, click_track, drum_loop, mix, pad_chords, silence
from algorip.audio import SR


def test_click_track_length_and_beat_peaks():
    y = click_track(120, bars=2, accent_downbeats=False)
    assert len(y) == SR * 4
    beat = SR // 2
    for b in range(8):
        assert abs(y[b * beat : b * beat + 200]).max() > 0.5
        assert abs(y[b * beat + 2000 : (b + 1) * beat - 2000]).max() < 1e-6


def test_drum_loop_places_a_kick_on_step_4():
    y = drum_loop({"bd": {(0, 4)}}, bpm=120, bars=1)
    step = SR // 8
    assert abs(y[4 * step : 4 * step + 1000]).max() > 0.3
    assert abs(y[: 4 * step - 100]).max() == 0


def test_bass_line_has_a_fundamental_at_the_note():
    y = bass_line([(0, 0, 16, 45)], bpm=120, bars=1)  # A2 = 110 Hz
    spectrum = np.abs(np.fft.rfft(y[:SR]))
    assert abs(spectrum.argmax() - 110) <= 1


def test_mix_peaks_at_0_9():
    y = mix(click_track(120, 1), bass_line([(0, 0, 16, 45)], 120, 1))
    assert abs(abs(y).max() - 0.9) < 1e-3


# Sanity checks of the fixtures themselves, so later analysis tests can trust them.


def _onsets(y: np.ndarray) -> np.ndarray:
    """Sample indices where silence gives way to sound."""
    nz = y != 0
    return np.flatnonzero(nz & ~np.concatenate(([False], nz[:-1])))


def test_fixtures_are_float32_mono():
    for y in (
        click_track(120, 1),
        drum_loop({"bd": {(0, 0)}}, 120, 1),
        bass_line([(0, 0, 4, 40)], 120, 1),
        pad_chords([(57, "minor")], 120),
        silence(0.5),
        mix(silence(0.1)),
    ):
        assert y.dtype == np.float32
        assert y.ndim == 1


@pytest.mark.parametrize("bpm", [120, 128, 93.5])
def test_click_track_clicks_land_on_beats_at_awkward_tempos(bpm):
    bars = 3
    y = click_track(bpm, bars=bars, accent_downbeats=False)
    assert len(y) == round(bars * 240 / bpm * SR)
    expected = [round(k * 60 / bpm * SR) for k in range(bars * 4)]
    assert _onsets(y).tolist() == expected
    # each click is 2 ms of noise and nothing else
    for start in expected:
        assert np.count_nonzero(y[start : start + 2000]) <= round(0.002 * SR)


@pytest.mark.parametrize("bpm", [120, 128, 93.5])
def test_click_track_accents_land_on_downbeats_240_over_bpm_apart(bpm):
    bars = 4
    y = click_track(bpm, bars=bars, accent_downbeats=True)
    tail = round(0.002 * SR)
    accent = round(0.1 * SR)
    for k in range(bars * 4):
        start = round(k * 60 / bpm * SR)
        body = y[start + tail : start + accent - tail]
        if k % 4 == 0:
            # the 60 Hz downbeat thump at 0.8 amplitude
            assert 0.79 < abs(body).max() <= 0.8 + 1e-6
            spectrum = np.abs(np.fft.rfft(y[start : start + accent]))
            assert spectrum[1:].argmax() + 1 == 6  # 10 Hz bins: 60 Hz
        else:
            assert abs(body).max() == 0
    downbeats = [round(b * 240 / bpm * SR) for b in range(bars)]
    assert np.allclose(np.diff(downbeats) / SR, 240 / bpm, atol=1 / SR)


def test_drum_voices_start_exactly_on_their_steps():
    bpm = 128
    hits = {"bd": {(0, 0), (1, 8)}, "sd": {(0, 4)}, "hh": {(0, 10)}, "oh": {(1, 2)}}
    y = drum_loop(hits, bpm=bpm, bars=2)
    assert len(y) == round(2 * 240 / bpm * SR)
    expected = sorted(round((bar * 16 + step) * 15 / bpm * SR) for v in hits.values() for bar, step in v)
    assert _onsets(y).tolist() == expected


def _voice(name: str) -> np.ndarray:
    """One hit of a voice on step 0 of a slow bar, so nothing overlaps."""
    return drum_loop({name: {(0, 0)}}, bpm=60, bars=1)


def _dominant_hz(y: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(y, n=SR))  # 1 Hz bins
    return float(spectrum.argmax())


def _energy_between(y: np.ndarray, lo_hz: float, hi_hz: float) -> float:
    """Fraction of the signal's energy between lo_hz and hi_hz."""
    power = np.abs(np.fft.rfft(y, n=SR)) ** 2  # 1 Hz bins
    return float(power[round(lo_hz) : round(hi_hz) + 1].sum() / power.sum())


def test_drum_voice_lengths_follow_their_decays():
    for name, seconds in {"bd": 0.15, "sd": 0.12, "hh": 0.03, "oh": 0.3}.items():
        y = _voice(name)
        last = np.flatnonzero(y).max()
        assert abs(last - seconds * SR) <= 2, name
        assert abs(y).max() == pytest.approx(1.0), name


def test_drum_voice_spectra():
    assert 45 <= _dominant_hz(_voice("bd")) <= 80
    assert _energy_between(_voice("sd"), 200, 2000) > 0.85
    assert _energy_between(_voice("hh"), 6000, SR / 2) > 0.9
    assert _energy_between(_voice("oh"), 6000, SR / 2) > 0.9


def test_bd_attack_ramps_over_5_ms():
    y = _voice("bd")
    ramp = round(0.005 * SR)
    assert abs(y[: ramp // 4]).max() < 0.3
    assert abs(y[ramp : 2 * ramp]).max() > 0.6


def test_drum_loop_rejects_an_unknown_voice():
    with pytest.raises(ValueError, match="cowbell"):
        drum_loop({"cowbell": {(0, 0)}}, bpm=120, bars=1)


def test_drum_loop_is_deterministic():
    hits = {"sd": {(0, 4), (0, 12)}, "hh": {(0, s) for s in range(0, 16, 2)}}
    assert np.array_equal(drum_loop(hits, 120, 1), drum_loop(hits, 120, 1))


def test_bass_note_spans_its_steps_with_10_ms_ramps():
    bpm = 128
    y = bass_line([(0, 4, 3, 40)], bpm=bpm, bars=1)
    start = round(4 * 15 / bpm * SR)
    end = round(7 * 15 / bpm * SR)
    nz = np.flatnonzero(y)
    assert nz.min() >= start and nz.max() < end
    assert abs(nz.min() - start) <= 1 and abs(nz.max() - (end - 1)) <= 1
    ramp = round(0.01 * SR)
    assert abs(y[start : start + ramp // 10]).max() < 0.2
    assert abs(y[end - ramp // 10 : end]).max() < 0.2
    assert abs(y[start + ramp : end - ramp]).max() > 1.0


def test_bass_harmonics_fall_off_as_one_over_n():
    y = bass_line([(0, 0, 16, 45)], bpm=120, bars=1)
    spectrum = np.abs(np.fft.rfft(y[SR // 2 : SR // 2 + SR]))
    fundamental = spectrum[110]
    for n in range(2, 7):
        assert spectrum[110 * n] / fundamental == pytest.approx(1 / n, rel=0.02)
    assert spectrum[110 * 7] / fundamental < 0.01


def test_pad_chords_spell_triads_per_bar():
    bpm = 120
    y = pad_chords([(57, "minor"), (57, "major")], bpm=bpm)
    bar = round(240 / bpm * SR)
    assert len(y) == 2 * bar

    def strongest_below_400hz(segment: np.ndarray) -> set[int]:
        spectrum = np.abs(np.fft.rfft(segment, n=SR))[:400]
        return set(np.argsort(spectrum)[-3:].tolist())

    a3, c4, cs4, e4 = 220, 262, 277, 330  # rounded to 1 Hz bins
    assert strongest_below_400hz(y[SR // 4 : SR // 4 + SR]) == {a3, c4, e4}
    assert strongest_below_400hz(y[bar + SR // 4 : bar + SR // 4 + SR]) == {a3, cs4, e4}


def test_pad_chords_rejects_an_unknown_quality():
    with pytest.raises(ValueError, match="sus4"):
        pad_chords([(60, "sus4")], bpm=120)


def test_silence_is_silent():
    y = silence(1.5)
    assert len(y) == round(1.5 * SR)
    assert not y.any()


def test_mix_zero_pads_to_the_longest_part():
    short = bass_line([(0, 0, 4, 45)], 120, 1)
    long = silence(3.0)
    y = mix(short, long)
    assert len(y) == len(long)
    assert not y[len(short) :].any()
    assert abs(y).max() == pytest.approx(0.9, abs=1e-6)


def test_mix_of_silence_stays_silent():
    y = mix(silence(0.5), silence(1.0))
    assert len(y) == round(1.0 * SR)
    assert not y.any()
