import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const skillPath = fileURLToPath(
  new URL("../../../skills/analyze-organization-evidence/SKILL.md", import.meta.url),
);
const manifestReferencePath = fileURLToPath(
  new URL(
    "../../../skills/analyze-organization-evidence/references/candidate-manifest.md",
    import.meta.url,
  ),
);

describe("Analysis skill evidence scenarios", () => {
  it("requires real CLI evidence, navigable citations, uncertainty, Seeded exclusion, and two real Turns before a Repeated pattern", async () => {
    const [skill, manifestReference] = await Promise.all([
      readFile(skillPath, "utf8"),
      readFile(manifestReferencePath, "utf8"),
    ]);

    expect(skill).toContain("Use only the Analysis CLI as the evidence source.");
    for (const command of ["search", "inspect", "compare", "cite", "watch"]) {
      expect(skill).toContain(`loupe-diagnostic ${command}`);
    }
    expect(skill).toContain("Resolve every supporting citation");
    expect(skill).toContain("State uncertainty beside every conclusion.");
    expect(skill).toContain("Keep Seeded Sessions excluded.");
    expect(skill).toContain("at least two distinct real Turns");
    expect(skill).toContain("single-case hypothesis");
    expect(manifestReference).toContain('"classification": "repeated_pattern"');
    expect(manifestReference).toContain("Every edit requires a new immutable version.");
    expect(manifestReference).toContain(
      "Seeded citations remain illustrative and cannot satisfy the Repeated-pattern rule.",
    );
  });
});
