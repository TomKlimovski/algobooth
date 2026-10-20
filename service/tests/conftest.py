from pathlib import Path
from typing import Callable

import numpy as np
import pytest

from algorip.audio import SR, write_wav


@pytest.fixture
def sr() -> int:
    return SR


@pytest.fixture
def tmp_wav(tmp_path: Path) -> Callable[[str, np.ndarray], Path]:
    """Return write(name, y) that saves y as a 16-bit WAV under tmp_path."""

    def write(name: str, y: np.ndarray) -> Path:
        path = tmp_path / name
        write_wav(path, y)
        return path

    return write
