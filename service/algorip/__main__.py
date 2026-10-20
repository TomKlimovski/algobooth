"""Entry point: `python -m algorip` serves the API on a random 127.0.0.1 port.

The first and only line on stdout is `{"port": N}`, which the Tauri app reads
to find the service; everything else goes to stderr.
"""

import json
import os
import socket
import sys
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path

from algorip.api import ServiceSettings
from algorip.pipeline import Paths

_DEFAULT_ROOT = Path.home() / ".algobooth"


def settings_from_env(env: Mapping[str, str]) -> ServiceSettings:
    token = env.get("ALGOBOOTH_TOKEN", "")
    if not token:
        print("algorip: ALGOBOOTH_TOKEN must be set", file=sys.stderr)
        raise SystemExit(2)
    return ServiceSettings(
        token=token,
        paths=Paths(
            cache_dir=Path(env.get("ALGOBOOTH_CACHE_DIR") or _DEFAULT_ROOT / "cache"),
            models_dir=Path(env.get("ALGOBOOTH_MODELS_DIR") or _DEFAULT_ROOT / "models"),
            keep_downloads=env.get("ALGOBOOTH_KEEP_DOWNLOADS") == "1",
        ),
    )


def port_line(port: int) -> str:
    return json.dumps({"port": port})


def parent_gone(original_ppid: int, current_ppid: int) -> bool:
    """True once this process has been reparented, i.e. the app that launched it died."""
    return current_ppid != original_ppid


def watch_parent(
    original_ppid: int,
    getppid: Callable[[], int] = os.getppid,
    exit_: Callable[[int], object] = os._exit,
    sleep: Callable[[float], object] = time.sleep,
    interval: float = 1.0,
) -> None:
    """Exits the process when the parent dies, so a killed or crashed app never leaves us running."""
    while True:
        if parent_gone(original_ppid, getppid()):
            print("algorip: parent process exited, shutting down", file=sys.stderr)
            exit_(0)
        sleep(interval)


def main() -> None:
    settings = settings_from_env(os.environ)
    threading.Thread(target=watch_parent, args=(os.getppid(),), name="parent-watch", daemon=True).start()

    import uvicorn

    from algorip.api import create_app
    from algorip.models import ModelStore

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(socket.SOMAXCONN)
    sys.stdout.write(port_line(sock.getsockname()[1]) + "\n")
    sys.stdout.flush()

    app = create_app(settings, models=ModelStore(settings.paths.models_dir))
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
