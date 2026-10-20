import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from algorip.__main__ import port_line, settings_from_env
from algorip.api import ServiceSettings, create_app
from algorip.download import clip_key
from algorip.pipeline import Deps, Paths
from algorip.schema import Analysis, RipResult, SoundChoice

TOKEN = "s3cret"
AUTH = {"Authorization": f"Bearer {TOKEN}"}
BODY = {"url": "https://x/v", "start": 0, "end": 8}


def fake_result() -> RipResult:
    a = Analysis(bpm=124, key="A minor", bars=4, first_downbeat=0.0, drums={}, four_on_the_floor=True,
                 bass=[], bass_harmonics=0.5, chords=[], melody=None)
    s = SoundChoice(drum_bank="tr909", snare_name="cp", bass_sound="sawtooth", bass_lpf=800)
    return RipResult(title="T", analysis=a, sounds=s, code="// T\nsetcpm(124/4)\n", tidied_code=None,
                     tidy_error=None, stems=["drums", "bass", "other", "vocals", "mix"])


class FakeRip:
    """Stands in for run_rip: reports a stage, then blocks until released (or cancelled)."""

    def __init__(self):
        self.release = threading.Event()
        self.started = threading.Event()
        self.error: Exception | None = None
        self.calls = 0

    def __call__(self, req, paths, progress, deps):
        from algorip.pipeline import Cancelled

        self.calls += 1
        progress("download", 0.0)
        progress("separate", 0.5)
        self.started.set()
        assert self.release.wait(5)
        if deps.cancelled():
            raise Cancelled()
        if self.error:
            raise self.error
        stem_dir = paths.cache_dir / "stems" / clip_key(req.url, req.start, req.end)
        stem_dir.mkdir(parents=True, exist_ok=True)
        for name in ("drums", "bass", "other", "vocals", "mix"):
            (stem_dir / f"{name}.wav").write_bytes(f"RIFF-{name}".encode())
        return fake_result()


@pytest.fixture
def fake():
    f = FakeRip()
    yield f
    f.release.set()


@pytest.fixture
def client(tmp_path, fake):
    settings = ServiceSettings(token=TOKEN, paths=Paths(cache_dir=tmp_path / "cache", models_dir=tmp_path / "m",
                                                         keep_downloads=False))
    deps = Deps(fetch=None, run=None, separator=None, predict=None, chat=None, cancelled=lambda: False)
    with TestClient(create_app(settings, run_rip=fake, deps=deps)) as c:
        yield c


def wait_for(client, job_id, status, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/rip/{job_id}", headers=AUTH).json()
        if body["status"] == status:
            return body
        time.sleep(0.01)
    raise AssertionError(f"job never reached {status}: {body}")


def start(client, fake):
    r = client.post("/rip", json=BODY, headers=AUTH)
    assert r.status_code == 202, r.text
    assert fake.started.wait(5)
    return r.json()["id"]


def test_every_route_needs_the_token(client):
    assert client.get("/health").json() == {"ok": True}
    for method, path in [("post", "/rip"), ("get", "/rip/abc"), ("delete", "/rip/abc"),
                         ("get", "/rip/abc/stem/drums"), ("get", "/models")]:
        for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}):
            r = client.request(method.upper(), path, headers=headers, json=BODY if method == "post" else None)
            assert r.status_code == 401, (method, path, headers)
            assert r.json() == {"detail": "unauthorised"}
    assert client.get("/models", headers=AUTH).json()["ready"] is True


def test_post_rip_validates_the_window(client, fake):
    r = client.post("/rip", json={"url": "https://x/v", "start": 0, "end": 61}, headers=AUTH)
    assert r.status_code == 422 and "60 seconds" in r.text
    r = client.post("/rip", json={"url": "ftp://x/v", "start": 0, "end": 5}, headers=AUTH)
    assert r.status_code == 422
    assert fake.calls == 0


def test_single_job_at_a_time(client, fake):
    job_id = start(client, fake)
    assert len(job_id) == 12 and int(job_id, 16) >= 0
    busy = client.post("/rip", json=BODY, headers=AUTH)
    assert busy.status_code == 409 and busy.json() == {"detail": "a rip is already running"}
    fake.release.set()
    wait_for(client, job_id, "done")
    again = client.post("/rip", json=BODY, headers=AUTH)
    assert again.status_code == 202 and again.json()["id"] != job_id


def test_status_progress_and_result(client, fake):
    job_id = start(client, fake)
    running = client.get(f"/rip/{job_id}", headers=AUTH).json()
    assert running["status"] == "running" and running["stage"] == "separate" and running["progress"] == 0.5
    assert running["result"] is None and running["error"] is None
    fake.release.set()
    done = wait_for(client, job_id, "done")
    assert done["result"]["stems"] == ["drums", "bass", "other", "vocals", "mix"]
    assert done["result"]["code"].startswith("// T")
    assert client.get("/rip/nope", headers=AUTH).status_code == 404


def test_cancel(client, fake):
    job_id = start(client, fake)
    r = client.delete(f"/rip/{job_id}", headers=AUTH)
    assert r.status_code == 204
    fake.release.set()
    cancelled = wait_for(client, job_id, "cancelled")
    assert cancelled["result"] is None
    assert client.delete("/rip/nope", headers=AUTH).status_code == 404
    assert client.post("/rip", json=BODY, headers=AUTH).status_code == 202


def test_cancel_a_queued_job_at_once():
    from algorip.jobs import JobStore
    from algorip.schema import RipRequest

    store = JobStore()
    job = store.create(RipRequest(**BODY))
    assert job.status.status == "queued" and store.cancel(job.id)
    assert store.get(job.id).status.status == "cancelled"
    assert store.create(RipRequest(**BODY)).status.status == "queued"


def test_stem_streaming(client, fake, tmp_path):
    job_id = start(client, fake)
    assert client.get(f"/rip/{job_id}/stem/drums", headers=AUTH).status_code == 404  # no result yet
    fake.release.set()
    wait_for(client, job_id, "done")
    r = client.get(f"/rip/{job_id}/stem/drums", headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"] == "audio/wav" and r.content == b"RIFF-drums"
    assert client.get(f"/rip/{job_id}/stem/mix", headers=AUTH).content == b"RIFF-mix"
    assert client.get(f"/rip/{job_id}/stem/nope", headers=AUTH).status_code == 404
    assert client.get(f"/rip/{job_id}/stem/..%2Fmix", headers=AUTH).status_code == 404
    assert client.get("/rip/unknown/stem/drums", headers=AUTH).status_code == 404


def test_cors_allows_the_tauri_origin(client):
    r = client.options("/rip", headers={"Origin": "tauri://localhost", "Access-Control-Request-Method": "POST",
                                        "Access-Control-Request-Headers": "Authorization, Content-Type"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "tauri://localhost"
    other = client.options("/rip", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in other.headers


def test_failed_pipeline_reports_error(client, fake):
    fake.error = RuntimeError("boom")
    job_id = start(client, fake)
    fake.release.set()
    failed = wait_for(client, job_id, "failed")
    assert failed["error"] == "boom" and failed["result"] is None
    assert client.post("/rip", json=BODY, headers=AUTH).status_code == 202


def test_models_not_ready_blocks_rips(tmp_path, fake):
    from algorip.schema import ModelStatus

    class NotReady:
        def status(self):
            return ModelStatus(ready=False, torch_installed=False, weights_present=False, installing=False,
                               stage=None, progress=0.0, error=None)

    settings = ServiceSettings(token=TOKEN, paths=Paths(cache_dir=tmp_path, models_dir=tmp_path, keep_downloads=False))
    with TestClient(create_app(settings, run_rip=fake, models=NotReady())) as c:
        r = c.post("/rip", json=BODY, headers=AUTH)
        assert r.status_code == 503 and r.json() == {"detail": "models not installed"}


def test_settings_from_env(tmp_path, capsys):
    env = {"ALGOBOOTH_TOKEN": "t", "ALGOBOOTH_CACHE_DIR": str(tmp_path / "c"),
           "ALGOBOOTH_MODELS_DIR": str(tmp_path / "m"), "ALGOBOOTH_KEEP_DOWNLOADS": "1"}
    s = settings_from_env(env)
    assert s.token == "t" and s.paths.cache_dir == tmp_path / "c" and s.paths.models_dir == tmp_path / "m"
    assert s.paths.keep_downloads is True
    assert settings_from_env({**env, "ALGOBOOTH_KEEP_DOWNLOADS": "0"}).paths.keep_downloads is False
    assert settings_from_env({k: v for k, v in env.items() if k != "ALGOBOOTH_KEEP_DOWNLOADS"}).paths.keep_downloads is False
    with pytest.raises(SystemExit) as exc:
        settings_from_env({k: v for k, v in env.items() if k != "ALGOBOOTH_TOKEN"})
    assert exc.value.code == 2 and "ALGOBOOTH_TOKEN" in capsys.readouterr().err
    with pytest.raises(SystemExit):
        settings_from_env({**env, "ALGOBOOTH_TOKEN": ""})


def test_port_line_is_one_json_line():
    line = port_line(51234)
    assert line == '{"port": 51234}' and json.loads(line) == {"port": 51234} and "\n" not in line
