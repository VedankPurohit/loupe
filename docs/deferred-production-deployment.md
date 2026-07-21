# Deferred production deployment

Loupe currently proves a portable local runtime; deployment and provider
selection remain deferred. Nothing in this repository provisions a host,
database, domain, Google project, or production environment, and the repository
must not be treated as evidence that a public launch has occurred.

## Preserved deployment seams

The React frontend has a Vercel Build Output API seam. It builds the same Vite
application used locally, copies static assets (including `guide.html`), keeps
client-side routes on `index.html`, and proxies same-origin `/api/*` requests to
the configured Fastify origin:

```bash
LOUPE_API_ORIGIN=https://api.loupe.example pnpm build:vercel
```

`LOUPE_API_ORIGIN` is public routing configuration, not a credential. The build
rejects non-HTTPS remote origins, URL credentials, paths, queries, and fragments.
The generated `.vercel/output` directory is compatible with the Vercel Build
Output API. Running the command proves the artifact shape; it does not publish
or provision a Vercel project.

The Dockerfile keeps independent `server` and `web` targets. Fastify uses the
single `DATABASE_URL` PostgreSQL contract and applies committed migrations at
startup. Compose packages both targets with PostgreSQL, health checks, and a
persistent volume for local verification. A later managed deployment can build
the `server` target without adopting Compose's bundled database or nginx web
target. The committed Compose profile is loopback HTTP and overrides runtime
`NODE_ENV` only so browsers accept its local session cookie; the standalone
server image defaults to production and emits `Secure` cookies for hosted HTTPS.

Google Identity Services authentication is configured on the backend with only
provider-neutral public values:

| Variable | Purpose |
| --- | --- |
| `GOOGLE_WEB_CLIENT_ID` | Public Web application client ID for the selected environment. |
| `GOOGLE_AUTH_ALLOWED_ORIGINS` | Comma-separated exact frontend origins allowed to deliver a Google credential. |

Compose accepts both variables without a Google client secret. For a hosted
same-origin frontend rewrite, the allowed origin is the stable public frontend
origin. Never add a client secret, Google ID token, Loupe browser-session cookie value, Device
credential, or Analysis credential to source control, image layers, build
arguments, browser bundles, or deployment logs.

## Deferred production requirements

Before a public production launch, an operator must complete and verify all of
the following outside this local acceptance phase:

- Choose stable owned domains for the frontend and API, then configure DNS.
- Terminate HTTPS on every public browser and API route; retain a same-origin
  `/api` proxy or validate the final same-site cookie and CORS topology.
- Select and operate managed PostgreSQL, including connection limits,
  migrations, availability, monitoring, and encrypted backups with tested
  restoration.
- Create a separate production Google Cloud project and Web client. Register
  only exact production HTTPS origins; do not reuse localhost or preview URLs.
- Publish a public homepage and privacy policy on a verified domain, and finish
  Google consent branding, audience, and production-readiness review.
- Define launch operations: secret/configuration injection, release and rollback
  procedures, alerts, incident ownership, support, data retention, and audit
  review.
- Test current Chrome, Safari, and Firefox behavior, responsive/accessibility
  paths, service interruption, credential revocation, and backup recovery in a
  staging environment that matches production.

Provider choice, production DNS, database procurement, the production Google
client, backup operations, and launch approval remain explicit human decisions.
The local Docker, Vercel-output, and `/api/v1` checks preserve seams for those
decisions; they do not satisfy them.
