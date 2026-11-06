import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The APITxT delivery provider is the only stub in this suite: sends
 * capture the application-generated code instead of dispatching an
 * SMS, and verification runs the real local digest comparison against
 * it. Everything else — the facade, the OTP service, the database —
 * is real, so the eligibility, rate-limit, and consumption guarantees
 * are proven against actual challenge rows.
 */
const { mockSendOtp } = vi.hoisted(() => ({
  mockSendOtp: vi.fn(),
}));

vi.mock("@/lib/server/apitxt-provider", () => ({
  apiTxtProvider: { sendOtp: mockSendOtp },
}));

import { db } from "@/lib/server/db";
import {
  linkMember,
  requestMemberOtp,
  submitMemberJoinRequest,
  verifyMemberOtp,
} from "@/lib/server/member-auth";
import { MemberLinkingError } from "@/lib/server/member-linking";
import { OtpVerificationError } from "@/lib/server/otp-service";

/**
 * Intent-aware OTP eligibility on a real database (opt-in:
 * RUN_DB_TESTS=true with a disposable DATABASE_URL).
 *
 * The join intent exists so a genuine newcomer — a phone with no
 * Member row in the gym — can complete OTP verification and submit a
 * join request. The guarantees pinned here: the link rule is unchanged
 * (a new phone still gets only a synthetic id and can never verify),
 * the cooldown and hourly caps count challenge rows across BOTH
 * intents (alternating intents cannot double an allowance), a
 * challenge is tenant-bound (gym A's challenge is indistinguishable
 * from a missing one at gym B), and cross-intent challenge use is
 * decided by the consuming endpoints' own rules — a join-issued
 * challenge links a member who was always linkable, fails generically
 * for a newcomer, and a link-issued challenge meets the join
 * endpoint's already-registered outcome.
 */
describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
  "member OTP join intent (database)",
  () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const createdOrgIds: string[] = [];
    const usedPhones: string[] = [];
    const sentOtps: string[] = [];
    let phoneCounter = 0;

    const TEST_OTP_SECRET = "test-otp-hmac-secret-0123456789abcdef";

    /** The code the application generated for the most recent send. */
    function lastSentOtp(): string {
      return sentOtps[sentOtps.length - 1]!;
    }

    function nextPhone(): string {
      phoneCounter += 1;
      const phone = `98${String(phoneCounter).padStart(8, "0")}`;
      usedPhones.push(phone);
      return phone;
    }

    async function seedGym(tag: string) {
      const org = await db.organization.create({
        data: { name: `OTP Intent Gym ${tag} ${suffix}` },
        select: { id: true },
      });
      createdOrgIds.push(org.id);
      // SaaS trial fixture: gyms created through onboarding carry a
      // live trial subscription; direct seeds must too, or the
      // entitlement guard (fail closed) blocks the mutations under test.
      await db.organizationSubscription.create({
        data: {
          organizationId: org.id,
          trialStartedAt: new Date(),
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
        },
      });
      return org;
    }

    async function seedMember(orgId: string, phoneNumber: string) {
      return db.member.create({
        data: {
          organizationId: orgId,
          name: "Existing Member",
          phoneNumber,
        },
        select: { id: true },
      });
    }

    async function challengeRow(id: string) {
      return db.memberOtpChallenge.findUnique({ where: { id } });
    }

    async function seedOrgCap(orgId: string) {
      await db.memberOtpChallenge.createMany({
        data: Array.from({ length: 100 }, (_, i) => ({
          organizationId: orgId,
          phoneNumber: `97${String(i).padStart(8, "0")}`,
          status: "EXPIRED" as const,
          expiresAt: new Date(Date.now() + 5 * 60_000),
        })),
      });
    }

    function joinInput(orgId: string, challengeId: string) {
      return {
        organizationId: orgId,
        challengeId,
        name: "New Person",
        requestedPlan: "MONTHLY",
        proposedFee: "1500",
        proposedStartDate: "2026-11-01",
      };
    }

    beforeAll(async () => {
      await db.$queryRaw`SELECT 1`;
    });

    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv("MEMBER_OTP_HMAC_SECRET", TEST_OTP_SECRET);
      mockSendOtp.mockImplementation(async (_phone: string, otp: string) => {
        sentOtps.push(otp);
      });
    });

    afterAll(async () => {
      if (createdOrgIds.length > 0) {
        await db.organization.deleteMany({
          where: { id: { in: createdOrgIds } },
        });
      }
      // Phone-backed users created by linking / join submission are
      // found by their phones. Organizations are deleted first so
      // their audit rows (actor-restricted) are gone.
      const users = await db.user.findMany({
        where: { phoneNumber: { in: usedPhones } },
        select: { id: true },
      });
      if (users.length > 0) {
        await db.user.deleteMany({
          where: { id: { in: users.map((u) => u.id) } },
        });
      }
      await db.$disconnect();
    });

    it("carries a genuine newcomer end-to-end: join OTP → verify → join request", async () => {
      const org = await seedGym("E2E");
      const phone = nextPhone();

      const { challengeId } = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      // A REAL challenge row exists — this is what the link rule
      // would never give a phone with no member record.
      const issued = await challengeRow(challengeId);
      expect(issued).toMatchObject({
        organizationId: org.id,
        phoneNumber: phone,
        status: "PENDING",
      });
      expect(mockSendOtp).toHaveBeenCalledWith(phone, expect.stringMatching(/^[0-9]{6}$/));

      const verified = await verifyMemberOtp({
        organizationId: org.id,
        challengeId,
        otp: lastSentOtp(),
      });
      expect(verified).toEqual({ verified: true });
      expect((await challengeRow(challengeId))?.status).toBe("VERIFIED");

      const result = await submitMemberJoinRequest(
        joinInput(org.id, challengeId),
      );
      expect(result.status).toBe("created");
      expect((await challengeRow(challengeId))?.consumedAt).not.toBeNull();
      const request = await db.memberJoinRequest.findFirst({
        where: { organizationId: org.id, phoneNumber: phone },
      });
      expect(request?.status).toBe("PENDING");
    });

    it("still gives a newcomer only a synthetic id under the link rule", async () => {
      const org = await seedGym("LINKRULE");

      for (const intent of [undefined, "link"] as const) {
        const phone = nextPhone();
        const { challengeId } = await requestMemberOtp({
          organizationId: org.id,
          phoneNumber: phone,
          intent,
        });
        // Synthetic: no row, no SMS, and verification fails generically.
        expect(await challengeRow(challengeId)).toBeNull();
        await expect(
          verifyMemberOtp({ organizationId: org.id, challengeId, otp: "123456" }),
        ).rejects.toBeInstanceOf(OtpVerificationError);
      }
      expect(mockSendOtp).not.toHaveBeenCalled();
    });

    it("counts the per-phone hourly cap across intents (alternating cannot double it)", async () => {
      const org = await seedGym("PHONECAP");
      const phone = nextPhone();
      await seedMember(org.id, phone); // eligible under the link rule too

      const intents = [undefined, "join", undefined, "join", undefined];
      for (const intent of intents) {
        const { challengeId } = await requestMemberOtp({
          organizationId: org.id,
          phoneNumber: phone,
          intent,
        });
        const row = await challengeRow(challengeId);
        expect(row?.status).toBe("PENDING");
        // Age the newest challenge past the 30s resend cooldown while
        // keeping it inside the rolling hour, so the next send is
        // judged by the hourly count alone.
        await db.memberOtpChallenge.update({
          where: { id: challengeId },
          data: { createdAt: new Date(Date.now() - 31_000) },
        });
      }
      expect(mockSendOtp).toHaveBeenCalledTimes(5);

      // The 6th send inside the hour — join intent — is synthetic.
      const sixth = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      expect(await challengeRow(sixth.challengeId)).toBeNull();
      expect(mockSendOtp).toHaveBeenCalledTimes(5);
    });

    it("applies the resend cooldown across intents in both orders", async () => {
      const org = await seedGym("COOLDOWN");

      // join first, then link: the link request hits the cooldown.
      const phoneA = nextPhone();
      await seedMember(org.id, phoneA);
      const firstA = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phoneA,
        intent: "join",
      });
      expect((await challengeRow(firstA.challengeId))?.status).toBe("PENDING");
      const secondA = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phoneA,
      });
      expect(await challengeRow(secondA.challengeId)).toBeNull();

      // link first, then join: the join request hits the cooldown.
      const phoneB = nextPhone();
      await seedMember(org.id, phoneB);
      const firstB = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phoneB,
      });
      expect((await challengeRow(firstB.challengeId))?.status).toBe("PENDING");
      const secondB = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phoneB,
        intent: "join",
      });
      expect(await challengeRow(secondB.challengeId)).toBeNull();

      // Exactly the two first sends ever reached the provider.
      expect(mockSendOtp).toHaveBeenCalledTimes(2);
    });

    it("folds a full per-gym hourly cap into the synthetic response for join intent", async () => {
      const org = await seedGym("ORGCAP");
      await seedOrgCap(org.id);

      const phone = nextPhone();
      const { challengeId } = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      expect(await challengeRow(challengeId)).toBeNull();
      expect(mockSendOtp).not.toHaveBeenCalled();
    });

    it("links a member with a join-issued challenge (endpoint rules decide)", async () => {
      const org = await seedGym("XUSE-LINK");
      const phone = nextPhone();
      const member = await seedMember(org.id, phone);

      const { challengeId } = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      await verifyMemberOtp({ organizationId: org.id, challengeId, otp: lastSentOtp() });

      // The challenge is phone-proof; linking applies its own
      // candidate rules and this member was always linkable.
      const linked = await linkMember({ organizationId: org.id, challengeId });
      expect(linked.memberId).toBe(member.id);
      const memberRow = await db.member.findUnique({
        where: { id: member.id },
      });
      expect(memberRow?.userId).toBe(linked.userId);
      expect(
        await db.memberSession.count({
          where: { organizationId: org.id, userId: linked.userId },
        }),
      ).toBe(1);
    });

    it("fails linking generically for a newcomer's join-issued challenge", async () => {
      const org = await seedGym("XUSE-NEW");
      const phone = nextPhone();

      const { challengeId } = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      await verifyMemberOtp({ organizationId: org.id, challengeId, otp: lastSentOtp() });

      // Zero candidates: linking fails with its one generic error and
      // the failed transaction leaves the challenge unconsumed.
      await expect(
        linkMember({ organizationId: org.id, challengeId }),
      ).rejects.toBeInstanceOf(MemberLinkingError);
      expect((await challengeRow(challengeId))?.consumedAt).toBeNull();
    });

    it("answers already_registered when a link-issued challenge meets the join endpoint", async () => {
      const org = await seedGym("XUSE-JOIN");
      const phone = nextPhone();
      await seedMember(org.id, phone);

      const { challengeId } = await requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
      });
      await verifyMemberOtp({ organizationId: org.id, challengeId, otp: lastSentOtp() });

      const result = await submitMemberJoinRequest(
        joinInput(org.id, challengeId),
      );
      expect(result.status).toBe("already_registered");
      expect(
        await db.memberJoinRequest.count({
          where: { organizationId: org.id, phoneNumber: phone },
        }),
      ).toBe(0);
    });

    it("serializes concurrent join requests for one phone: exactly one SMS is sent", async () => {
      const org = await seedGym("RACE");
      const phone = nextPhone();

      // The provider send stays in flight until the test releases it,
      // so the race window is genuinely open: pre-M3a, the second
      // request would also pass the cooldown check and dispatch its
      // own SMS (this test then observed two sends). With issuance
      // serialized by the (organization, phone) advisory lock, the
      // second request waits for the first to commit and then meets
      // the fresh challenge inside the resend cooldown — it folds to
      // the synthetic response and never sends.
      const releases: Array<() => void> = [];
      mockSendOtp.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releases.push(resolve);
          }),
      );

      const first = requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });
      const second = requestMemberOtp({
        organizationId: org.id,
        phoneNumber: phone,
        intent: "join",
      });

      await vi.waitFor(() => expect(releases).toHaveLength(1));
      // Give the second request ample opportunity to (incorrectly)
      // reach the provider; under serialization it cannot.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(releases).toHaveLength(1);
      expect(mockSendOtp).toHaveBeenCalledTimes(1);

      releases[0]!();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(secondResult.challengeId).not.toBe(firstResult.challengeId);

      const rows = await db.memberOtpChallenge.findMany({
        where: { organizationId: org.id, phoneNumber: phone },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: firstResult.challengeId, status: "PENDING" });
      // The second result is synthetic: it names no stored challenge.
      expect(rows.some((row) => row.id === secondResult.challengeId)).toBe(false);
    });

    it("binds a join challenge to its gym and keeps caps per-gym", async () => {
      const gymA = await seedGym("XA");
      const gymB = await seedGym("XB");
      const phone = nextPhone();

      const { challengeId } = await requestMemberOtp({
        organizationId: gymA.id,
        phoneNumber: phone,
        intent: "join",
      });
      // At gym B the challenge is indistinguishable from a missing one.
      await expect(
        verifyMemberOtp({
          organizationId: gymB.id,
          challengeId,
          otp: "123456",
        }),
      ).rejects.toBeInstanceOf(OtpVerificationError);
      expect((await challengeRow(challengeId))?.status).toBe("PENDING");

      // Exhaust gym A's hourly cap: gym A goes synthetic while the
      // same flow in gym B still issues a real challenge.
      await seedOrgCap(gymA.id);
      const cappedPhone = nextPhone();
      const inA = await requestMemberOtp({
        organizationId: gymA.id,
        phoneNumber: cappedPhone,
        intent: "join",
      });
      expect(await challengeRow(inA.challengeId)).toBeNull();

      const inB = await requestMemberOtp({
        organizationId: gymB.id,
        phoneNumber: cappedPhone,
        intent: "join",
      });
      expect((await challengeRow(inB.challengeId))?.status).toBe("PENDING");
    });
  },
);
