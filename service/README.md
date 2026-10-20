# algorip

The analysis service behind Algobooth's rip pipeline: it takes a YouTube clip and
turns it into a live-coding pattern. It is a Python 3.11 project managed by
[uv](https://docs.astral.sh/uv/).

## Set up

```sh
cd service
uv sync
```

This creates `service/.venv` with Python 3.11 and the exact versions in `uv.lock`.
Every dependency is pinned with `==` in `pyproject.toml`.

## Run the tests

```sh
uv run pytest                 # everything (what CI runs)
uv run pytest -m "not slow"   # skip the tests that run a real Basic Pitch inference
```

Tests never touch the network: `pytest-socket` runs with `--disable-socket`, and the
analysis tests build their audio from the synthetic fixtures in `tests/synth.py`.

## Run the service by hand

```sh
ALGOBOOTH_TOKEN=dev uv run python -m algorip
```

Normally the desktop app starts the service itself and passes the token. The service
binds a random port on `127.0.0.1`, prints one line, `{"port": N}`, on stdout, and
logs everything else to stderr. It exits on its own when the process that started it
goes away.

### Environment

The Rust shell (`src-tauri/src/service.rs`) sets these when it starts the service:

| Variable | Meaning | Default when unset |
| --- | --- | --- |
| `ALGOBOOTH_TOKEN` | Bearer token every request but `GET /health` must carry. A fresh random one per launch. | none: the service exits with status 2 |
| `ALGOBOOTH_CACHE_DIR` | Downloads, stems and analysis results. The app passes the Settings value, `~/Algobooth/cache` by default. | `~/.algobooth/cache` |
| `ALGOBOOTH_MODELS_DIR` | Where PyTorch, Demucs (`site/`) and the htdemucs weights (`torch/`) are installed. The app passes `<app data>/models`. | `~/.algobooth/models` |
| `ALGOBOOTH_KEEP_DOWNLOADS` | `1` keeps the downloaded source audio after a rip; anything else deletes it. | delete |
| `PYTORCH_ENABLE_MPS_FALLBACK` | Always `1`, so torch ops Metal lacks fall back to the CPU. | unset |

`ALGOBOOTH_PYTHON` is read by the Rust shell, not the service: it overrides which
Python runs `-m algorip` (otherwise `service/.venv/bin/python`).

## API

Every route except `GET /health` needs `Authorization: Bearer <ALGOBOOTH_TOKEN>`;
without it the answer is `401 {"detail": "unauthorised"}`. CORS allows the Tauri
origins and the Vite dev server (`http://localhost:1420`). Request bodies that fail
validation get FastAPI's `422`. One rip runs at a time.

| Method and path | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /health` | | `200 {"ok": true}` (no auth) | |
| `GET /models` | | `200 ModelStatus` | `401` |
| `POST /models/install` | | `202 ModelStatus`; starts the first-run download, a no-op while one is running | `401` |
| `POST /rip` | `RipRequest`: `url`, `start`, `end` (seconds), `tidy`, `claude_api_key` | `202 {"id": "..."}` | `401`; `422` bad URL, start not before end, or a clip over 60 s; `503` models not installed; `409` a rip is already running |
| `GET /rip/{id}` | | `200 JobStatus`: `status` (`queued`, `running`, `done`, `failed`, `cancelled`), `stage` (`download`, `separate`, `analyse`, `generate`, `tidy`), `progress` 0..1 within the stage, `result` (`RipResult`) once done, `error` | `401`; `404` unknown id |
| `DELETE /rip/{id}` | | `204`; cancels the rip at the next stage boundary | `401`; `404` unknown id |
| `GET /rip/{id}/stem/{name}` | | `200 audio/wav`; `name` is `drums`, `bass`, `other`, `vocals` or `mix` | `401`; `404` unknown id, rip not done, or no such stem |

The types are in `algorip/schema.py`; `app/src/rip/ripApi.ts` mirrors them.

## PyTorch and Demucs

torch and Demucs are not project dependencies. The service installs them into the
app's models folder the first time you rip a clip, so `uv sync` stays small.
