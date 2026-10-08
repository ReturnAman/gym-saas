import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockChallengeFindFirst,
  mockChallengeCount,
  mockChallengeCreate,
  mockChallengeUpdate,
  mockChallengeUpdateMany,
  mockSendOtp,
  mockVerifyOtp,
} = vi.hoisted(() => ({
  mockChallengeFindFirst: vi.fn(),
  mockChallengeCount: vi.fn(),
  mockChallengeCreate: vi.fn(),
  mockChallengeUpdate: vi.fn(),
  mockChallengeUpdateMany: vi.fn(),
  mockSendOtp: vi.fn(),
  mockVerifyOtp: vi.fn(),
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

vi.mock("@/lib/server/twofactor-provider", () => ({
  twoFactorProvider: { sendOtp: mockSendOtp, verifyOtp: mockVerifyOtp },
}));

import { SmsProviderError } from "@/lib/server/sms-provider";
import {
  OTP_MAX_VERIFY_ATTEMPTS,
  OtpRateLimitError,
  OtpVerificationError,
  issueChallenge,
  verifyChallenge,
} from "@/lib/server/otp-service";

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const PHONE = "9876543210";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const SESSION_ID = "provider-session-xyz";

function pendingChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: CHALLENGE_ID,
    organizationId: ORG_ID,
    phoneNumber: PHONE,
    providerSessionId: SESSION_ID,
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
  mockChallengeUpdate.mockResolvedValue({});
  mockChallengeUpdateMany.mockResolvedValue({ count: 0 });
});

describe("issueChallenge", () => {
  it("sends via the provider, supersedes the old pending challenge, and persists the new one", async () => {
    mockNoRateLimits();
    mockSendOtp.mockResolvedValue({ providerSessionId: SESSION_ID });
    mockChallengeCreate.mockResolvedValue({ id: CHALLENGE_ID });

    const result = await issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });

    expect(mockSendOtp).toHaveBeenCalledWith(PHONE);
    expect(mockChallengeUpdateMany).toHaveBeenCalledWith({
      where: { organizationId: ORG_ID, phoneNumber: PHONE, status: "PENDING" },
      data: { status: "SUPERSEDED" },
    });
    const createData = mockChallengeCreate.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      providerSessionId: SESSION_ID,
      status: "PENDING",
      attempts: 0,
    });
    expect(createData.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // The challenge row must never carry an OTP.
    expect(createData).not.toHaveProperty("otp");
    expect(createData).not.toHaveProperty("code");
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

  it("leaves no pending challenge behind when the provider call fails", async () => {
    mockNoRateLimits();
    mockSendOtp.mockRejectedValue(new SmsProviderError("PROVIDER_UNAVAILABLE"));
    await expect(
      issueChallenge({ organizationId: ORG_ID, phoneNumber: PHONE }),
    ).rejects.toBeInstanceOf(SmsProviderError);
    expect(mockChallengeCreate).not.toHaveBeenCalled();
    expect(mockChallengeUpdateMany).not.toHaveBeenCalled();
  });
});

describe("verifyChallenge", () => {
  it("marks the challenge VERIFIED on a correct OTP", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge());
    mockVerifyOtp.mockResolvedValue({ verified: true });

    const result = await verifyChallenge({
      organizationId: ORG_ID,
      challengeId: CHALLENGE_ID,
      otp: "123456",
    });
    expect(result).toEqual({ verified: true, phoneNumber: PHONE });
    expect(mockVerifyOtp).toHaveBeenCalledWith(SESSION_ID, "123456");
    const updateData = mockChallengeUpdate.mock.calls[0]?.[0];
    expect(updateData.where).toEqual({ id: CHALLENGE_ID });
    expect(updateData.data.status).toBe("VERIFIED");
    expect(updateData.data.verifiedAt).toBeInstanceOf(Date);
  });

  it("looks the challenge up tenant-scoped (id + organization)", async () => {
    mockChallengeFindFirst.mockResolvedValue(null);
    await expect(
      verifyChallenge({
        organizationId: "another-org",
        challengeId: CHALLENGE_ID,
        otp: "123456",
      }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeFindFirst).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID, organizationId: "another-org" },
    });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("increments attempts on a wrong OTP", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ attempts: 1 }));
    mockVerifyOtp.mockResolvedValue({ verified: false });
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "000000" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { attempts: 2 },
    });
  });

  it("locks the challenge when the failed attempt reaches the maximum", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ attempts: OTP_MAX_VERIFY_ATTEMPTS - 1 }),
    );
    mockVerifyOtp.mockResolvedValue({ verified: false });
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "000000" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { attempts: OTP_MAX_VERIFY_ATTEMPTS, status: "LOCKED" },
    });
  });

  it("rejects an expired challenge without calling the provider", async () => {
    mockChallengeFindFirst.mockResolvedValue(
      pendingChallenge({ expiresAt: new Date(Date.now() - 1_000) }),
    );
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "123456" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockChallengeUpdate).toHaveBeenCalledWith({
      where: { id: CHALLENGE_ID },
      data: { status: "EXPIRED" },
    });
  });

  it("rejects a second verification (single-use)", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge({ status: "VERIFIED" }));
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "123456" }),
    ).rejects.toBeInstanceOf(OtpVerificationError);
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });

  it("does not consume an attempt when the provider is unavailable", async () => {
    mockChallengeFindFirst.mockResolvedValue(pendingChallenge());
    mockVerifyOtp.mockRejectedValue(new SmsProviderError("PROVIDER_UNAVAILABLE"));
    await expect(
      verifyChallenge({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp: "123456" }),
    ).rejects.toBeInstanceOf(SmsProviderError);
    expect(mockChallengeUpdate).not.toHaveBeenCalled();
  });
});
