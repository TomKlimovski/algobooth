"""The local HTTP API the Tauri app talks to: bearer-token auth, one rip at a time."""

import hmac
from dataclasses import replace
from typing import Protocol

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from algorip import jobs
from algorip.download import ClipInfo, list_clips
from algorip.jobs import Busy, Job, JobStore
from algorip.pipeline import Deps, Paths, run_rip as default_run_rip, stem_dir
from algorip.schema import JobStatus, ModelStatus, RipRequest
from algorip.separate import STEMS

ALLOWED_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"]
STEM_NAMES = (*STEMS, "mix")


class ModelStore(Protocol):
    """What the API needs from `algorip.models.ModelStore`."""

    def status(self) -> ModelStatus: ...

    def install(self) -> None: ...


class ServiceSettings(BaseModel):
    token: str
    paths: Paths


class RipCreated(BaseModel):
    id: str


def create_app(
    settings: ServiceSettings,
    run_rip=default_run_rip,
    deps: Deps | None = None,
    models: ModelStore | None = None,
) -> FastAPI:
    app = FastAPI(title="algorip")
    store = JobStore()
    base_deps = deps or Deps()
    expected = f"Bearer {settings.token}".encode()

    @app.middleware("http")
    async def require_token(request: Request, call_next):
        if request.method == "GET" and request.url.path == "/health":
            return await call_next(request)
        given = request.headers.get("authorization", "").encode()
        if not hmac.compare_digest(given, expected):
            return JSONResponse({"detail": "unauthorised"}, status_code=401)
        return await call_next(request)

    # Added last so it is outermost: preflights are answered before auth, and 401s carry CORS headers.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    def work(job: Job):
        job_deps = replace(base_deps, cancelled=lambda: job.cancel.is_set() or base_deps.cancelled())
        result = run_rip(job.request, settings.paths,
                         lambda stage, fraction: store.set_progress(job.id, stage, fraction), job_deps)
        return result, stem_dir(settings.paths, job.request)

    def model_status() -> ModelStatus:
        if models is None:  # no store (tests, or a pipeline with an injected separator): assume the models are there
            return ModelStatus(ready=True, torch_installed=True, weights_present=True, installing=False,
                               stage=None, progress=0.0, error=None)
        return models.status()

    def find(job_id: str) -> Job:
        job = store.get(job_id)
        if job is None:
            raise HTTPException(404, "no such rip")
        return job

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/models")
    def get_models() -> ModelStatus:
        return model_status()

    @app.post("/models/install", status_code=202)
    def post_models_install() -> ModelStatus:
        if models is not None:
            models.install()  # a no-op while an install is already running
        return model_status()

    @app.get("/clips")
    def get_clips() -> list[ClipInfo]:
        return list_clips(settings.paths.cache_dir)

    @app.post("/rip", status_code=202)
    def post_rip(req: RipRequest) -> RipCreated:
        if not model_status().ready:
            raise HTTPException(503, "models not installed")
        try:
            job = store.create(req)
        except Busy:
            raise HTTPException(409, "a rip is already running") from None
        jobs.start(store, job, work)
        return RipCreated(id=job.id)

    @app.get("/rip/{job_id}")
    def get_rip(job_id: str) -> JobStatus:
        return find(job_id).status

    @app.delete("/rip/{job_id}", status_code=204)
    def delete_rip(job_id: str) -> Response:
        find(job_id)
        store.cancel(job_id)
        return Response(status_code=204)

    @app.get("/rip/{job_id}/stem/{name}")
    def get_stem(job_id: str, name: str) -> FileResponse:
        job = find(job_id)
        if job.status.result is None or job.stem_dir is None or name not in STEM_NAMES:
            raise HTTPException(404, "no such stem")
        path = job.stem_dir / f"{name}.wav"
        if not path.is_file():
            raise HTTPException(404, "no such stem")
        return FileResponse(path, media_type="audio/wav")

    return app
