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
 *
 * Concurrency (Phase M3a): issuance for one (organization, phone) is
 * serialized by a transaction-scoped advisory lock across
 * check → send → insert, so concurrent requests cannot all pass the
 * cooldown/caps and dispatch multiple SMS. Verification attempts are
 * counted by an atomic conditional increment, so concurrent guesses
 * can neither lose updates nor exceed the attempt budget.
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

/**
 * Issuance transaction bounds. The transaction deliberately spans the
 * provider send (up to the provider's own 10s timeout) while holding
 * the per-(organization, phone) advisory lock — that is what makes
 * the cooldown/caps exact under concurrency. Prisma's default
 * interactive-transaction timeout (5s) would be too small, so the
 * timeout is set explicitly to twice the provider cap; maxWait bounds
 * time spent waiting for a pooled connection (the pool's own
 * connectionTimeoutMillis is also 5s). The pool's server-side
 * statement_timeout (15s by default, see db.ts) additionally bounds
 * how long the lock-acquisition statement itself may wait. The lock's
 * blast radius is a single phone at a single gym: other phones
 * proceed in parallel on other connections, and a transaction that
 * still times out fails closed with a rollback — no partial
 * challenge state.
 */
const ISSUE_TRANSACTION_MAX_WAIT_MS = 5_000;
const ISSUE_TRANSACTION_TIMEOUT_MS = 20_000;

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
 * caps, generate the OTP and its digest, deliver the code via the SMS
 * provider, then persist the challenge — all serialized per
 * (organization, phone) by an advisory lock inside one transaction.
 *
 * Ordering guarantees:
 * - The advisory lock is taken first, and the cooldown/cap reads run
 *   inside the transaction, so they observe every previously committed
 *   issuance for this pair — concurrent requests queue instead of all
 *   passing the checks.
 * - The HMAC secret is validated BEFORE anything is sent, so no message
 *   is ever dispatched that the application could not verify later.
 * - The provider is called BEFORE the row is created, and superseding
 *   happens after a successful send: if the provider call fails, the
 *   transaction rolls back — no PENDING challenge is left behind and
 *   the previous pending challenge is never superseded.
 * - The challenge id is generated up front because the digest binds it.
 */
export async function issueChallenge(input: {
  organizationId: string;
  phoneNumber: string;
}): Promise<{ challengeId: string }> {
  const { organizationId, phoneNumber } = input;

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"member-otp-issue:" + organizationId + ":" + phoneNumber}))`;

      const now = new Date();
      const hourAgo = new Date(now.getTime() - ONE_HOUR_MS);

      const [latest, phoneCount, orgCount] = await Promise.all([
        tx.memberOtpChallenge.findFirst({
          where: { organizationId, phoneNumber },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        tx.memberOtpChallenge.count({
          where: { organizationId, phoneNumber, createdAt: { gt: hourAgo } },
        }),
        tx.memberOtpChallenge.count({
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

      await tx.memberOtpChallenge.updateMany({
        where: { organizationId, phoneNumber, status: "PENDING" },
        data: { status: "SUPERSEDED" },
      });

      const challenge = await tx.memberOtpChallenge.create({
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
    },
    {
      maxWait: ISSUE_TRANSACTION_MAX_WAIT_MS,
      timeout: ISSUE_TRANSACTION_TIMEOUT_MS,
    },
  );
}

/**
 * Atomically record one failed verification attempt.
 *
 * The increment is a single conditional UPDATE (… WHERE attempts < max),
 * which PostgreSQL serializes on the row: concurrent attempts can
 * neither lose an increment nor push the count past the maximum. When
 * the increment lands exactly on the maximum, the challenge locks.
 * State transitions here are conditional on the row still being
 * PENDING, so a concurrent successful verification is never undone.
 */
async function recordFailedAttempt(challengeId: string): Promise<void> {
  const incremented = await db.memberOtpChallenge.updateMany({
    where: {
      id: challengeId,
      status: "PENDING",
      attempts: { lt: OTP_MAX_VERIFY_ATTEMPTS },
    },
    data: { attempts: { increment: 1 } },
  });
  if (incremented.count === 0) {
    // Concurrent attempts already exhausted the budget (or the
    // challenge left PENDING); nothing further to record.
    return;
  }
  const row = await db.memberOtpChallenge.findFirst({
    where: { id: challengeId },
    select: { attempts: true, status: true },
  });
  if (row && row.status === "PENDING" && row.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await db.memberOtpChallenge.updateMany({
      where: {
        id: challengeId,
        status: "PENDING",
        attempts: { gte: OTP_MAX_VERIFY_ATTEMPTS },
      },
      data: { status: "LOCKED" },
    });
  }
}

/**
 * Verify an entered OTP against a challenge, locally.
 *
 * Tenant-scoped: the challenge is looked up by id AND organization, so a
 * challenge from another gym fails identically to a missing one. Only
 * PENDING challenges can verify; expiry is enforced app-side; the
 * entered code is compared against the stored digest in constant time;
 * a wrong code records an atomic failed attempt (see
 * recordFailedAttempt) and locks the challenge at the maximum; success
 * flips VERIFIED through a conditional update (single-use). A
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
    await db.memberOtpChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    throw new OtpVerificationError();
  }
  if (challenge.attempts >= OTP_MAX_VERIFY_ATTEMPTS) {
    await db.memberOtpChallenge.updateMany({
      where: { id: challenge.id, status: "PENDING" },
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
    await recordFailedAttempt(challenge.id);
    throw new OtpVerificationError();
  }

  const claimed = await db.memberOtpChallenge.updateMany({
    where: { id: challenge.id, status: "PENDING" },
    data: { status: "VERIFIED", verifiedAt: now },
  });
  if (claimed.count === 0) {
    // A concurrent request with the same correct code won the
    // transition. That is the same proof, so it succeeds identically;
    // anything else (a concurrent lock/expiry) fails generically.
    const row = await db.memberOtpChallenge.findFirst({
      where: { id: challenge.id },
      select: { status: true },
    });
    if (!row || row.status !== "VERIFIED") {
      throw new OtpVerificationError();
    }
  }
  return { verified: true, phoneNumber: challenge.phoneNumber };
}
