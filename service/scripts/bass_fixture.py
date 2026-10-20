"""Write a bass-loop golden: from a clip's cached stems, or from the synthetic build.

    uv run python scripts/bass_fixture.py stems <stems_dir> <name> --title T --start S --end E
    uv run python scripts/bass_fixture.py synthetic build

Run from service/. Writes JSON and .strudel text to tests/golden; never audio.
"""

import argparse
import sys
import tempfile
from pathlib import Path

SERVICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVICE))  # for tests.synth, which the synthetic build is made with

from algorip.audio import write_wav  # noqa: E402
from algorip.fixtures import bass_grid_of, build_fixture_audio, write_golden  # noqa: E402
from algorip.mini import loop_mini  # noqa: E402
from algorip.pipeline import RESULT_STEMS, _analyse  # noqa: E402
from algorip.schema import Analysis  # noqa: E402

GOLDEN = SERVICE / "tests" / "golden"


def _report(name: str, a: Analysis) -> None:
    loop = a.bass_loop
    print(f"{name}: {a.bpm} bpm, {a.key}, {a.bars} bars, first downbeat {a.first_downbeat:.3f}")
    if loop is None:
        print("no bass loop")
        return
    print(f"loop (period {loop.period}): {loop_mini(loop.templates)}")
    print(f"layer_bars: {loop.layer_bars}")
    print(f"match: {loop.match:.3f}  match_with_layer: {loop.match_with_layer}")


def _golden(stems: dict[str, Path], name: str, predict, title: str, start: float, end: float) -> None:
    a = _analyse(stems, predict, lambda f: None)
    write_golden(GOLDEN, name, a, bass_grid_of(stems, a), title, start, end)
    _report(name, a)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    from_stems = sub.add_parser("stems", help="a golden from a directory of stem wavs")
    from_stems.add_argument("stems_dir", type=Path)
    from_stems.add_argument("name")
    from_stems.add_argument("--title", required=True)
    from_stems.add_argument("--start", type=float, required=True)
    from_stems.add_argument("--end", type=float, required=True)
    synthetic = sub.add_parser("synthetic", help="a golden from synthetic audio")
    synthetic.add_argument("name", choices=["build"])
    args = parser.parse_args()

    if args.command == "stems":
        from algorip.notes import basic_pitch_predict

        stems = {s: args.stems_dir.expanduser() / f"{s}.wav" for s in RESULT_STEMS}
        _golden(stems, args.name, basic_pitch_predict, args.title, args.start, args.end)
    else:
        audio, _, _ = build_fixture_audio()
        with tempfile.TemporaryDirectory() as tmp:
            stems = {}
            for s, y in audio.items():
                stems[s] = Path(tmp) / f"{s}.wav"
                write_wav(stems[s], y)
            # The build's header is "Build", 0 to 16 s, as test_generate expects.
            _golden(stems, args.name, lambda p: [], "Build", 0, 16)


if __name__ == "__main__":
    main()
