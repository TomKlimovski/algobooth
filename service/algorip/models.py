"""First-run install of PyTorch, Demucs and the htdemucs weights into the models directory.

The service itself ships without PyTorch; `ModelStore.install()` pip-installs the
pinned ML packages into `models_dir/site` and downloads the htdemucs checkpoint
into the torch hub cache under `models_dir/torch`, where `demucs_separator` finds them.
"""

import os
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable

import httpx

from algorip.download import Runner
from algorip.schema import ModelStatus

# demucs 4.0.1 is published as an sdist only, which `--only-binary=:all:` refuses;
# 4.1.0 is the first release with a wheel (py3-none-any), and every one of its
# dependencies has a macOS arm64 cp311 wheel. torch and torchaudio 2.5.1 do too.
ML_PACKAGES = ["torch==2.5.1", "torchaudio==2.5.1", "demucs==4.1.0"]
HTDEMUCS_SIGNATURE = "955717e8"  # demucs/remote/htdemucs.yaml: `models: ['955717e8']`
PACKAGES_SHARE = 0.7  # progress given to pip; the weights download gets the rest

Downloader = Callable[[str, Path, Callable[[float], None]], None]
CHUNK = 1024 * 1024


def use_site(site: Path) -> None:
    """Make the installed ML packages importable.

    Appended, not prepended: pip also puts shared dependencies (anyio, h11,
    packaging, ...) in site, and the service's own pinned copies must win.
    """
    entry = str(site)
    if entry not in sys.path:
        sys.path.append(entry)


def demucs_checkpoint_url(site: Path) -> str:
    """The URL demucs itself would fetch the htdemucs weights from.

    `demucs.pretrained` (4.0.1 and 4.1.0) parses `demucs/remote/files.txt` with
    `_parse_remote_files`: `root:` lines set a folder, every other line is
    `<sig>-<hash>.th`, mapped to `ROOT_URL + root + line`. The legacy loader
    passes that URL to `torch.hub.load_state_dict_from_url`, which caches it as
    `$TORCH_HOME/hub/checkpoints/<basename>`, so downloading the same URL to the
    same name is what makes the separator find the weights without the network.
    """
    use_site(site)
    from demucs import pretrained

    return pretrained._parse_remote_files(pretrained.REMOTE_ROOT / "files.txt")[HTDEMUCS_SIGNATURE]


def httpx_download(url: str, path: Path, on_fraction: Callable[[float], None],
                   transport: httpx.BaseTransport | None = None) -> None:
    """Stream url to path, reporting the fraction done every megabyte."""
    with httpx.Client(transport=transport, follow_redirects=True, timeout=60) as client:
        with client.stream("GET", url) as response:
            response.raise_for_status()
            total = int(response.headers.get("content-length") or 0)
            done = 0
            with path.open("wb") as f:
                for chunk in response.iter_bytes(CHUNK):
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        on_fraction(min(done / total, 1.0))


class GroupRunner:
    """Runs each command in a session of its own, so stop() can kill it with every process it started.

    pip spawns build and install helpers; killing pip alone would leave them writing.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running: set[subprocess.Popen] = set()

    def __call__(self, cmd: list[str]) -> None:
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
        with self._lock:
            self._running.add(proc)
        try:
            _, err = proc.communicate()
        finally:
            with self._lock:
                self._running.discard(proc)
        if proc.returncode != 0:
            raise RuntimeError(err.decode(errors="replace").strip() or f"{cmd[0]} exited with {proc.returncode}")

    def stop(self) -> None:
        with self._lock:
            running = list(self._running)
        for proc in running:
            try:
                os.killpg(proc.pid, signal.SIGKILL)  # start_new_session made its pid the group id
            except (ProcessLookupError, PermissionError):
                pass


class ModelStore:
    def __init__(
        self,
        models_dir: Path,
        python: Path = Path(sys.executable),
        run: Runner | None = None,  # None means a GroupRunner
        download: Downloader = httpx_download,
        resolve_url: Callable[[], str] | None = None,  # None means demucs_checkpoint_url(self.site)
    ):
        self.models_dir = models_dir
        self.python = python
        self.run = run or GroupRunner()
        self.download = download
        self.resolve_url = resolve_url or (lambda: demucs_checkpoint_url(self.site))
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._installing = False
        self._stage: str | None = None
        self._progress = 0.0
        self._error: str | None = None

    @property
    def site(self) -> Path:
        return self.models_dir / "site"

    @property
    def torch_home(self) -> Path:
        return self.models_dir / "torch"

    @property
    def marker(self) -> Path:
        return self.site / ".installed"

    @property
    def checkpoints(self) -> Path:
        return self.torch_home / "hub" / "checkpoints"

    def _torch_installed(self) -> bool:
        try:
            return self.marker.read_text().split("\n") == ML_PACKAGES
        except OSError:
            return False

    def _weights_present(self) -> bool:
        return self.checkpoints.is_dir() and any(self.checkpoints.glob(f"{HTDEMUCS_SIGNATURE}*.th"))

    def status(self) -> ModelStatus:
        torch_installed, weights_present = self._torch_installed(), self._weights_present()
        with self._lock:
            return ModelStatus(ready=torch_installed and weights_present, torch_installed=torch_installed,
                               weights_present=weights_present, installing=self._installing,
                               stage=self._stage, progress=self._progress, error=self._error)

    def install(self) -> None:
        with self._lock:
            if self._installing:
                return
            self._installing, self._stage, self._progress, self._error = True, None, 0.0, None
            self._thread = threading.Thread(target=self._install, name="model-install", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        """Kill a running pip and everything it started (the service calls this as it exits)."""
        stop = getattr(self.run, "stop", None)
        if stop is not None:
            stop()

    def wait(self, timeout: float | None = None) -> None:
        """Join the install thread (for tests)."""
        thread = self._thread
        if thread is not None:
            thread.join(timeout)

    def _set(self, stage: str, progress: float) -> None:
        with self._lock:
            self._stage, self._progress = stage, progress

    def _install(self) -> None:
        try:
            if not self._torch_installed():
                self._install_packages()
            if not self._weights_present():
                self._install_weights()
            self._finish(None)
        except Exception as exc:  # reported through status(); install() can be retried
            self._finish(str(exc) or type(exc).__name__)

    def _finish(self, error: str | None) -> None:
        with self._lock:
            self._installing, self._error = False, error
            if error is None:
                self._stage, self._progress = None, 1.0

    def _install_packages(self) -> None:
        self._set("packages", 0.0)
        # pip installs into a folder of this process's own, which replaces site only once pip is done:
        # a pip orphaned by an earlier, killed service may still be writing into its own folder.
        partial = self.models_dir / f"site.partial-{os.getpid()}"
        for stale in self.models_dir.glob("site.partial-*"):
            shutil.rmtree(stale, ignore_errors=True)
        try:
            self.run([str(self.python), "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                      "--only-binary=:all:", "--target", str(partial), *ML_PACKAGES])
            shutil.rmtree(self.site, ignore_errors=True)
            os.replace(partial, self.site)
        finally:
            shutil.rmtree(partial, ignore_errors=True)
        self._set("packages", PACKAGES_SHARE)
        # Written last: a site without this marker (or with other pins) is never "installed"
        self.marker.write_text("\n".join(ML_PACKAGES))

    def _install_weights(self) -> None:
        self._set("weights", PACKAGES_SHARE)
        url = self.resolve_url()
        self.checkpoints.mkdir(parents=True, exist_ok=True)
        final = self.checkpoints / url.rsplit("/", 1)[-1]
        partial = final.with_name(final.name + ".part")
        try:
            self.download(url, partial,
                          lambda f: self._set("weights", PACKAGES_SHARE + (1 - PACKAGES_SHARE) * f))
            os.replace(partial, final)
        finally:
            partial.unlink(missing_ok=True)
