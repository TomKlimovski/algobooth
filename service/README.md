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

Normally the desktop app starts the service itself and passes the token.

## PyTorch and Demucs

torch and Demucs are not project dependencies. The service installs them into the
app's models folder the first time you rip a clip, so `uv sync` stays small.
