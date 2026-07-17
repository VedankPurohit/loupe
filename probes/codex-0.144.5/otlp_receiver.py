#!/usr/bin/env python3
"""PROTOTYPE: minimal localhost OTLP/HTTP JSON receiver for a real Codex probe."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock


class ProbeOtlpServer(ThreadingHTTPServer):
    def __init__(self, raw_dir: Path) -> None:
        super().__init__(("127.0.0.1", 0), ProbeOtlpHandler)
        self.raw_dir = raw_dir
        self.write_lock = Lock()


class ProbeOtlpHandler(BaseHTTPRequestHandler):
    server: ProbeOtlpServer

    def do_POST(self) -> None:  # noqa: N802 - stdlib callback name
        length = int(self.headers.get("content-length", "0"))
        body = self.rfile.read(length)
        kind = "traces" if self.path.endswith("/v1/traces") else "logs"
        record = {
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "producer": {"name": "codex-cli", "version": "0.144.5"},
            "content_type": self.headers.get("content-type"),
            "path": self.path,
            "payload": json.loads(body),
        }
        target = self.server.raw_dir / f"otel-{kind}.raw.jsonl"
        with self.server.write_lock, target.open("a", encoding="utf-8") as output:
            output.write(json.dumps(record, sort_keys=True) + "\n")

        response = b"{}"
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, _format: str, *_args: object) -> None:
        return
