# Candidate manifest

Submit JSON with a complete skill package and claim-to-citation links:

```json
{
  "name": "prefer-evidence",
  "version": "1.0.0",
  "reviewerContext": "Review whether this instruction fits Organization investigations.",
  "uncertainty": {
    "level": "medium",
    "statement": "Supported by two real captured Turns; post-rollout impact is unknown."
  },
  "claims": [
    {
      "id": "claim-1",
      "statement": "Two distinct real captured Turns used this workflow.",
      "classification": "repeated_pattern",
      "citationIds": ["evidence-a", "evidence-b"]
    }
  ],
  "citations": [
    {
      "id": "evidence-a",
      "sessionId": "SESSION_A",
      "turnId": "TURN_A",
      "activityId": "ACTIVITY_UUID_A"
    },
    {
      "id": "evidence-b",
      "sessionId": "SESSION_B",
      "turnId": "TURN_B",
      "activityId": "ACTIVITY_UUID_B"
    }
  ],
  "package": {
    "files": [
      {
        "path": "SKILL.md",
        "content": "---\nname: prefer-evidence\ndescription: Require evidence before recommendations.\n---\n\n# Prefer evidence\n\nCite observed Turns before recommending changes.\n"
      }
    ]
  }
}
```

Use safe relative, unique file paths. Keep `SKILL.md` frontmatter `name` equal to the Candidate name. The CLI sorts files by path and hashes the UTF-8 JSON serialization of `{"files":[...]}` with SHA-256; the server rejects mismatches. Every edit requires a new immutable version.

Use `repeated_pattern` only with two distinct real Turn citations, `single_case_hypothesis` for one real Turn, and `descriptive` for other factual descriptions. Seeded citations remain illustrative and cannot satisfy the Repeated-pattern rule.
