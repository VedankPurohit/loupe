import type {
  ComparisonRequest,
  ComparisonResponse,
  ExecutionSessionDetail,
  OrganizationActivityResponse,
} from "@workspace/contracts";

type ApiErrorBody = { error?: { code?: string; message?: string } };

export class NotebookApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function read<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json().catch(() => undefined)) as
    | T
    | ApiErrorBody
    | undefined;
  if (!response.ok) {
    const error = body as ApiErrorBody | undefined;
    throw new NotebookApiError(
      error?.error?.message ?? `The evidence API returned ${response.status}.`,
      response.status,
      error?.error?.code,
    );
  }
  return body as T;
}

export async function searchOrganization(
  query: string,
): Promise<OrganizationActivityResponse> {
  const parameters = new URLSearchParams();
  if (query.trim()) parameters.set("q", query.trim());
  return read(`/api/v1/organization/activity?${parameters.toString()}`);
}

export async function readSession(id: string): Promise<ExecutionSessionDetail> {
  return read(`/api/v1/sessions/${encodeURIComponent(id)}`);
}

export async function compareCases(
  request: ComparisonRequest,
): Promise<ComparisonResponse> {
  return read("/api/v1/comparisons", {
    method: "POST",
    body: JSON.stringify(request),
  });
}
