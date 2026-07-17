import { describe, expect, test } from "vitest";

import type { ExecutionSessionDetail } from "@workspace/contracts";

import { followFailureFromActivity } from "./investigation";

describe("keyboard investigation journey", () => {
  test("moves from organization activity to the exact failed Tool without raw telemetry", () => {
    const detail = {
      evidence: {
        tools: [
          { id: "tool-ok", outcome: "success", occurredAt: "2026-07-17T10:01:00Z" },
          {
            id: "tool-failed-shell",
            outcome: "failure",
            occurredAt: "2026-07-17T10:02:00Z",
          },
        ],
      },
    } as ExecutionSessionDetail;

    expect(followFailureFromActivity(detail)).toEqual({
      kind: "tool",
      id: "tool-failed-shell",
    });
  });
});
