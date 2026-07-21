import { z } from "zod";

import {
  OrganizationMemberSchema,
  OrganizationSchema,
  PersonSchema,
} from "./identity.js";

export * from "./identity.js";
export * from "./google-auth.js";

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
export const analysisCredentialSecuritySchemeName = "analysisCredential";
export const analysisCredentialOpenApiSecurityScheme = {
  type: "http",
  scheme: "bearer",
  bearerFormat: "Analysis credential",
} as const;
export const analysisCredentialOpenApiSecurity = [
  { [analysisCredentialSecuritySchemeName]: [] },
];
export const browserOrAnalysisOpenApiSecurity = [
  ...browserSessionOpenApiSecurity,
  ...analysisCredentialOpenApiSecurity,
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

export const AnalysisCredentialScopeSchema = z.enum([
  "organization:evidence:read",
  "candidate:submit",
]);
export const AnalysisCredentialSchema = z.object({
  id: z.uuid(),
  memberId: z.uuid(),
  name: z.string().min(1),
  scopes: z.array(AnalysisCredentialScopeSchema).length(2),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export const AnalysisCredentialCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});
export const AnalysisCredentialCreateResponseSchema = z.object({
  credential: z.string().regex(/^analysis_[A-Za-z0-9_-]{43}$/),
  analysisCredential: AnalysisCredentialSchema,
});
export const AnalysisCredentialAuthorizationQuerySchema = z.object({
  name: z.string().trim().min(1).max(120),
  callback: z.string().url(),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});
export const AnalysisCredentialGrantResponseSchema = z.object({
  grant: z.string().regex(/^analysis_grant_[A-Za-z0-9_-]{16,256}$/),
  expiresAt: z.iso.datetime(),
});
export const AnalysisCredentialGrantRedeemRequestSchema = z.object({
  grant: z.string().min(1),
});
export const AnalysisCredentialsResponseSchema = z.object({
  analysisCredentials: z.array(AnalysisCredentialSchema),
});
export const AnalysisCredentialIdParamsSchema = z.object({ id: z.uuid() });

export const BootstrapStatusResponseSchema = z.object({
  required: z.boolean(),
});

export const BootstrapRedeemRequestSchema = z.object({
  code: z.string().min(1),
  organization: z.object({ name: z.string().trim().min(1).max(120) }),
  administrator: z.object({ displayName: z.string().trim().min(1).max(120) }),
});

export const AuthenticatedSessionResponseSchema = z.object({
  person: PersonSchema,
  organization: OrganizationSchema,
  member: OrganizationMemberSchema,
});

export const AnalysisCredentialStatusResponseSchema =
  AuthenticatedSessionResponseSchema.extend({
    analysisCredential: AnalysisCredentialSchema,
  });

export const PersonBrowserSessionResponseSchema = z.object({
  person: PersonSchema,
  organization: OrganizationSchema.nullable(),
  member: OrganizationMemberSchema.nullable(),
});
export type PersonBrowserSessionResponse = z.infer<
  typeof PersonBrowserSessionResponseSchema
>;

export const InviteCodeRequestSchema = z.object({
  expiresInHours: z.number().int().min(1).max(168).optional(),
});
export const InviteCodeResponseSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  expiresAt: z.iso.datetime(),
  role: z.literal("member"),
});
export const InviteCodeIdParamsSchema = z.object({ id: z.uuid() });
export const InviteCodeRedeemRequestSchema = z.object({
  code: z.string().min(1),
  member: z
    .object({ displayName: z.string().trim().min(1).max(120) })
    .optional(),
});

export const ActiveMembershipSelectionRequestSchema = z.object({
  membershipId: z.uuid(),
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

/**
 * Browser-authorized installer hand-off.  The callback is always a loopback
 * HTTP endpoint owned by the installer; the browser contributes its existing
 * HttpOnly Loupe session cookie, never the installer.
 */
export const DeviceEnrollmentAuthorizationQuerySchema = z.object({
  deviceName: z.string().trim().min(1).max(120),
  callback: z.string().url(),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
});

export const DeviceDisconnectAuthorizationQuerySchema = z.object({
  deviceId: z.uuid(),
  callback: z.string().url(),
  state: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
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

export const StructuralCaptureLedgerQuerySchema = z
  .object({
    sessionId: z.string().min(1).optional(),
    receivedFrom: z.iso.datetime().optional(),
    receivedTo: z.iso.datetime().optional(),
    cursor: z.string().regex(/^[A-Za-z0-9_-]+$/).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .superRefine((query, context) => {
    const sessionScope = query.sessionId !== undefined;
    const windowScope =
      query.receivedFrom !== undefined && query.receivedTo !== undefined;
    if (sessionScope === windowScope) {
      context.addIssue({
        code: "custom",
        message: "Select exactly one Session or one bounded receipt-time window.",
      });
    }
    if (
      windowScope &&
      new Date(query.receivedFrom!).getTime() > new Date(query.receivedTo!).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "The receipt-time window start must not follow its end.",
      });
    }
  });

export const StructuralCaptureLedgerResponseSchema = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("session"), sessionId: z.string().min(1) }),
    z.object({
      kind: z.literal("receipt_window"),
      receivedFrom: z.iso.datetime(),
      receivedTo: z.iso.datetime(),
    }),
  ]),
  observations: z.array(
    z.object({
      observationId: z.uuid(),
      sourceEventId: z.uuid().nullable(),
      sourceFamily: z.string().min(1).nullable(),
      producerVersion: z.string().min(1).nullable(),
      eventName: z.string().min(1).nullable(),
      sourceIdentity: z.string().min(1).nullable(),
      payloadHash: z.string().min(1).nullable(),
      occurredAt: z.iso.datetime().nullable(),
      receivedAt: z.iso.datetime(),
      acceptance: z.object({
        disposition: z.enum(["accepted", "duplicate", "rejected"]),
        code: z.string().min(1).nullable(),
      }),
      adapter: z.object({
        disposition: z.enum([
          "adapted",
          "preserved",
          "downgraded",
          "rejected",
          "unavailable",
        ]),
        reason: z.string().min(1).nullable(),
      }),
      fieldPresence: z.object({
        sessionIdentity: z.boolean(),
        turnIdentity: z.boolean(),
        traceIdentity: z.boolean(),
        gitContext: z.boolean(),
        canonicalObservations: z.boolean(),
      }),
      projectionReferences: z.object({
        sessions: z.array(z.string()),
        turns: z.array(z.string()),
        agentRuns: z.array(z.string()),
        activityEpisodes: z.array(z.string()),
        timeline: z.array(z.string()),
      }),
    }),
  ),
  nextCursor: z.string().nullable(),
});

export const EvidenceReferenceSchema = z.discriminatedUnion("origin", [
  z.object({
    origin: z.literal("captured_source_event"),
    sourceEventId: z.uuid(),
  }),
  z.object({
    origin: z.literal("example_pack_server_controlled"),
    examplePackVersion: z.string().min(1),
    syntheticEvidenceId: z.uuid(),
  }),
]);

export const EvidenceSchema = z
  .object({
    stability: z.array(
      z.enum(["documented", "observed", "inferred", "unstable", "unavailable"]),
    ),
    derivation: z.enum(["exact", "inferred", "unavailable"]),
    sourceEventIds: z.array(z.uuid()),
    references: z.array(EvidenceReferenceSchema).optional(),
  })
  .superRefine((e, ctx) => {
    const synthetic =
      e.references?.filter(
        (reference) => reference.origin === "example_pack_server_controlled",
      ) ?? [];
    const captured =
      e.references?.filter(
        (reference) => reference.origin === "captured_source_event",
      ) ?? [];
    if (synthetic.length && (e.sourceEventIds.length || captured.length)) {
      ctx.addIssue({
        code: "custom",
        path: ["references"],
        message: "Example-pack evidence cannot reference captured Source events.",
      });
    }
    for (const reference of captured) {
      if (!e.sourceEventIds.includes(reference.sourceEventId)) {
        ctx.addIssue({
          code: "custom",
          path: ["references"],
          message: "Captured references must match sourceEventIds.",
        });
      }
    }
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

export const ActivityEpisodeSchema = z
  .object({
    id: z.string().min(1),
    source: z.enum(["startup", "resume", "clear", "compact", "observed"]),
    state: z.enum(["live", "idle", "resumed"]),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    sourceEventId: z.uuid().nullable(),
    reference: EvidenceReferenceSchema.optional(),
  })
  .superRefine((row, ctx) => {
    if (
      row.sourceEventId === null &&
      row.reference?.origin !== "example_pack_server_controlled"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message:
          "A Source-event-free row requires server-controlled Example-pack provenance.",
      });
    }
    if (
      row.sourceEventId !== null &&
      row.reference?.origin === "example_pack_server_controlled"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Example-pack provenance cannot carry a Source-event id.",
      });
    }
    if (
      row.reference?.origin === "captured_source_event" &&
      row.reference.sourceEventId !== row.sourceEventId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Captured reference must match sourceEventId.",
      });
    }
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
  owner: z.object({ memberId: z.uuid(), deviceId: z.uuid().nullable() }),
  ownerProfile: z.object({ displayName: z.string(), isExample: z.boolean() }),
  gitContext: GitContextObservationSchema.nullable(),
  firstObservedAt: z.iso.datetime(),
  lastObservedAt: z.iso.datetime(),
  activityState: z.enum(["live", "idle", "resumed"]),
  completion: z.object({
    status: z.literal("not_assumed"),
    evidence: z.literal("unavailable"),
  }),
  rootAgentRunId: z.string().min(1),
  // Named projection versions evolve when source events are reprojected;
  // consumers must tolerate values beyond the current "1".
  projectionVersion: z.string().min(1).max(32),
  ownershipReconciliation: ReconciliationSchema,
  annotations: z.object({
    outcome: z.enum(["successful", "partial", "failed", "unknown"]),
    reviewStatus: z.enum(["exemplar", "needs_help", "ordinary"]),
    tags: z.array(z.string()),
    updatedAt: z.iso.datetime().nullable(),
  }),
  synthetic: z.object({
    kind: z.enum(["real", "seeded"]),
    examplePackVersion: z.string().nullable(),
  }),
  deepLink: z.string().min(1),
});

export const ExecutionSessionsResponseSchema = z.object({
  sessions: z.array(ExecutionSessionSchema),
});
export const ExecutionSessionIdParamsSchema = z.object({ id: z.string().min(1) });
export const TimelineEventSchema = z
  .object({
    sourceEventId: z.uuid().nullable(),
    reference: EvidenceReferenceSchema.optional(),
    event: z.string().min(1),
    occurredAt: z.iso.datetime(),
    turnId: z.string().nullable(),
    agentRunId: z.string().nullable(),
    evidence: EvidenceSchema,
  })
  .superRefine((row, ctx) => {
    if (
      row.sourceEventId === null &&
      row.reference?.origin !== "example_pack_server_controlled"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message:
          "A Source-event-free row requires server-controlled Example-pack provenance.",
      });
    }
    if (
      row.sourceEventId !== null &&
      row.reference?.origin === "example_pack_server_controlled"
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Example-pack provenance cannot carry a Source-event id.",
      });
    }
    if (
      row.reference?.origin === "captured_source_event" &&
      row.reference.sourceEventId !== row.sourceEventId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Captured reference must match sourceEventId.",
      });
    }
  });

export const TurnAssociationSchema = z.object({
  turnId: z.string().nullable(),
  strength: z.enum(["exact", "exact_unstable", "inferred", "unavailable"]),
  method: z.string().min(1),
});

export const ToolEvidenceSchema = z.object({
  id: z.string().min(1),
  toolName: z.string().min(1),
  occurredAt: z.iso.datetime(),
  identifiers: z.object({
    hookToolUseId: z.string().nullable(),
    otelCallId: z.string().nullable(),
  }),
  input: z.unknown().nullable(),
  result: z.unknown().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  outcome: z.enum(["success", "failure", "unknown"]),
  approval: z.enum(["approved", "denied", "requested", "unavailable"]),
  retryCount: z.number().int().nonnegative().nullable(),
  turnAssociation: TurnAssociationSchema,
  evidence: EvidenceSchema,
  coverageGaps: z.array(z.string()),
});

export const LifecycleEvidenceSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["compaction", "resume", "fork", "skill", "mcp"]),
  event: z.string().min(1),
  occurredAt: z.iso.datetime(),
  details: z.record(z.string(), z.unknown()),
  turnAssociation: TurnAssociationSchema,
  evidence: EvidenceSchema,
});

export const TokenUsageCategoriesSchema = z.object({
  input: z.number().int().nonnegative().nullable(),
  cachedInput: z.number().int().nonnegative().nullable(),
  output: z.number().int().nonnegative().nullable(),
  reasoningOutput: z.number().int().nonnegative().nullable(),
  total: z.number().int().nonnegative().nullable(),
});

export const TokenUsageSampleSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime(),
  sourceKind: z.enum(["provider_completion", "turn_total"]),
  model: z.string().nullable(),
  serviceTier: z.string().nullable(),
  categories: TokenUsageCategoriesSchema,
  turnAssociation: TurnAssociationSchema,
  evidence: EvidenceSchema,
});

export const ApiRequestEvidenceSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime(),
  attempt: z.number().int().nonnegative().nullable(),
  statusCode: z.number().int().nonnegative().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  success: z.boolean().nullable(),
  error: z.string().nullable(),
  turnAssociation: TurnAssociationSchema,
  evidence: EvidenceSchema,
});

export const ContextLimitSchema = z.object({
  model: z.string().nullable(),
  contextWindow: z.number().int().positive().nullable(),
  autoCompactionLimit: z.number().int().positive().nullable(),
  evidence: EvidenceSchema,
});

export const ContextOccupancySchema = z.object({
  tokenUsageId: z.string().min(1),
  occupancyTokens: z.number().int().nonnegative(),
  occupancyPercent: z.number().nonnegative().nullable(),
  method: z.literal("provider_input_tokens_over_reported_context_window"),
  inputs: z.object({
    inputTokens: z.number().int().nonnegative(),
    contextWindow: z.number().int().positive().nullable(),
  }),
  missingAssumptions: z.array(z.string()),
  evidence: EvidenceSchema,
});

export const ContextEvidenceSchema = z.object({
  limits: z.array(ContextLimitSchema),
  occupancy: z.array(ContextOccupancySchema),
  firstRequestBaseline: ContextOccupancySchema.nullable(),
  contribution: z.object({
    status: z.enum(["estimated", "unavailable"]),
    method: z.string().min(1),
    note: z.string().min(1),
    evidence: EvidenceSchema,
  }),
});

export const CostEstimateSchema = z.object({
  tokenUsageId: z.string().min(1),
  status: z.enum(["estimated", "unavailable"]),
  amount: z.number().nonnegative().nullable(),
  currency: z.string().min(1).nullable(),
  effectiveDate: z.string().min(1).nullable(),
  priceTableVersion: z.string().min(1).nullable(),
  modelMapping: z.object({
    observedModel: z.string().nullable(),
    pricedModel: z.string().nullable(),
  }),
  inputs: z.object({
    uncachedInputTokens: z.number().int().nonnegative().nullable(),
    cachedInputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    reasoningOutputTokens: z.number().int().nonnegative().nullable(),
  }),
  billingCaveat: z.string().min(1),
  reason: z.string().min(1).nullable(),
  evidence: EvidenceSchema.optional(),
});

export const CapabilityEvidenceSchema = z.object({
  capability: z.enum([
    "explicit_skill_mention",
    "implicit_skill_activation",
    "configured_mcp_servers",
    "observed_mcp_use",
    "complete_passive_capability_snapshot",
    "fork",
  ]),
  state: z.enum(["observed", "inferred", "conditional", "unavailable"]),
  note: z.string().min(1),
  evidence: EvidenceSchema,
});

export const RichSessionEvidenceSchema = z.object({
  tools: z.array(ToolEvidenceSchema),
  lifecycle: z.array(LifecycleEvidenceSchema),
  apiRequests: z.array(ApiRequestEvidenceSchema),
  tokenUsage: z.array(TokenUsageSampleSchema),
  context: ContextEvidenceSchema,
  costEstimates: z.array(CostEstimateSchema),
  capabilities: z.array(CapabilityEvidenceSchema),
});

export const ExecutionSessionDetailResponseSchema = z.object({
  session: ExecutionSessionSchema,
  activities: z.array(ActivityEpisodeSchema),
  turns: z.array(TurnSchema),
  agentRuns: z.array(AgentRunSchema),
  timeline: z.array(TimelineEventSchema),
  evidence: RichSessionEvidenceSchema,
});

export const ComparisonSelectionSchema = z.discriminatedUnion("scope", [
  z.object({
    scope: z.literal("session"),
    sessionId: z.string().min(1),
  }),
  z.object({
    scope: z.literal("turn"),
    sessionId: z.string().min(1),
    turnId: z.string().min(1),
  }),
]);

export const ComparisonFiltersSchema = z.object({
  q: z.string().trim().min(1).max(240).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  memberId: z.uuid().optional(),
  repository: z.string().trim().min(1).max(240).optional(),
  activityState: z.enum(["live", "idle", "resumed"]).optional(),
  outcome: z.enum(["successful", "partial", "failed", "unknown"]).optional(),
  reviewStatus: z.enum(["exemplar", "needs_help", "ordinary"]).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  tool: z.string().trim().min(1).max(120).optional(),
  capability: z.string().trim().min(1).max(120).optional(),
  error: z.string().trim().min(1).max(240).optional(),
});

export const ComparisonClaimSchema = z.object({
  kind: z.enum(["pattern", "outcome", "causal", "productivity"]),
  statement: z.string().trim().min(1).max(1_000),
  signals: z
    .array(
      z.enum([
        "human_session_outcome",
        "token_usage",
        "cost",
        "duration",
        "tool_count",
        "model_choice",
        "correlation",
      ]),
    )
    .default([]),
});

export const ComparisonRequestSchema = z.object({
  selections: z.array(ComparisonSelectionSchema).min(1).max(50),
  filters: ComparisonFiltersSchema.default({}),
  includeSeeded: z.boolean().default(false),
  claim: ComparisonClaimSchema,
});

export const EvidenceCitationSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  activityId: z.uuid(),
  synthetic: z.enum(["real", "seeded"]),
  evidence: EvidenceSchema,
  links: z.object({
    session: z.string().min(1),
    turn: z.string().min(1),
    activity: z.string().min(1),
    browser: z.string().min(1),
  }),
});

export const CandidatePackageFileSchema = z.object({
  path: z.string().trim().min(1).max(240),
  content: z.string().max(1_000_000),
});
export const CandidatePackageSchema = z.object({
  files: z.array(CandidatePackageFileSchema).max(100),
});
export const CandidateClaimSchema = z.object({
  id: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(1).max(2_000),
  classification: z
    .enum(["repeated_pattern", "single_case_hypothesis", "descriptive"])
    .default("descriptive"),
  citationIds: z.array(z.string().trim().min(1).max(120)).max(100),
});
export const CandidateCitationInputSchema = z.object({
  id: z.string().trim().min(1).max(120),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  activityId: z.uuid(),
});
export const CandidateSubmissionRequestSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    .max(80),
  reviewerContext: z.string().trim().min(1).max(10_000),
  uncertainty: z.object({
    level: z.enum(["low", "medium", "high"]),
    statement: z.string().trim().min(1).max(4_000),
  }),
  claims: z.array(CandidateClaimSchema).min(1).max(100),
  citations: z.array(CandidateCitationInputSchema).max(500),
  package: CandidatePackageSchema,
  artifactHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export const CandidateSkillSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(["pending_review", "rejected", "approved"]),
  createdAt: z.iso.datetime(),
  deepLink: z.string().min(1),
});
export const CandidateSkillVersionSchema = z.object({
  id: z.uuid(),
  version: z.string(),
  immutable: z.literal(true),
  artifactHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  package: CandidatePackageSchema,
  reviewerContext: z.string(),
  uncertainty: CandidateSubmissionRequestSchema.shape.uncertainty,
  claims: z.array(CandidateClaimSchema),
  citations: z.array(EvidenceCitationSchema),
  submittedAt: z.iso.datetime(),
  submittedBy: z.object({
    memberId: z.uuid(),
    analysisCredentialId: z.uuid().nullable(),
  }),
  review: z.object({
    state: z.enum(["pending_review", "rejected", "approved"]),
    note: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    decidedByMemberId: z.uuid().nullable(),
  }),
});
export const CandidateSubmissionResponseSchema = z.object({
  candidate: CandidateSkillSchema,
  version: CandidateSkillVersionSchema,
});
export const CandidateHistoryResponseSchema = z.object({
  items: z.array(CandidateSubmissionResponseSchema),
});

export const CandidateVersionParamsSchema = z.object({
  candidateId: z.uuid(),
  versionId: z.uuid(),
});
export const CandidateReviewEditRequestSchema = z.object({
  version: CandidateSubmissionRequestSchema.shape.version,
  reviewerContext: CandidateSubmissionRequestSchema.shape.reviewerContext,
  uncertainty: CandidateSubmissionRequestSchema.shape.uncertainty,
  claims: CandidateSubmissionRequestSchema.shape.claims,
  package: CandidatePackageSchema,
  artifactHash: CandidateSubmissionRequestSchema.shape.artifactHash,
});
export const CandidateReviewDecisionRequestSchema = z.object({
  note: z.string().trim().min(1).max(4_000),
});
export const CandidateApprovalRequestSchema = z.object({
  artifactHash: CandidateSubmissionRequestSchema.shape.artifactHash,
});
export const CandidateReviewSchema = z.object({
  state: z.enum(["pending_review", "rejected", "approved"]),
  note: z.string().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  decidedByMemberId: z.uuid().nullable(),
});
export const OrganizationStandardReleaseSchema = z.object({
  standardId: z.uuid(),
  releaseId: z.uuid(),
  candidateId: z.uuid(),
  candidateVersionId: z.uuid(),
  name: z.string(),
  version: z.string(),
  artifactHash: CandidateSubmissionRequestSchema.shape.artifactHash,
  mandatory: z.literal(true),
  immutable: z.literal(true),
  approvedAt: z.iso.datetime(),
  approvedByMemberId: z.uuid(),
});
export const CandidateApprovalResponseSchema = z.object({
  release: OrganizationStandardReleaseSchema,
});
export const CandidateReviewResponseSchema = z.object({
  candidate: CandidateSkillSchema,
  version: CandidateSkillVersionSchema,
  review: CandidateReviewSchema,
});

export const DeviceStandardTargetSchema = z.object({
  standardId: z.uuid(),
  name: z.string(),
  releaseId: z.uuid(),
  version: z.string(),
  artifactHash: CandidateSubmissionRequestSchema.shape.artifactHash,
  artifactUrl: z.string().min(1),
  collisionPolicy: z.literal("organization_wins_preserve_personal"),
  sequence: z.number().int().nonnegative(),
  state: z.enum(["active", "paused"]),
  mandatory: z.literal(true),
  previousReleaseId: z.uuid().nullable(),
});
export const DeviceStandardManifestSchema = z.object({
  schemaVersion: z.literal("1"),
  pollAfterSeconds: z.number().int().min(5).max(300),
  generatedAt: z.iso.datetime(),
  targets: z.array(DeviceStandardTargetSchema),
});
export const DeviceStandardArtifactSchema = z.object({
  standardId: z.uuid(),
  releaseId: z.uuid(),
  name: z.string(),
  version: z.string(),
  artifactHash: CandidateSubmissionRequestSchema.shape.artifactHash,
  package: CandidatePackageSchema,
});
export const DeviceStandardReleaseParamsSchema = z.object({ releaseId: z.uuid() });
export const DeviceStandardInstallationStateSchema = z.enum([
  "idle",
  "deferred_active_session",
  "installed",
  "download_failed",
  "verification_failed",
  "staging_failed",
  "switch_failed",
  "rolled_back",
]);
export const DeviceStandardInstallationFailureSchema = z.object({
  stage: z.enum(["download", "verification", "staging", "switch"]),
  code: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(2_000),
});
export const DeviceStandardInstallationReportRequestSchema = z.object({
  standardId: z.uuid(),
  releaseId: z.uuid().nullable(),
  installedReleaseId: z.uuid().nullable(),
  state: DeviceStandardInstallationStateSchema,
  observedAt: z.iso.datetime(),
  activeSessionIds: z.array(z.string().trim().min(1).max(240)).max(100).default([]),
  failure: DeviceStandardInstallationFailureSchema.nullable().optional(),
});
export const DeviceStandardInstallationSchema =
  DeviceStandardInstallationReportRequestSchema.extend({
    deviceId: z.uuid(),
    serverReceivedAt: z.iso.datetime(),
  });
export const DeviceStandardInstallationsResponseSchema = z.object({
  items: z.array(DeviceStandardInstallationSchema),
});

export const OrganizationStandardParamsSchema = z.object({ standardId: z.uuid() });
export const OrganizationStandardRollbackRequestSchema = z.object({
  releaseId: z.uuid(),
});
export const OrganizationStandardDistributionSchema = z.object({
  standardId: z.uuid(),
  name: z.string(),
  state: z.enum(["active", "paused"]),
  sequence: z.number().int().nonnegative(),
  target: OrganizationStandardReleaseSchema.nullable(),
  previousReleaseId: z.uuid().nullable(),
  releases: z.array(OrganizationStandardReleaseSchema),
  installations: z.array(DeviceStandardInstallationSchema),
});
export const OrganizationStandardsResponseSchema = z.object({
  items: z.array(OrganizationStandardDistributionSchema),
});

export const ComparisonResponseSchema = z.object({
  population: z.object({
    selected: z.array(ComparisonSelectionSchema),
    selectedSessions: z.number().int().nonnegative(),
    selectedTurns: z.number().int().nonnegative(),
    distinctRealTurns: z.number().int().nonnegative(),
    seededTurns: z.number().int().nonnegative(),
  }),
  filters: ComparisonFiltersSchema,
  syntheticInclusion: z.enum(["excluded", "included_for_illustration"]),
  completeness: z.object({
    status: z.enum(["complete", "partial", "unavailable"]),
    selected: z.number().int().positive(),
    resolved: z.number().int().nonnegative(),
    missing: z.array(
      z.object({
        selection: ComparisonSelectionSchema,
        reason: z.enum(["SESSION_NOT_FOUND", "TURN_NOT_FOUND", "SEEDED_EXCLUDED"]),
      }),
    ),
    evidenceGaps: z.array(z.string()),
  }),
  subjects: z.array(
    z.object({
      selection: ComparisonSelectionSchema,
      synthetic: z.enum(["real", "seeded"]),
      ownerDisplayName: z.string(),
      outcome: z.enum(["successful", "partial", "failed", "unknown"]),
      reviewStatus: z.enum(["exemplar", "needs_help", "ordinary"]),
      durationMs: z.number().nonnegative().nullable(),
      toolCount: z.number().int().nonnegative(),
      tokenTotal: z.number().int().nonnegative().nullable(),
      modelChoices: z.array(z.string()),
      completeness: z.object({
        tokenUsage: z.enum(["available", "unavailable"]),
        toolEvidence: z.enum(["available", "unavailable"]),
        humanOutcome: z.enum(["available", "unavailable"]),
      }),
    }),
  ),
  citations: z.array(EvidenceCitationSchema),
  claim: z.object({
    kind: ComparisonClaimSchema.shape.kind,
    statement: z.string(),
    signals: ComparisonClaimSchema.shape.signals,
    classification: z.enum([
      "repeated_pattern",
      "single_case_hypothesis",
      "descriptive_comparison",
      "unsupported",
    ]),
    status: z.enum(["supported", "refused"]),
    refusal: z
      .object({
        code: z.enum([
          "INSUFFICIENT_REAL_TURN_EVIDENCE",
          "INSUFFICIENT_OUTCOME_EVIDENCE",
          "INSUFFICIENT_CAUSAL_EVIDENCE",
          "INSUFFICIENT_PRODUCTIVITY_EVIDENCE",
        ]),
        message: z.string().min(1),
      })
      .nullable(),
    caveats: z.array(z.string()),
  }),
});

export const ComparisonTurnParamsSchema = z.object({
  id: z.string().min(1),
  turnId: z.string().min(1),
});
export const ComparisonActivityParamsSchema = z.object({
  id: z.string().min(1),
  activityId: z.uuid(),
});
export const CitationTurnTargetResponseSchema = z.object({
  session: ExecutionSessionSchema,
  turn: TurnSchema,
});
export const CitationActivityTargetResponseSchema = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().nullable(),
  activity: TimelineEventSchema,
});

export const OrganizationActivityQuerySchema = z.object({
  q: z.string().trim().min(1).max(240).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  includeSeeded: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  memberId: z.uuid().optional(),
  repository: z.string().trim().min(1).max(240).optional(),
  activityState: z.enum(["live", "idle", "resumed"]).optional(),
  outcome: z.enum(["successful", "partial", "failed", "unknown"]).optional(),
  reviewStatus: z.enum(["exemplar", "needs_help", "ordinary"]).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  tool: z.string().trim().min(1).max(120).optional(),
  capability: z.string().trim().min(1).max(120).optional(),
  error: z.string().trim().min(1).max(240).optional(),
});

export const OrganizationActivityItemSchema = ExecutionSessionSchema.extend({
  owner: ExecutionSessionSchema.shape.owner.extend({
    displayName: z.string(),
    isExample: z.boolean(),
  }),
  repository: z.object({
    repositoryRoot: z.string().nullable(),
    remoteIdentity: z.string().nullable(),
    branch: z.string().nullable(),
  }),
});

export const OrganizationActivityResponseSchema = z.object({
  items: z.array(OrganizationActivityItemSchema),
  syntheticInclusion: z.enum(["excluded", "included"]),
  filters: z.object({
    q: z.string().optional(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    includeSeeded: z.boolean(),
    from: z.string().optional(),
    to: z.string().optional(),
    memberId: z.string().optional(),
    repository: z.string().optional(),
    activityState: z.string().optional(),
    outcome: z.string().optional(),
    reviewStatus: z.string().optional(),
    tag: z.string().optional(),
    model: z.string().optional(),
    tool: z.string().optional(),
    capability: z.string().optional(),
    error: z.string().optional(),
  }),
  page: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
    nextPage: z.number().int().positive().nullable(),
  }),
  aggregates: z.object({
    sessions: z.number().int().nonnegative(),
    members: z.number().int().nonnegative(),
    repositories: z.number().int().nonnegative(),
    activityStates: z.object({
      live: z.number().int().nonnegative(),
      idle: z.number().int().nonnegative(),
      resumed: z.number().int().nonnegative(),
    }),
    outcomes: z.object({
      successful: z.number().int().nonnegative(),
      partial: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      unknown: z.number().int().nonnegative(),
    }),
  }),
  members: z.array(
    z.object({
      id: z.uuid(),
      displayName: z.string(),
      isExample: z.boolean(),
      sessionCount: z.number().int().nonnegative(),
    }),
  ),
  repositories: z.array(
    z.object({ identity: z.string(), sessionCount: z.number().int().nonnegative() }),
  ),
});

export const SessionAnnotationRequestSchema = z
  .object({
    outcome: z.enum(["successful", "partial", "failed", "unknown"]).optional(),
    reviewStatus: z.enum(["exemplar", "needs_help", "ordinary"]).optional(),
    tags: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
  })
  .refine(
    (value) =>
      value.outcome !== undefined ||
      value.reviewStatus !== undefined ||
      value.tags !== undefined,
    { message: "At least one annotation field is required." },
  );
export const SessionAnnotationResponseSchema = ExecutionSessionSchema.shape.annotations;

export const ExamplePackParamsSchema = z.object({
  version: z.enum(["starter-v1", "rich-v1"]),
});
export const EmptyRequestBodySchema = z.object({}).strict().nullish();
export const ExamplePackImportResponseSchema = z.object({
  version: z.enum(["starter-v1", "rich-v1"]),
  imported: z.boolean(),
  exampleMemberId: z.uuid(),
  sessionIds: z.array(z.string().min(1)),
  syntheticDesignation: z.literal("seeded"),
  counts: z.object({
    members: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    agentRuns: z.number().int().nonnegative(),
    detailRecords: z.number().int().nonnegative(),
  }),
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
export type AnalysisCredentialScope = z.infer<
  typeof AnalysisCredentialScopeSchema
>;
export type AnalysisCredential = z.infer<typeof AnalysisCredentialSchema>;
export type AnalysisCredentialCreateRequest = z.infer<
  typeof AnalysisCredentialCreateRequestSchema
>;
export type AnalysisCredentialCreateResponse = z.infer<
  typeof AnalysisCredentialCreateResponseSchema
>;
export type AnalysisCredentialGrantResponse = z.infer<
  typeof AnalysisCredentialGrantResponseSchema
>;
export type InviteCodeRequest = z.infer<typeof InviteCodeRequestSchema>;
export type InviteCodeResponse = z.infer<typeof InviteCodeResponseSchema>;
export type InviteCodeRedeemRequest = z.infer<
  typeof InviteCodeRedeemRequestSchema
>;
export type ActiveMembershipSelectionRequest = z.infer<
  typeof ActiveMembershipSelectionRequestSchema
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
export type StructuralCaptureLedgerQuery = z.infer<
  typeof StructuralCaptureLedgerQuerySchema
>;
export type StructuralCaptureLedgerResponse = z.infer<
  typeof StructuralCaptureLedgerResponseSchema
>;
export type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Reconciliation = z.infer<typeof ReconciliationSchema>;
export type ActivityEpisode = z.infer<typeof ActivityEpisodeSchema>;
export type Turn = z.infer<typeof TurnSchema>;
export type AgentRun = z.infer<typeof AgentRunSchema>;
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
export type ExecutionSessionDetail = z.infer<
  typeof ExecutionSessionDetailResponseSchema
>;
export type LiveExecutionEvent = z.infer<typeof LiveExecutionEventSchema>;
export type TurnAssociation = z.infer<typeof TurnAssociationSchema>;
export type ToolEvidence = z.infer<typeof ToolEvidenceSchema>;
export type LifecycleEvidence = z.infer<typeof LifecycleEvidenceSchema>;
export type ApiRequestEvidence = z.infer<typeof ApiRequestEvidenceSchema>;
export type TokenUsageSample = z.infer<typeof TokenUsageSampleSchema>;
export type ContextEvidence = z.infer<typeof ContextEvidenceSchema>;
export type CostEstimate = z.infer<typeof CostEstimateSchema>;
export type CapabilityEvidence = z.infer<typeof CapabilityEvidenceSchema>;
export type RichSessionEvidence = z.infer<typeof RichSessionEvidenceSchema>;
export type ComparisonSelection = z.infer<typeof ComparisonSelectionSchema>;
export type ComparisonFilters = z.infer<typeof ComparisonFiltersSchema>;
export type ComparisonClaim = z.infer<typeof ComparisonClaimSchema>;
export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;
export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
export type CandidatePackage = z.infer<typeof CandidatePackageSchema>;
export type CandidateClaim = z.infer<typeof CandidateClaimSchema>;
export type CandidateSubmissionRequest = z.infer<
  typeof CandidateSubmissionRequestSchema
>;
export type CandidateSubmissionResponse = z.infer<
  typeof CandidateSubmissionResponseSchema
>;
export type CandidateReviewEditRequest = z.infer<
  typeof CandidateReviewEditRequestSchema
>;
export type CandidateReview = z.infer<typeof CandidateReviewSchema>;
export type OrganizationStandardRelease = z.infer<
  typeof OrganizationStandardReleaseSchema
>;
export type DeviceStandardManifest = z.infer<
  typeof DeviceStandardManifestSchema
>;
export type DeviceStandardArtifact = z.infer<
  typeof DeviceStandardArtifactSchema
>;
export type DeviceStandardInstallationState = z.infer<
  typeof DeviceStandardInstallationStateSchema
>;
export type DeviceStandardInstallationReportRequest = z.infer<
  typeof DeviceStandardInstallationReportRequestSchema
>;
export type DeviceStandardInstallation = z.infer<
  typeof DeviceStandardInstallationSchema
>;
export type OrganizationStandardDistribution = z.infer<
  typeof OrganizationStandardDistributionSchema
>;
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;
export type OrganizationActivityQuery = z.infer<
  typeof OrganizationActivityQuerySchema
>;
export type OrganizationActivityResponse = z.infer<
  typeof OrganizationActivityResponseSchema
>;
export type SessionAnnotationRequest = z.infer<
  typeof SessionAnnotationRequestSchema
>;
export type ExamplePackImportResponse = z.infer<
  typeof ExamplePackImportResponseSchema
>;
