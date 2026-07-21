import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  adaptCodexObservation,
  createCodexSourceEvent,
  type CodexSourceObservation,
} from "../../packages/agent-adapter/src/index.js";

interface HookFixture {
  events: Array<{ captured_at: string; payload: Record<string, unknown> }>;
}

function toSourceEvent(event: HookFixture["events"][number]) {
  const observation: CodexSourceObservation = {
    source: "codex_hook",
    producer: { name: "codex", version: "0.144.5" },
    producerEvent: String(event.payload.hook_event_name),
    occurredAt: new Date(event.captured_at).toISOString(),
    capturedAt: new Date(event.captured_at).toISOString(),
    capturePath: `hook:${String(event.payload.hook_event_name)}`,
    payload: event.payload,
  };

  return createCodexSourceEvent({
    id: randomUUID(),
    adapted: adaptCodexObservation(observation),
    redaction: { policyVersion: 1, applied: false, evidence: [] },
  });
}

export async function loadInspectorFixture() {
  const fixture = JSON.parse(
    await readFile(
      new URL(
        "../../packages/agent-adapter/test/fixtures/codex/0.144.5/hooks.sanitized.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as HookFixture;
  const sessionEvents = fixture.events.filter(
    ({ payload }) => payload.session_id === "session-probe-001",
  );
  const finalTurnIndex = sessionEvents.findIndex(
    ({ payload }) => payload.turn_id === "turn-probe-008",
  );
  const resumeIndex = sessionEvents
    .slice(0, finalTurnIndex)
    .findLastIndex(
      ({ payload }) =>
        payload.hook_event_name === "SessionStart" && payload.source === "resume",
    );

  return {
    initial: sessionEvents.slice(0, resumeIndex).map(toSourceEvent),
    live: sessionEvents.slice(resumeIndex, finalTurnIndex).map(toSourceEvent),
    afterDisconnect: sessionEvents.slice(finalTurnIndex).map(toSourceEvent),
  };
}

export function setupVerificationFixture(
  sessionId = "setup-verification-playwright",
) {
  return [
    toSourceEvent({
      captured_at: "2026-07-18T08:00:00.000Z",
      payload: {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        source: "startup",
      },
    }),
    toSourceEvent({
      captured_at: "2026-07-18T08:00:01.000Z",
      payload: {
        hook_event_name: "Stop",
        session_id: sessionId,
        source: "setup_verification_complete",
      },
    }),
  ];
}
