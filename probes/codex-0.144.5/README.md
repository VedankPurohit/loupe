# Codex 0.144.5 capture probe (prototype)

Question: does the real target producer emit the documented lifecycle identity
and OTLP/JSON structure needed by ticket 04, and which hoped-for capabilities
must be downgraded?

The probe is intentionally isolated and throwaway. It runs the exact npm
package `@openai/codex@0.144.5`, writes its config, session state, raw hook
payloads, and raw OTLP payloads under a new `loupe-codex-0144-5-*` directory in
the operating system's temporary area, and uses harmless synthetic prompts in
an empty temporary workspace.
It reads the existing Codex login through a temporary symlink; it never copies
credential bytes. Raw output must not be committed.

Run it with one command:

```sh
python3 probes/codex-0.144.5/run_probe.py
```

Then exercise the TUI-only fork and approval surfaces against the printed
temporary probe root:

```sh
python3 probes/codex-0.144.5/run_interactive_probe.py \
  /tmp/loupe-codex-0144-5-EXAMPLE
```

The interactive prototype uses a real PTY and approves only one synthetic
`touch` command in the isolated workspace. Sanitize the raw directory with
`sanitize_probe.py`, run the contract assertions, and delete the complete
temporary probe root. Unknown fields retain keys, scalar types, and nested
shape; unknown string content is structurally tokenized by default.
