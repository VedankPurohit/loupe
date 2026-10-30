# Judge walkthrough

This guide prepares a local Loupe demonstration without weakening admission
controls. Google sign-in is preferred when it is configured, but it is not a
requirement for a judge to enter the demo Organization.

## Fast local evaluation

For a judge who is cloning the repository and wants to inspect the product
immediately, use the dedicated disposable demo:

```bash
pnpm install --frozen-lockfile
pnpm demo
```

This resets only the `agent_observer_demo` database, creates an `OpenAI`
Organization, imports both Example packs, and opens the populated dashboard as
its Demo Administrator. Google is not required. The auto-login route exists
only while `DEMO_MODE=1` and `NODE_ENV` is not `production`; it is absent from
normal and production deployments. Stop the demo with Control-C.

Use this path for evaluation, screenshots, and product exploration. Use the
normal Invite flow below when the demonstration needs to exercise real
multi-person admission boundaries.

## Operator preparation for Invite-based judging

Use one local stack and one PostgreSQL database. For the local Google setup,
use the public configuration in
[`docs/google-auth-local-project.md`](./docs/google-auth-local-project.md), then
start the workspace from the repository root:

```bash
export DATABASE_URL=postgresql://localhost/loupe_ui_dev
export GOOGLE_WEB_CLIENT_ID=133441910622-ljjnmig0uhbmr4vgf890o20jck74v5o8.apps.googleusercontent.com
export GOOGLE_AUTH_ALLOWED_ORIGINS=http://127.0.0.1:5173
pnpm dev
```

Open `http://127.0.0.1:5173`, complete Bootstrap if this is an empty database,
and create the `OPENAI` Organization. Sign in as its Administrator. In the
dashboard's **Members** section, import **rich-v1 Example pack**. This is
explicit and idempotent; its expected receipt is 12 Example members, 480
Seeded Sessions, 1,088 Turns, 864 Agent runs, and 3,104 detail records.

Create one expiring, single-use Invite code for each judge from the same
**Members** section. Share every code privately and keep it outside the
repository, issue tracker, screenshots, shell history, and recorded demo
material. Revoke unused codes after the demo.

If Google cannot be configured or is temporarily unavailable, omit the two
Google environment variables and use the same Bootstrap and Invite paths. The
application presents this as an available code-entry path, not as an
authentication failure.

## Judge flow

1. Visit `http://127.0.0.1:5173`.
2. Choose **Use an Invite code**, enter the individually supplied code, and
   supply the requested display information. Google sign-in is optional.
3. Confirm that the browser enters `OPENAI` as an ordinary Member; an Invite
   cannot create an Administrator.
4. In Organization activity, enable **Include clearly labelled Seeded
   examples**. Seeded records are intentionally excluded by default so they
   cannot be mistaken for captured evidence.
5. Open a Seeded Session and inspect its timeline, turns, agent runs,
   repository/model context, and evidence/provenance labels. The selected
   record remains visibly marked **Seeded · Example** and links retain the
   explicit inclusion setting.

The rich pack is illustrative, server-controlled data. It does not use a Device
credential and never substitutes for real captured evidence or real-Turn
requirements in comparisons and standards review.

## Multi-Organization behavior

The same deployment can serve several Organizations. A Person can create or
join multiple Organizations and select an active membership; Organization
evidence, Device credentials, Analysis credentials, and Administrator authority
remain isolated to that membership. A judge Invite admits the judge only to the
Organization that issued it.
