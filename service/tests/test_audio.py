import numpy as np
import pytest
import soundfile as sf

from algorip.audio import load_mono, load_stereo, write_wav
from tests.synth import bass_line

PCM16_STEP = 1 / 32768


def test_mono_round_trip(tmp_wav, sr):
    y = 0.5 * bass_line([(0, 0, 16, 45)], 120, 1) / 2.5
    path = tmp_wav("mono.wav", y)
    info = sf.info(path)
    assert (info.samplerate, info.channels, info.subtype) == (sr, 1, "PCM_16")
    back = load_mono(path)
    assert back.dtype == np.float32 and back.shape == y.shape
    assert np.abs(back - y).max() <= PCM16_STEP


def test_stereo_round_trip(tmp_wav, sr):
    left = 0.4 * bass_line([(0, 0, 16, 45)], 120, 1) / 2.5
    right = -left
    path = tmp_wav("stereo.wav", np.stack([left, right]))
    assert sf.info(path).channels == 2
    back = load_stereo(path, sr)
    assert back.dtype == np.float32 and back.shape == (2, len(left))
    assert np.abs(back[0] - left).max() <= PCM16_STEP
    assert np.abs(back[1] - right).max() <= PCM16_STEP
    mono = load_mono(path)
    assert np.abs(mono).max() <= 2 * PCM16_STEP  # left and right cancel


def test_load_stereo_duplicates_a_mono_file(tmp_wav, sr):
    y = 0.3 * bass_line([(0, 0, 8, 50)], 120, 1) / 2.5
    back = load_stereo(tmp_wav("mono.wav", y), sr)
    assert back.shape == (2, len(y))
    assert np.array_equal(back[0], back[1])


def test_load_mono_resamples(tmp_wav, sr):
    y = 0.3 * bass_line([(0, 0, 16, 45)], 120, 1) / 2.5
    back = load_mono(tmp_wav("mono.wav", y), sr=sr // 2)
    assert len(back) == len(y) // 2


def test_write_wav_rejects_other_shapes(tmp_path):
    with pytest.raises(ValueError):
        write_wav(tmp_path / "bad.wav", np.zeros((3, 100), dtype=np.float32))
