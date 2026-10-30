# Loupe — Google authentication constraints for local and hosted deployment

**Research date:** 2026-07-18 (Asia/Kolkata)

**Question:** What do current primary Google OAuth/OpenID Connect documents require for local development, production callbacks, consent, client types, PKCE/state/nonce, token validation, logout/revocation, and secret handling when the UI can run on Vercel and the Fastify backend runs in a Docker-compatible environment?

**Source boundary:** Google Identity/Cloud/Workspace documentation, Google's live OpenID Provider metadata, OpenID Connect Core, and the IETF OAuth 2.0 Security Best Current Practice. All web sources were accessed on 2026-07-18. No credentials were created or inspected.

## Executive decision

Google authentication is compatible with the planned local and hosted Loupe architecture. It does **not** require Convex and does not require Google access or refresh tokens for the current authentication-only milestone.

The smallest current design is:

1. Use **Google Identity Services (GIS) for Web** in the Vercel-served UI with an OAuth client of type **Web application**.
2. Receive a Google ID-token credential in the browser and send it by HTTPS POST to the Docker-hosted backend.
3. Validate delivery CSRF protection and the ID token on the backend, identify the Google account by `sub`, then discard the Google credential and issue Loupe's own revocable browser session.
4. Request only the default sign-in identity data (`openid`, `email`, `profile`). Do not request offline access, Google API scopes, access tokens, or refresh tokens.

Google explicitly separates authentication, which returns an ID token, from authorization to Google data, which returns an authorization code/access token ([GIS overview, “Separated authentication and authorization moments”](https://developers.google.com/identity/gsi/web/guides/overview#separated_authentication_and_authorization_moments)). Google's GIS setup guide says the default `email`, `profile`, and `openid` scopes are sufficient for authentication and do not require adding sensitive scopes ([GIS setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#configure_your_oauth_consent_screen)).

This approach has no Google client secret in the browser or backend and stores no Google tokens. The Web client ID is intentionally public and is included in the page. Loupe still needs to secure its own session cookie and session store.

There is one important portability limit: **Google sign-in is configurable, not zero-configuration.** Google requires a registered client with an allowlist of origins and, when used, exact redirect URIs. OAuth clients must be created/configured manually in Cloud Console, and production domains must be owned and verifiable. Therefore an arbitrary self-hosted domain cannot use one universal Loupe client without prior registration. Each self-hosting operator must supply a Web client ID configured for their origin, or Loupe must operate a central authentication broker—which is outside the current architecture ([Google OAuth best practices, “Manual creation and configuration”](https://developers.google.com/identity/protocols/oauth2/resources/best-practices#manual-oauth-clients); [production domain requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#only-use-domains-you-own)).

## Requirement labels

- **Required** — explicitly stated as `must`, `required`, or enforced by Google/specification validation.
- **Recommended** — stated as `should`, `recommended`, or a security best practice.
- **Architecture choice** — a Loupe design decision derived from those constraints, not a Google hosting requirement.

## Constraint matrix

| Area | Required | Recommended | Loupe architecture choice |
|---|---|---|---|
| Client type | Register a client; for GIS on a website choose **Web application** and register the website origin. Use a separate client per platform when there are genuinely different platforms. | Reuse the Web client for the web UI and its server validation; hosting the UI and API separately does not by itself make them different platforms. | One Web client per environment/tier. Do not use a Desktop client merely because developers run the web app on localhost. |
| Local development | For GIS, add both `http://localhost` and the port-bearing origin, such as `http://localhost:5173`. If a redirect is used, it must exactly match a registered redirect URI. Google exempts localhost and localhost-IP redirect URIs from the general HTTPS rule. | Prefer a fixed port and fixed callback so configuration is repeatable. | Development Google project/client with local Vite origin; backend at a fixed localhost port. Never add local addresses to the production project. |
| Production transport | Web origins and redirect URIs must use HTTPS. Redirect values must match scheme, host, port/path, case, and trailing slash exactly. | Use stable custom domains rather than provider preview URLs. | `app.example.com` on Vercel and `api.example.com` for the Docker backend, or a same-origin `/api` proxy. |
| Consent/audience | Configure branding, support/contact email, audience, and data access. External testing requires explicit test users. Production has owned-domain/homepage/privacy requirements; sensitive/restricted scopes require additional verification. | Request the narrowest scopes and add authorization later, in context. | External development app with named test users; public production app with only sign-in scopes initially. |
| CSRF/replay | The client must prevent CSRF. GIS redirect/POST mode requires validating the `g_csrf_token` double-submit cookie/body values. In code flow, any returned `state` must match the transaction; a sent `nonce` must be returned and checked. | Use a unique, unpredictable, one-time `state`; use a transaction-bound nonce. For a confidential code-flow client, use S256 PKCE. | GIS callback mode: enforce the app's CSRF/origin controls and use a one-time nonce. Future code flow: use state + nonce + S256 PKCE together. |
| ID-token validation | Validate Google signature/keys, `iss`, `aud`, and `exp`; validate `nonce` if sent; use `hd` only when enforcing a Workspace domain. | Use Google's Node auth library and cache rotating keys according to response caching headers. `tokeninfo` is debugging-only. | Validate only in Fastify, never trust decoded browser claims, and persist Google `sub` as the external identity key. |
| Secrets/tokens | Credentials and user tokens must not be hardcoded, committed, published, or transmitted in plaintext. | Use a secret manager/runtime secret injection; encrypt stored user tokens at rest. | Recommended GIS auth-only flow has no Google client secret or stored Google token. If code flow is added, the secret and token exchange live only in the Docker backend. |
| Logout/revocation | Loupe must terminate its own application session. Google provides separate mechanisms for disabling automatic re-sign-in, revoking ID-token sharing consent, and revoking OAuth API grants. | Revoke Google consent only for unlink/delete-account, not every logout. | Logout revokes the Loupe session and clears its cookie; call `disableAutoSelect()` only to prevent an immediate sign-in loop. |

## 1. Authentication-only flow recommended for the current milestone

The current requirement is to authenticate a Person, then let Loupe decide whether that Person creates an Organization, accepts an invite, or selects an existing membership. Loupe does not need to call Google APIs on the Person's behalf.

Google's current GIS model supports this directly:

```text
Vercel UI                     Docker/Fastify backend              Google
    |                                   |                           |
    |-- GIS sign-in interaction --------------------------------->|
    |<---------------- signed ID-token credential ----------------|
    |-- HTTPS POST credential -------->|                           |
    |                                   |-- validate Google keys,   |
    |                                   |   iss, aud, exp, nonce    |
    |                                   |-- find/create Person by sub
    |<-- Loupe HttpOnly session cookie -|                           |
```

The GIS setup guide requires a client ID, says to choose **Web application**, and says to include that client ID in the web app. It does not instruct the browser to contain a client secret ([GIS setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#get_your_google_api_client_id)). The credential response is a signed JWT ID token, not a Loupe session ([GIS JavaScript reference, `CredentialResponse`](https://developers.google.com/identity/gsi/web/reference/js-reference#CredentialResponse)).

### Delivery mode matters

GIS supports two relevant delivery shapes:

- **Popup/JavaScript callback:** the callback receives the credential in JavaScript. The application is responsible for securely transmitting it to the backend. This works with a Vercel UI and a separate API, but Loupe must enforce its own CSRF/origin policy on the credential POST and use an explicit CORS allowlist.
- **Redirect/login URI:** GIS POSTs the credential to `login_uri`. The URI must exactly match an authorized redirect URI, and the backend must compare Google's `g_csrf_token` cookie and body values before validating the ID token ([GIS server-side verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token); [GIS `login_uri`](https://developers.google.com/identity/gsi/web/reference/js-reference#login_uri)).

**Architecture choice:** start with popup/JavaScript callback because the UI and API may be separate origins. POST the credential to the Fastify API over HTTPS with an exact frontend-origin allowlist, application CSRF protection, and a one-time nonce. If Loupe later exposes the backend through a same-origin Vercel rewrite, redirect/login-URI mode becomes attractive because Google's documented double-submit CSRF mechanism can terminate at that same public origin.

Do not keep the Google ID token in `localStorage`, use it as the Loupe API bearer token, or use its expiration as Loupe's session lifetime. Validate it once, create/revoke a server-side Loupe session, and retain only the needed identity/profile fields.

## 2. Localhost and production origin/callback rules

### Local development

Google's GIS setup page gives explicit local configuration: add both `http://localhost` and `http://localhost:<port_number>` to Authorized JavaScript origins. It separately notes that One Tap display is HTTPS-only, so local HTTP development should rely on the Sign in with Google button rather than assuming every One Tap feature works ([GIS setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#get_your_google_api_client_id)).

For web-server OAuth redirects, Google's validation rules say:

- redirect URIs normally **must use HTTPS**;
- localhost URIs, including localhost-IP URIs, are exempt;
- hosts cannot be raw IP addresses except localhost IP addresses;
- fragments, userinfo, path traversal, wildcards, invalid encodings, and open redirects are forbidden;
- the requested redirect URI must exactly match a registered URI, including scheme, case, and trailing slash.

Google explicitly uses `http://localhost:8080` as a testing redirect example ([Google OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred); [redirect URI validation rules](https://developers.google.com/identity/protocols/oauth2/web-server#uri-validation)).

Google's general OpenID Connect walkthrough broadly says to use HTTPS for protocol requests, while the service-specific Web client and redirect-validation pages explicitly permit HTTP localhost origins/callbacks for development. Treat localhost as the narrow documented exception: it does not permit plain HTTP on a LAN hostname, preview deployment, or production domain ([Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect#sendauthrequest); [GIS localhost setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#get_your_google_api_client_id)).

Examples for a fixed local setup:

```text
Authorized JavaScript origins
  http://localhost
  http://localhost:5173

Only if a redirect/login URI is used
  http://localhost:3000/api/v1/auth/google/callback
```

Using `localhost` is a web-development exception; it does not change the correct client type from Web application to Desktop app.

### Production

Production JavaScript origins and callbacks must be stable HTTPS URLs. A callback such as `https://api.example.com/api/v1/auth/google/callback` is valid only when registered exactly. A Vercel preview URL cannot be matched by a wildcard because Google forbids wildcard characters in redirect URIs. Google's production-readiness guide also says production clients must not contain development/test origins or redirect URIs ([production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#separate-projects-testing-production)).

**Architecture choice:** use a stable owned domain for the public UI and, preferably, a sibling API subdomain or same-origin proxy. If the UI remains on `*.vercel.app` while the API remains on an unrelated `*.railway.app`/provider domain, Loupe's session cookie becomes cross-site and is exposed to browser third-party-cookie restrictions. That is a browser/session architecture issue, not a Google OAuth requirement. A stable pair such as `app.example.com` and `api.example.com` keeps the deployment portable while avoiding provider URLs in Google configuration.

## 3. Projects, clients, consent, and the public homepage

### Separate development and production projects

Google's production-readiness guidance requires separate projects for testing and production. It says the production project/client must not contain individual developer servers, test/pre-release versions, test redirect URIs, or test JavaScript origins ([separate projects](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#separate-projects-testing-production)).

For Loupe this means:

- **Development project:** Web client with localhost origins; External audience with named test users if the app is not Internal to one Workspace organization.
- **Production project:** Web client with only stable public HTTPS origins/callbacks; production branding and owned domains.

### Consent configuration

Google requires an OAuth consent configuration. Current configuration includes app name, support email, audience (`Internal` or `External`), contact email, acceptance of the Google API Services User Data Policy, and scopes/data access. An External app in testing must list test users ([Google consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent)).

For authentication, Google's GIS setup guide says the default `email`, `profile`, and `openid` scope set is sufficient and no sensitive scopes need to be added. Sensitive or restricted Google API scopes add verification/security-review requirements; they should not be requested for the present milestone ([GIS consent setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid#configure_your_oauth_consent_screen); [scope categories](https://developers.google.com/workspace/guides/configure-oauth-consent#scope_categories)).

### The unauthenticated homepage is useful and eventually required

Google says every production OAuth app must have a publicly accessible homepage on a verified domain. The homepage must describe the application's functionality and link to a privacy policy; terms of service are optional. Domains used by the homepage, privacy policy, terms, authorized origins, and redirect URIs must be owned/verifiable ([production homepage and domain rules](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance#host-homepage-production-apps)).

This supports the current UI direction: the unauthenticated marketing/home experience can be the production OAuth homepage, while authenticated routes expose the dashboard. Before production verification, it needs real privacy-policy content and stable owned-domain links.

## 4. State, nonce, and PKCE

These controls apply differently to the two possible flows.

### GIS ID-token credential flow (recommended now)

- There is no authorization code to exchange, so **PKCE does not apply**.
- In redirect/automatic POST mode, Google requires the backend to validate the `g_csrf_token` double-submit cookie/body pair before accepting the credential ([GIS token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)).
- GIS exposes an optional `nonce` configuration value specifically for ID-token replay protection ([GIS JavaScript reference, `nonce`](https://developers.google.com/identity/gsi/web/reference/js-reference#nonce)).
- In JavaScript callback mode, Loupe is responsible for secure browser-to-backend delivery; use a one-time, server-issued nonce bound to the login transaction, reject mismatches/reuse, and apply the API's CSRF/origin policy.

### Backend authorization-code flow (only if selected or needed later)

If Loupe later needs Google API authorization, the Docker backend should own `/auth/google/start`, the callback, and the code exchange. The browser should never receive the client secret, code verifier, or resulting Google refresh token.

For that flow:

- OAuth clients **must prevent CSRF**. Google's web-server guide recommends `state`, requires the callback value to be checked before handling the response, and calls out the client's CSRF obligation ([Google web-server OAuth, `state`](https://developers.google.com/identity/protocols/oauth2/web-server#request-parameter-state); [callback check](https://developers.google.com/identity/protocols/oauth2/web-server#handlingresponse)).
- Google's OpenID Connect guide describes `state` as an anti-forgery/session token and `nonce` as replay protection. Its parameter table marks `nonce` required for its presented Google OIDC authentication request ([Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect#sendauthrequest)).
- The current OAuth Security BCP requires public clients to use PKCE and **recommends** PKCE for confidential clients such as a backend web application. The challenge/nonce must be transaction-specific and bound to the browser transaction. `S256` is the only currently defined PKCE method that does not expose the verifier in the authorization request ([RFC 9700 §2.1.1](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.1.1)).
- Google's live discovery metadata advertises `code_challenge_methods_supported` including `S256` ([Google OpenID Provider configuration](https://accounts.google.com/.well-known/openid-configuration)).
- OpenID Connect Core requires that when a nonce is sent, the returned ID token contain the same value and that the client check it ([OpenID Connect Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)).

**Architecture choice:** if code flow is implemented, use all three controls—unpredictable one-time `state`, unpredictable one-time `nonce`, and S256 PKCE—stored server-side with a short expiration and consumed exactly once. PKCE is a recommendation, not a hard requirement for this confidential backend client; using it removes an avoidable authorization-code injection/replay risk.

## 5. Backend ID-token validation and identity mapping

Do not trust a decoded JWT or browser-provided profile. Google's verification guide requires the backend to verify:

1. the signature using Google's rotating public keys;
2. `aud` equals an allowed Loupe Web client ID;
3. `iss` equals `accounts.google.com` or `https://accounts.google.com`;
4. `exp` has not passed;
5. `hd` matches an allowed Workspace domain only if Loupe intentionally restricts sign-in by Workspace domain.

When a nonce was included, OpenID Connect additionally requires checking the returned nonce. Google recommends a Google API/auth library in production and says `tokeninfo` is for development/debugging; key caches should follow the response `Cache-Control` header ([Google ID-token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token); [OpenID Connect validation](https://developers.google.com/identity/openid-connect/openid-connect#validatinganidtoken)).

Google repeatedly warns that `email` can change and must not be used as the stable account identifier. Persist the ID token's `sub` claim as the Google identity key; treat email/name/picture as profile attributes that can be refreshed ([Google ID-token verification, account correlation](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)).

The backend should accept exactly the configured client audience. If development and production clients differ, each environment should allow only its own client ID. Do not accept an arbitrary `aud` sent by the browser.

## 6. Secure handling of secrets and tokens

Google's best-practices page says client credentials must be stored securely (for example in a secret manager) and must not be hardcoded, committed, or published. It also says user access/refresh tokens must be securely stored, never sent in plaintext, encrypted at rest for server-side multi-user stores, revoked when no longer needed, and deleted from the system ([Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices#handle-client-credentials-securely)).

Implications:

- **GIS authentication-only:** expose the Web client ID in the frontend; it is not a secret. Do not configure or store a Google client secret, access token, or refresh token.
- **Authorization-code alternative:** inject the client secret only into the Docker backend using the deployment platform's secret facility. Never place it in `VITE_*`, `NEXT_PUBLIC_*`, browser bundles, source control, Docker image layers, build logs, or telemetry.
- Store state/nonce/PKCE verifier records server-side, short-lived and one-time. Do not put a raw client secret or token inside `state`.
- Do not log ID tokens, authorization codes, access tokens, refresh tokens, session tokens, cookies, or credential POST bodies.
- Loupe's own browser session token should be random, revocable, and sent in an `HttpOnly` cookie; production cookies should be `Secure`. This is an application-session choice rather than a Google-token requirement.

The Google web-server guide separately says downloaded client credentials should be stored somewhere only the application can access and outside the source tree ([Google web-server credential storage](https://developers.google.com/identity/protocols/oauth2/web-server#creatingcred)).

## 7. Logout, unlink, and revocation are different operations

### Normal Loupe logout

Normal logout must revoke Loupe's server-side session and clear the Loupe session cookie. It should not revoke Google consent on every logout.

If GIS automatic sign-in/One Tap is used, call `google.accounts.id.disableAutoSelect()` or use Google's sign-out marker to avoid immediately signing the user back in. Google explicitly warns that this mechanism does **not** sign the user out of Loupe or Google; it only suppresses automatic selection/sign-in behavior ([GIS automatic sign-out](https://developers.google.com/identity/gsi/web/guides/automatic-sign-in-sign-out#sign-out)).

### Unlink/delete-account

When a user intentionally unlinks Google or deletes their Loupe account, GIS exposes `google.accounts.id.revoke`. Google's dedicated revoke guide says this revokes consent to share an ID token and forces re-consent on a future visit; it is not the normal application logout operation ([GIS ID-token sharing revocation](https://developers.google.com/identity/gsi/web/guides/revoke)).

### Revoking Google API authorization

If Loupe later obtains Google access/refresh tokens, revoke them with `https://oauth2.googleapis.com/revoke` and delete stored tokens. Google's web-server guide says project-level OAuth revocation invalidates the associated authorization across registered clients/scopes ([Google OAuth token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke)).

As of the research date, Google's discovery document advertises a `revocation_endpoint` but no standard OIDC `end_session_endpoint`; Google does not document an RP-initiated global Google-account logout for this integration ([live discovery metadata](https://accounts.google.com/.well-known/openid-configuration)). Loupe should not attempt to sign the user out of their Google Account.

### Documentation inconsistency

Google's dedicated GIS revoke guide says `google.accounts.id.revoke` applies only to ID-token sharing and not OAuth scopes. The current JavaScript reference contains a conflicting key-point sentence saying revocation removes all project OAuth scopes ([dedicated guide](https://developers.google.com/identity/gsi/web/guides/revoke); [JavaScript reference, `revoke`](https://developers.google.com/identity/gsi/web/reference/js-reference#google.accounts.id.revoke)). Treat the dedicated guide as the contract for GIS ID-sharing revocation, and use the documented OAuth revocation endpoint for any future access/refresh tokens. For the recommended authentication-only design, no Google API grants exist, so the ambiguity does not affect normal operation.

## 8. Deployment consequences

### What remains portable

The same application can run:

- locally with localhost origins and a development Web client ID;
- on Vercel plus any Docker-compatible backend;
- fully containerized later, provided the public UI/API URLs are stable and registered.

No provider-specific Google logic is required. The configurable values are the public Web client ID, allowed frontend/API URLs, and Loupe session settings. A code-flow implementation would additionally require a client secret and exact callback URL.

### What each self-hosting operator must do

An operator who wants Google sign-in on their own public domain must:

1. create/configure a Google Cloud project and OAuth consent screen;
2. create a Web application client;
3. register their exact public UI origin and any redirect URI used;
4. provide the client ID to Loupe;
5. publish/verify the consent branding as required for their audience and scopes.

This cannot be fully automated by Loupe: Google's best-practices documentation says OAuth clients cannot be created or modified programmatically and must be configured manually in Cloud Console ([manual client configuration](https://developers.google.com/identity/protocols/oauth2/resources/best-practices#manual-oauth-clients)).

### Vercel preview environments

Do not append every ephemeral Vercel preview origin to the production Google project. Use one of:

- the local development project for local testing;
- a separate staging project with one stable staging domain;
- preview deployments without Google sign-in, using mock/local authentication.

This follows Google's environment separation rule and avoids unsupported wildcard redirects.

## 9. Implementation acceptance checklist

### Local milestone

- [ ] Development Google project exists separately from any production project.
- [ ] OAuth client type is **Web application**.
- [ ] Authorized origins include exactly `http://localhost` and the selected frontend port.
- [ ] External testing audience lists the intended local testers.
- [ ] UI uses GIS authentication only; no Google API/offline scopes are requested.
- [ ] Backend credential endpoint enforces explicit origin/CORS and application CSRF protection for JS-callback mode, or validates GIS `g_csrf_token` for redirect/POST mode.
- [ ] A transaction-specific nonce is issued, checked, expired, and consumed once.
- [ ] Backend validates signature, `iss`, `aud`, `exp`, and nonce with a maintained library.
- [ ] Person identity is keyed by `(provider = google, subject = sub)`, not email.
- [ ] Google ID token is discarded after validation; Loupe issues its own revocable session.
- [ ] Logout revokes the Loupe session and prevents an automatic GIS sign-in loop.
- [ ] Tests cover invalid signature, wrong audience, expired token, nonce replay/mismatch, CSRF failure, logout, and same-email/different-`sub` handling.

### Deferred hosted deployment

- [ ] Stable owned frontend and API domains are chosen.
- [ ] Separate production Google project/client uses only production HTTPS origins/callbacks.
- [ ] Public homepage describes Loupe and links to a privacy policy on a verified domain.
- [ ] Production branding/verification status is complete.
- [ ] Session-cookie/CORS topology is tested in current Chrome, Safari, and Firefox; a same-site custom-domain or same-origin proxy is preferred over unrelated provider domains.
- [ ] No Vercel preview or localhost URI appears in the production client.

## 10. Primary-source register

1. [Google Identity Services setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid) — Web client, localhost origins, optional redirects, consent fields, default authentication scopes.
2. [Google Identity Services overview](https://developers.google.com/identity/gsi/web/guides/overview) — separation of authentication from Google API authorization.
3. [Verify the Google ID token on the server](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token) — CSRF delivery check, claim/signature validation, `sub`, library guidance.
4. [GIS JavaScript API reference](https://developers.google.com/identity/gsi/web/reference/js-reference) — callback/login URI modes, nonce, credential response, auto-select, revoke.
5. [GIS automatic sign-in and sign-out](https://developers.google.com/identity/gsi/web/guides/automatic-sign-in-sign-out) — `disableAutoSelect()` semantics and logout-loop prevention.
6. [GIS ID-token sharing revocation](https://developers.google.com/identity/gsi/web/guides/revoke) — unlink/re-consent semantics.
7. [OAuth 2.0 for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server) — confidential server flow, exact callbacks, localhost, state, token storage/revocation.
8. [Google OAuth 2.0 best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices) — credential/token security, state, least privilege, manual client configuration.
9. [Google OAuth production readiness](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) — separate projects, production domains, homepage, HTTPS.
10. [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent) — branding, audience, test users, scope categories.
11. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) — authentication request, state/nonce, ID-token claims/validation, discovery.
12. [Google live OpenID Provider configuration](https://accounts.google.com/.well-known/openid-configuration) — current endpoints, signing algorithms, and PKCE method metadata.
13. [OAuth 2.0 Security Best Current Practice, RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html) — CSRF, authorization-code injection, PKCE requirements/recommendations, S256.
14. [OpenID Connect Core 1.0](https://openid.net/specs/openid-connect-core-1_0.html) — authorization-code flow and normative ID-token/nonce validation.

## Final boundary

For the local-presentability phase, implement **Google authentication, not Google API authorization**. GIS + backend ID-token verification gives the desired sign-up experience with one public client ID and no Google secret/token store. Keep authorization-code/refresh-token machinery out until a real Google API feature requires it.

Deployment remains deferred, but the code should expose configuration seams for stable frontend/API URLs, a per-environment Google Web client ID, explicit origin allowlists, and secure Loupe session cookies. The future hosted launch will still require a separate production Google project, stable HTTPS domains, public homepage/privacy policy, and consent-brand verification.
