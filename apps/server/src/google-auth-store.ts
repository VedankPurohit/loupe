import { createHash } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  browserSessions,
  externalIdentities,
  googleAuthTransactions,
  persons,
} from "@workspace/database";
import type {
  GoogleBrowserSessionResponse,
  GoogleLinkResponse,
} from "@workspace/contracts";

import type { VerifiedGoogleIdentity } from "./google-id-token-verifier.js";

export type GoogleAuthErrorCode =
  | "GOOGLE_AUTH_TRANSACTION_INVALID"
  | "GOOGLE_AUTH_TRANSACTION_REPLAYED"
  | "GOOGLE_AUTH_NONCE_INVALID"
  | "GOOGLE_AUTH_CSRF_INVALID"
  | "GOOGLE_AUTH_ORIGIN_INVALID"
  | "GOOGLE_IDENTITY_ALREADY_LINKED"
  | "GOOGLE_IDENTITY_UNLINKED"
  | "GOOGLE_IDENTITY_NOT_LINKED";

export class GoogleAuthError extends Error {
  constructor(
    public readonly code: GoogleAuthErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function digest(secret: string): string {
  return createHash("sha256").update(secret).digest("base64url");
}

function transactionError(
  code: GoogleAuthErrorCode,
  message: string,
): GoogleAuthError {
  return new GoogleAuthError(code, message);
}

export class GoogleAuthStore {
  private readonly client;
  private readonly database;

  constructor(databaseUrl: string) {
    this.client = postgres(databaseUrl);
    this.database = drizzle(this.client);
  }

  async close(): Promise<void> {
    await this.client.end();
  }

  async createTransaction(input: {
    transaction: string;
    nonce: string;
    csrfToken: string;
    origin: string;
    now: Date;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.insert(googleAuthTransactions).values({
      transactionDigest: digest(input.transaction),
      nonceDigest: digest(input.nonce),
      csrfDigest: digest(input.csrfToken),
      origin: input.origin,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    });
  }

  async consumeTransaction(input: {
    transaction: string;
    nonce: string;
    csrfToken: string;
    origin: string;
    now: Date;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [stored] = await transaction
        .select()
        .from(googleAuthTransactions)
        .where(
          eq(
            googleAuthTransactions.transactionDigest,
            digest(input.transaction),
          ),
        )
        .for("update")
        .limit(1);
      if (!stored || stored.expiresAt <= input.now) {
        throw transactionError(
          "GOOGLE_AUTH_TRANSACTION_INVALID",
          "The Google authentication transaction is invalid or expired.",
        );
      }
      if (stored.consumedAt !== null) {
        throw transactionError(
          "GOOGLE_AUTH_TRANSACTION_REPLAYED",
          "The Google authentication transaction has already been used.",
        );
      }
      if (stored.origin !== input.origin) {
        throw transactionError(
          "GOOGLE_AUTH_ORIGIN_INVALID",
          "The credential-delivery origin is not allowed.",
        );
      }
      if (stored.csrfDigest !== digest(input.csrfToken)) {
        throw transactionError(
          "GOOGLE_AUTH_CSRF_INVALID",
          "The Google authentication CSRF token is invalid.",
        );
      }
      if (stored.nonceDigest !== digest(input.nonce)) {
        throw transactionError(
          "GOOGLE_AUTH_NONCE_INVALID",
          "The Google authentication nonce is invalid or has already been used.",
        );
      }
      await transaction
        .update(googleAuthTransactions)
        .set({ consumedAt: input.now })
        .where(eq(googleAuthTransactions.id, stored.id));
    });
  }

  async signIn(input: {
    identity: VerifiedGoogleIdentity;
    sessionToken: string;
    now: Date;
    sessionExpiresAt: Date;
  }): Promise<GoogleBrowserSessionResponse> {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select({
          externalIdentityId: externalIdentities.id,
          personId: persons.id,
          unlinkedAt: externalIdentities.unlinkedAt,
        })
        .from(externalIdentities)
        .innerJoin(persons, eq(externalIdentities.personId, persons.id))
        .where(
          and(
            eq(externalIdentities.provider, "google"),
            eq(externalIdentities.subject, input.identity.subject),
          ),
        )
        .for("update")
        .limit(1);

      let personId: string;
      if (existing) {
        if (existing.unlinkedAt !== null) {
          throw new GoogleAuthError(
            "GOOGLE_IDENTITY_UNLINKED",
            "This Google identity was unlinked and requires an explicit authenticated relink.",
          );
        }
        personId = existing.personId;
        await transaction
          .update(persons)
          .set({
            displayName: input.identity.displayName,
            email: input.identity.email,
            updatedAt: input.now,
          })
          .where(eq(persons.id, personId));
        await transaction
          .update(externalIdentities)
          .set({
            profileDisplayName: input.identity.displayName,
            profileEmail: input.identity.email,
            profileAvatarUrl: input.identity.avatarUrl,
            updatedAt: input.now,
          })
          .where(eq(externalIdentities.id, existing.externalIdentityId));
      } else {
        const [person] = await transaction
          .insert(persons)
          .values({
            displayName: input.identity.displayName,
            email: input.identity.email,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning({ id: persons.id });
        personId = person!.id;
        await transaction.insert(externalIdentities).values({
          personId,
          provider: "google",
          subject: input.identity.subject,
          profileDisplayName: input.identity.displayName,
          profileEmail: input.identity.email,
          profileAvatarUrl: input.identity.avatarUrl,
          linkedAt: input.now,
          updatedAt: input.now,
        });
      }

      await transaction.insert(browserSessions).values({
        personId,
        memberId: null,
        tokenDigest: digest(input.sessionToken),
        createdAt: input.now,
        expiresAt: input.sessionExpiresAt,
      });
      return {
        person: {
          id: personId,
          displayName: input.identity.displayName,
          email: input.identity.email,
        },
        organization: null,
        member: null,
        googleProfile: {
          subject: input.identity.subject,
          avatarUrl: input.identity.avatarUrl,
        },
      };
    });
  }

  async authenticatedPersonId(
    sessionToken: string,
    now: Date,
  ): Promise<string | undefined> {
    const [session] = await this.database
      .select({ personId: browserSessions.personId })
      .from(browserSessions)
      .where(
        and(
          eq(browserSessions.tokenDigest, digest(sessionToken)),
          isNull(browserSessions.revokedAt),
          gt(browserSessions.expiresAt, now),
        ),
      )
      .limit(1);
    return session?.personId;
  }

  async link(
    personId: string,
    identity: VerifiedGoogleIdentity,
    now: Date,
  ): Promise<GoogleLinkResponse> {
    return this.database.transaction(async (transaction) => {
      const [subjectLink] = await transaction
        .select({
          id: externalIdentities.id,
          personId: externalIdentities.personId,
        })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.provider, "google"),
            eq(externalIdentities.subject, identity.subject),
          ),
        )
        .for("update")
        .limit(1);
      const [personLink] = await transaction
        .select({
          id: externalIdentities.id,
          subject: externalIdentities.subject,
        })
        .from(externalIdentities)
        .where(
          and(
            eq(externalIdentities.provider, "google"),
            eq(externalIdentities.personId, personId),
          ),
        )
        .for("update")
        .limit(1);
      if (
        (subjectLink && subjectLink.personId !== personId) ||
        (personLink && personLink.subject !== identity.subject)
      ) {
        throw new GoogleAuthError(
          "GOOGLE_IDENTITY_ALREADY_LINKED",
          "That Google identity is already linked to a different Person.",
        );
      }

      await transaction
        .update(persons)
        .set({
          displayName: identity.displayName,
          email: identity.email,
          updatedAt: now,
        })
        .where(eq(persons.id, personId));
      if (subjectLink) {
        await transaction
          .update(externalIdentities)
          .set({
            profileDisplayName: identity.displayName,
            profileEmail: identity.email,
            profileAvatarUrl: identity.avatarUrl,
            updatedAt: now,
            unlinkedAt: null,
          })
          .where(eq(externalIdentities.id, subjectLink.id));
      } else {
        await transaction.insert(externalIdentities).values({
          personId,
          provider: "google",
          subject: identity.subject,
          profileDisplayName: identity.displayName,
          profileEmail: identity.email,
          profileAvatarUrl: identity.avatarUrl,
          linkedAt: now,
          updatedAt: now,
        });
      }
      return {
        person: {
          id: personId,
          displayName: identity.displayName,
          email: identity.email,
        },
        googleProfile: {
          subject: identity.subject,
          avatarUrl: identity.avatarUrl,
        },
      };
    });
  }

  async unlink(personId: string, now: Date): Promise<void> {
    const [unlinked] = await this.database
      .update(externalIdentities)
      .set({ unlinkedAt: now, updatedAt: now })
      .where(
        and(
          eq(externalIdentities.provider, "google"),
          eq(externalIdentities.personId, personId),
          isNull(externalIdentities.unlinkedAt),
        ),
      )
      .returning({ id: externalIdentities.id });
    if (!unlinked) {
      throw new GoogleAuthError(
        "GOOGLE_IDENTITY_NOT_LINKED",
        "This Person does not have a linked Google identity.",
      );
    }
  }
}
