"""The job store: one rip at a time, its status readable from any thread.

Every mutation happens under one lock and replaces `Job.status` with a fresh
`JobStatus`, so a reader holding the old object always sees a consistent snapshot.
"""

import secrets
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from algorip.pipeline import Cancelled
from algorip.schema import JobStatus, RipRequest, RipResult, Stage


class Busy(Exception):
    """A job is already queued or running."""


@dataclass
class Job:
    id: str
    request: RipRequest
    status: JobStatus
    stem_dir: Path | None = None
    cancel: threading.Event = field(default_factory=threading.Event)


_ACTIVE = ("queued", "running")


class JobStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}

    def create(self, req: RipRequest) -> Job:
        with self._lock:
            if any(job.status.status in _ACTIVE for job in self._jobs.values()):
                raise Busy()
            job_id = secrets.token_hex(6)
            status = JobStatus(id=job_id, status="queued", stage=None, progress=0.0, result=None, error=None)
            job = Job(id=job_id, request=req, status=status)
            self._jobs[job_id] = job
            return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _update(self, job: Job, **changes) -> None:
        job.status = job.status.model_copy(update=changes)

    def begin(self, job_id: str) -> bool:
        """Move a queued job to running; False when it was cancelled before it started."""
        with self._lock:
            job = self._jobs[job_id]
            if job.status.status != "queued":
                return False
            self._update(job, status="running")
            return True

    def cancel(self, job_id: str) -> bool:
        """Cancel a queued job at once, or flag a running one to stop after its stage; False otherwise."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status.status not in _ACTIVE:
                return False
            job.cancel.set()
            if job.status.status == "queued":
                self._update(job, status="cancelled")
            return True

    def set_progress(self, job_id: str, stage: Stage, fraction: float) -> None:
        with self._lock:
            job = self._jobs[job_id]
            if job.status.status == "running":
                self._update(job, stage=stage, progress=fraction)

    def finish(self, job_id: str, result: RipResult, stem_dir: Path | None = None) -> None:
        with self._lock:
            job = self._jobs[job_id]
            job.stem_dir = stem_dir
            self._update(job, status="done", progress=1.0, result=result, error=None)

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            self._update(self._jobs[job_id], status="failed", error=error)

    def mark_cancelled(self, job_id: str) -> None:
        with self._lock:
            self._update(self._jobs[job_id], status="cancelled")


Work = Callable[[Job], tuple[RipResult, Path | None]]


def start(store: JobStore, job: Job, work: Work) -> threading.Thread:
    """Run `work(job)` on its own thread, recording done, failed or cancelled in the store."""

    def target() -> None:
        if not store.begin(job.id):
            return
        try:
            result, stem_dir = work(job)
        except Cancelled:
            store.mark_cancelled(job.id)
        except Exception as exc:  # noqa: BLE001 - any pipeline failure is reported on the job
            store.fail(job.id, str(exc) or type(exc).__name__)
        else:
            store.finish(job.id, result, stem_dir)

    thread = threading.Thread(target=target, name=f"rip-{job.id}", daemon=True)
    thread.start()
    return thread
