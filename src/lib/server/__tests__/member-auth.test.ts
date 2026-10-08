import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockMemberFindFirst,
  mockChallengeFindFirst,
  mockChallengeCount,
  mockChallengeCreate,
  mockChallengeUpdate,
  mockChallengeUpdateMany,
  mockSendOtp,
  mockVerifyOtp,
} = vi.hoisted(() => ({
  mockMemberFindFirst: vi.fn(),
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
    member: { findFirst: mockMemberFindFirst },
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

import { MemberValidationError } from "@/lib/members";
import { requestMemberOtp, verifyMemberOtp } from "@/lib/server/member-auth";
import { OtpVerificationError } from "@/lib/server/otp-service";

const ORG_ID = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const PHONE = "9876543210";
const CHALLENGE_ID = "a12b3c4d-5e6f-47a8-b9c0-0a1b2c3d4e5f";
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  vi.clearAllMocks();
  mockChallengeUpdate.mockResolvedValue({});
  mockChallengeUpdateMany.mockResolvedValue({ count: 0 });
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
    mockSendOtp.mockResolvedValue({ providerSessionId: "provider-session-xyz" });
    mockChallengeCreate.mockResolvedValue({ id: CHALLENGE_ID });

    const result = await requestMemberOtp({ organizationId: ORG_ID, phoneNumber: PHONE });
    expect(result).toEqual({ challengeId: CHALLENGE_ID });
    expect(mockSendOtp).toHaveBeenCalledWith(PHONE);
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
});

describe("verifyMemberOtp", () => {
  it("rejects a malformed OTP generically without calling the provider", async () => {
    for (const otp of ["12345", "abcdef", "1234567", ""]) {
      await expect(
        verifyMemberOtp({ organizationId: ORG_ID, challengeId: CHALLENGE_ID, otp }),
      ).rejects.toBeInstanceOf(OtpVerificationError);
    }
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockChallengeUpdate).not.toHaveBeenCalled();
  });

  it("returns verified=true on success", async () => {
    mockChallengeFindFirst.mockResolvedValue({
      id: CHALLENGE_ID,
      organizationId: ORG_ID,
      phoneNumber: PHONE,
      providerSessionId: "provider-session-xyz",
      status: "PENDING",
      attempts: 0,
      expiresAt: new Date(Date.now() + 5 * 60_000),
      verifiedAt: null,
    });
    mockVerifyOtp.mockResolvedValue({ verified: true });

    const result = await verifyMemberOtp({
      organizationId: ORG_ID,
      challengeId: CHALLENGE_ID,
      otp: "123456",
    });
    expect(result).toEqual({ verified: true });
  });
});
