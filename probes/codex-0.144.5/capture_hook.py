#!/usr/bin/env python3
"""PROTOTYPE: copy one Codex hook payload to the probe's raw directory."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    raw_dir = Path(os.environ["LOUPE_PROBE_RAW_DIR"])
    raw_dir.mkdir(parents=True, exist_ok=True)
    payload = json.load(sys.stdin)
    record = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "producer": {"name": "codex-cli", "version": "0.144.5"},
        "payload": payload,
    }
    with (raw_dir / "hooks.raw.jsonl").open("a", encoding="utf-8") as output:
        output.write(json.dumps(record, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
