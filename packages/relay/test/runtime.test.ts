import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { openDeliveryQueue } from "../src/index.js";
import { recordCodexPayload } from "../src/runtime.js";

describe("relay capture runtime", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("redacts a real hook payload before recording its source event in SQLite", async () => {
    const stateDir = join(tmpdir(), `relay-runtime-${randomUUID()}`);
    roots.push(stateDir);
    await mkdir(stateDir, { recursive: true });
    const secret = `sk-${"S".repeat(40)}`;
    await writeFile(join(stateDir, "setup-state.json"), JSON.stringify({
      version: 1,
      stateDir,
      serverUrl: "http://127.0.0.1:3000",
      credential: "device_test",
      fingerprintKey: Buffer.alloc(32, 7).toString("base64url"),
      policy: { version: 1, ordinaryRedactionEnabled: true, demoCanaryEnabled: false },
    }));

    const id = await recordCodexPayload({
      stateDir,
      source: "codex_hook",
      producerEvent: "UserPromptSubmit",
      payload: { session_id: "session-1", turn_id: "turn-1", prompt: `use ${secret}` },
    });
    const queue = openDeliveryQueue({ databasePath: join(stateDir, "relay.sqlite") });
    const item = queue.pending().find(({ event }) => event.id === id);
    expect(item?.event.rawPayload).toEqual({
      session_id: "session-1",
      turn_id: "turn-1",
      prompt: "use [REDACTED:openai_api_key]",
    });
    expect(item?.event.redaction.applied).toBe(true);
    queue.close();
  });
});
