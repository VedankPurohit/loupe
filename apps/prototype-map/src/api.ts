import type {
  ComparisonRequest,
  ComparisonResponse,
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(
      body?.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }
  return response.json() as Promise<T>;
}

export function loadOrganizationActivity(query: string) {
  const parameters = new URLSearchParams({ pageSize: "40" });
  if (query.trim()) parameters.set("q", query.trim());
  return requestJson<OrganizationActivityResponse>(
    `/api/v1/organization/activity?${parameters.toString()}`,
  );
}

export function loadSessionDetail(id: string) {
  return requestJson<ExecutionSessionDetail>(
    `/api/v1/sessions/${encodeURIComponent(id)}`,
  );
}

export function compareEvidence(body: ComparisonRequest) {
  return requestJson<ComparisonResponse>("/api/v1/comparisons", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
