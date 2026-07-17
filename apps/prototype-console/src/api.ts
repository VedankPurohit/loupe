import type { ActivityResponse, ComparisonResponse, SearchFilters, SessionDetail } from "./types";

type ApiErrorEnvelope = { error?: { code?: string; message?: string } };

export class LoupeApi {
  constructor(private readonly baseUrl: string) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      credentials: "include",
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorEnvelope;
      const code = body.error?.code ? `${body.error.code}: ` : "";
      throw new Error(`${code}${body.error?.message ?? `Request failed (${response.status})`}`);
    }
    return response.json() as Promise<T>;
  }

  search(filters: SearchFilters): Promise<ActivityResponse> {
    const query = new URLSearchParams({ pageSize: "50" });
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === "boolean") {
        if (value) query.set(key, "true");
      } else if (value) query.set(key, value);
    }
    return this.request(`/api/v1/organization/activity?${query}`);
  }

  session(id: string): Promise<SessionDetail> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  compare(sessionIds: string[], statement: string, includeSeeded: boolean): Promise<ComparisonResponse> {
    return this.request("/api/v1/comparisons", {
      method: "POST",
      body: JSON.stringify({
        selections: sessionIds.map((sessionId) => ({ scope: "session", sessionId })),
        filters: {},
        includeSeeded,
        claim: {
          kind: "pattern",
          statement,
          signals: ["human_session_outcome", "token_usage", "duration", "tool_count", "model_choice"],
        },
      }),
    });
  }
}
