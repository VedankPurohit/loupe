#!/bin/sh
set -eu

: "${SESSION_ID:?Set SESSION_ID to a real captured Codex Session id}"
: "${BROWSER_SESSION:?Set BROWSER_SESSION to an authenticated browser_session cookie value}"

SERVER_URL="${SERVER_URL:-http://127.0.0.1:3000}"
WEB_URL="${WEB_URL:-http://127.0.0.1:5173}"
STATE_DIR="${STATE_DIR:-$HOME/Library/Application Support/coding-agent-observability-relay}"

pnpm --filter @workspace/relay build
pnpm --filter @workspace/diagnostic-cli build

CODING_AGENT_OBSERVABILITY_BROWSER_SESSION="$BROWSER_SESSION" \
  node packages/relay/dist/cli.js checkpoint \
  --server-url "$SERVER_URL" \
  --web-url "$WEB_URL" \
  --state-dir "$STATE_DIR" \
  --session-id "$SESSION_ID"

CODING_AGENT_OBSERVABILITY_BROWSER_SESSION="$BROWSER_SESSION" \
  node apps/diagnostic-cli/dist/cli.js inspect "$SESSION_ID" \
  --server-url "$SERVER_URL"
