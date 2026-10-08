import "server-only";

import { SmsProviderError } from "./sms-provider";
import { twoFactorProvider } from "./twofactor-provider";
import { db } from "./db";

/**
 * OTP challenge lifecycle (02-USER-FLOWS §9.6; ADR 019 database-backed
 * rate limiting).
 *
 * Owns the member_otp_challenges state machine:
 *
 *   PENDING ──verify success──▶ VERIFIED   (single-use, terminal)
 *   PENDING ──expiry─────────▶ EXPIRED
 *   PENDING ──new request────▶ SUPERSEDED
 *   PENDING ──5 failed tries─▶ LOCKED
 *
 * The OTP itself never passes through this module's persistence: it is
 * forwarded to the provider's VERIFY call and forgotten. Rate limiting is
 * enforced from the challenge rows themselves (cooldown + hourly caps) —
 * no external store. The challenge rows and their timestamps are the OTP
 * audit trail for this foundation (AuditLog requires an authenticated
 * actor, which does not exist at this stage).
 */

/** App-side challenge lifetime (independent of the provider's own window). */
export const OTP_CHALLENGE_TTL_MS = 5 * 60_000;
/** Minimum gap between two OTP sends for the same gym + phone. */
export const OTP_RESEND_COOLDOWN_MS = 30_000;
/** Failed verification attempts allowed before the challenge locks. */
export const OTP_MAX_VERIFY_ATTEMPTS = 5;
/** Sends allowed per gym + phone per rolling hour. */
export const OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR = 5;
/** Sends allowed per gym per rolling hour (abuse ceiling). */
export const OTP_MAX_REQUESTS_PER_ORG_PER_HOUR = 100;

const ONE_HOUR_MS = 60 * 60_000;

/** Thrown when cooldown or a request cap blocks a new challenge. */
export class OtpRateLimitError extends Error {
  constructor() {
    super("Too many OTP requests.");
    this.name = "OtpRateLimitError";
  }
}

/**
 * Thrown for EVERY verification failure — missing challenge, wrong gym,
 * wrong state, expired, locked, wrong code. Callers must surface one
 * generic message; the distinctions stay server-side.
 */
export class OtpVerificationError extends Error {
  constructor() {
    super("Verification failed.");
    this.name = "OtpVerificationError";
  }
}

/**
 * Issue a new challenge for (organization, phone): enforce cooldown and
 * caps, send the OTP via the provider, then persist the challenge.
 *
 * The provider is called BEFORE the row is created, so a provider failure
 * never leaves a PENDING challenge without a valid provider session.
 * Superseding the previous PENDING challenge happens after a successful
 * send, immediately before the insert.
 */
export async function issueChallenge(input: {
  organizationId: string;
  phoneNumber: string;
}): Promise<{ challengeId: string }> {
  const { organizationId, phoneNumber } = input;
  const now = new Date();
  const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);

  const [latest, phoneCount, orgCount] = await Promise.all([
    db.memberOtpChallenge.findFirst({
      where: { organizationId, phoneNumber },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.memberOtpChallenge.count({
      where: { organizationId, phoneNumber, createdAt: { gt: hourAgo } },
    }),
    db.memberOtpChallenge.count({
      where: { organizationId, createdAt: { gt: hourAgo } },
    }),
  ]);

  if (
    latest &&
    now.getTime() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS
  ) {
    throw new OtpRateLimitError();
  }
  if (
    phoneCount >= OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR ||
    orgCount >= OTP_MAX_REQUESTS_PER_ORG_PER_HOUR
  ) {
    throw new OtpRateLimitError();
  }

  const { providerSessionId } = await twoFactorProvider.sendOtp(phoneNumber);

  await db.memberOtpChallenge.updateMany({
    where: { organizationId, phoneNumber, status: "PENDING" },
    data: { status: "SUPERSEDED" },
  });

  const challenge = await db.memberOtpChallenge.create({
    data: {
      organizationId,
      phoneNumber,
      providerSessionId,
      status: "PENDING",
      attempts: 0,
      expiresAt: new Date(now.getTime() + OTP_CHALLENGE_TTL_MS),
    },
    select: { id: true },
  });
  return { challengeId: challenge.id };
}

/**
 * Verify an entered OTP against a challenge.
 *
 * Tenant-scoped: the challenge is looked up by id AND organization, so a
 * challenge from another gym fails identically to a missing one. Only
 * PENDING challenges can verify; expiry is enforced app-side before the
 * provider is called; a wrong code increments attempts and locks the
 * challenge at the maximum; success marks VERIFIED (single-use). A
 * provider outage does not consume an attempt.
 */
export async function verifyChallenge(input: {
  organizationId: string;
  challengeId: string;
  otp: string,
}): Promise<{ verified: true; phoneNumber: string }> {
  const { organizationId, challengeId, otp } = input;

  const challenge = await db.memberOtpChallenge.findFirst({
    where: { id: challengeId, organizationId },
  });
  if (!challenge || challenge.status !== "PENDING") {
    throw new OtpVerificationError();
  }

  const now = new Date();
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    await db.memberOtpChallenge.update({
      where: { id: challenge.id },
      data: { status: "EXPIRED" },
    });
    throw new OtpVerificationError();
  }
  if (challenge.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await db.memberOtpChallenge.update({
      where: { id: challenge.id },
      data: { status: "LOCKED" },
    });
    throw new OtpVerificationError();
  }

  let result: { verified: boolean };
  try {
    result = await twoFactorProvider.verifyOtp(challenge.providerSessionId, otp);
  } catch (error) {
    if (error instanceof SmsProviderError) throw error;
    throw new SmsProviderError("PROVIDER_UNAVAILABLE");
  }

  if (!result.verified) {
    const attempts = challenge.attempts + 1;
    await db.memberOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts,
        ...(attempts >= OTP_MAX_VERIFY_ATTEMPTS ? { status: "LOCKED" as const } : {}),
      },
    });
    throw new OtpVerificationError();
  }

  await db.memberOtpChallenge.update({
    where: { id: challenge.id },
    data: { status: "VERIFIED", verifiedAt: now },
  });
  return { verified: true, phoneNumber: challenge.phoneNumber };
}
