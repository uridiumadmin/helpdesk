from __future__ import annotations

import argparse
from dataclasses import replace

from audio_worker.config import WorkerSettings
from audio_worker.server import serve


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the audio worker health server.")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = WorkerSettings.from_env()
    if args.host is not None or args.port is not None:
        settings = replace(
            settings,
            **({} if args.host is None else {"host": args.host}),
            **({} if args.port is None else {"port": args.port}),
        )
    serve(settings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
