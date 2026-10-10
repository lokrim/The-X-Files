"""Tests for the command-line interface."""

import pytest

from x_files.cli import main


def test_cli_accepts_no_arguments() -> None:
    assert main([]) == 0


def test_help_describes_the_program(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit) as result:
        main(["--help"])

    assert result.value.code == 0

    output = capsys.readouterr().out
    assert "usage: xfiles" in output
    assert "local-first vault" in output
