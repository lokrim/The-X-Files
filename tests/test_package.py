"""Tests for package installation and discovery."""


def test_package_imports() -> None:
    import x_files

    assert x_files.__doc__ == "X Files: a local-first encrypted-media vault."
