"""Command-line interface for X Files."""

from __future__ import annotations

import argparse
from collections.abc import Sequence


def build_parser() -> argparse.ArgumentParser:
    """Create the top-level argument parser."""
    return argparse.ArgumentParser(
        prog="xfiles",
        description="Encrypt and recover personal media in a local-first vault.",
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Run the X Files command-line interface."""
    parser = build_parser()
    parser.parse_args(argv)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
