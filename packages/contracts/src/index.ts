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

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type BootstrapRedeemRequest = z.infer<typeof BootstrapRedeemRequestSchema>;
export type AuthenticatedSessionResponse = z.infer<
  typeof AuthenticatedSessionResponseSchema
>;
