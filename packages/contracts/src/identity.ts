import { z } from "zod";

export const PersonSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string().email().nullable(),
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

export const OrganizationCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const PersonMembershipsResponseSchema = z.object({
  person: PersonSchema,
  memberships: z.array(
    z.object({
      organization: OrganizationSchema,
      member: OrganizationMemberSchema,
    }),
  ),
});

export const OrganizationMembershipCreateResponseSchema = z.object({
  person: PersonSchema,
  organization: OrganizationSchema,
  member: OrganizationMemberSchema.extend({
    role: z.literal("administrator"),
  }),
});

export type Person = z.infer<typeof PersonSchema>;
export type OrganizationCreateRequest = z.infer<
  typeof OrganizationCreateRequestSchema
>;
export type PersonMembershipsResponse = z.infer<
  typeof PersonMembershipsResponseSchema
>;
export type OrganizationMembershipCreateResponse = z.infer<
  typeof OrganizationMembershipCreateResponseSchema
>;
