"""Splitting a clip into drums, bass, other and vocals stems.

The separator is injected so tests can use a fake; `demucs_separator` builds
the real one, importing PyTorch and Demucs lazily from the models directory so
the service starts (and tests run) without them installed.
"""

import os
from pathlib import Path
from typing import Any, Callable

import numpy as np

from algorip.audio import SR, load_stereo, write_wav
from algorip.models import use_site

STEMS = ("drums", "bass", "other", "vocals")
DEMUCS_SEGMENT = 5.0  # seconds per chunk; keeps peak memory inside 8 GB of RAM
DEMUCS_MODEL = "htdemucs"

Separator = Callable[[np.ndarray, int], dict[str, np.ndarray]]

_models: dict[str, Any] = {}
_mps_failed = False


def separate(clip: Path, out_dir: Path, separator: Separator) -> dict[str, Path]:
    """Write each stem and the 44.1 kHz stereo mix to out_dir; reuse them if all exist."""
    paths = {name: out_dir / f"{name}.wav" for name in (*STEMS, "mix")}
    if all(p.exists() for p in paths.values()):
        return paths

    mix = load_stereo(clip, SR)
    stems = separator(mix, SR)
    missing = [name for name in STEMS if name not in stems]
    if missing:
        raise ValueError(f"separator returned no {', '.join(missing)} stem(s)")

    out_dir.mkdir(parents=True, exist_ok=True)
    for name in STEMS:
        _write_atomically(paths[name], stems.pop(name))
    _write_atomically(paths["mix"], mix)
    return paths


def _write_atomically(path: Path, y: np.ndarray) -> None:
    """Write via a temporary sibling so an interrupted write never looks like a cached stem."""
    partial = path.with_name(f"{path.stem}.partial.wav")
    write_wav(partial, y, SR)
    os.replace(partial, path)


def pick_device(torch: Any) -> str:
    return "mps" if torch.backends.mps.is_available() else "cpu"


def _load_legacy(name: str) -> Any:
    """Load a pretrained bag from demucs's own remote list, never the HuggingFace hub.

    demucs 4.1.0's `get_model` tries HuggingFace first, which would fetch a second
    copy of the weights; this is its fallback branch, which reads the checkpoint
    `ModelStore` put in the torch hub cache (see `models.demucs_checkpoint_url`).
    """
    from demucs.pretrained import REMOTE_ROOT, _parse_remote_files
    from demucs.repo import AnyModelRepo, BagOnlyRepo, RemoteRepo

    model_repo = RemoteRepo(_parse_remote_files(REMOTE_ROOT / "files.txt"))
    model = AnyModelRepo(model_repo, BagOnlyRepo(REMOTE_ROOT, model_repo)).get_model(name)
    model.eval()
    return model


def demucs_separator(models_dir: Path, device: str | None = None) -> Separator:
    """Build a Demucs htdemucs separator from the packages and weights under models_dir."""
    use_site(models_dir / "site")
    os.environ["TORCH_HOME"] = str(models_dir / "torch")

    import torch
    from demucs.apply import apply_model

    if DEMUCS_MODEL not in _models:
        _models[DEMUCS_MODEL] = _load_legacy(DEMUCS_MODEL)
    model = _models[DEMUCS_MODEL]
    current = device or pick_device(torch)

    def run(mix: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        global _mps_failed
        nonlocal current
        if sr != model.samplerate:
            raise ValueError(f"Demucs expects {model.samplerate} Hz, got {sr}")
        if _mps_failed and current == "mps":
            current = "cpu"
        tensor = torch.from_numpy(np.ascontiguousarray(mix))[None]

        def apply(on: str) -> np.ndarray:
            with torch.no_grad():
                out = apply_model(
                    model, tensor, segment=DEMUCS_SEGMENT, shifts=0, overlap=0.1,
                    device=on, progress=False,
                )[0]
            return out.cpu().numpy()

        try:
            sources = apply(current)
        except Exception:
            if current != "mps":
                raise
            _mps_failed = True
            current = "cpu"
            sources = apply(current)
        return {name: sources[i] for i, name in enumerate(model.sources)}

    return run
