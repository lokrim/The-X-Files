# X Files

A cross-platform, local-first Python CLI for encrypting and securely storing
personal media.

X Files will use AES-256-GCM for authenticated encryption and implement Shamir
Secret Sharing for threshold recovery. The core workflow works fully offline and
does not require a cloud service.

## Development

Run the command-line help:

```bash
uv run xfiles --help
```

## Tests

```bash
uv run pytest tests/test_cli.py -v
uv run pytest -v
uv run ruff check .
uv run ruff format --check .
uv run xfiles --help
```
