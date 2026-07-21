import { describe, expect, it } from "vitest";

import {
  authorizeDeviceDisconnect,
  authorizeDeviceEnrollment,
} from "../src/browser-authorization.js";

describe("browser-authorized Device enrollment", () => {
  it("opens one server URL and accepts a single-use grant through loopback POST without a cookie", async () => {
    let opened = "";
    const result = await authorizeDeviceEnrollment({
      serverUrl: "http://127.0.0.1:3000",
      deviceName: "Test Mac",
      timeoutMs: 2_000,
      openBrowser: async (url) => {
        opened = url;
        const parsed = new URL(url);
        const callback = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const response = await fetch(callback, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            state,
            grant: "enroll_test_lookup_test_secret_1234567890123456789012345678901234567890123",
          }),
        });
        expect(response.status).toBe(200);
      },
    });

    expect(new URL(opened).pathname).toBe("/api/v1/device-enrollment/authorize");
    expect(new URL(opened).searchParams.get("deviceName")).toBe("Test Mac");
    expect(result.grant).toMatch(/^enroll_/);
    expect(result.state).toHaveLength(32);
    expect(result.callbackUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
  });

  it("ignores a forged callback and still accepts the valid browser hand-off", async () => {
    const result = await authorizeDeviceEnrollment({
      serverUrl: "http://127.0.0.1:3000",
      deviceName: "Test Mac",
      timeoutMs: 2_000,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callback = parsed.searchParams.get("callback")!;
        const forged = await fetch(callback, {
          method: "POST",
          body: new URLSearchParams({
            state: "wrong-state-which-is-long-enough",
            grant: "enroll_test_lookup_test_secret_1234567890123456789012345678901234567890123",
          }),
        });
        expect(forged.status).toBe(400);
        const valid = await fetch(callback, {
          method: "POST",
          body: new URLSearchParams({
            state: parsed.searchParams.get("state")!,
            grant: "enroll_test_lookup_test_secret_1234567890123456789012345678901234567890123",
          }),
        });
        expect(valid.status).toBe(200);
      },
    });
    expect(result.grant).toMatch(/^enroll_/);
  });

  it("does not open a browser when setup was already interrupted", async () => {
    const controller = new AbortController();
    controller.abort();
    let opened = false;
    await expect(
      authorizeDeviceEnrollment({
        serverUrl: "http://127.0.0.1:3000",
        deviceName: "Test Mac",
        signal: controller.signal,
        openBrowser: async () => {
          opened = true;
        },
      }),
    ).rejects.toThrow("BROWSER_AUTH_ABORTED");
    expect(opened).toBe(false);
  });

  it("requires the expected completion status for browser-authorized actions", async () => {
    await expect(
      authorizeDeviceDisconnect({
        serverUrl: "http://127.0.0.1:3000",
        deviceId: "11111111-1111-4111-8111-111111111111",
        timeoutMs: 2_000,
        openBrowser: async (url) => {
          const parsed = new URL(url);
          await fetch(parsed.searchParams.get("callback")!, {
            method: "POST",
            body: new URLSearchParams({
              state: parsed.searchParams.get("state")!,
              status: "not-revoked",
            }),
          });
        },
      }),
    ).rejects.toThrow("BROWSER_AUTH_RESPONSE_INVALID");
  });
});
