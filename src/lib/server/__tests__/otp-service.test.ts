import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockChallengeFindFirst,
  mockChallengeCount,
  mockChallengeCreate,
  mockChallengeUpdate,
  mockChallengeUpdateMany,
  mockSendOtp,
} = vi.hoisted(() => ({
  mockChallengeFindFirst: vi.fn(),
  mockChallengeCount: vi.fn(),
  mockChallengeCreate: vi.fn(),
  mockChallengeUpdate: vi.fn(),
  mockChallengeUpdateMany: vi.fn(),
  mockSendOtp: vi.fn(),
}));

vi.mock("@/lib/server/db", () => ({
  db: {
    memberOtpChallenge: {
      findFirst: mockChallengeFindFirst,
      count: mockChallengeCount,
      create: mockChallengeCreate,
      update: mockChallengeUpdate,
      updateMany: mockChallengeUpdateMany,
    },
  },
}));

vi.mock("@/lib/server/apitxt-provider", () => ({
  apiTxtProvider: { sendOtp: mockSendOtp },
}));

import { computeOtpHash } from "@/lib/server/otp-crypto";
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  OtpRateLimitError,
  OtpVerificationError,
  issueChallenge,
  verifyChallenge,
} from "@/lib/server/otp-service";
import { SmsProviderError } from "@/lib/server/sms-provider";

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const PHONE = "9876543210";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const SECRET = "test-otp-hmac-secret-0123456789abcdef";
const CORRECT_OTP = "123456";

function hashFor(otp: string, challengeId = CHALLENGE_ID, orgId = ORG_ID) {
  return computeOtpHash(SECRET, {
    organizationId: orgId,
    challengeId,
    phoneNumber: PHONE,
    otp,
  });
}

function pendingChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: CHALLENGE_ID,
    organizationId: ORG_ID,
    phoneNumber: PHONE,
    otpHash: hashFor(CORRECT_OTP),
    status: "PENDING",
    attempts: 0,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    verifiedAt: null,
    ...overrides,
  };
}

/** No recent challenges, no counts — the happy-path rate-limit baseline. */
function mockNoRateLimits() {
  mockChallengeFindFirst.mockResolvedValue(null);
  mockChallengeCount.mockResolvedValue(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MEMBER_OTP_HMAC_SECRET", SECRET);
  mockChallengeUpdateMany.mockResolvedValue({ count: 1 });
  mockChallengeUpdate.mockResolvedValue({});
  // The create mock echoes the service-generated id, as the real
  // database does when the row is inserted with an explicit id.
  mockChallengeCreate.mockImplementation(
    async (args: { data: { id: string } }) => ({ id: args.data.id }),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("issueChallenge", () => {
  it("delivers an app-generated OTP, supersedes the old pending challenge, and persists only its digest", async () => {
    mockNoRateLimits();
    mockSendOtp.mockResolvedValue(undefined);

    const result = await issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE });

    // The provider received the phone and an application-generated
    // six-digit code — delivery only, no session comes back.
    expect(mockSendOtp).toHaveBeenCalledTimes(1);
    const [sentPhone, sentOtp] = mockSendOtp.mock.calls[0] as [string, string];
    expect(sentPhone).toBe(PHONE);
    expect(sentOtp).toMatch(/^[0-9]{6}$/);

    expect(mockChallengeUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, phoneNumber: PHONE, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });

    const createData = mockChallengeCreate.mock.calls[0]?.[0].data;
    expect(result).toEqual({ challengeId: createData.id });
    // The digest is the HMAC of the DELIVERED code, bound to this
    // challenge — recomputed independently here.
    expect(createData.otpHash).toBe(
      computeOtpHash(SECRET, {
        organizationId: ORG_ID,
        challengeId: createData.id,
        phoneNumber: PHONE,
        otp: sentOtp,
      }),
    );
    expect(createData).toMatchObject({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      status: "PENDING",
      attempts: 0,
    });
    expect(createData.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // The challenge row must never carry the plaintext OTP.
    expect(createData).not.toHaveProperty("otp");
    expect(createData).not.toHaveProperty("code");
    expect(createData.otpHash).not.toBe(sentOtp);
    expect(createData.otpHash).not.toContain(sentOtp);
  });

  it("enforces the resend cooldown from the latest challenge", async () => {
    mockChallengeFindFirst.mockResolvedValue({ createdAt: new Date() });
    mockChallengeCount.mockResolvedValue(0);
    await expect(
      issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE }),
    ).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
  });

  it("enforces the per-phone hourly request cap", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockImplementation(
      async (args: { where: Record<string, unknown> }) =>
        args.where.phoneNumber ? 5 : 0,
    );
    await expect(
      issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE }),
    ).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("enforces the per-organization hourly request cap", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    mockChallengeCount.mockImplementation(
      async (args: { where: Record<string, unknown> }) =>
        args.where.phoneNumber ? 0 : 100,
    );
    await expect(
      issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE }),
    ).rejects.toBeInstanceOf(OtpRateLimitError);
    expect(mockSendOtp).not.toHaveBeenCalled();
  });

  it("leaves no pending challenge behind and does not supersede when the provider call fails", async () => {
    mockNoRateLimits();
    mockSendOtp.mockRejectedValue(new SmsProviderError("PROVIDER_UNAVAILABLE"));
    await expect(
      issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE }),
    ).rejects.toBeInstanceOf(SmsProviderError);
    expect(mockChallengeCreate).not.toHaveBeenCalled();
    expect(mockChallengeUpdateMany).not.toHaveBeenCalled();
  });

  it("sends nothing when the HMAC secret is missing or too short", async () => {
    mockNoRateLimits();
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "");
    const missing = await issueChallenge({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
    }).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(SmsProviderError);
    expect((missing as SmsProviderError).code).toBe("NOT_CONFIGURED");

    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "too-short");
    const short = await issueChallenge({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
    }).catch((e: unknown) => e);
    expect(short).toBeInstanceOf(SmsProviderError);
    expect((short as SmsProviderError).code).toBe("NOT_CONFIGURED");

    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeCreate).not.toHaveBeenCalled();
    expect(mockChallengeUpdateMany).not.toHaveBeenCalled();
  });
});

describe("verifyChallenge", () => {
  it("marks the challenge VERIFIED on the correct OTP, without any provider call", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge());

    const result = await verifyChallenge({
      organizationId: ORG_ID,
      challengeId: CHALLENGE_ID,
      otp: CORRECT_OTP,
    });
    expect(result).toEqual({ verified: true, phoneNumber: PHONE });
    // Verification is purely local in the new model.
    expect(mockSendOtp).not.toHaveBeenCalled();
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { status: "VERIFIED", verifiedAt: expect.any(Date) },
    });
  });

  it("looks the challenge up tenant-scoped (id + organization)", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    await expect(
      verifyChallenge({
        organizationId: "another-org",
        challengeId: CHALLENGE_ID,
        otp: CORRECT_OTP,
      }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeFindFirst).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID, organizationId: "another-org" },
    });
  });

  it("fails generically when the digest was bound to another organization", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ otpHash: hashFor(CORRECT_OTP, CHALLENGE_ID, "another-org") }),
    );
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
  });

  it("increments attempts on a wrong OTP", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ attempts: 1 }));
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "000000" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { attempts: 2 },
    });
  });

  it("locks the challenge when the increment lands on the maximum", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ attempts: OTP_MAX_VERIFY_ATTEMPTS - 1 }),
    );
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "000000" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { attempts: OTP_MAX_VERIFY_ATTEMPTS, status: "LOCKED" },
    });
  });

  it("locks a PENDING challenge whose attempts are already at the maximum", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ attempts: OTP_MAX_VERIFY_ATTEMPTS }),
    );
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { status: "LOCKED" },
    });
  });

  it("rejects an expired challenge and marks it EXPIRED", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { status: "EXPIRED" },
    });
  });

  it("rejects non-PENDING challenges (single-use, superseded, locked)", async () => {
    for (const status of ["VERIFIED", "SUPERSEDED", "LOCKED", "EXPIRED"]) {
      mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ status }));
      await expect(
        verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
      ).rejects.toBeInstanceOf(OtpVerificationError);
    }
    expect(mockChallengeUpdate).not.toHaveBeenCalled();
  });

  it("fails generically for a challenge with a missing digest (legacy row)", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ otpHash: null }));
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
  });

  it("fails generically for a challenge with a malformed digest", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ otpHash: "zz-not-hex" }));
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: CORRECT_OTP }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
  });

  it("fails closed with the configuration error when the HMAC secret is unavailable", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge());
    vi.stubEnv("MEMBER_OTP_HMAC_SECRET", "");
    const error = await verifyChallenge({
      organizationId: ORG_ID,
      challengeId: CHALLENGE_ID,
      otp: CORRECT_OTP,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SmsProviderError);
    expect((error as SmsProviderError).code).toBe("NOT_CONFIGURED");
    // No attempt consumed and no state change on a configuration failure.
    expect(mockChallengeUpdate).not.toHaveBeenCalled();
  });
});
