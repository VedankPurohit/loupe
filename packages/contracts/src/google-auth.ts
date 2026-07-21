import { z } from "zod";

import { PersonSchema } from "./identity.js";

export const GoogleAuthTransactionResponseSchema = z.object({
  clientId: z.string().min(1),
  transaction: z.string().min(32).max(256),
  nonce: z.string().min(32).max(256),
  csrfToken: z.string().min(32).max(256),
  expiresAt: z.iso.datetime(),
});

export const GoogleCredentialRequestSchema = z.object({
  transaction: z.string().min(32).max(256),
  nonce: z.string().min(32).max(256),
  csrfToken: z.string().min(32).max(256),
  credential: z.string().min(1).max(16_384),
});

export const GoogleProfileSchema = z.object({
  subject: z.string().min(1),
  avatarUrl: z.string().url().nullable(),
});

export const GoogleBrowserSessionResponseSchema = z.object({
  person: PersonSchema,
  organization: z.null(),
  member: z.null(),
  googleProfile: GoogleProfileSchema,
});

export const GoogleLinkResponseSchema = z.object({
  person: PersonSchema,
  googleProfile: GoogleProfileSchema,
});

export const GoogleUnlinkResponseSchema = z.object({
  unlinked: z.literal(true),
  revokeGoogleConsent: z.literal(true),
});

export type GoogleAuthTransactionResponse = z.infer<
  typeof GoogleAuthTransactionResponseSchema
>;
export type GoogleCredentialRequest = z.infer<
  typeof GoogleCredentialRequestSchema
>;
export type GoogleBrowserSessionResponse = z.infer<
  typeof GoogleBrowserSessionResponseSchema
>;
export type GoogleLinkResponse = z.infer<typeof GoogleLinkResponseSchema>;
