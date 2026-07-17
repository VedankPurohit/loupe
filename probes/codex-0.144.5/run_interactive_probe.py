#!/usr/bin/env python3
"""PROTOTYPE: exercise Codex 0.144.5 fork and approval in an isolated PTY.

Question: does the target TUI emit a fork lineage record and a lifecycle
PermissionRequest when a human approves one synthetic command in the isolated
probe workspace? Run only against a directory created by run_probe.py.
"""

from __future__ import annotations

import argparse
import json
import os
import pty
import re
import select
import signal
import threading
import time
from pathlib import Path

from otlp_receiver import ProbeOtlpServer


TARGET_PACKAGE = "@openai/codex@0.144.5"


def latest_root_thread(codex_home: Path) -> str:
    rollouts = sorted((codex_home / "sessions").rglob("*.jsonl"))
    if not rollouts:
        raise RuntimeError("probe root has no rollout session")
    for line in rollouts[0].read_text(encoding="utf-8").splitlines():
        record = json.loads(line)
        if record.get("type") == "session_meta":
            return str(record["payload"]["id"])
    raise RuntimeError("root rollout has no session_meta id")


def point_config_at(codex_home: Path, port: int) -> None:
    path = codex_home / "config.toml"
    config = path.read_text(encoding="utf-8")
    config = re.sub(
        r'endpoint = "http://127\.0\.0\.1:\d+/(v1/(?:logs|traces))"',
        rf'endpoint = "http://127.0.0.1:{port}/\1"',
        config,
    )
    path.write_text(config, encoding="utf-8")


def run_tui(command: list[str], env: dict[str, str], terminal_path: Path) -> dict[str, object]:
    pid, descriptor = pty.fork()
    if pid == 0:
        os.execvpe(command[0], command, env)

    deadline = time.monotonic() + 300
    output = bytearray()
    approval_seen = False
    approval_sent = False
    sentinel_seen = False
    exited = False
    started = time.monotonic()
    with terminal_path.open("wb") as terminal:
        try:
            while time.monotonic() < deadline:
                readable, _, _ = select.select([descriptor], [], [], 1)
                if readable:
                    try:
                        chunk = os.read(descriptor, 65536)
                    except OSError:
                        chunk = b""
                    if not chunk:
                        exited = True
                        break
                    output.extend(chunk)
                    terminal.write(chunk)
                    terminal.flush()
                    visible = output.decode("utf-8", errors="replace")
                    if not approval_sent and (
                        "Would you like to run" in visible
                        or "Press enter to confirm" in visible
                        or "Yes, proceed" in visible
                    ):
                        approval_seen = True
                        os.write(descriptor, b"1\n")
                        approval_sent = True
                    if "INTERACTIVE_APPROVAL_DONE" in visible:
                        sentinel_seen = True
                        time.sleep(1)
                        os.write(descriptor, b"\x03")
                        time.sleep(0.5)
                        os.write(descriptor, b"\x03")
                # The alternate-screen renderer may split prompt text with ANSI
                # control sequences. After a bounded wait, select only the first
                # approval option for this one synthetic `touch` command.
                if not approval_sent and time.monotonic() - started > 25:
                    os.write(descriptor, b"1\n")
                    approval_sent = True
                waited, status = os.waitpid(pid, os.WNOHANG)
                if waited == pid:
                    exited = True
                    return_code = os.waitstatus_to_exitcode(status)
                    break
            else:
                os.kill(pid, signal.SIGTERM)
        except BaseException:
            os.kill(pid, signal.SIGTERM)
            raise

    if not exited:
        waited, status = os.waitpid(pid, 0)
        return_code = os.waitstatus_to_exitcode(status) if waited == pid else -1
    elif "return_code" not in locals():
        waited, status = os.waitpid(pid, 0)
        return_code = os.waitstatus_to_exitcode(status) if waited == pid else -1
    return {
        "pty": True,
        "approval_prompt_seen": approval_seen,
        "approval_response_sent": approval_sent,
        "completion_sentinel_seen": sentinel_seen,
        "process_exit_code": return_code,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("probe_root", type=Path)
    args = parser.parse_args()
    codex_home = args.probe_root / "codex-home"
    work_dir = args.probe_root / "work"
    raw_dir = args.probe_root / "raw"
    if not all(path.is_dir() for path in (codex_home, work_dir, raw_dir)):
        raise SystemExit("probe_root must be an intact run_probe.py output")

    server = ProbeOtlpServer(raw_dir)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    point_config_at(codex_home, server.server_port)

    env = dict(os.environ)
    env.update(
        {
            "CODEX_HOME": str(codex_home),
            "LOUPE_PROBE_RAW_DIR": str(raw_dir),
            "TERM": "xterm-256color",
        }
    )
    thread_id = latest_root_thread(codex_home)
    command = [
        "npx",
        "-y",
        TARGET_PACKAGE,
        "fork",
        "--no-alt-screen",
        "--dangerously-bypass-hook-trust",
        "--ask-for-approval",
        "untrusted",
        "--sandbox",
        "workspace-write",
        "-C",
        str(work_dir),
        thread_id,
        (
            "Synthetic interactive observability probe. Use the shell command "
            "`touch approval-interactive.txt`, wait for human approval, then report "
            "INTERACTIVE_APPROVAL_DONE. Do not inspect anything outside this isolated "
            "temporary workspace."
        ),
    ]
    terminal_path = raw_dir / "interactive-terminal.raw.txt"
    result = run_tui(command, env, terminal_path)
    result.update(
        {
            "producer": "codex-cli 0.144.5",
            "surface": "codex fork TUI",
            "synthetic_workspace_only": True,
            "raw_terminal_location": "temporary probe directory; excluded from fixtures",
        }
    )
    (raw_dir / "interactive-probe-summary.raw.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )

    time.sleep(2)
    server.shutdown()
    server.server_close()
    server_thread.join(timeout=5)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["completion_sentinel_seen"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
