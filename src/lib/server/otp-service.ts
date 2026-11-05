import "server-only";

import { randomUUID } from "node:crypto";

import { apiTxtProvider } from "./apitxt-provider";
import { db } from "./db";
import {
  computeOtpHash,
  generateOtpCode,
  otpHashMatches,
  readOtpHmacSecret,
} from "./otp-crypto";
import { SmsProviderError } from "./sms-provider";

/**
 * OTP challenge lifecycle (02-USER-FLOWS §9.6; ADR 019 database-backed
 * rate limiting; ADR 021 member authentication).
 *
 * Owns the member_otp_challenges state machine:
 *
 *   PENDING ──verify success──▶ VERIFIED   (single-use, terminal)
 *   PENDING ──expiry─────────▶ EXPIRED
 *   PENDING ──new request────▶ SUPERSEDED
 *   PENDING ──5 failed tries─▶ LOCKED
 *
 * The application generates the OTP and verifies it locally. The raw
 * code exists only in memory long enough to hand to the SMS delivery
 * provider and to compute its digest: only a keyed HMAC-SHA256 digest
 * (otp-crypto.ts), bound to the organization, challenge, and phone, is
 * ever persisted — the code itself is never stored, never logged, and
 * never returned to the client. Rate limiting is enforced from the
 * challenge rows themselves (cooldown + hourly caps) — no external
 * store. The challenge rows and their timestamps are the OTP audit
 * trail for this foundation (AuditLog requires an authenticated actor,
 * which does not exist at this stage).
 */

/** App-side challenge lifetime. */
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
 * wrong state, expired, locked, missing digest, wrong code. Callers
 * must surface one generic message; the distinctions stay server-side.
 */
export class OtpVerificationError extends Error {
  constructor() {
    super("Verification failed.");
    this.name = "OtpVerificationError";
  }
}

/**
 * Issue a new challenge for (organization, phone): enforce cooldown and
 * caps from the challenge rows, generate the OTP and its digest,
 * deliver the code via the SMS provider, then persist the challenge.
 *
 * Ordering guarantees:
 * - The HMAC secret is validated BEFORE anything is sent, so no message
 *   is ever dispatched that the application could not verify later.
 * - The provider is called BEFORE the row is created, and superseding
 *   happens after a successful send: if the provider call fails, no
 *   PENDING challenge is left behind and the previous pending challenge
 *   is never superseded.
 * - The challenge id is generated up front because the digest binds it.
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

  // Fail closed before sending if the code could not be verified later.
  const secret = readOtpHmacSecret();

  const challengeId = randomUUID();
  const otp = generateOtpCode();
  const otpHash = computeOtpHash(secret, {
    organizationId,
    challengeId,
    phoneNumber,
    otp,
  });

  await apiTxtProvider.sendOtp(phoneNumber, otp);

  await db.memberOtpChallenge.updateMany({
    where: { organizationId, phoneNumber, status: "PENDING" },
    data: { status: "SUPERSEDED" },
  });

  const challenge = await db.memberOtpChallenge.create({
    data: {
      id: challengeId,
      organizationId,
      phoneNumber,
      otpHash,
      status: "PENDING",
      attempts: 0,
      expiresAt: new Date(now.getTime() + OTP_CHALLENGE_TTL_MS),
    },
    select: { id: true },
  });
  return { challengeId: challenge.id };
}

/**
 * Verify an entered OTP against a challenge, locally.
 *
 * Tenant-scoped: the challenge is looked up by id AND organization, so a
 * challenge from another gym fails identically to a missing one. Only
 * PENDING challenges can verify; expiry is enforced app-side; the
 * entered code is compared against the stored digest in constant time;
 * a wrong code counts an attempt and locks the challenge at the
 * maximum; success flips the challenge to VERIFIED (single-use). A
 * challenge with no stored digest (a legacy row) can never verify. No
 * provider call is involved, so verification cannot fail for delivery
 * reasons and a provider outage cannot consume attempts.
 */
export async function verifyChallenge(input: {
  organizationId: string;
  challengeId: string;
  otp: string;
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

  let secret: string;
  try {
    secret = readOtpHmacSecret();
  } catch (error) {
    // Verification cannot proceed securely without the secret; surface
    // the normalized configuration failure (the route renders 503),
    // never a silent pass or a misleading "wrong code".
    if (error instanceof SmsProviderError) throw error;
    throw new SmsProviderError("PROVIDER_UNAVAILABLE");
  }

  const matched = otpHashMatches(
    secret,
    {
      organizationId: challenge.organizationId,
      challengeId: challenge.id,
      phoneNumber: challenge.phoneNumber,
      otp,
    },
    challenge.otpHash,
  );

  if (!matched) {
    const attempts = challenge.attempts + 1;
    await db.memberOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts,
        ...(attempts >= OTP_MAX_VERIFY_ATTEMPTS
          ? { status: "LOCKED" as const }
          : {}),
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
