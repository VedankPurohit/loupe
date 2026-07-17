import { z } from "zod";

export const browserSessionCookieName = "browser_session";
export const browserSessionSecuritySchemeName = "browserSession";
export const browserSessionOpenApiSecurityScheme = {
  type: "apiKey",
  in: "cookie",
  name: browserSessionCookieName,
} as const;
export const browserSessionOpenApiSecurity = [
  { [browserSessionSecuritySchemeName]: [] },
];
export const deviceCredentialSecuritySchemeName = "deviceCredential";
export const deviceCredentialOpenApiSecurityScheme = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Device credential",
} as const;
export const deviceCredentialOpenApiSecurity = [
  { [deviceCredentialSecuritySchemeName]: [] },
];

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok"),
  apiVersion: z.literal("v1"),
});

export const OrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

export const OrganizationMemberSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: z.enum(["member", "administrator"]),
});

export const BootstrapStatusResponseSchema = z.object({
  required: z.boolean(),
});

export const BootstrapRedeemRequestSchema = z.object({
  code: z.string().min(1),
  organization: z.object({ name: z.string().trim().min(1).max(120) }),
  administrator: z.object({ displayName: z.string().trim().min(1).max(120) }),
});

export const AuthenticatedSessionResponseSchema = z.object({
  organization: OrganizationSchema,
  member: OrganizationMemberSchema,
});

export const InviteCodeRequestSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).optional(),
});
export const InviteCodeResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export const InviteCodeRedeemRequestSchema = z.object({
  code: z.string().min(1),
  member: z.object({ displayName: z.string().trim().min(1).max(120) }),
});

export const CapturePolicySchema = z.object({
  version: z.number().int().positive(),
  ordinaryRedactionEnabled: z.boolean(),
  demoCanaryEnabled: z.boolean(),
});

export const EnrolledDeviceSchema = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  name: z.string(),
  health: z.enum(["healthy", "revoked"]),
  lastSeenAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  capturePolicy: CapturePolicySchema,
});

export const DeviceEnrollmentGrantRequestSchema = z.object({
  deviceName: z.string().trim().min(1).max(120),
});

export const DeviceEnrollmentGrantResponseSchema = z.object({
  grant: z.string(),
  expiresAt: z.iso.datetime(),
});

export const DeviceEnrollmentRedeemRequestSchema = z.object({
  grant: z.string().min(1),
});

export const DeviceEnrollmentResponseSchema = z.object({
  credential: z.string(),
  device: EnrolledDeviceSchema,
});

export const DeviceCapturePolicyResponseSchema = CapturePolicySchema;
export const DeviceHealthResponseSchema = z.object({
  deviceId: z.uuid(),
  status: z.literal("healthy"),
  lastSeenAt: z.iso.datetime(),
  policyVersion: z.number().int().positive(),
});
export const EnrolledDevicesResponseSchema = z.object({
  devices: z.array(EnrolledDeviceSchema),
});
export const DeviceIdParamsSchema = z.object({ id: z.uuid() });
export const UpdateDeviceCapturePolicyRequestSchema = z
  .object({
    ordinaryRedactionEnabled: z.boolean().optional(),
    demoCanaryEnabled: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.ordinaryRedactionEnabled !== undefined ||
      value.demoCanaryEnabled !== undefined,
    { message: "At least one capture-policy setting is required." },
  );

export const RedactionEvidenceSchema = z.object({
  type: z.string().min(1),
  fingerprint: z.string().regex(/^sha256-hmac:[A-Za-z0-9_-]{43}$/),
  rule: z.string().min(1),
  sourceLocation: z.object({
    path: z.string().min(1),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  }),
});
export const CaptureRecordSchema = z.object({
  id: z.uuid(),
  source: z.enum(["prompt", "tool_input", "tool_output"]),
  content: z.string(),
  sourcePath: z.string().min(1),
  capturedAt: z.iso.datetime(),
  policyVersion: z.number().int().positive(),
  redactions: z.array(RedactionEvidenceSchema),
});
export const CaptureRecordAcceptedResponseSchema = z.object({
  id: z.uuid(),
  accepted: z.literal(true),
});
export const CaptureRecordIdParamsSchema = z.object({ id: z.uuid() });

export const GitContextObservationSchema = z.object({
  status: z.enum([
    "available",
    "not_repository",
    "inspection_failed",
    "unavailable",
  ]),
  repositoryRoot: z.string().min(1).nullable(),
  remoteIdentity: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  detached: z.boolean().nullable(),
  worktree: z.string().min(1).nullable(),
  commit: z.string().regex(/^[0-9a-f]{40,64}$/).nullable(),
  sampledAt: z.iso.datetime(),
  provenance: z.object({
    source: z.literal("relay_local_git"),
    evidence: z.literal("local_observation"),
    stability: z.literal("observed"),
    derivation: z.literal("exact"),
    cwd: z.string().min(1),
  }),
  reason: z
    .enum([
      "cwd_is_not_a_git_repository",
      "git_inspection_failed",
      "git_command_unavailable",
    ])
    .nullable(),
});

export const SourceEventSchema = z.object({
  schemaVersion: z.literal("1"),
  id: z.uuid(),
  deduplicationKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  source: z.enum([
    "codex_hook",
    "codex_otel_log",
    "codex_otel_trace",
    "codex_rollout",
  ]),
  producer: z.object({
    name: z.literal("codex"),
    version: z.string().min(1),
    event: z.string().min(1),
  }),
  parser: z.object({ name: z.string().min(1), version: z.string().min(1) }),
  occurredAt: z.iso.datetime(),
  capturedAt: z.iso.datetime(),
  capturePath: z.string().min(1),
  rawPayload: z.record(z.string(), z.unknown()),
  canonicalObservations: z.array(z.unknown()),
  adapter: z.object({
    status: z.enum(["adapted", "preserved", "downgraded", "rejected"]),
    reason: z.string().min(1).optional(),
    capabilities: z.record(z.string(), z.unknown()),
  }),
  redaction: z.object({
    policyVersion: z.number().int().positive(),
    applied: z.boolean(),
    evidence: z.array(RedactionEvidenceSchema),
  }),
  gitContext: GitContextObservationSchema.optional(),
});

// Events stay unknown at the batch boundary so one malformed/unsupported
// event can receive an explicit permanent rejection without poisoning peers.
export const SourceEventBatchRequestSchema = z.object({
  batchId: z.uuid(),
  events: z.array(z.unknown()).min(1).max(100),
});
export const SourceEventBatchResultSchema = z.object({
  eventId: z.string().min(1),
  status: z.enum(["accepted", "duplicate", "rejected"]),
  code: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  message: z.string().min(1).optional(),
});
export const SourceEventBatchResponseSchema = z.object({
  batchId: z.uuid(),
  results: z.array(SourceEventBatchResultSchema),
});
export const SourceEventIdParamsSchema = z.object({ id: z.uuid() });
export const RetainedSourceEventSchema = SourceEventSchema.extend({
  receivedAt: z.iso.datetime(),
  delivery: z.object({ deviceId: z.uuid(), batchId: z.uuid() }),
});

export const EvidenceSchema = z.object({
  stability: z.array(
    z.enum(["documented", "observed", "inferred", "unstable", "unavailable"]),
  ),
  derivation: z.enum(["exact", "inferred", "unavailable"]),
  sourceEventIds: z.array(z.uuid()),
});

export const ReconciliationInputSchema = z.object({
  sourceEventId: z.uuid(),
  source: z.string().min(1),
  observedValue: z.string().nullable(),
  stability: z.enum(["documented", "observed", "unstable"]),
  derivation: z.enum(["exact", "inferred"]),
  confidence: z.enum(["high", "medium", "low"]),
});

export const ReconciliationSchema = z.object({
  inputs: z.array(ReconciliationInputSchema),
  rule: z.string().min(1),
  selectedValue: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low", "none"]),
});

export const ActivityEpisodeSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["startup", "resume", "clear", "compact", "observed"]),
  state: z.enum(["live", "idle", "resumed"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  sourceEventId: z.uuid(),
});

export const TurnSchema = z.object({
  id: z.string().min(1),
  agentRunId: z.string().min(1),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  evidence: EvidenceSchema,
});

export const ParentEdgeSchema = z.object({
  status: z.enum(["exact", "inferred", "unresolved"]),
  parentAgentRunId: z.string().nullable(),
  reconciliation: ReconciliationSchema,
});

export const AgentRunSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["root", "subagent"]),
  codexThreadId: z.string().nullable(),
  agentType: z.string().nullable(),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  identityEvidence: EvidenceSchema,
  parentEdge: ParentEdgeSchema.nullable(),
});

export const ExecutionSessionSchema = z.object({
  id: z.string().min(1),
  owner: z.object({ memberId: z.uuid(), deviceId: z.uuid() }),
  gitContext: GitContextObservationSchema.nullable(),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  activityState: z.enum(["live", "idle", "resumed"]),
  completion: z.object({
    status: z.literal("not_assumed"),
    evidence: z.literal("unavailable"),
  }),
  rootAgentRunId: z.string().min(1),
  projectionVersion: z.literal("1"),
  ownershipReconciliation: ReconciliationSchema,
});

export const ExecutionSessionsResponseSchema = z.object({
  sessions: z.array(ExecutionSessionSchema),
});
export const ExecutionSessionIdParamsSchema = z.object({ id: z.string().min(1) });
export const TimelineEventSchema = z.object({
  sourceEventId: z.uuid(),
  event: z.string().min(1),
  occurredAt: z.iso.datetime(),
  turnId: z.string().nullable(),
  agentRunId: z.string().nullable(),
  evidence: EvidenceSchema,
});
export const ExecutionSessionDetailResponseSchema = z.object({
  session: ExecutionSessionSchema,
  activities: z.array(ActivityEpisodeSchema),
  turns: z.array(TurnSchema),
  agentRuns: z.array(AgentRunSchema),
  timeline: z.array(TimelineEventSchema),
});

export const LiveExecutionEventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.literal("session.updated"),
  sessionId: z.string().min(1),
  occurredAt: z.iso.datetime(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type BootstrapRedeemRequest = z.infer<typeof BootstrapRedeemRequestSchema>;
export type AuthenticatedSessionResponse = z.infer<
  typeof AuthenticatedSessionResponseSchema
>;
export type InviteCodeRequest = z.infer<typeof InviteCodeRequestSchema>;
export type InviteCodeResponse = z.infer<typeof InviteCodeResponseSchema>;
export type InviteCodeRedeemRequest = z.infer<
  typeof InviteCodeRedeemRequestSchema
>;
export type CapturePolicy = z.infer<typeof CapturePolicySchema>;
export type EnrolledDevice = z.infer<typeof EnrolledDeviceSchema>;
export type DeviceEnrollmentGrantRequest = z.infer<
  typeof DeviceEnrollmentGrantRequestSchema
>;
export type DeviceEnrollmentGrantResponse = z.infer<
  typeof DeviceEnrollmentGrantResponseSchema
>;
export type DeviceEnrollmentRedeemRequest = z.infer<
  typeof DeviceEnrollmentRedeemRequestSchema
>;
export type DeviceEnrollmentResponse = z.infer<
  typeof DeviceEnrollmentResponseSchema
>;
export type UpdateDeviceCapturePolicyRequest = z.infer<
  typeof UpdateDeviceCapturePolicyRequestSchema
>;
export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;
export type GitContextObservation = z.infer<
  typeof GitContextObservationSchema
>;
export type SourceEvent = z.infer<typeof SourceEventSchema>;
export type SourceEventBatchResult = z.infer<typeof SourceEventBatchResultSchema>;
export type SourceEventBatchResponse = z.infer<
  typeof SourceEventBatchResponseSchema
>;
export type RetainedSourceEvent = z.infer<typeof RetainedSourceEventSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
export type ActivityEpisode = z.infer<typeof ActivityEpisodeSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
export type ExecutionSessionDetail = z.infer<
  typeof ExecutionSessionDetailResponseSchema
>;
export type LiveExecutionEvent = z.infer<typeof LiveExecutionEventSchema>;
