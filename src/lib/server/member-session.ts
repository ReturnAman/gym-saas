import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type {
  Member,
  MemberSession,
  Organization,
  OrganizationMembership,
  Prisma,
  User,
} from "@prisma/client";

import { db } from "./db";

/**
 * Member sessions (ADR 021) — the phone-OTP path's session layer.
 *
 * Deliberately independent from Clerk: nothing here imports Clerk or reads
 * Clerk state, and Clerk code never reads this. A session is gym-scoped —
 * it attests "this User, in this Organization, via a verified phone" —
 * and authorization still comes from the live OrganizationMembership row
 * resolved alongside it. A member session can never reach staff surfaces:
 * those resolve identity exclusively through the Clerk-side resolvers.
 *
 * Token discipline: the raw token is 32 cryptographically random bytes,
 * exists only in the HttpOnly cookie and in the caller's hands at
 * creation, and is never persisted, logged, or returned in a body. The
 * database stores only its SHA-256 hash.
 */

export const MEMBER_SESSION_COOKIE_NAME = "gym_member_session";
/** Absolute session lifetime: 30 days from creation. */
export const MEMBER_SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60_000;
/** Idle lifetime: 7 days from lastSeenAt. */
export const MEMBER_SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60_000;
/** Cookie Max-Age mirrors the absolute lifetime (J6/J7). */
export const MEMBER_SESSION_COOKIE_MAX_AGE_SECONDS =
  MEMBER_SESSION_ABSOLUTE_TTL_MS / 1000;
/** lastSeenAt is refreshed at most hourly to bound write load. */
const LAST_SEEN_TOUCH_THRESHOLD_MS = 60 * 60_000;

/** Generate a fresh raw session token (256 bits, base64url). */
export function generateMemberSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of a raw token — the only form ever stored. */
export function hashMemberSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Cookie helpers — the single place member cookie mechanics live.
// ---------------------------------------------------------------------------

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

export async function setMemberSessionCookie(rawToken: string): Promise<void> {
  const store = await cookies();
  store.set(MEMBER_SESSION_COOKIE_NAME, rawToken, {
    ...COOKIE_OPTIONS,
    maxAge: MEMBER_SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearMemberSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(MEMBER_SESSION_COOKIE_NAME, "", {
    ...COOKIE_OPTIONS,
    maxAge: 0,
  });
}

export async function readMemberSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(MEMBER_SESSION_COOKIE_NAME)?.value ?? null;
}

/**
 * Origin guard for cookie-authenticated POSTs (defense in depth on top of
 * SameSite=Lax): when the browser sends an Origin header, its host must
 * match the request's Host. Requests without an Origin header (non-browser
 * clients) pass — they do not carry ambient cookies in a CSRF pattern.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

/**
 * Create a session row inside the caller's transaction (used by member
 * linking, so session creation commits atomically with the link). Returns
 * the raw token — the caller hands it to the cookie helper AFTER commit.
 */
export async function createMemberSession(
  tx: Prisma.TransactionClient,
  input: { userId: string; organizationId: string },
): Promise<{ rawToken: string; session: MemberSession }> {
  const rawToken = generateMemberSessionToken();
  const now = new Date();
  const session = await tx.memberSession.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId,
      tokenHash: hashMemberSessionToken(rawToken),
      expiresAt: new Date(now.getTime() + MEMBER_SESSION_ABSOLUTE_TTL_MS),
      lastSeenAt: now,
    },
  });
  return { rawToken, session };
}

export interface MemberSessionContext {
  session: MemberSession;
  user: User;
  organization: Organization;
  membership: OrganizationMembership;
  /** The Member record linked to this user in this gym, if it still exists. */
  member: Member | null;
}

/**
 * Resolve a raw cookie token to its full member context, or null.
 *
 * Fails closed on: unknown token, revoked session, absolute expiry, idle
 * expiry (both expiries also mark the row revoked), a deleted user, or a
 * missing OrganizationMembership for the session's gym — the session row
 * alone never authorizes anything. Cross-gym access is impossible by
 * construction: organization and membership are loaded from the session
 * row, never from any client-supplied identifier.
 */
export async function resolveMemberSession(
  rawToken: string | null,
): Promise<MemberSessionContext | null> {
  if (!rawToken) return null;

  const session = await db.memberSession.findUnique({
    where: { tokenHash: hashMemberSessionToken(rawToken) },
  });
  if (!session || session.revokedAt) return null;

  const now = new Date();
  const idleExpired =
    now.getTime() - session.lastSeenAt.getTime() >
    MEMBER_SESSION_IDLE_TTL_MS;
  if (session.expiresAt.getTime() <= now.getTime() || idleExpired) {
    await db.memberSession.update({
      where: { id: session.id },
      data: { revokedAt: now },
    });
    return null;
  }

  if (
    now.getTime() - session.lastSeenAt.getTime() >
    LAST_SEEN_TOUCH_THRESHOLD_MS
  ) {
    await db.memberSession.update({
      where: { id: session.id },
      data: { lastSeenAt: now },
    });
    session.lastSeenAt = now;
  }

  const [user, membership, member] = await Promise.all([
    db.user.findUnique({ where: { id: session.userId } }),
    db.organizationMembership.findUnique({
      where: {
        userId_organizationId: {
          userId: session.userId,
          organizationId: session.organizationId,
        },
      },
      include: { organization: true },
    }),
    db.member.findFirst({
      where: { organizationId: session.organizationId, userId: session.userId },
    }),
  ]);
  if (!user || !membership) return null;

  return {
    session,
    user,
    organization: membership.organization,
    membership,
    member,
  };
}

/** Revoke a session server-side (logout). Idempotent; unknown tokens no-op. */
export async function revokeMemberSession(
  rawToken: string | null,
): Promise<void> {
  if (!rawToken) return;
  await db.memberSession.updateMany({
    where: {
      tokenHash: hashMemberSessionToken(rawToken),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Context resolvers for member-facing pages (parallel to the Clerk-side
// organization-context resolver, which member code must never call).
// ---------------------------------------------------------------------------

/** Member context from the current request's cookie, or null. */
export async function getMemberContext(): Promise<MemberSessionContext | null> {
  return resolveMemberSession(await readMemberSessionToken());
}

/** Member context, or redirect to the member landing page. */
export async function requireMemberContext(): Promise<MemberSessionContext> {
  const context = await getMemberContext();
  if (!context) {
    redirect("/member");
  }
  return context;
}
