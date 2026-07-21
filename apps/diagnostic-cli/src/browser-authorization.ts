import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface AnalysisCredentialAuthorizationOptions {
  serverUrl: URL;
  name: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  openBrowser?: (url: string) => Promise<void>;
}

function respond(reply: ServerResponse, status: number, message: string): void {
  reply.statusCode = status;
  reply.setHeader("content-type", "text/plain; charset=utf-8");
  reply.setHeader("cache-control", "no-store");
  reply.end(message);
}

async function callbackBody(request: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk as Buffer);
    length += value.length;
    if (length > 16_384) throw new Error("BROWSER_AUTH_CALLBACK_TOO_LARGE");
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function defaultOpenBrowser(url: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error(
      "BROWSER_AUTH_MACOS_REQUIRED: open the authorization URL in a local browser.",
    );
  }
  return execFileAsync("open", [url]).then(() => undefined);
}

/**
 * Receives only a short-lived grant at a state-bound loopback endpoint. The
 * browser's HttpOnly Session and the redeemed Analysis credential never cross
 * this hand-off.
 */
export async function authorizeAnalysisCredential(
  options: AnalysisCredentialAuthorizationOptions,
): Promise<string> {
  if (options.signal?.aborted) throw new Error("BROWSER_AUTH_ABORTED");
  const state = randomBytes(24).toString("base64url");
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  let callbackUrl = "";
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  let resolveGrant!: (grant: string) => void;
  let rejectGrant!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveGrant = resolve;
    rejectGrant = reject;
  });
  void result.catch(() => undefined);
  const finish = (error?: Error, grant?: string) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (error) rejectGrant(error);
    else resolveGrant(grant!);
  };
  const server = createServer(async (request, reply) => {
    if (
      request.socket.remoteAddress !== "127.0.0.1" &&
      request.socket.remoteAddress !== "::1"
    ) {
      respond(reply, 403, "Loopback callback required.");
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method !== "POST" || pathname !== "/callback") {
      respond(reply, 405, "The Analysis CLI callback accepts one POST.");
      return;
    }
    try {
      const body = await callbackBody(request);
      if (body.get("state") !== state) {
        respond(reply, 400, "The authorization response was invalid.");
        return;
      }
      const grant = body.get("grant");
      if (!grant || !/^analysis_grant_[A-Za-z0-9_-]{16,256}$/.test(grant)) {
        respond(reply, 400, "The authorization response was invalid.");
        finish(new Error("BROWSER_AUTH_RESPONSE_INVALID"));
        return;
      }
      respond(reply, 200, "Authorization received. You may close this tab.");
      finish(undefined, grant);
    } catch (error) {
      respond(reply, 400, "The authorization response could not be read.");
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("BROWSER_AUTH_CALLBACK_UNAVAILABLE");
    }
    callbackUrl = `http://127.0.0.1:${address.port}/callback`;
    const authorizationUrl = new URL(
      "/api/v1/analysis-credential/authorize",
      options.serverUrl,
    );
    authorizationUrl.searchParams.set("name", options.name);
    authorizationUrl.searchParams.set("callback", callbackUrl);
    authorizationUrl.searchParams.set("state", state);
    timer = setTimeout(() => finish(new Error("BROWSER_AUTH_TIMEOUT")), timeoutMs);
    options.signal?.addEventListener(
      "abort",
      () => finish(new Error("BROWSER_AUTH_ABORTED")),
      { once: true },
    );
    await (options.openBrowser ?? defaultOpenBrowser)(authorizationUrl.toString());
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
  try {
    return await result;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
