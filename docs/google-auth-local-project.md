# Loupe local Google authentication

This document records the Google Cloud configuration used for Loupe's local
Google Identity Services sign-in. It intentionally contains only public or
non-secret configuration. Never add an OAuth client secret, ID token, browser
cookie, password, or browser-session value to this file.

## Google Cloud project

| Setting | Value |
| --- | --- |
| Project name | `Loupe Local Auth` |
| Project ID | `loupe-local-auth` |
| Project number | `133441910622` |
| Organization | No organization |
| Auth Platform app name | `Loupe` |
| Audience | External, testing mode |
| OAuth client name | `Loupe Local Web` |
| OAuth client type | Web application |
| Public OAuth client ID | `133441910622-ljjnmig0uhbmr4vgf890o20jck74v5o8.apps.googleusercontent.com` |
| Authorized JavaScript origin | `http://127.0.0.1:5173` |
| Authorized redirect URIs | None; Loupe uses the Google Identity Services ID-token callback |

The support and developer-contact fields use the Google account that owns the
project. Keep the exact email in Google Cloud rather than duplicating personal
contact information in the repository.

## Console links

- [Google Auth Platform overview](https://console.cloud.google.com/auth/overview?project=loupe-local-auth)
- [OAuth clients](https://console.cloud.google.com/auth/clients?project=loupe-local-auth)
- [Branding](https://console.cloud.google.com/auth/branding?project=loupe-local-auth)
- [Audience and test users](https://console.cloud.google.com/auth/audience?project=loupe-local-auth)

Always verify that the project selector says **Loupe Local Auth** before making
changes. Do not modify the unrelated `Yaa Space Hub Auth` project.

## Local server configuration

Start Loupe's API with the public client ID and the exact local browser origin:

```bash
export DATABASE_URL=postgresql://localhost/loupe_ui_dev
export GOOGLE_WEB_CLIENT_ID=133441910622-ljjnmig0uhbmr4vgf890o20jck74v5o8.apps.googleusercontent.com
export GOOGLE_AUTH_ALLOWED_ORIGINS=http://127.0.0.1:5173
pnpm --filter @workspace/server dev
```

The web application remains at `http://127.0.0.1:5173`. The client ID is public
configuration; no OAuth client secret is required by Loupe's browser ID-token
flow.

## Asking a future agent to change the project

Use a prompt like this:

> Use `$computer-use:computer-use` to control Zen Browser on my Mac. Open the
> Google Cloud project `Loupe Local Auth` (`loupe-local-auth`) at
> `https://console.cloud.google.com/auth/overview?project=loupe-local-auth`.
> Make the requested Google Auth Platform change. Confirm the project selector
> before editing. Never inspect cookies, browser storage, passwords, ID tokens,
> OAuth client secrets, or saved credentials. Stop for me to enter any password
> and ask immediately before accepting legal terms, creating credentials,
> granting persistent access, or saving a security-sensitive change. Report the
> final non-secret configuration and verify Loupe at
> `http://127.0.0.1:5173`.

Add the specific desired change to that prompt, for example:

- add another authorized local origin;
- add or remove a test user;
- update Auth Platform branding;
- rotate the public web client by creating a replacement and updating
  `GOOGLE_WEB_CLIENT_ID`;
- verify that Google sign-in reaches Loupe without `invalid_client`.

For read-only inspection, the agent can navigate and report without changing
anything. Google Cloud actions that create credentials, expand access, accept
terms, or change security-sensitive configuration require confirmation at the
actual action step even when the overall task was authorized earlier.

