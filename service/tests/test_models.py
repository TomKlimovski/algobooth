import os
import sys
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from algorip.api import ServiceSettings, create_app
from algorip.models import HTDEMUCS_SIGNATURE, ML_PACKAGES, GroupRunner, ModelStore
from algorip.pipeline import Paths

TOKEN = "s3cret"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
URL = f"https://w/{HTDEMUCS_SIGNATURE}-8726e21a.th"


def target(cmd):
    return Path(cmd[cmd.index("--target") + 1])


def fake_run(tmp_path, calls):
    def run(cmd):
        calls.append(cmd)
        (target(cmd) / "torch").mkdir(parents=True, exist_ok=True)
    return run


def fake_download(url, path, on_fraction):
    path.parent.mkdir(parents=True, exist_ok=True)
    on_fraction(0.5)
    path.write_bytes(b"w")


def test_pins_are_exact():
    assert all("==" in p for p in ML_PACKAGES)
    assert HTDEMUCS_SIGNATURE == "955717e8"


def test_status_is_not_ready_until_marker_and_weights_exist(tmp_path):
    store = ModelStore(tmp_path)
    assert store.site == tmp_path / "site" and store.torch_home == tmp_path / "torch"
    assert store.marker == tmp_path / "site" / ".installed"
    assert store.status().ready is False
    (tmp_path / "site").mkdir(); (tmp_path / "site" / "torch").mkdir()   # half-written install
    assert store.status().torch_installed is False                        # review focus 4
    (tmp_path / "site" / ".installed").write_text("\n".join(ML_PACKAGES))
    assert store.status().torch_installed is True and store.status().weights_present is False
    ck = tmp_path / "torch/hub/checkpoints"; ck.mkdir(parents=True)
    (ck / "955717e8-8726e21a.th.part").write_bytes(b"w")                  # interrupted download
    assert store.status().weights_present is False
    (ck / "955717e8-8726e21a.th").write_bytes(b"w")
    assert store.status().ready is True


def test_marker_for_other_packages_is_not_installed(tmp_path):
    (tmp_path / "site").mkdir()
    (tmp_path / "site" / ".installed").write_text("torch==1.0")
    assert ModelStore(tmp_path).status().torch_installed is False


def test_install_runs_pip_then_downloads_weights(tmp_path):
    calls = []
    store = ModelStore(tmp_path, python=Path("/py"), run=fake_run(tmp_path, calls), download=fake_download,
                       resolve_url=lambda: URL)
    store.install(); store.wait(5)
    cmd = calls[0]
    assert cmd[:3] == ["/py", "-m", "pip"] and "--target" in cmd and ML_PACKAGES[0] in cmd
    assert cmd == ["/py", "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--only-binary=:all:",
                   "--target", str(tmp_path / f"site.partial-{os.getpid()}"), *ML_PACKAGES]
    status = store.status()
    assert status.ready and status.error is None and not status.installing and status.progress == 1.0
    assert (tmp_path / "site" / ".installed").read_text().split("\n") == ML_PACKAGES
    assert (tmp_path / "torch/hub/checkpoints/955717e8-8726e21a.th").read_bytes() == b"w"
    assert not list((tmp_path / "torch/hub/checkpoints").glob("*.part"))


def test_install_reports_stages_and_progress(tmp_path):
    seen = []
    gate = threading.Event()
    store = None

    def run(cmd):
        s = store.status(); seen.append((s.stage, s.progress, s.installing))
        target(cmd).mkdir(parents=True, exist_ok=True)

    def download(url, path, on_fraction):
        on_fraction(0.5)
        s = store.status(); seen.append((s.stage, s.progress, s.installing))
        assert store.site.joinpath(".installed").exists()                # marker written before weights
        path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"w")
        gate.set()

    store = ModelStore(tmp_path, run=run, download=download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    assert gate.is_set()
    assert seen[0] == ("packages", 0.0, True)
    assert seen[1] == ("weights", pytest.approx(0.85), True)


def test_marker_is_written_only_after_pip_succeeds(tmp_path):
    def run(cmd):
        (target(cmd) / "torch").mkdir(parents=True)
        raise RuntimeError("disk full")

    store = ModelStore(tmp_path, run=run, download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    assert not (tmp_path / "site" / ".installed").exists()
    assert store.status().torch_installed is False


def test_install_failure_is_reported_and_retryable(tmp_path):
    calls = []

    def run(cmd):
        calls.append(cmd)
        raise RuntimeError("no wheel")

    store = ModelStore(tmp_path, run=run, download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    s = store.status()
    assert s.error == "no wheel" and s.installing is False and s.torch_installed is False and not s.ready
    store.install(); store.wait(5)
    assert len(calls) == 2


def test_pip_installs_into_a_partial_folder_that_then_replaces_site(tmp_path):
    (tmp_path / "site" / "torch").mkdir(parents=True)
    (tmp_path / "site" / "torch" / "stale.py").write_text("")  # a half-written site from a killed install
    (tmp_path / "site.partial-1").mkdir()  # an orphaned pip's folder
    seen = []

    def run(cmd):
        seen.append((target(cmd), (tmp_path / "site" / "torch" / "stale.py").exists()))
        (target(cmd) / "torch").mkdir(parents=True)
        (target(cmd) / "torch" / "new.py").write_text("")

    store = ModelStore(tmp_path, run=run, download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    assert seen == [(tmp_path / f"site.partial-{os.getpid()}", True)]  # pip never writes into site itself
    assert (tmp_path / "site" / "torch" / "new.py").exists()
    assert not (tmp_path / "site" / "torch" / "stale.py").exists()
    assert (tmp_path / "site" / ".installed").exists()
    assert list(tmp_path.glob("site.partial-*")) == []


def test_a_failed_pip_leaves_site_alone_and_no_partial_folder(tmp_path):
    (tmp_path / "site").mkdir()
    (tmp_path / "site" / "keep.py").write_text("")

    def run(cmd):
        (target(cmd) / "torch").mkdir(parents=True)
        raise RuntimeError("no wheel")

    store = ModelStore(tmp_path, run=run, download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    assert store.status().error == "no wheel"
    assert (tmp_path / "site" / "keep.py").exists()
    assert list(tmp_path.glob("site.partial-*")) == []


def test_store_stop_stops_its_runner(tmp_path):
    class Runner:
        stopped = False

        def __call__(self, cmd):
            pass

        def stop(self):
            Runner.stopped = True

    ModelStore(tmp_path, run=Runner()).stop()
    assert Runner.stopped
    ModelStore(tmp_path, run=lambda cmd: None).stop()  # a plain runner has nothing to stop


def _alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def test_group_runner_stop_kills_the_command_and_its_children(tmp_path):
    pidfile = tmp_path / "child.pid"
    script = ("import subprocess, sys, time\n"
              "child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\n"
              f"open({str(pidfile)!r}, 'w').write(str(child.pid))\n"
              "time.sleep(60)\n")
    runner, errors = GroupRunner(), []

    def go():
        try:
            runner([sys.executable, "-c", script])
        except RuntimeError as exc:
            errors.append(exc)

    thread = threading.Thread(target=go)
    thread.start()
    deadline = time.monotonic() + 10
    while not (pidfile.exists() and pidfile.read_text()) and time.monotonic() < deadline:
        time.sleep(0.02)
    child = int(pidfile.read_text())
    runner.stop()
    thread.join(10)
    assert not thread.is_alive() and len(errors) == 1
    deadline = time.monotonic() + 10
    while _alive(child) and time.monotonic() < deadline:
        time.sleep(0.02)
    assert not _alive(child)


def test_group_runner_reports_a_failure_with_its_stderr():
    with pytest.raises(RuntimeError, match="boom"):
        GroupRunner()([sys.executable, "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"])
    GroupRunner()([sys.executable, "-c", "pass"])


def test_download_failure_leaves_no_weights_and_keeps_packages(tmp_path):
    calls = []

    def download(url, path, on_fraction):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"half")
        raise OSError("connection reset")

    store = ModelStore(tmp_path, run=fake_run(tmp_path, calls), download=download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    s = store.status()
    assert s.error == "connection reset" and s.torch_installed and not s.weights_present and not s.installing
    assert not (tmp_path / "torch/hub/checkpoints/955717e8-8726e21a.th").exists()

    store = ModelStore(tmp_path, run=fake_run(tmp_path, calls), download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    assert store.status().ready and len(calls) == 1                     # packages were not reinstalled


def test_resolve_url_failure_is_reported(tmp_path):
    def resolve():
        raise KeyError("955717e8")

    store = ModelStore(tmp_path, run=fake_run(tmp_path, []), download=fake_download, resolve_url=resolve)
    store.install(); store.wait(5)
    assert store.status().error and not store.status().installing


def test_second_install_while_installing_is_a_no_op(tmp_path):
    calls = []
    release = threading.Event()

    def run(cmd):
        calls.append(cmd)
        assert release.wait(5)
        target(cmd).mkdir(parents=True, exist_ok=True)

    store = ModelStore(tmp_path, run=run, download=fake_download, resolve_url=lambda: URL)
    store.install()
    store.install()
    assert store.status().installing is True
    release.set()
    store.wait(5)
    assert len(calls) == 1 and store.status().ready


def test_install_when_ready_does_nothing(tmp_path):
    calls = []
    store = ModelStore(tmp_path, run=fake_run(tmp_path, calls), download=fake_download, resolve_url=lambda: URL)
    store.install(); store.wait(5)
    store.install(); store.wait(5)
    assert len(calls) == 1 and store.status().ready


@pytest.fixture
def client_with_models(tmp_path):
    release = threading.Event()
    calls = []

    def run(cmd):
        calls.append(cmd)
        assert release.wait(5)
        target(cmd).mkdir(parents=True, exist_ok=True)

    store = ModelStore(tmp_path / "m", run=run, download=fake_download, resolve_url=lambda: URL)
    settings = ServiceSettings(token=TOKEN, paths=Paths(cache_dir=tmp_path / "c", models_dir=tmp_path / "m",
                                                         keep_downloads=False))
    with TestClient(create_app(settings, run_rip=lambda *a: None, models=store)) as c:
        yield c, store, release, calls
    release.set()


def test_api_blocks_rip_until_models_ready(client_with_models):
    client, store, release, calls = client_with_models
    body = {"url": "https://x/v", "start": 0, "end": 8}
    r = client.post("/rip", json=body, headers=AUTH)
    assert r.status_code == 503 and r.json() == {"detail": "models not installed"}
    assert client.get("/models", headers=AUTH).json()["ready"] is False

    r = client.post("/models/install", headers=AUTH)
    assert r.status_code == 202 and r.json()["installing"] is True and r.json()["ready"] is False
    assert client.post("/models/install", headers=AUTH).status_code == 202
    assert client.post("/rip", json=body, headers=AUTH).status_code == 503

    release.set(); store.wait(5)
    m = client.get("/models", headers=AUTH).json()
    assert m == {"ready": True, "torch_installed": True, "weights_present": True, "installing": False,
                 "stage": None, "progress": 1.0, "error": None}
    assert len(calls) == 1


def test_models_install_requires_the_token(client_with_models):
    client, *_ = client_with_models
    assert client.post("/models/install").status_code == 401


def test_demucs_checkpoint_url_reads_the_remote_list_from_site(tmp_path, monkeypatch):
    import sys

    from algorip.models import demucs_checkpoint_url

    pkg = tmp_path / "site" / "demucs"
    (pkg / "remote").mkdir(parents=True)
    (pkg / "__init__.py").write_text("")
    (pkg / "remote" / "files.txt").write_text("root: hybrid_transformer/\n955717e8-8726e21a.th\n")
    (pkg / "pretrained.py").write_text(
        "from pathlib import Path\n"
        "ROOT_URL = 'https://dl.example/demucs/'\n"
        "REMOTE_ROOT = Path(__file__).parent / 'remote'\n"
        "def _parse_remote_files(p):\n"
        "    root, out = '', {}\n"
        "    for line in p.read_text().split('\\n'):\n"
        "        if line.startswith('root:'): root = line.split(':', 1)[1].strip()\n"
        "        elif line: out[line.split('-', 1)[0]] = ROOT_URL + root + line\n"
        "    return out\n")
    monkeypatch.setattr(sys, "path", list(sys.path))
    for name in ("demucs", "demucs.pretrained"):
        monkeypatch.delitem(sys.modules, name, raising=False)
    try:
        assert demucs_checkpoint_url(tmp_path / "site") == \
            "https://dl.example/demucs/hybrid_transformer/955717e8-8726e21a.th"
    finally:
        for name in ("demucs", "demucs.pretrained"):
            sys.modules.pop(name, None)


def test_httpx_download_streams_and_reports_fractions(tmp_path):
    import httpx

    from algorip.models import httpx_download

    payload = b"x" * (2 * 1024 * 1024 + 10)
    transport = httpx.MockTransport(
        lambda req: httpx.Response(200, content=payload, headers={"content-length": str(len(payload))}))
    fractions = []
    httpx_download("https://w/a.th", tmp_path / "a.th", fractions.append, transport=transport)
    assert (tmp_path / "a.th").read_bytes() == payload
    assert len(fractions) >= 2 and fractions == sorted(fractions) and fractions[-1] == 1.0


def test_httpx_download_raises_on_http_error(tmp_path):
    import httpx

    from algorip.models import httpx_download

    transport = httpx.MockTransport(lambda req: httpx.Response(404))
    with pytest.raises(httpx.HTTPStatusError):
        httpx_download("https://w/a.th", tmp_path / "a.th", lambda f: None, transport=transport)


def test_use_site_appends_so_service_packages_win(tmp_path, monkeypatch):
    import sys

    from algorip.models import use_site

    monkeypatch.setattr(sys, "path", ["/service"])
    use_site(tmp_path); use_site(tmp_path)
    assert sys.path == ["/service", str(tmp_path)]
