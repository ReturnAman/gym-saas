import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMemberFindFirst,
  mockChallengeFindFirst,
  mockChallengeCount,
  mockChallengeCreate,
  mockChallengeUpdate,
  mockChallengeUpdateMany,
  mockSendOtp,
  mockCheckOtpRequestIpLimit,
  mockTransaction,
  mockTxExecuteRaw,
} = vi.hoisted(() => ({
  mockMemberFindFirst: vi.fn(),
  mockChallengeFindFirst: vi.fn(),
  mockChallengeCount: vi.fn(),
  mockChallengeCreate: vi.fn(),
  mockChallengeUpdate: vi.fn(),
  mockChallengeUpdateMany: vi.fn(),
  mockSendOtp: vi.fn(),
  mockCheckOtpRequestIpLimit: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxExecuteRaw: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    member: { findFirst: mockMemberFindFirst },
    memberOtpChallenge: {
      findFirst: mockChallengeFindFirst,
      count: mockChallengeCount,
      create: mockChallengeCreate,
      update: mockChallengeUpdate,
      updateMany: mockChallengeUpdateMany,
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/server/apitxt-provider", () => ({
  apiTxtProvider: { sendOtp: mockSendOtp },
}));

vi.mock("@/lib/server/rate-limit", () => ({
  checkOtpRequestIpLimit: mockCheckOtpRequestIpLimit,
}));

import { MemberValidationError } from "@/lib/members";
import { requestMemberOtp, verifyMemberOtp } from "@/lib/server/member-auth";
import { computeOtpHash } from "@/lib/server/otp-crypto";
import { OtpVerificationError } from "@/lib/server/otp-service";
import { SmsProviderError } from "@/lib/server/sms-provider";

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const PHONE = "9876543210";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OTP_SHAPE = /^[0-9]{6}$/;
const TEST_OTP_SECRET = "test-otp-hmac-secret-0123456789abcdef";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEMBER_OTP_HMAC_SECRET", TEST_OTP_SECRET);
  mockChallengeUpdate.mockResolvedValue({});
  mockChallengeUpdateMany.mockResolvedValue({ count: 1 });
  mockCheckOtpRequestIpLimit.mockResolvedValue("ok");
  mockTxExecuteRaw.mockResolvedValue(1);
  mockTransaction.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        memberOtpChallenge: {
          findFirst: mockChallengeFindFirst,
          count: mockChallengeCount,
          create: mockChallengeCreate,
          update: mockChallengeUpdate,
          updateMany: mockChallengeUpdateMany,
        },
        $executeRaw: mockTxExecuteRaw,
      }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestMemberOtp", () => {
  it("returns a synthetic challenge and sends nothing for an ineligible phone", async () => {
    // Anti-enumeration: no Member row with this phone in this gym.
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await requestMemberOtp({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(result.challengeId).not.toBe(CHALLENGE_ID);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
    // Eligibility was checked tenant-scoped.
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, phoneNumber: PHONE },
      select: { id: true },
    });
  });

  it("creates a real challenge for an eligible phone", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: "member-id" });
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockResolvedValue(0);
    mockSendOtp.mockResolvedValue(undefined);
    mockChallengeCreate.mockResolvedValue({ id: CHALLENGE_ID });

    const result = await requestMemberOtp({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });
    expect(mockSendOtp).toHaveBeenCalledWith(PHONE, expect.stringMatching(OTP_SHAPE));
    expect(mockChallengeCreate).toHaveBeenCalledTimes(1);
  });

  it("returns a synthetic challenge when rate-limited (indistinguishable from ineligible)", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: "member-id" });
    // Latest challenge is brand new → resend cooldown trips inside issueChallenge.
    mockChallengeFindFirst.mockResolvedValue({ createdAt: new Date() });
    mockChallengeCount.mockResolvedValue(0);

    const result = await requestMemberOtp({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone number as a validation error", async () => {
    await expect(
      requestMemberOtp({ organizationId: ORG_ID, phoneNumber: "+919876543210" }),
    ).rejects.toBeInstanceOf(MemberValidationError);
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  /** Baseline mocks under which issueChallenge issues a real challenge. */
  function mockIssuableChallenge() {
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockResolvedValue(0);
    mockSendOtp.mockResolvedValue(undefined);
    mockChallengeCreate.mockResolvedValue({ id: CHALLENGE_ID });
  }

  it("issues a real challenge for a member phone under join intent, without the eligibility check", async () => {
    mockIssuableChallenge();

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
    });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });
    // The member-row eligibility check belongs to the link rule only.
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockSendOtp).toHaveBeenCalledWith(PHONE, expect.stringMatching(OTP_SHAPE));
    expect(mockChallengeCreate).toHaveBeenCalledTimes(1);
  });

  it("issues a real challenge for a brand-new phone under join intent", async () => {
    // No Member row exists — under the link rule this phone is
    // ineligible; join intent is what makes it issuable.
    mockMemberFindFirst.mockResolvedValue(null);
    mockIssuableChallenge();

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
    });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockSendOtp).toHaveBeenCalledWith(PHONE, expect.stringMatching(OTP_SHAPE));
    expect(mockChallengeCreate).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit link intent on the eligibility rule for a new phone", async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "link",
    });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(result.challengeId).not.toBe(CHALLENGE_ID);
    expect(mockMemberFindFirst).toHaveBeenCalledTimes(1);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("normalizes unrecognized intent values to the link rule (fail-safe)", async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    for (const intent of ["JOIN", "banana", ""]) {
      const result = await requestMemberOtp({
        organizationId: ORG_ID,
        phoneNumber: PHONE,
        intent,
      });
      expect(result.challengeId).toMatch(UUID_SHAPE);
      expect(result.challengeId).not.toBe(CHALLENGE_ID);
    }
    // Every unrecognized value took the eligibility-checked path.
    expect(mockMemberFindFirst).toHaveBeenCalledTimes(3);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("returns a synthetic challenge when a join request trips the resend cooldown", async () => {
    // Latest challenge is brand new → cooldown trips inside
    // issueChallenge, and the facade folds it into the same synthetic
    // response as every other non-issuance.
    mockChallengeFindFirst.mockResolvedValue({ createdAt: new Date() });
    mockChallengeCount.mockResolvedValue(0);

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
    });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(result.challengeId).not.toBe(CHALLENGE_ID);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("returns a synthetic challenge when a join request trips the hourly phone cap", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    // The mocked count serves both the per-phone and per-gym counts;
    // 5 trips the per-phone cap (OTP_MAX_REQUESTS_PER_PHONE_PER_HOUR).
    mockChallengeCount.mockResolvedValue(5);

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
    });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(result.challengeId).not.toBe(CHALLENGE_ID);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("propagates a provider failure on the join path (the route renders 503)", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockResolvedValue(0);
    mockSendOtp.mockRejectedValue(new SmsProviderError("PROVIDER_UNAVAILABLE"));

    await expect(
      requestMemberOtp({
        organizationId: ORG_ID,
        phoneNumber: PHONE,
        intent: "join",
      }),
    ).rejects.toBeInstanceOf(SmsProviderError);
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });
});

describe("requestMemberOtp per-IP ceiling (Phase M3a)", () => {
  const IP_KEY = "b".repeat(64);

  it("folds an enforce-mode exceedance into the synthetic response, before any eligibility or issuance work", async () => {
    mockCheckOtpRequestIpLimit.mockResolvedValue("exceeded");

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      intent: "join",
      ipKeyHash: IP_KEY,
    });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(result.challengeId).not.toBe(CHALLENGE_ID);
    expect(mockCheckOtpRequestIpLimit).toHaveBeenCalledWith(IP_KEY);
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("issues normally when the IP check passes", async () => {
    mockMemberFindFirst.mockResolvedValue({ id: "member-id" });
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockResolvedValue(0);
    mockSendOtp.mockResolvedValue(undefined);
    mockChallengeCreate.mockResolvedValue({ id: CHALLENGE_ID });

    const result = await requestMemberOtp({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      ipKeyHash: IP_KEY,
    });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });
    expect(mockCheckOtpRequestIpLimit).toHaveBeenCalledWith(IP_KEY);
    expect(mockChallengeCreate).toHaveBeenCalledTimes(1);
  });

  it("does not consult the IP limiter when the request has no IP key", async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await requestMemberOtp({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result.challengeId).toMatch(UUID_SHAPE);
    expect(mockCheckOtpRequestIpLimit).not.toHaveBeenCalled();
  });
});

describe("verifyMemberOtp", () => {
  it("rejects a malformed OTP generically without touching the challenge", async () => {
    for (const otp of ["12345", "abcdef", "1234567", ""]) {
      await expect(
        verifyMemberOtp({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp }),
      ).rejects.toBeInstanceOf(OtpVerificationError);
    }
    expect(mockChallengeFindFirst).not.toHaveBeenCalled();
    expect(mockChallengeUpdate).not.toHaveBeenCalled();
  });

  it("returns verified=true on success", async () => {
    mockChallengeFindFirst.mockResolvedValue({
      id: CHALLENGE_ID,
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      otpHash: computeOtpHash(TEST_OTP_SECRET, {
        organizationId: ORG_ID,
        challengeId: CHALLENGE_ID,
        phoneNumber: PHONE,
        otp: "123456",
      }),
      status: "PENDING",
      attempts: 0,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      verifiedAt: null,
    });

    const result = await verifyMemberOtp({
      organizationId: ORG_ID,
      challengeId: CHALLENGE_ID,
      otp: "123456",
    });
    expect(result).toEqual({ verified: true });
  });
});
