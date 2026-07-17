#!/usr/bin/env python3
"""PROTOTYPE: run a real, isolated Codex 0.144.5 multi-Turn capture probe.

Question: does the target producer emit documented lifecycle identities and
OTel JSON with enough structure to support the ticket-04 adapter contract?
Raw captures remain under /tmp and must be sanitized before repository use.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from otlp_receiver import ProbeOtlpServer


TARGET_PACKAGE = "@openai/codex@0.144.5"
TARGET_VERSION = "codex-cli 0.144.5"
EVENTS = (
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PermissionRequest",
    "PostToolUse",
    "PreCompact",
    "PostCompact",
    "SubagentStart",
    "SubagentStop",
    "Stop",
)


def run(command: list[str], *, env: dict[str, str], timeout: int = 360) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=False,
        capture_output=True,
        env=env,
        text=True,
        timeout=timeout,
    )


def write_probe_config(codex_home: Path, port: int) -> None:
    endpoint = f"http://127.0.0.1:{port}"
    config = f'''approval_policy = "never"
sandbox_mode = "workspace-write"
model_reasoning_effort = "low"
model_auto_compact_token_limit = 20000

[agents]
max_depth = 2

[mcp_servers.probe]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-everything"]
startup_timeout_sec = 60

[features]
hooks = true

[otel]
environment = "loupe-probe"
log_user_prompt = false
exporter = {{ otlp-http = {{ endpoint = "{endpoint}/v1/logs", protocol = "json" }} }}
trace_exporter = {{ otlp-http = {{ endpoint = "{endpoint}/v1/traces", protocol = "json" }} }}
metrics_exporter = "none"
'''
    (codex_home / "config.toml").write_text(config, encoding="utf-8")


def write_probe_skill(codex_home: Path) -> None:
    skill_dir = codex_home / "skills" / "probe-skill"
    skill_dir.mkdir(parents=True)
    (skill_dir / "SKILL.md").write_text(
        '''---
name: probe-skill
description: Use for harmless SAFE_PROBE observability marker checks.
---

# Probe skill

When invoked, report `SAFE_SKILL_MARKER` and do not read any credential or
file outside the current synthetic probe workspace.
''',
        encoding="utf-8",
    )


def write_hook_config(codex_home: Path, recorder: Path) -> None:
    command = f'{sys.executable} "{recorder}"'
    hook = {"hooks": [{"type": "command", "command": command, "timeout": 10}]}
    config = {"hooks": {event: [hook] for event in EVENTS}}
    (codex_home / "hooks.json").write_text(
        json.dumps(config, indent=2) + "\n", encoding="utf-8"
    )


def parse_thread_id(stdout: str) -> str:
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "thread.started":
            return str(event["thread_id"])
    raise RuntimeError("Codex output did not include thread.started")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run the isolated Codex 0.144.5 multi-Turn capture probe. "
            "Raw evidence remains in a temporary directory until sanitized."
        )
    )
    parser.parse_args()

    script_dir = Path(__file__).resolve().parent
    probe_root = Path(tempfile.mkdtemp(prefix="loupe-codex-0144-5-"))
    codex_home = probe_root / "codex-home"
    work_dir = probe_root / "work"
    raw_dir = probe_root / "raw"
    for directory in (codex_home, work_dir, raw_dir):
        directory.mkdir()

    auth_source = Path.home() / ".codex" / "auth.json"
    if not auth_source.exists():
        raise SystemExit("No existing Codex login. Run `codex login` outside the probe first.")
    (codex_home / "auth.json").symlink_to(auth_source)

    version = run(
        ["npx", "-y", TARGET_PACKAGE, "--version"], env=dict(os.environ), timeout=60
    )
    if version.returncode != 0 or version.stdout.strip() != TARGET_VERSION:
        raise SystemExit(f"Target version check failed: {version.stdout.strip()!r}")

    server = ProbeOtlpServer(raw_dir)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    write_probe_config(codex_home, server.server_port)
    write_hook_config(codex_home, script_dir / "capture_hook.py")
    write_probe_skill(codex_home)

    env = dict(os.environ)
    env.update({"CODEX_HOME": str(codex_home), "LOUPE_PROBE_RAW_DIR": str(raw_dir)})
    base = [
        "npx",
        "-y",
        TARGET_PACKAGE,
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--dangerously-bypass-hook-trust",
        "-C",
        str(work_dir),
    ]
    first_prompt = (
        "Synthetic observability probe, turn one. Use the shell tool to create "
        "probe-success.txt containing SAFE_PROBE, then run the shell command false "
        "so one tool attempt fails. Do not inspect files outside this temporary "
        "working directory. Finish with PROBE_TURN_ONE_DONE."
    )
    first = run([*base, first_prompt], env=env)
    (raw_dir / "turn-one-cli.jsonl").write_text(first.stdout, encoding="utf-8")
    (raw_dir / "turn-one-stderr.txt").write_text(first.stderr, encoding="utf-8")
    if first.returncode != 0:
        raise SystemExit(f"First Codex turn failed; raw evidence: {probe_root}")

    thread_id = parse_thread_id(first.stdout)
    second_prompt = (
        "Synthetic observability probe, turn two. Use the shell tool to read only "
        "probe-success.txt, report its safe marker, and finish with "
        "PROBE_TURN_TWO_DONE."
    )
    second = run([*base, "resume", thread_id, second_prompt], env=env)
    (raw_dir / "turn-two-cli.jsonl").write_text(second.stdout, encoding="utf-8")
    (raw_dir / "turn-two-stderr.txt").write_text(second.stderr, encoding="utf-8")
    if second.returncode != 0:
        raise SystemExit(f"Second Codex turn failed; raw evidence: {probe_root}")

    later_prompts = [
        (
            "turn-three",
            "Synthetic observability probe, turn three. Explicitly use $probe-skill, "
            "then call the probe MCP server's echo tool with SAFE_MCP_MARKER. "
            "Finish with PROBE_TURN_THREE_DONE.",
            [],
        ),
        (
            "turn-four",
            "Synthetic observability probe, turn four. Use any applicable skill "
            "without an explicit dollar-prefixed skill mention and report the safe "
            "marker it requires. Finish with PROBE_TURN_FOUR_DONE.",
            [],
        ),
        (
            "turn-five",
            "Synthetic observability probe, turn five. Use the collaboration tools "
            "to spawn one child agent. Tell that child to spawn one grandchild agent; "
            "each should only return a SAFE_CHILD marker and must not inspect files. "
            "Wait for the child result, then finish with PROBE_TURN_FIVE_DONE.",
            [],
        ),
        (
            "turn-six",
            "Synthetic observability probe, turn six. Request permission to run the "
            "shell command `touch approval-probe.txt`; if non-interactive execution "
            "cannot grant permission, report that fact. Finish with "
            "PROBE_TURN_SIX_DONE.",
            ["-c", 'approval_policy="untrusted"'],
        ),
    ]
    for label, prompt, overrides in later_prompts:
        result = run([*base, *overrides, "resume", thread_id, prompt], env=env)
        (raw_dir / f"{label}-cli.jsonl").write_text(result.stdout, encoding="utf-8")
        (raw_dir / f"{label}-stderr.txt").write_text(result.stderr, encoding="utf-8")
        if result.returncode != 0:
            (raw_dir / f"{label}-failed").touch()

    time.sleep(2)
    server.shutdown()
    server.server_close()
    server_thread.join(timeout=5)

    evidence = {
        "producer": TARGET_VERSION,
        "probe_root": str(probe_root),
        "thread_id": thread_id,
        "hook_records": sum(1 for _ in (raw_dir / "hooks.raw.jsonl").open()),
        "otel_log_batches": sum(1 for _ in (raw_dir / "otel-logs.raw.jsonl").open()),
        "otel_trace_batches": sum(1 for _ in (raw_dir / "otel-traces.raw.jsonl").open()),
        "credential_handling": "temporary symlink; no credential bytes copied",
    }
    print(json.dumps(evidence, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
