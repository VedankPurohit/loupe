#!/usr/bin/env python3
"""Sanitize a real Codex 0.144.5 capture into producer-versioned fixtures."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


PRODUCER = {"name": "codex-cli", "version": "0.144.5"}
LOG_EVENTS = {
    "codex.agent_communication",
    "codex.api_request",
    "codex.conversation_starts",
    "codex.sse_event",
    "codex.tool_decision",
    "codex.tool_result",
    "codex.user_prompt",
    "codex.websocket_connect",
    "codex.websocket_request",
}
TRACE_SPANS = {
    "build_skill_injections",
    "collect_explicit_skill_mentions",
    "codex.exec",
    "handle_responses",
    "mcp.tools.call",
    "run_sampling_request",
    "session_task.turn",
}
TOOL_SPANS = {
    "collaborationspawn_agent",
    "collaborationwait_agent",
    "exec",
    "exec_command",
    "mcp__probeecho",
}
HOOK_SAFE_STRING_FIELDS = {
    "agent_type",
    "hook_event_name",
    "model",
    "permission_mode",
    "source",
    "stop_hook_active",
    "tool_name",
    "trigger",
}
OTEL_SAFE_STRING_FIELDS = {
    "endTimeUnixNano",
    "name",
    "observedTimeUnixNano",
    "retention_reason",
    "schemaUrl",
    "startTimeUnixNano",
    "timeUnixNano",
    "version",
}
OTEL_SAFE_ATTRIBUTE_STRINGS = {
    "app.version",
    "approval_policy",
    "auth.header_name",
    "auth.mode",
    "auth_mode",
    "codex.request.reasoning_effort",
    "codex.turn.reasoning_effort",
    "decision",
    "event.kind",
    "event.name",
    "event.timestamp",
    "kind",
    "mcp.connector.name",
    "mcp.server.name",
    "mcp.server.origin",
    "mcp.transport",
    "mcp_server",
    "mcp_server_origin",
    "model",
    "model_reasoning_effort",
    "originator",
    "provider_name",
    "reasoning_effort",
    "reasoning_summary",
    "rpc.method",
    "rpc.system",
    "sandbox_policy",
    "source",
    "state",
    "success",
    "target",
    "terminal.type",
    "thread.name",
    "tool.name",
    "tool_name",
}
STRING_TOKEN = "<unknown-string-redacted>"


class IdMap:
    def __init__(self) -> None:
        self.values: dict[tuple[str, str], str] = {}

    def replace(self, category: str, value: Any) -> Any:
        if not isinstance(value, str) or not value:
            return value
        key = (category, value)
        if key not in self.values:
            number = sum(1 for candidate in self.values if candidate[0] == category) + 1
            self.values[key] = f"{category}-probe-{number:03d}"
        return self.values[key]


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def sanitize_content(value: Any, placeholder: str) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_content(item, placeholder) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_content(item, placeholder) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return placeholder


def sanitize_unknown(value: Any, placeholder: str = STRING_TOKEN) -> Any:
    """Preserve additive keys and JSON shape while default-denying string content."""
    if isinstance(value, dict):
        return {key: sanitize_unknown(item, placeholder) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_unknown(item, placeholder) for item in value]
    if isinstance(value, str):
        return placeholder
    return value


def sanitize_otel_value(value: Any) -> Any:
    """Sanitize OTLP AnyValue strings while retaining typed scalar evidence."""
    if isinstance(value, dict):
        return {
            key: item
            if key in {"intValue", "boolValue", "doubleValue", "bytesValue"}
            else STRING_TOKEN
            if key == "stringValue"
            else sanitize_otel_value(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [sanitize_otel_value(item) for item in value]
    if isinstance(value, str):
        return STRING_TOKEN
    return value


def sanitize_hook_payload(payload: dict[str, Any], ids: IdMap) -> dict[str, Any]:
    result = {
        key: value if key in HOOK_SAFE_STRING_FIELDS else sanitize_unknown(value)
        for key, value in payload.items()
    }
    if "session_id" in result:
        result["session_id"] = ids.replace("session", payload["session_id"])
    if "turn_id" in result:
        result["turn_id"] = ids.replace("turn", payload["turn_id"])
    if "agent_id" in result:
        result["agent_id"] = ids.replace("agent-run", payload["agent_id"])
    if "tool_use_id" in result:
        result["tool_use_id"] = ids.replace("tool-use", payload["tool_use_id"])
    if "cwd" in result:
        result["cwd"] = "<probe-workdir>"
    if "transcript_path" in result and result["transcript_path"] is not None:
        result["transcript_path"] = "<unstable-transcript-path>"
    if "agent_transcript_path" in result and result["agent_transcript_path"] is not None:
        result["agent_transcript_path"] = "<unstable-agent-transcript-path>"
    for field in ("prompt", "last_assistant_message"):
        if field in result and result[field] is not None:
            result[field] = "<synthetic-content-redacted>"
    for field in ("tool_input", "tool_response"):
        if field in result:
            result[field] = sanitize_content(result[field], "<synthetic-tool-content-redacted>")
    return result


def write_hooks(raw_dir: Path, fixture_dir: Path, ids: IdMap) -> None:
    records = read_jsonl(raw_dir / "hooks.raw.jsonl")
    fixture = {
        "fixture_schema_version": 1,
        "producer": PRODUCER,
        "source": "codex_hook",
        "sanitization": {
            "content": "replaced",
            "paths": "replaced",
            "identifiers": "deterministically pseudonymized",
            "unknown_fields": "preserved",
        },
        "events": [
            {
                "captured_at": record["captured_at"],
                "payload": sanitize_hook_payload(record["payload"], ids),
            }
            for record in records
        ],
    }
    fixture_dir.mkdir(parents=True, exist_ok=True)
    (fixture_dir / "hooks.sanitized.json").write_text(
        json.dumps(fixture, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def attribute_value(attribute: dict[str, Any]) -> Any:
    value = attribute.get("value", {})
    for key in ("stringValue", "intValue", "boolValue", "doubleValue"):
        if key in value:
            return value[key]
    return None


def attributes_by_key(item: dict[str, Any]) -> dict[str, Any]:
    return {attribute["key"]: attribute_value(attribute) for attribute in item.get("attributes", [])}


def sanitize_any_value(value: dict[str, Any], replacement: Any) -> dict[str, Any]:
    if "stringValue" in value:
        return {**value, "stringValue": str(replacement)}
    return value


def redact_any_value(value: Any, placeholder: str) -> Any:
    if isinstance(value, list):
        return [redact_any_value(item, placeholder) for item in value]
    if not isinstance(value, dict):
        return value
    return {
        key: placeholder if key == "stringValue" else redact_any_value(item, placeholder)
        for key, item in value.items()
    }


def sanitize_attribute(attribute: dict[str, Any], ids: IdMap) -> dict[str, Any]:
    result = sanitize_unknown(attribute)
    result["key"] = attribute.get("key")
    key = str(result.get("key", ""))
    value = dict(attribute.get("value", {}))
    raw = value.get("stringValue")
    if key in {"arguments", "output", "prompt", "content", "cwd", "process.command_args"}:
        result["value"] = redact_any_value(value, "<synthetic-content-redacted>")
        return result
    if key in {"code.file.path", "transcript_path", "agent_transcript_path", "process.executable.path"}:
        result["value"] = redact_any_value(value, "<path-redacted>")
        return result
    if raw is None:
        result["value"] = sanitize_otel_value(value)
        return result

    if key in {"conversation.id", "thread.id", "thread_id", "sender_thread_id", "receiver_thread_id"}:
        result["value"] = sanitize_any_value(value, ids.replace("agent-run", raw))
    elif key == "session.id":
        result["value"] = sanitize_any_value(value, ids.replace("session", raw))
    elif key in {"turn.id", "turn_id"}:
        result["value"] = sanitize_any_value(value, ids.replace("turn", raw))
    elif key in {"call_id", "tool.call_id"}:
        result["value"] = sanitize_any_value(value, ids.replace("tool-use", raw))
    elif key in {"communication_id", "submission.id", "rpc.request_id", "app_server.connection_id"}:
        result["value"] = sanitize_any_value(value, ids.replace("producer-id", raw))
    elif key in {"host.name", "user.email", "user.account_id"} or key.startswith("auth."):
        result["value"] = sanitize_any_value(value, "<account-attribute-redacted>")
    elif raw.startswith("/") or "/Users/" in raw or re.search(r"[^\s@]+@[^\s@]+", raw):
        result["value"] = sanitize_any_value(value, "<string-redacted>")
    elif key in OTEL_SAFE_ATTRIBUTE_STRINGS:
        result["value"] = value
    else:
        result["value"] = sanitize_any_value(value, STRING_TOKEN)
    return result


def sanitize_otel_item(item: Any, ids: IdMap, field: str | None = None) -> Any:
    if isinstance(item, list):
        return [sanitize_otel_item(value, ids, field) for value in item]
    if not isinstance(item, dict):
        if isinstance(item, str):
            if field in OTEL_SAFE_STRING_FIELDS or (field and field.endswith("UnixNano")):
                return item
            return STRING_TOKEN
        return item
    if "key" in item and "value" in item:
        return sanitize_attribute(item, ids)

    result: dict[str, Any] = {}
    for key, value in item.items():
        if key == "traceId" and isinstance(value, str):
            result[key] = ids.replace("trace", value)
        elif key in {"spanId", "parentSpanId"} and isinstance(value, str):
            result[key] = ids.replace("span", value)
        else:
            result[key] = sanitize_otel_item(value, ids, key)
    return result


def iter_log_records(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for record in records:
        for resource_log in record["payload"].get("resourceLogs", []):
            resource = resource_log.get("resource", {})
            for scope_log in resource_log.get("scopeLogs", []):
                scope = scope_log.get("scope", {})
                for log_record in scope_log.get("logRecords", []):
                    event_name = attributes_by_key(log_record).get("event.name")
                    if event_name in LOG_EVENTS:
                        selected.append(
                            {"resource": resource, "scope": scope, "log_record": log_record}
                        )
    return selected


def iter_trace_spans(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    available: list[dict[str, Any]] = []
    for record in records:
        for resource_span in record["payload"].get("resourceSpans", []):
            resource = resource_span.get("resource", {})
            for scope_span in resource_span.get("scopeSpans", []):
                scope = scope_span.get("scope", {})
                for span in scope_span.get("spans", []):
                    available.append({"resource": resource, "scope": scope, "span": span})

    by_identity = {
        (record["span"].get("traceId"), record["span"].get("spanId")): record
        for record in available
    }
    selected: dict[tuple[Any, Any], dict[str, Any]] = {}
    for record in available:
        span = record["span"]
        name = span.get("name")
        attributes = attributes_by_key(span)
        keep = name in TRACE_SPANS or name in TOOL_SPANS
        if name == "handle_responses" and not any(
            key.startswith("gen_ai.usage.") for key in attributes
        ):
            keep = False
        if name == "run_sampling_request" and "turn_id" not in attributes:
            keep = False
        if not keep:
            continue

        current = record
        reason = "selected"
        seen: set[tuple[Any, Any]] = set()
        while current:
            current_span = current["span"]
            identity = (current_span.get("traceId"), current_span.get("spanId"))
            if identity in seen:
                break
            seen.add(identity)
            selected.setdefault(identity, {**current, "retention_reason": reason})
            parent_id = current_span.get("parentSpanId")
            current = by_identity.get((current_span.get("traceId"), parent_id))
            reason = "ancestor"
    return list(selected.values())


def normalize_resources(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    resources: list[dict[str, Any]] = []
    resource_slots: dict[str, int] = {}
    normalized: list[dict[str, Any]] = []
    for record in records:
        encoded = json.dumps(record["resource"], sort_keys=True)
        if encoded not in resource_slots:
            resource_slots[encoded] = len(resources) + 1
            resources.append(record["resource"])
        normalized.append(
            {
                "resource_slot": resource_slots[encoded],
                **{key: value for key, value in record.items() if key != "resource"},
            }
        )
    return resources, normalized


def write_otel(raw_dir: Path, fixture_dir: Path, ids: IdMap) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    log_records = iter_log_records(read_jsonl(raw_dir / "otel-logs.raw.jsonl"))
    trace_spans = iter_trace_spans(read_jsonl(raw_dir / "otel-traces.raw.jsonl"))
    log_resources, normalized_logs = normalize_resources(log_records)
    trace_resources, normalized_traces = normalize_resources(trace_spans)
    common = {
        "fixture_schema_version": 1,
        "producer": PRODUCER,
        "sanitization": {
            "content_paths_accounts": "replaced",
            "identifiers": "deterministically pseudonymized",
            "unknown_fields": "preserved within selected records",
        },
    }
    (fixture_dir / "otel-logs.sanitized.json").write_text(
        json.dumps(
            {
                **common,
                "source": "codex_otel_log",
                "resources": sanitize_otel_item(log_resources, ids),
                "records": sanitize_otel_item(normalized_logs, ids),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    (fixture_dir / "otel-traces.sanitized.json").write_text(
        json.dumps(
            {
                **common,
                "source": "codex_otel_trace",
                "resources": sanitize_otel_item(trace_resources, ids),
                "records": sanitize_otel_item(normalized_traces, ids),
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    return log_records, trace_spans


def rollout_files(raw_dir: Path) -> list[Path]:
    sessions = raw_dir.parent / "codex-home" / "sessions"
    return sorted(sessions.rglob("*.jsonl"))


def sanitize_rollout_identity(field: str, value: Any, ids: IdMap) -> Any:
    if isinstance(value, dict):
        return {key: sanitize_rollout_identity(key, item, ids) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_rollout_identity(field, item, ids) for item in value]
    if field == "session_id":
        return ids.replace("session", value)
    if field in {"id", "parent_thread_id", "forked_from_id", "agent_thread_id"}:
        return ids.replace("agent-run", value)
    if field == "turn_id":
        return ids.replace("turn", value)
    if field in {"window_id", "first_window_id", "previous_window_id"}:
        return ids.replace("compaction-window", value)
    if field in {"cwd", "agent_path"} and value is not None:
        return "<path-redacted>"
    return value


def write_rollout(raw_dir: Path, fixture_dir: Path, ids: IdMap) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    retained = {
        "session_id",
        "id",
        "parent_thread_id",
        "forked_from_id",
        "turn_id",
        "agent_thread_id",
        "agent_path",
        "cli_version",
        "context_window",
        "originator",
        "source",
        "thread_source",
        "multi_agent_version",
        "agent_nickname",
        "agent_role",
        "model",
        "type",
        "trigger",
    }
    for file_slot, path in enumerate(rollout_files(raw_dir), 1):
        for ordinal, record in enumerate(read_jsonl(path), 1):
            payload = record.get("payload", {})
            record_type = record.get("type")
            event_type = payload.get("type") if isinstance(payload, dict) else None
            if record_type not in {"session_meta", "turn_context", "compacted", "event_msg"}:
                continue
            if record_type == "event_msg" and event_type not in {
                "task_started",
                "task_complete",
                "context_compacted",
                "sub_agent_activity",
                "turn_aborted",
            }:
                continue
            values = {
                key: sanitize_rollout_identity(key, value, ids)
                for key, value in payload.items()
                if key in retained
            }
            selected.append(
                {
                    "source_file_slot": file_slot,
                    "source_ordinal": ordinal,
                    "record_type": record_type,
                    "payload_keys": sorted(payload),
                    "retained_values": values,
                }
            )
    fixture = {
        "fixture_schema_version": 1,
        "producer": PRODUCER,
        "source": "codex_rollout",
        "stability": "unstable_version_gated_key_only",
        "records": selected,
    }
    (fixture_dir / "rollout-key-only.sanitized.json").write_text(
        json.dumps(fixture, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return selected


def event_name(record: dict[str, Any]) -> Any:
    return attributes_by_key(record["log_record"]).get("event.name")


def nested_value(value: Any, key: str) -> Any:
    if isinstance(value, dict):
        if key in value:
            return value[key]
        for item in value.values():
            found = nested_value(item, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for item in value:
            found = nested_value(item, key)
            if found is not None:
                return found
    return None


def contains_string(value: Any, expected: str) -> bool:
    if isinstance(value, dict):
        return any(contains_string(item, expected) for item in value.values())
    if isinstance(value, list):
        return any(contains_string(item, expected) for item in value)
    return value == expected


def failed_command_observation(
    raw_dir: Path,
    hooks: list[dict[str, Any]],
    log_records: list[dict[str, Any]],
) -> dict[str, Any]:
    cli_path = raw_dir / "turn-one-cli.jsonl"
    cli_records = read_jsonl(cli_path) if cli_path.exists() else []
    cli_exit_codes = [
        record.get("item", {}).get("exit_code")
        for record in cli_records
        if record.get("type") == "item.completed"
        and record.get("item", {}).get("type") == "command_execution"
    ]
    failed_hook = next(
        (
            record["payload"]
            for record in hooks
            if record["payload"].get("hook_event_name") == "PostToolUse"
            and contains_string(record["payload"].get("tool_input"), "false")
        ),
        {},
    )
    tool_id = failed_hook.get("tool_use_id")
    matching_log = next(
        (
            attributes_by_key(record["log_record"])
            for record in log_records
            if attributes_by_key(record["log_record"]).get("event.name") == "codex.tool_result"
            and attributes_by_key(record["log_record"]).get("call_id") == tool_id
        ),
        {},
    )
    return {
        "requested_exit_code": 1,
        "cli_exit_code_observed": 1 if 1 in cli_exit_codes else None,
        "hook_structured_exit_code": nested_value(failed_hook.get("tool_response"), "exit_code"),
        "otel_tool_result_success": matching_log.get("success"),
        "decision": "stable_passive_failure_outcome_unavailable",
    }


def write_interactive(raw_dir: Path, fixture_dir: Path) -> dict[str, Any]:
    summary_path = raw_dir / "interactive-probe-summary.raw.json"
    raw = (
        json.loads(summary_path.read_text(encoding="utf-8"))
        if summary_path.exists()
        else {}
    )
    fixture = {
        "fixture_schema_version": 1,
        "producer": PRODUCER,
        "source": "codex_tui_pty_probe",
        "surface": "codex fork TUI" if summary_path.exists() else "not_attempted",
        "pty": bool(raw.get("pty")),
        "approval_prompt_text_detected": bool(raw.get("approval_prompt_seen")),
        "approval_response_sent": bool(raw.get("approval_response_sent")),
        "terminal_completion_sentinel_detected": bool(raw.get("completion_sentinel_seen")),
        "process_exit_code": raw.get("process_exit_code"),
        "synthetic_workspace_only": bool(raw.get("synthetic_workspace_only")),
        "synthetic_command_effect_observed": (raw_dir.parent / "work" / "approval-interactive.txt").exists(),
        "terminal_capture": (
            "excluded_after_derived_evidence; raw temporary file deleted"
            if summary_path.exists()
            else "not_created"
        ),
        "interpretation": (
            "PermissionRequest and Stop hooks plus rollout session_meta are authoritative; "
            "ANSI terminal text detection is not used as lifecycle evidence"
        ),
    }
    (fixture_dir / "interactive-probe.sanitized.json").write_text(
        json.dumps(fixture, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return fixture


def write_manifest(
    fixture_dir: Path,
    hooks: list[dict[str, Any]],
    log_records: list[dict[str, Any]],
    trace_spans: list[dict[str, Any]],
    rollout: list[dict[str, Any]],
    raw_counts: dict[str, int],
    interactive: dict[str, Any],
    failed_command: dict[str, Any],
) -> None:
    hook_payloads = [record["payload"] for record in hooks]
    hook_ids = {
        payload["tool_use_id"]
        for payload in hook_payloads
        if payload.get("hook_event_name") == "PostToolUse"
    }
    otel_ids = {
        attributes_by_key(record["log_record"]).get("call_id")
        for record in log_records
        if attributes_by_key(record["log_record"]).get("call_id")
    }
    event_names = {event_name(record) for record in log_records}
    permission_observed = any(
        payload.get("hook_event_name") == "PermissionRequest" for payload in hook_payloads
    )
    user_fork_observed = any(
        record.get("record_type") == "session_meta"
        and record.get("retained_values", {}).get("thread_source") == "user"
        and record.get("retained_values", {}).get("forked_from_id")
        and not record.get("retained_values", {}).get("parent_thread_id")
        for record in rollout
    )
    manifest = {
        "fixture_schema_version": 1,
        "producer": PRODUCER,
        "probe": {
            "platform": "macOS",
            "surface": "codex exec, exec resume, and codex fork TUI",
            "model_observed": "gpt-5.6-sol",
            "auth": "existing ChatGPT login referenced; identity and credentials excluded",
            "root_turns": 7,
            "raw_location": "temporary directory outside repository; intentionally not retained",
            "raw_capture_counts": raw_counts,
        },
        "observations": {
            "hook_event_counts": {
                name: sum(1 for payload in hook_payloads if payload.get("hook_event_name") == name)
                for name in sorted({payload.get("hook_event_name") for payload in hook_payloads})
            },
            "session_start_sources": sorted(
                {payload["source"] for payload in hook_payloads if payload.get("hook_event_name") == "SessionStart"}
            ),
            "hook_tool_ids": len(hook_ids),
            "hook_tool_ids_found_in_otel": len(hook_ids & otel_ids),
            "otel_event_names": sorted(event_names),
            "turn_spans": sum(1 for record in trace_spans if record["span"].get("name") == "session_task.turn"),
            "rollout_records_retained": len(rollout),
            "failed_command_scenario": failed_command,
            "interactive_probe": {
                "pty": interactive["pty"],
                "approval_response_sent": interactive["approval_response_sent"],
                "synthetic_command_effect_observed": interactive["synthetic_command_effect_observed"],
                "terminal_text_detection_used_as_evidence": False,
            },
        },
        "capabilities": {
            "session_identity": {"classification": ["documented", "observed"], "derivation": "exact"},
            "turn_identity": {"classification": ["documented", "observed"], "derivation": "exact"},
            "tool_id_reconciliation": {
                "classification": ["observed", "unstable"],
                "derivation": f"exact_for_{len(hook_ids & otel_ids)}_of_{len(hook_ids)}_hook_ids",
            },
            "completion_to_turn_trace_association": {"classification": ["observed", "unstable"], "derivation": "exact_source_defined_trace_parentage"},
            "nested_parentage": {"classification": ["observed", "unstable"], "derivation": "exact_agent_communication_and_rollout; hooks_only_inferred"},
            "compaction_timing_trigger": {"classification": ["documented", "observed"], "derivation": "exact_auto_hook_events"},
            "resume": {"classification": ["documented", "observed"], "derivation": "exact"},
            "mcp_use": {"classification": ["documented", "observed"], "derivation": "exact_when_emitted"},
            "explicit_skill_mention": {"classification": ["observed", "unstable"], "derivation": "partial_source_defined_trace_and_prompt_evidence"},
            "implicit_skill_activation": {"classification": ["unavailable"], "derivation": "none"},
            "permission_request": {
                "classification": ["documented", "observed"] if permission_observed else ["unavailable"],
                "derivation": "exact_when_emitted" if permission_observed else "not_observed",
            },
            "fork": {
                "classification": ["observed", "unstable"] if user_fork_observed else ["unavailable"],
                "derivation": (
                    "exact_user_fork_lineage_in_rollout; hook_session_start_source_startup"
                    if user_fork_observed
                    else "not_observed"
                ),
            },
            "websocket_event_log": {"classification": ["documented", "unavailable"], "derivation": "not_emitted; websocket_request_observed"},
            "logical_model_request_identity": {"classification": ["unavailable"], "derivation": "transport_attempts_only"},
            "complete_passive_capability_snapshot": {"classification": ["unavailable"], "derivation": "none"},
            "provider_reported_cost": {"classification": ["unavailable"], "derivation": "none"},
        },
    }
    (fixture_dir / "probe-manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("raw_dir", type=Path)
    parser.add_argument("fixture_dir", type=Path)
    args = parser.parse_args()
    ids = IdMap()
    hook_records = read_jsonl(args.raw_dir / "hooks.raw.jsonl")
    raw_logs = read_jsonl(args.raw_dir / "otel-logs.raw.jsonl")
    raw_traces = read_jsonl(args.raw_dir / "otel-traces.raw.jsonl")
    write_hooks(args.raw_dir, args.fixture_dir, ids)
    log_records, trace_spans = write_otel(args.raw_dir, args.fixture_dir, ids)
    rollout = write_rollout(args.raw_dir, args.fixture_dir, ids)
    interactive = write_interactive(args.raw_dir, args.fixture_dir)
    failed_command = failed_command_observation(args.raw_dir, hook_records, log_records)
    write_manifest(
        args.fixture_dir,
        hook_records,
        log_records,
        trace_spans,
        rollout,
        {
            "hook_records": len(hook_records),
            "otel_log_batches": len(raw_logs),
            "otel_trace_batches": len(raw_traces),
        },
        interactive,
        failed_command,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
