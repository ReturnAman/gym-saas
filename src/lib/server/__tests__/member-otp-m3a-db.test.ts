import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { env } from "@/lib/server/env";

/**
 * Phase M3a database/concurrency coverage (skipped unless RUN_DB_TESTS=true).
 *
 * Exercises the real PostgreSQL behavior the unit mocks cannot:
 * - Issuance serialization: concurrent OTP requests for one
 *   (organization, phone) dispatch exactly one SMS (advisory lock).
 * - Atomic verify attempts: concurrent wrong codes can neither lose
 *   increments nor exceed the five-attempt budget.
 * - Bucket atomicity: parallel increments across TWO connection pools
 *   (i.e. two application replicas) produce one exact shared count.
 * - Enforce-mode folding: an exceeded IP bucket yields the synthetic
 *   response; shadow mode with the same bucket still issues.
 *
 * APITxT is mocked at the provider boundary; no SMS is sent.
 */
const runDbTests = process.env.RUN_DB_TESTS === "true";

const { mockSendOtp, sentOtps } = vi.hoisted(() => ({
  mockSendOtp: vi.fn(),
  sentOtps: [] as Array<{ phoneNumber: string; otp: string }>,
}));

vi.mock("@/lib/server/apitxt-provider", () => ({
  apiTxtProvider: { sendOtp: mockSendOtp },
}));

import { db } from "@/lib/server/db";
import { requestMemberOtp } from "@/lib/server/member-auth";
import {
  OtpVerificationError,
  verifyChallenge,
} from "@/lib/server/otp-service";
import {
  OTP_REQUEST_IP_BUCKET_KIND,
  OTP_REQUEST_IP_LIMIT_PER_HOUR,
  getRateLimitBucketCount,
  hourWindowStart,
  incrementRateLimitBucket,
} from "@/lib/server/rate-limit";

const TEST_SECRET = "test-otp-hmac-secret-0123456789abcdef";
const TEST_RATE_SECRET = "test-rate-limit-secret-0123456789abcd";

let phoneSeq = 8500;
function nextPhone(): string {
  phoneSeq += 1;
  return `98${String(phoneSeq).padStart(8, "0")}`;
}

let secondClient: PrismaClient;

/** Organizations this suite created; cleanup is scoped to these ids. */
const createdOrgIds: string[] = [];
/** Bucket keys this suite uses; bucket cleanup is scoped to them. */
const SUITE_KEY_HASHES = ["c", "d", "e", "f"].map((ch) => ch.repeat(64));

async function cleanupSuiteData(): Promise<void> {
  // The DB suites share one database across parallel workers, so
  // cleanup must never touch another suite's rows (the repo pattern).
  await db.rateLimitBucket.deleteMany({
    where: { keyHash: { in: SUITE_KEY_HASHES } },
  });
  if (createdOrgIds.length === 0) return;
  const scope = { organizationId: { in: createdOrgIds } };
  await db.memberOtpChallenge.deleteMany({ where: scope });
  await db.member.deleteMany({ where: scope });
  await db.organizationSubscription.deleteMany({ where: scope });
  await db.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
}

async function seedGym(tag: string): Promise<{ id: string }> {
  const suffix = `${tag}-${Math.random().toString(36).slice(2, 10)}`;
  const org = await db.organization.create({
    data: { name: `M3a Gym ${suffix}` },
    select: { id: true },
  });
  createdOrgIds.push(org.id);
  // Live-trial fixture, mirroring the other OTP suites: the
  // entitlement guard fails closed without it.
  await db.organizationSubscription.create({
    data: {
      organizationId: org.id,
      trialStartedAt: new Date(),
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
    },
  });
  return org;
}

function lastSentOtp(phoneNumber: string): string {
  for (let i = sentOtps.length - 1; i >= 0; i -= 1) {
    if (sentOtps[i]!.phoneNumber === phoneNumber) return sentOtps[i]!.otp;
  }
  throw new Error(`no OTP captured for ${phoneNumber}`);
}

function wrongCodeFor(otp: string): string {
  return otp === "000000" ? "111111" : "000000";
}

describe.skipIf(!runDbTests)("member OTP M3a hardening against PostgreSQL", () => {
  beforeAll(() => {
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", TEST_SECRET);
    vi.stubEnv("RATE_LIMIT_HASH_SECRET", TEST_RATE_SECRET);
    secondClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: env.databaseUrl, max: 4 }),
    });
  });

  afterAll(async () => {
    await cleanupSuiteData();
    await secondClient.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    sentOtps.length = 0;
    mockSendOtp.mockReset();
    mockSendOtp.mockImplementation(
      async (phoneNumber: string, otp: string) => {
        sentOtps.push({ phoneNumber, otp });
      },
    );
    await cleanupSuiteData();
  });

  it("dispatches exactly one SMS under concurrent issuance for one phone (N=4, slow send)", async () => {
    const org = await seedGym("SER");
    const phone = nextPhone();
    mockSendOtp.mockImplementation(
      async (phoneNumber: string, otp: string) => {
        // Widen the race window: without serialization all four
        // requests would pass the cooldown check during this delay.
        await new Promise((resolve) => setTimeout(resolve, 75));
        sentOtps.push({ phoneNumber, otp });
      },
    );

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        requestMemberOtp({ organizationId: org.id, phoneNumber: phone, intent: "join" }),
      ),
    );

    expect(sentOtps).toHaveLength(1);
    const rows = await db.memberOtpChallenge.findMany({
      where: { organizationId: org.id, phoneNumber: phone },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("PENDING");
    const realIds = results.filter((r) => r.challengeId === rows[0]!.id);
    expect(realIds).toHaveLength(1);
  });

  it("never accepts more than five failed attempts under concurrent verification", async () => {
    const org = await seedGym("ATM");
    const phone = nextPhone();
    const { challengeId } = await requestMemberOtp({
      organizationId: org.id,
      phoneNumber: phone,
      intent: "join",
    });
    const wrong = wrongCodeFor(lastSentOtp(phone));

    const outcomes = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        verifyChallenge({ organizationId: org.id, challengeId, otp: wrong }),
      ),
    );
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      if (outcome.status === "rejected") {
        expect(outcome.reason).toBeInstanceOf(OtpVerificationError);
      }
    }

    const row = await db.memberOtpChallenge.findUnique({ where: { id: challengeId } });
    expect(row?.attempts).toBe(5);
    expect(row?.status).toBe("LOCKED");

    // The correct code cannot revive a locked challenge.
    await expect(
      verifyChallenge({ organizationId: org.id, challengeId, otp: lastSentOtp(phone) }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
  });

  it("counts concurrent failed attempts exactly below the cap, then still verifies", async () => {
    const org = await seedGym("CNT");
    const phone = nextPhone();
    const { challengeId } = await requestMemberOtp({
      organizationId: org.id,
      phoneNumber: phone,
      intent: "join",
    });
    const correct = lastSentOtp(phone);
    const wrong = wrongCodeFor(correct);

    await Promise.allSettled(
      Array.from({ length: 3 }, () =>
        verifyChallenge({ organizationId: org.id, challengeId, otp: wrong }),
      ),
    );
    const row = await db.memberOtpChallenge.findUnique({ where: { id: challengeId } });
    expect(row?.attempts).toBe(3);
    expect(row?.status).toBe("PENDING");

    await expect(
      verifyChallenge({ organizationId: org.id, challengeId, otp: correct }),
    ).resolves.toEqual({ verified: true, phoneNumber: phone });
  });

  it("keeps one exact bucket count across two connection pools (two replicas)", async () => {
    const keyHash = "c".repeat(64);
    const otherKeyHash = "d".repeat(64);

    await Promise.all([
      ...Array.from({ length: 10 }, () =>
        incrementRateLimitBucket({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash }),
      ),
      ...Array.from({ length: 10 }, () =>
        incrementRateLimitBucket({
          kind: OTP_REQUEST_IP_BUCKET_KIND,
          keyHash,
          client: secondClient,
        }),
      ),
    ]);

    await expect(
      getRateLimitBucketCount({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash }),
    ).resolves.toBe(20);
    // A different key has an independent bucket.
    await expect(
      getRateLimitBucketCount({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash: otherKeyHash }),
    ).resolves.toBe(0);
    await incrementRateLimitBucket({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash: otherKeyHash });
    await expect(
      getRateLimitBucketCount({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash: otherKeyHash }),
    ).resolves.toBe(1);
    await expect(
      getRateLimitBucketCount({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash }),
    ).resolves.toBe(20);
  });

  it("folds an exceeded IP bucket into the synthetic response in enforce mode only", async () => {
    const org = await seedGym("ENF");
    const phone = nextPhone();
    await db.member.create({
      data: { organizationId: org.id, name: "M3a Member", phoneNumber: phone },
    });
    const ipKeyHash = "e".repeat(64);
    for (let i = 0; i < OTP_REQUEST_IP_LIMIT_PER_HOUR; i += 1) {
      await incrementRateLimitBucket({ kind: OTP_REQUEST_IP_BUCKET_KIND, keyHash: ipKeyHash });
    }

    // Shadow (the default): the same over-limit bucket changes nothing.
    vi.stubEnv("RATE_LIMIT_IP_MODE", "shadow");
    const shadowResult = await requestMemberOtp({
      organizationId: org.id,
      phoneNumber: phone,
      ipKeyHash,
    });
    expect(sentOtps).toHaveLength(1);
    expect(
      await db.memberOtpChallenge.findUnique({ where: { id: shadowResult.challengeId } }),
    ).not.toBeNull();

    // Enforce: the next request from this IP folds to synthetic — no
    // SMS, no challenge row, indistinguishable response shape.
    vi.stubEnv("RATE_LIMIT_IP_MODE", "enforce");
    const phone2 = nextPhone();
    await db.member.create({
      data: { organizationId: org.id, name: "M3a Member Two", phoneNumber: phone2 },
    });
    const enforced = await requestMemberOtp({
      organizationId: org.id,
      phoneNumber: phone2,
      ipKeyHash,
    });
    expect(sentOtps).toHaveLength(1);
    expect(
      await db.memberOtpChallenge.findUnique({ where: { id: enforced.challengeId } }),
    ).toBeNull();

    // A different IP key is unaffected and issues normally.
    const other = await requestMemberOtp({
      organizationId: org.id,
      phoneNumber: phone2,
      ipKeyHash: "f".repeat(64),
    });
    expect(sentOtps).toHaveLength(2);
    expect(
      await db.memberOtpChallenge.findUnique({ where: { id: other.challengeId } }),
    ).not.toBeNull();
  });
});
