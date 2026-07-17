import { describe, expect, it } from "vitest";

import {
  beginInvestigation,
  openCase,
  revealFirstFailure,
} from "./investigation.js";

describe("narrative evidence notebook investigation", () => {
  it("moves from Organization activity to the exact failed Tool", () => {
    const initial = beginInvestigation();
    const opened = openCase(initial, "session-build-47");
    const revealed = revealFirstFailure(opened, {
      tools: [
        { id: "tool-read-1", outcome: "success" },
        { id: "tool-shell-9", outcome: "failure" },
      ],
    });

    expect(revealed).toEqual({
      caseId: "session-build-47",
      focusedEvidenceId: "tool-shell-9",
      mode: "evidence",
    });
  });
});
