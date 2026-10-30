import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  AttendanceMembershipExpiredError,
  checkInSelf,
} from "@/lib/server/attendance";
import { db } from "@/lib/server/db";
import type { MemberSessionContext } from "@/lib/server/member-session";
import {
  MemberAuthorizationError,
  MemberNotFoundError,
  MemberRenewalConflictError,
  renewMembership,
} from "@/lib/server/members";
import { confirmPaymentClaim } from "@/lib/server/payment-claims";
import { sumConfirmedPaymentsByMembership } from "@/lib/server/payments";
import { SubscriptionRestrictedError } from "@/lib/server/subscriptions";

/**
 * Membership renewal — database tests (disposable database only;
 * scripts/run-db-tests.mjs sets RUN_DB_TESTS=true and a test
 * DATABASE_URL). Exercises the real transaction path: advisory
 * locks, the token's unique index, tenant isolation, claim
 * attachment, and the check-in gate flipping after renewal.
 */

const RUN = process.env.RUN_DB_TESTS === "true";
const RUN_ID = randomUUID().slice(0, 8);
let seq = 0;

function nextSeq(): number {
  seq += 1;
  return seq;
}

function utcDay(offsetDays: number): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offsetDays * 86_400_000,
  );
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function token(): string {
  return randomUUID();
}

interface SeededOrg {
  orgId: string;
  ownerUserId: string;
}

async function seedOrg(label: string): Promise<SeededOrg> {
  const n = nextSeq();
  const owner = await db.user.create({
    data: {
      clerkUserId: `clerk_renew_${RUN_ID}_${label}_${n}`,
    },
  });
  const org = await db.organization.create({
    data: { name: `Renew ${label} ${RUN_ID}-${n}` },
  });
  await db.organizationMembership.create({
    data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
  });
  await db.organizationSubscription.create({
    data: { organizationId: org.id, trialEndsAt: utcDay(30) },
  });
  return { orgId: org.id, ownerUserId: owner.id };
}

async function seedMember(
  orgId: string,
  opts: {
    expiryOffsetDays: number;
    startOffsetDays?: number;
    feeRupees?: string;
    linkedUserId?: string;
  },
): Promise<{ memberId: string; membershipId: string }> {
  const n = nextSeq();
  const member = await db.member.create({
    data: {
      organizationId: orgId,
      name: `Renew Member ${RUN_ID}-${n}`,
      phoneNumber: `97${String(10_000_000 + n * 13 + (Date.now() % 1000))}`,
      userId: opts.linkedUserId,
    },
  });
  const membership = await db.membership.create({
    data: {
      organizationId: orgId,
      memberId: member.id,
      plan: "SIX_MONTHS",
      startDate: utcDay(opts.startOffsetDays ?? -60),
      expiryDate: utcDay(opts.expiryOffsetDays),
      fee: new Prisma.Decimal(opts.feeRupees ?? "6000"),
    },
  });
  return { memberId: member.id, membershipId: membership.id };
}

async function membershipsOf(orgId: string, memberId: string) {
  return db.membership.findMany({
    where: { organizationId: orgId, memberId },
    orderBy: { createdAt: "asc" },
  });
}

async function renewalAudits(orgId: string) {
  return db.auditLog.findMany({
    where: { organizationId: orgId, event: "MEMBERSHIP_RENEWED" },
  });
}

describe.skipIf(!RUN)("renewMembership (database)", () => {
  it("creates the chained next period, leaves the old row untouched, and writes exactly one audit", async () => {
    const { orgId, ownerUserId } = await seedOrg("chain");
    const { memberId, membershipId } = await seedMember(orgId, {
      expiryOffsetDays: 30,
    });
    const before = await db.membership.findUniqueOrThrow({
      where: { id: membershipId },
    });

    const result = await renewMembership(ownerUserId, memberId, {
      expiryDate: isoDay(utcDay(212)),
      idempotencyKey: token(),
    });

    const rows = await membershipsOf(orgId, memberId);
    expect(rows).toHaveLength(2);
    const created = rows.find((row) => row.id === result.membershipId)!;
    expect(result.previousMembershipId).toBe(membershipId);
    expect(created.startDate).toEqual(utcDay(31));
    expect(created.expiryDate).toEqual(utcDay(212));
    expect(created.plan).toBe("SIX_MONTHS");
    expect(created.fee.toString()).toBe("6000");
    expect(created.renewalIdempotencyKey).not.toBeNull();

    const after = await db.membership.findUniqueOrThrow({
      where: { id: membershipId },
    });
    expect(after).toEqual(before);
    expect(after.renewalIdempotencyKey).toBeNull();

    const audits = await renewalAudits(orgId);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.targetId).toBe(created.id);
    expect(
      (audits[0]!.metadata as { previousMembershipId?: string })
        .previousMembershipId,
    ).toBe(membershipId);
    // Renewal creates no money rows of any kind.
    expect(
      await db.payment.count({ where: { organizationId: orgId } }),
    ).toBe(0);
    expect(
      await db.paymentClaim.count({ where: { organizationId: orgId } }),
    ).toBe(0);
  });

  it("restarts an expired member today and restores self check-in", async () => {
    const { orgId, ownerUserId } = await seedOrg("expired");
    const memberUser = await db.user.create({
      data: {
        clerkUserId: `clerk_renew_member_${RUN_ID}_${nextSeq()}`,
        phoneNumber: "+919812345678",
      },
    });
    const { memberId } = await seedMember(orgId, {
      expiryOffsetDays: -5,
      startOffsetDays: -190,
      linkedUserId: memberUser.id,
    });
    const context = {
      session: { id: "session-x", userId: memberUser.id, organizationId: orgId },
      user: { id: memberUser.id },
      organization: { id: orgId },
      membership: {
        userId: memberUser.id,
        organizationId: orgId,
        role: "MEMBER",
      },
      member: { id: memberId },
    } as unknown as MemberSessionContext;

    // Expired: self check-in is blocked outright.
    await expect(checkInSelf(context)).rejects.toBeInstanceOf(
      AttendanceMembershipExpiredError,
    );
    expect(
      await db.attendanceSession.count({ where: { organizationId: orgId } }),
    ).toBe(0);

    const result = await renewMembership(ownerUserId, memberId, {
      expiryDate: isoDay(utcDay(90)),
      idempotencyKey: token(),
    });
    const created = await db.membership.findUniqueOrThrow({
      where: { id: result.membershipId },
    });
    expect(created.startDate).toEqual(utcDay(0));

    // Renewed: the same member can check in again.
    const { sessionId } = await checkInSelf(context);
    expect(sessionId).toBeTruthy();
    expect(
      await db.attendanceSession.count({ where: { organizationId: orgId } }),
    ).toBe(1);
  });

  it("an identical same-token retry resolves to the original with no second row or audit", async () => {
    const { orgId, ownerUserId } = await seedOrg("replay");
    const { memberId } = await seedMember(orgId, { expiryOffsetDays: 10 });
    const key = token();
    const input = { expiryDate: isoDay(utcDay(192)), idempotencyKey: key };

    const first = await renewMembership(ownerUserId, memberId, input);
    const second = await renewMembership(ownerUserId, memberId, input);

    expect(second.membershipId).toBe(first.membershipId);
    expect(second.previousMembershipId).toBe(first.previousMembershipId);
    expect(await membershipsOf(orgId, memberId)).toHaveLength(2);
    expect(await renewalAudits(orgId)).toHaveLength(1);
  });

  it("a conflicting same-token retry is rejected and writes nothing", async () => {
    const { orgId, ownerUserId } = await seedOrg("conflict");
    const { memberId } = await seedMember(orgId, { expiryOffsetDays: 10 });
    const key = token();
    await renewMembership(ownerUserId, memberId, {
      expiryDate: isoDay(utcDay(192)),
      idempotencyKey: key,
    });

    await expect(
      renewMembership(ownerUserId, memberId, {
        expiryDate: isoDay(utcDay(200)),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(MemberRenewalConflictError);
    expect(await membershipsOf(orgId, memberId)).toHaveLength(2);
    expect(await renewalAudits(orgId)).toHaveLength(1);
  });

  it("concurrent same-token submissions create exactly one renewal", async () => {
    const { orgId, ownerUserId } = await seedOrg("race-same");
    const { memberId } = await seedMember(orgId, { expiryOffsetDays: 10 });
    const key = token();
    const input = { expiryDate: isoDay(utcDay(192)), idempotencyKey: key };

    const [a, b] = await Promise.all([
      renewMembership(ownerUserId, memberId, input),
      renewMembership(ownerUserId, memberId, input),
    ]);

    expect(a.membershipId).toBe(b.membershipId);
    expect(await membershipsOf(orgId, memberId)).toHaveLength(2);
    expect(await renewalAudits(orgId)).toHaveLength(1);
  });

  it("concurrent different-token renewals never fork the period chain", async () => {
    const { orgId, ownerUserId } = await seedOrg("race-diff");
    const { memberId, membershipId } = await seedMember(orgId, {
      expiryOffsetDays: 10,
    });

    const settled = await Promise.allSettled([
      renewMembership(ownerUserId, memberId, {
        expiryDate: isoDay(utcDay(192)),
        idempotencyKey: token(),
      }),
      renewMembership(ownerUserId, memberId, {
        expiryDate: isoDay(utcDay(396)),
        idempotencyKey: token(),
      }),
    ]);
    const successes = settled.filter((s) => s.status === "fulfilled");
    // At least the first renewal lands; a second may legitimately
    // fail validation when the winner's period pushes the chained
    // start past the loser's confirmed expiry. What must never
    // happen is a fork: periods always form a single chain.
    expect(successes.length).toBeGreaterThanOrEqual(1);

    const rows = await membershipsOf(orgId, memberId);
    expect(rows.length).toBe(1 + successes.length);
    expect(await renewalAudits(orgId)).toHaveLength(successes.length);
    const byStart = [...rows].sort(
      (x, y) => x.startDate.getTime() - y.startDate.getTime(),
    );
    // The seeded period is the chain's base.
    expect(byStart[0]!.id).toBe(membershipId);
    for (let i = 1; i < byStart.length; i += 1) {
      // Each later period starts strictly after the previous expiry:
      // chained (expiry + 1) or restarted (today > expiry) — never
      // overlapping, never two periods from the same base.
      expect(byStart[i]!.startDate.getTime()).toBeGreaterThan(
        byStart[i - 1]!.expiryDate.getTime(),
      );
      expect(
        byStart[i]!.startDate.getTime(),
      ).toBeLessThanOrEqual(byStart[i]!.expiryDate.getTime());
    }
  });

  it("cross-gym renewal is the identical not-found and writes nothing", async () => {
    const a = await seedOrg("gym-a");
    const b = await seedOrg("gym-b");
    const { memberId } = await seedMember(a.orgId, { expiryOffsetDays: 10 });

    await expect(
      renewMembership(b.ownerUserId, memberId, {
        expiryDate: isoDay(utcDay(192)),
        idempotencyKey: token(),
      }),
    ).rejects.toBeInstanceOf(MemberNotFoundError);
    expect(await membershipsOf(a.orgId, memberId)).toHaveLength(1);
    expect(await renewalAudits(a.orgId)).toHaveLength(0);
    expect(await renewalAudits(b.orgId)).toHaveLength(0);
  });

  it("denies TRAINER and a SaaS-restricted gym, writing nothing", async () => {
    const { orgId, ownerUserId } = await seedOrg("denied");
    const { memberId } = await seedMember(orgId, { expiryOffsetDays: 10 });

    const trainer = await db.user.create({
      data: {
        clerkUserId: `clerk_renew_trainer_${RUN_ID}_${nextSeq()}`,
      },
    });
    await db.organizationMembership.create({
      data: { userId: trainer.id, organizationId: orgId, role: "TRAINER" },
    });
    await expect(
      renewMembership(trainer.id, memberId, {
        expiryDate: isoDay(utcDay(192)),
        idempotencyKey: token(),
      }),
    ).rejects.toBeInstanceOf(MemberAuthorizationError);

    await db.organizationSubscription.update({
      where: { organizationId: orgId },
      data: { suspendedAt: new Date() },
    });
    await expect(
      renewMembership(ownerUserId, memberId, {
        expiryDate: isoDay(utcDay(192)),
        idempotencyKey: token(),
      }),
    ).rejects.toBeInstanceOf(SubscriptionRestrictedError);

    expect(await membershipsOf(orgId, memberId)).toHaveLength(1);
    expect(await renewalAudits(orgId)).toHaveLength(0);
  });

  it("pending claims do not block renewal and stay attached to the old period", async () => {
    const { orgId, ownerUserId } = await seedOrg("claims");
    const { memberId, membershipId } = await seedMember(orgId, {
      expiryOffsetDays: 10,
    });
    const claim = await db.paymentClaim.create({
      data: {
        organizationId: orgId,
        memberId,
        membershipId,
        claimedAmount: new Prisma.Decimal("2000"),
        paymentMethod: "UPI",
        reference: "UTR-RENEW-1",
      },
    });

    // Renewal proceeds with the claim still pending.
    const result = await renewMembership(ownerUserId, memberId, {
      expiryDate: isoDay(utcDay(192)),
      idempotencyKey: token(),
    });
    const claimAfterRenewal = await db.paymentClaim.findUniqueOrThrow({
      where: { id: claim.id },
    });
    expect(claimAfterRenewal.status).toBe("PENDING");
    expect(claimAfterRenewal.membershipId).toBe(membershipId);

    // Confirming afterwards pays the OLD period, never the new one.
    const { paymentId } = await confirmPaymentClaim(ownerUserId, claim.id);
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    expect(payment.membershipId).toBe(membershipId);

    const sums = await sumConfirmedPaymentsByMembership(orgId, [
      membershipId,
      result.membershipId,
    ]);
    expect(sums.get(membershipId)).toBe(200_000);
    expect(sums.get(result.membershipId) ?? 0).toBe(0);
    // The old period's outstanding fell; the new period's is untouched
    // (its own full fee), i.e. balances never merged across periods.
    const newRow = await db.membership.findUniqueOrThrow({
      where: { id: result.membershipId },
    });
    expect(newRow.fee.toString()).toBe("6000");
  });
});
