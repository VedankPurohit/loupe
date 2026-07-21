import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";

import { requireSecureServerUrl } from "./setup.js";

const execFileAsync = promisify(execFile);

export interface BrowserEnrollmentAuthorizationOptions {
  serverUrl: string;
  deviceName: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Test seam and an escape hatch for non-macOS desktop launchers. */
  openBrowser?: (url: string) => Promise<void>;
}

export interface BrowserEnrollmentAuthorization {
  grant: string;
  state: string;
  callbackUrl: string;
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1";
}

function defaultOpenBrowser(url: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("BROWSER_AUTH_MACOS_REQUIRED: open the authorization URL in a local browser.");
  }
  return execFileAsync("open", [url]).then(() => undefined);
}

function response(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(body);
}

async function readCallbackBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Buffer);
    bytes += value.length;
    if (bytes > 16_384) throw new Error("BROWSER_AUTH_CALLBACK_TOO_LARGE");
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

/**
 * Starts a one-request loopback callback, opens the server's browser
 * authorization page, and returns the single-use grant posted by that page.
 * No browser cookie is read or passed to this process.
 */
export async function authorizeDeviceEnrollment(
  options: BrowserEnrollmentAuthorizationOptions,
): Promise<BrowserEnrollmentAuthorization> {
  const serverUrl = requireSecureServerUrl(options.serverUrl).toString().replace(/\/$/, "");
  if (options.signal?.aborted) throw new Error("BROWSER_AUTH_ABORTED");
  const state = randomBytes(24).toString("base64url");
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveGrant!: (value: BrowserEnrollmentAuthorization) => void;
  let rejectGrant!: (error: Error) => void;
  const result = new Promise<BrowserEnrollmentAuthorization>((resolve, reject) => {
    resolveGrant = resolve;
    rejectGrant = reject;
  });
  // The browser callback can reject the promise while the opener is still
  // awaiting its HTTP response. Attach a handled branch immediately so a
  // malformed/forged callback cannot surface as an unhandled rejection.
  void result.catch(() => undefined);

  const finish = (error?: Error, value?: BrowserEnrollmentAuthorization) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectGrant(error);
    else resolveGrant(value!);
  };

  const server = createServer(async (request, reply) => {
    const address = request.socket.remoteAddress;
    if (!isLoopbackAddress(address)) {
      response(reply, 403, "Loopback callback required.");
      return;
    }
    if (request.method !== "POST" || new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/callback") {
      response(reply, 405, "The installer callback accepts one POST.");
      return;
    }
    try {
      const payload = await readCallbackBody(request);
      const returnedState = payload.get("state");
      const grant = payload.get("grant");
      if (returnedState !== state) {
        response(reply, 400, "The authorization response was invalid. Return to the installer and retry.");
        return;
      }
      if (!grant || !/^enroll_[A-Za-z0-9_-]{16,256}$/.test(grant)) {
        response(reply, 400, "The authorization response was invalid. Return to the installer and retry.");
        finish(new Error("BROWSER_AUTH_RESPONSE_INVALID"));
        return;
      }
      response(reply, 200, "Authorization received. You may close this tab.");
      finish(undefined, {
        grant,
        state,
        callbackUrl: callbackUrl,
      });
    } catch (error) {
      response(reply, 400, "The authorization response could not be read.");
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });

  let callbackUrl = "";
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("BROWSER_AUTH_CALLBACK_UNAVAILABLE");
    callbackUrl = `http://127.0.0.1:${address.port}/callback`;
    const authorizationUrl = new URL(`${serverUrl}/api/v1/device-enrollment/authorize`);
    authorizationUrl.searchParams.set("deviceName", options.deviceName);
    authorizationUrl.searchParams.set("callback", callbackUrl);
    authorizationUrl.searchParams.set("state", state);
    timer = setTimeout(() => finish(new Error("BROWSER_AUTH_TIMEOUT")), timeoutMs);
    options.signal?.addEventListener(
      "abort",
      () => finish(new Error("BROWSER_AUTH_ABORTED")),
      { once: true },
    );
    try {
      await (options.openBrowser ?? defaultOpenBrowser)(authorizationUrl.toString());
    } catch (error) {
      finish(new Error(`BROWSER_AUTH_OPEN_FAILED: ${error instanceof Error ? error.message : String(error)}`));
    }
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }

  try {
    return await result;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

interface BrowserActionAuthorizationOptions {
  serverUrl: string;
  authorizationPath: string;
  query: Record<string, string>;
  expectedStatus: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  openBrowser?: (url: string) => Promise<void>;
}

/** Runs a browser-authorized, state-bound loopback action such as disconnect. */
async function authorizeBrowserAction(
  options: BrowserActionAuthorizationOptions,
): Promise<Record<string, string>> {
  const serverUrl = requireSecureServerUrl(options.serverUrl).toString().replace(/\/$/, "");
  if (options.signal?.aborted) throw new Error("BROWSER_AUTH_ABORTED");
  const state = randomBytes(24).toString("base64url");
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let callbackUrl = "";
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveResult!: (value: Record<string, string>) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<Record<string, string>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  void result.catch(() => undefined);
  const finish = (error?: Error, value?: Record<string, string>) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectResult(error);
    else resolveResult(value!);
  };
  const server = createServer(async (request, reply) => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      response(reply, 403, "Loopback callback required.");
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method !== "POST" || pathname !== "/callback") {
      response(reply, 405, "The installer callback accepts one POST.");
      return;
    }
    try {
      const payload = await readCallbackBody(request);
      if (payload.get("state") !== state) {
        response(reply, 400, "The authorization response was invalid.");
        return;
      }
      if (payload.get("status") !== options.expectedStatus) {
        response(reply, 400, "The authorization response was invalid.");
        finish(new Error("BROWSER_AUTH_RESPONSE_INVALID"));
        return;
      }
      response(reply, 200, "Action complete. You may close this tab.");
      finish(undefined, Object.fromEntries(payload.entries()));
    } catch (error) {
      response(reply, 400, "The authorization response could not be read.");
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("BROWSER_AUTH_CALLBACK_UNAVAILABLE");
    callbackUrl = `http://127.0.0.1:${address.port}/callback`;
    const authorizationUrl = new URL(`${serverUrl}${options.authorizationPath}`);
    for (const [key, value] of Object.entries(options.query)) authorizationUrl.searchParams.set(key, value);
    authorizationUrl.searchParams.set("callback", callbackUrl);
    authorizationUrl.searchParams.set("state", state);
    timer = setTimeout(() => finish(new Error("BROWSER_AUTH_TIMEOUT")), timeoutMs);
    options.signal?.addEventListener("abort", () => finish(new Error("BROWSER_AUTH_ABORTED")), { once: true });
    try {
      await (options.openBrowser ?? defaultOpenBrowser)(authorizationUrl.toString());
    } catch (error) {
      finish(new Error(`BROWSER_AUTH_OPEN_FAILED: ${error instanceof Error ? error.message : String(error)}`));
    }
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
  try {
    return await result;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export interface DeviceDisconnectAuthorizationOptions {
  serverUrl: string;
  deviceId: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  openBrowser?: (url: string) => Promise<void>;
}

/** Authorizes revocation of exactly one Enrolled device in the browser. */
export function authorizeDeviceDisconnect(
  options: DeviceDisconnectAuthorizationOptions,
): Promise<Record<string, string>> {
  return authorizeBrowserAction({
    serverUrl: options.serverUrl,
    authorizationPath: "/api/v1/device-disconnect/authorize",
    query: { deviceId: options.deviceId },
    expectedStatus: "revoked",
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    openBrowser: options.openBrowser,
  });
}
