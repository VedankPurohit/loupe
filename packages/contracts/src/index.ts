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

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type BootstrapRedeemRequest = z.infer<typeof BootstrapRedeemRequestSchema>;
export type AuthenticatedSessionResponse = z.infer<
  typeof AuthenticatedSessionResponseSchema
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
