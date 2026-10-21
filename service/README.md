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
uv run pytest -m "not slow"   # skip the slow test: the 60-second pitch-tracking timing budget
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
| `ALGOBOOTH_KEEP_DOWNLOADS` | `1` keeps the downloaded source audio after a rip; anything else deletes it. A request's `keep_downloads` wins. | delete |
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
| `GET /clips` | | `200 ClipInfo[]`: the cached clips (link, window, title, `fetched_at`), newest first, for ripping again without a download | `401` |
| `GET /models` | | `200 ModelStatus` | `401` |
| `POST /models/install` | | `202 ModelStatus`; starts the first-run download, a no-op while one is running | `401` |
| `POST /rip` | `RipRequest`: `url`, `start`, `end` (seconds), `tidy`, `claude_api_key`, `keep_downloads` (overrides `ALGOBOOTH_KEEP_DOWNLOADS` for this rip; the app always sends it), `replay` (return the result stored by this clip's last rip, `stems/<key>/result.json`, without running anything; falls through to a normal rip when there is none) | `202 {"id": "..."}` | `401`; `422` bad URL, start not before end, or a clip over 60 s; `503` models not installed; `409` a rip is already running |
| `GET /rip/{id}` | | `200 JobStatus`: `status` (`queued`, `running`, `done`, `failed`, `cancelled`), `stage` (`download`, `separate`, `analyse`, `generate`, `tidy`), `progress` 0..1 within the stage, `result` (`RipResult`) once done, `error` | `401`; `404` unknown id |
| `DELETE /rip/{id}` | | `204`; cancels the rip at the next stage boundary | `401`; `404` unknown id |
| `GET /rip/{id}/stem/{name}` | | `200 audio/wav`; `name` is `drums`, `bass`, `other`, `vocals` or `mix` | `401`; `404` unknown id, rip not done, or no such stem |

The types are in `algorip/schema.py`; `app/src/rip/ripApi.ts` mirrors them. `Analysis`
carries `bass_loop` (`BassLoop`: `period`, `templates`, `layer`, `layer_bars`, `match`,
`match_with_layer`), null when no loop is found.
It also carries `drum_summary` (`DrumSummary`: `period`, `match`, `fill_bars`), null when
there are no drum hits.

## PyTorch and Demucs

torch and Demucs are not project dependencies. The service installs them into the
app's models folder the first time you rip a clip, so `uv sync` stays small.

## Bass loop

Basic Pitch still transcribes the melody; the bass goes through these modules instead.
`mir_eval` is a direct dependency, used for the onset score.

- `algorip/bassgrid.py`: a per-16th-step pitch grid from `librosa.pyin` (stem resampled to 11025 Hz, 30 to 400 Hz), with note starts. Steps quieter than a tenth of the loudest step are rests. The pyin frame is fixed at 2048 samples (186 ms), so the grid is reliable up to roughly 160 bpm and smears 16ths above that (a tempo-adaptive frame is a follow-up).
- `algorip/loop.py`: finds the period (1, 2, 4 or 8 bars) the bars repeat at with a two-pass majority vote, so deviating bars do not veto it. What those bars sound or start that the template does not (measured on the grid's steps, so a sustained fill counts as much as a retriggered one) becomes a layer when it repeats and is dense enough.
- `algorip/score.py`: scores a candidate against the grid, combining a per-step pitch-class frame score with mir_eval's onset F1 into a `match` in 0 to 1.
- `algorip/drumloop.py`: finds a loop per drum voice through `loop.find_loop`; every hit the loop does not play, per bar, becomes the muted `_fills:` line. Drum-only rule: a loop with an empty phase is not a loop; that voice has no main line and all its hits are fills. A bar's strays over the looped voices are written only from `FILL_MIN_HITS` (3) hits. `match` is hit agreement (F1 of the hits the loops play against the classified hits), not a check against the stem.
- `algorip/bass.py`: `choose_bass_loop` tries four notations (as heard, on an 8th grid, sustained, both) and keeps the shortest within 0.05 of the best match.

### Backtest fixtures

`tests/golden/` holds `solomun.*` (a real clip; the derived grid, analysis, Strudel code and
bass events, no audio) and `build.*` (a synthetic 2-bar loop with a build layer).
`app/src/rip/roundtrip.test.ts` plays each golden's `bass:` line under real Strudel and
checks it against the events. `scripts/bass_fixture.py` builds the fixtures and prints the
loop and the match:

```sh
# a real clip: run the analysis on a rip's cached stems (~/Algobooth/cache/stems/<key>/)
uv run python scripts/bass_fixture.py stems <stems_dir> <name> --title T --start S --end E
# the synthetic golden
uv run python scripts/bass_fixture.py synthetic build
```

For a new clip, run `stems`, look at the grid and the loop, and commit the files with the expected loop.
