from __future__ import annotations

import os
import re
from pathlib import Path

_ENV_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[7:].lstrip()
    if "=" not in stripped:
        return None
    key, value = stripped.split("=", 1)
    key = key.strip()
    if not _ENV_KEY_RE.match(key):
        return None
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        value = value[1:-1]
    return key, value


def load_repo_env(
    root: str | Path | None = None,
    filenames: tuple[str, ...] = (".env", ".env.runner"),
) -> list[Path]:
    repo_root = Path(root) if root is not None else Path(__file__).resolve().parents[1]
    loaded: list[Path] = []
    for filename in filenames:
        path = repo_root / filename
        if not path.exists() or not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            parsed = _parse_env_line(line)
            if parsed is None:
                continue
            key, value = parsed
            os.environ.setdefault(key, value)
        loaded.append(path)
    return loaded
