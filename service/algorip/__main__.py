"""Entry point: `python -m algorip` serves the API on a random 127.0.0.1 port.

The first and only line on stdout is `{"port": N}`, which the Tauri app reads
to find the service; everything else goes to stderr.
"""

import json
import os
import socket
import sys
from collections.abc import Mapping
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


def main() -> None:
    settings = settings_from_env(os.environ)

    import uvicorn

    from algorip.api import create_app

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    sock.listen(socket.SOMAXCONN)
    sys.stdout.write(port_line(sock.getsockname()[1]) + "\n")
    sys.stdout.flush()

    server = uvicorn.Server(uvicorn.Config(create_app(settings), log_level="warning"))
    server.run(sockets=[sock])


if __name__ == "__main__":
    main()
