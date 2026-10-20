import pytest

from algorip.audio import SR, load_stereo
from algorip.separate import STEMS, separate
from tests.synth import click_track


def scaled_stems(mix, sr):
    assert mix.shape[0] == 2 and sr == SR
    return {name: mix * (i + 1) / 10 for i, name in enumerate(STEMS)}


def test_separate_writes_every_stem_and_the_mix(tmp_path, tmp_wav):
    clip = tmp_wav("clip.wav", click_track(120, 1))
    paths = separate(clip, tmp_path / "stems", scaled_stems)
    assert set(paths) == set(STEMS) | {"mix"}
    assert all(p.exists() for p in paths.values())
    assert load_stereo(paths["mix"], SR).shape == load_stereo(clip, SR).shape


def test_separate_is_cached(tmp_path, tmp_wav):
    clip = tmp_wav("clip.wav", click_track(120, 1))
    first = separate(clip, tmp_path / "stems", scaled_stems)

    def explode(mix, sr):
        raise AssertionError("separator called despite a full cache")

    assert separate(clip, tmp_path / "stems", explode) == first


def test_separator_output_missing_a_stem_is_an_error(tmp_path, tmp_wav):
    clip = tmp_wav("clip.wav", click_track(120, 1))
    out_dir = tmp_path / "stems"

    def drums_only(mix, sr):
        return {"drums": mix}

    with pytest.raises(ValueError, match="bass, other, vocals"):
        separate(clip, out_dir, drums_only)
    assert not out_dir.exists() or not any(out_dir.iterdir())
