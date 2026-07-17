"""Contract assertions for the real Codex 0.144.5 macOS probe.

The validation seam is the sanitized, producer-versioned output of an actual
Codex process. These tests intentionally do not implement the production agent
adapter owned by ticket 04.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FIXTURE_DIR = (
    ROOT
    / "packages"
    / "agent-adapter"
    / "test"
    / "fixtures"
    / "codex"
    / "0.144.5"
)


def load_json(name: str) -> dict:
    with (FIXTURE_DIR / name).open(encoding="utf-8") as fixture:
        return json.load(fixture)


def otel_attributes(item: dict) -> dict:
    values = {}
    for attribute in item.get("attributes", []):
        value = attribute["value"]
        values[attribute["key"]] = next(iter(value.values()), None)
    return values


def trace_turn_ancestor(span: dict, spans_by_id: dict[str, dict]) -> dict:
    seen = set()
    parent_id = span.get("parentSpanId")
    while parent_id:
        if parent_id in seen:
            raise AssertionError(f"cycle in sanitized trace ancestry at {parent_id}")
        seen.add(parent_id)
        parent = spans_by_id.get(parent_id)
        if parent is None:
            raise AssertionError(f"unresolved sanitized parent span {parent_id}")
        if parent.get("name") == "session_task.turn":
            return parent
        parent_id = parent.get("parentSpanId")
    raise AssertionError("sanitized response ancestry did not reach a Turn span")


class Codex01445CaptureContractTest(unittest.TestCase):
    def test_probe_help_is_side_effect_free(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            home = temporary / "home"
            home.mkdir()
            result = subprocess.run(
                [sys.executable, str(ROOT / "probes/codex-0.144.5/run_probe.py"), "--help"],
                capture_output=True,
                text=True,
                timeout=10,
                env={**os.environ, "HOME": str(home), "TMPDIR": str(temporary)},
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("usage:", result.stdout.lower())
            self.assertEqual(
                list(temporary.glob("loupe-codex-0144-5-*")),
                [],
                "--help must exit before creating the probe tree or starting Codex",
            )

    def test_documented_hook_identity_survives_two_turns(self) -> None:
        fixture = load_json("hooks.sanitized.json")

        events = fixture["events"]
        prompts = [
            event["payload"]
            for event in events
            if event["payload"]["hook_event_name"] == "UserPromptSubmit"
        ]
        first_session_ids = {prompt["session_id"] for prompt in prompts[:2]}
        prompt_turn_ids = {prompt["turn_id"] for prompt in prompts[:2]}

        self.assertEqual(fixture["producer"]["name"], "codex-cli")
        self.assertEqual(fixture["producer"]["version"], "0.144.5")
        self.assertEqual(first_session_ids, {"session-probe-001"})
        self.assertTrue(
            {"turn-probe-001", "turn-probe-002"}.issubset(prompt_turn_ids)
        )

    def test_fixture_set_is_versioned_sanitized_and_key_preserving(self) -> None:
        names = (
            "hooks.sanitized.json",
            "otel-logs.sanitized.json",
            "otel-traces.sanitized.json",
            "rollout-key-only.sanitized.json",
            "interactive-probe.sanitized.json",
            "probe-manifest.json",
        )
        for name in names:
            fixture = load_json(name)
            self.assertEqual(fixture["producer"], {"name": "codex-cli", "version": "0.144.5"})
            text = json.dumps(fixture)
            self.assertNotIn("/Users/", text)
            self.assertNotIn("SAFE_PROBE", text)
            self.assertNotRegex(
                text,
                re.compile(
                    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"
                ),
            )

        logs = load_json("otel-logs.sanitized.json")
        self.assertIn("observedTimeUnixNano", logs["records"][0]["log_record"])

    def test_observed_tool_ids_reconcile_without_becoming_a_documented_rule(self) -> None:
        hooks = load_json("hooks.sanitized.json")
        logs = load_json("otel-logs.sanitized.json")
        hook_ids = {
            event["payload"]["tool_use_id"]
            for event in hooks["events"]
            if event["payload"]["hook_event_name"] == "PostToolUse"
        }
        otel_ids = {
            attributes["call_id"]
            for record in logs["records"]
            if (attributes := otel_attributes(record["log_record"])).get("call_id")
        }
        manifest = load_json("probe-manifest.json")

        self.assertEqual(len(hook_ids), 10)
        self.assertTrue(hook_ids.issubset(otel_ids))
        self.assertEqual(
            manifest["capabilities"]["tool_id_reconciliation"]["classification"],
            ["observed", "unstable"],
        )

    def test_nested_parentage_is_exact_only_on_version_gated_sources(self) -> None:
        rollout = load_json("rollout-key-only.sanitized.json")
        metadata = [
            record["retained_values"]
            for record in rollout["records"]
            if record["record_type"] == "session_meta"
        ]
        unique = {record["id"]: record for record in metadata}
        root = next(record for record in unique.values() if "parent_thread_id" not in record)
        child = next(record for record in unique.values() if record.get("parent_thread_id") == root["id"])
        grandchild = next(
            record for record in unique.values() if record.get("parent_thread_id") == child["id"]
        )
        manifest = load_json("probe-manifest.json")

        self.assertEqual(grandchild["session_id"], root["session_id"])
        self.assertEqual(
            manifest["capabilities"]["nested_parentage"],
            {
                "classification": ["observed", "unstable"],
                "derivation": "exact_agent_communication_and_rollout; hooks_only_inferred",
            },
        )

    def test_negative_results_downgrade_instead_of_guessing(self) -> None:
        capabilities = load_json("probe-manifest.json")["capabilities"]
        self.assertEqual(capabilities["implicit_skill_activation"]["classification"], ["unavailable"])
        self.assertEqual(
            capabilities["websocket_event_log"]["classification"],
            ["documented", "unavailable"],
        )

    def test_interactive_fork_and_approval_are_preserved_without_overclaiming(self) -> None:
        hooks = load_json("hooks.sanitized.json")
        permission_requests = [
            event["payload"]
            for event in hooks["events"]
            if event["payload"]["hook_event_name"] == "PermissionRequest"
        ]
        self.assertEqual(len(permission_requests), 1)
        self.assertEqual(permission_requests[0]["tool_name"], "Bash")
        self.assertEqual(permission_requests[0]["permission_mode"], "default")

        rollout = load_json("rollout-key-only.sanitized.json")
        user_forks = [
            record["retained_values"]
            for record in rollout["records"]
            if record["record_type"] == "session_meta"
            and (values := record["retained_values"]).get("thread_source") == "user"
            and values.get("forked_from_id")
            and not values.get("parent_thread_id")
        ]
        self.assertEqual(len(user_forks), 1)
        self.assertEqual(user_forks[0]["source"], "cli")

        interactive = load_json("interactive-probe.sanitized.json")
        self.assertEqual(interactive["surface"], "codex fork TUI")
        self.assertEqual(interactive["pty"], True)
        self.assertEqual(interactive["approval_response_sent"], True)
        capabilities = load_json("probe-manifest.json")["capabilities"]
        self.assertEqual(
            capabilities["permission_request"],
            {"classification": ["documented", "observed"], "derivation": "exact_when_emitted"},
        )
        self.assertEqual(
            capabilities["fork"],
            {
                "classification": ["observed", "unstable"],
                "derivation": "exact_user_fork_lineage_in_rollout; hook_session_start_source_startup",
            },
        )

    def test_trace_fixture_retains_exact_source_defined_turn_association(self) -> None:
        traces = load_json("otel-traces.sanitized.json")
        spans = [record["span"] for record in traces["records"]]
        spans_by_id = {span["spanId"]: span for span in spans}
        turn_spans = [span for span in spans if span["name"] == "session_task.turn"]
        self.assertEqual(len(turn_spans), 9)
        for span in turn_spans:
            attributes = otel_attributes(span)
            self.assertIn("thread.id", attributes)
            self.assertIn("turn.id", attributes)

        response_spans = [
            span
            for span in spans
            if span["name"] == "handle_responses"
            and "gen_ai.usage.input_tokens" in otel_attributes(span)
        ]
        self.assertGreater(len(response_spans), 0)
        associated_turns = set()
        for response in response_spans:
            turn = trace_turn_ancestor(response, spans_by_id)
            associated_turns.add(
                (
                    otel_attributes(turn)["thread.id"],
                    otel_attributes(turn)["turn.id"],
                )
            )

        rollout = load_json("rollout-key-only.sanitized.json")
        thread_parents = {
            values["id"]: values.get("parent_thread_id")
            for record in rollout["records"]
            if record["record_type"] == "session_meta"
            and (values := record["retained_values"]).get("id")
        }
        root = next(thread for thread, parent in thread_parents.items() if parent is None)
        child = next(thread for thread, parent in thread_parents.items() if parent == root)
        grandchild = next(thread for thread, parent in thread_parents.items() if parent == child)
        associated_threads = {thread for thread, _turn in associated_turns}
        self.assertTrue({root, child, grandchild}.issubset(associated_threads))

    def test_unknown_additive_fields_keep_shape_without_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw"
            fixtures = root / "fixtures"
            sessions = root / "codex-home" / "sessions"
            raw.mkdir()
            sessions.mkdir(parents=True)
            hook = {
                "captured_at": "2026-07-17T00:00:00Z",
                "payload": {
                    "hook_event_name": "SessionStart",
                    "session_id": "raw-session",
                    "source": "startup",
                    "future_prompt": "ADVERSARIAL_HOOK_SECRET",
                    "future": {
                        "payload": "ADVERSARIAL_NESTED_SECRET",
                        "enabled": True,
                        "count": 7,
                        "items": ["ADVERSARIAL_LIST_SECRET", {"ratio": 1.5}],
                    },
                },
            }
            (raw / "hooks.raw.jsonl").write_text(json.dumps(hook) + "\n")
            log_payload = {
                "captured_at": "2026-07-17T00:00:00Z",
                "payload": {
                    "resourceLogs": [{
                        "resource": {"attributes": []},
                        "scopeLogs": [{
                            "scope": {"name": "codex_otel"},
                            "logRecords": [{
                                "timeUnixNano": "1",
                                "future_prompt": "ADVERSARIAL_OTEL_SECRET",
                                "attributes": [
                                    {"key": "event.name", "value": {"stringValue": "codex.api_request"}},
                                    {"key": "future.payload", "value": {"stringValue": "ADVERSARIAL_ATTRIBUTE_SECRET"}},
                                    {"key": "attempt", "value": {"intValue": "2"}},
                                ],
                            }],
                        }],
                    }],
                },
            }
            (raw / "otel-logs.raw.jsonl").write_text(json.dumps(log_payload) + "\n")
            (raw / "otel-traces.raw.jsonl").write_text(
                json.dumps({"captured_at": "2026-07-17T00:00:00Z", "payload": {"resourceSpans": []}}) + "\n"
            )
            subprocess.run(
                [sys.executable, str(ROOT / "probes/codex-0.144.5/sanitize_probe.py"), str(raw), str(fixtures)],
                check=True,
                capture_output=True,
                text=True,
            )

            hooks = json.loads((fixtures / "hooks.sanitized.json").read_text())
            payload = hooks["events"][0]["payload"]
            self.assertIn("future_prompt", payload)
            self.assertEqual(payload["future"]["enabled"], True)
            self.assertEqual(payload["future"]["count"], 7)
            self.assertEqual(payload["future"]["items"][1]["ratio"], 1.5)
            logs = json.loads((fixtures / "otel-logs.sanitized.json").read_text())
            record = logs["records"][0]["log_record"]
            self.assertIn("future_prompt", record)
            self.assertIn("future.payload", otel_attributes(record))
            self.assertEqual(otel_attributes(record)["attempt"], "2")
            serialized = json.dumps([hooks, logs])
            self.assertNotIn("ADVERSARIAL_", serialized)

    def test_manifest_retains_raw_batch_provenance_and_failed_command_evidence(self) -> None:
        manifest = load_json("probe-manifest.json")
        self.assertEqual(
            manifest["probe"]["raw_capture_counts"],
            {"hook_records": 49, "otel_log_batches": 73, "otel_trace_batches": 32},
        )
        failed = manifest["observations"]["failed_command_scenario"]
        self.assertEqual(failed["requested_exit_code"], 1)
        self.assertEqual(failed["cli_exit_code_observed"], 1)
        self.assertEqual(failed["hook_structured_exit_code"], None)
        self.assertEqual(failed["otel_tool_result_success"], "true")
        self.assertEqual(failed["decision"], "stable_passive_failure_outcome_unavailable")


if __name__ == "__main__":
    unittest.main()
