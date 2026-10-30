import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const { cookieJar } = vi.hoisted(() => ({
  cookieJar: new Map<string, string>(),
}));
// The C2 route tests resolve REAL member sessions from the database;
// only the cookie transport is replaced, with a jar the tests fill.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

import { POST as postClaimRoute } from "@/app/api/member-payments/claims/route";
import { db } from "@/lib/server/db";
import { deriveMembershipPayments } from "@/lib/members";
import {
  MEMBER_SESSION_COOKIE_NAME,
  generateMemberSessionToken,
  hashMemberSessionToken,
} from "@/lib/server/member-session";
import {
  PENDING_CLAIMS_QUEUE_LIMIT,
  PaymentClaimAuthorizationError,
  PaymentClaimConflictError,
  PaymentClaimDuplicateError,
  PaymentClaimLimitError,
  PaymentClaimNotFoundError,
  confirmPaymentClaim,
  getOwnMembershipSummary,
  listClaimsForMember,
  listOwnPaymentClaims,
  listPendingClaimsForReview,
  rejectPaymentClaim,
  submitPaymentClaim,
  type MemberClaimScope,
} from "@/lib/server/payment-claims";
import { sumConfirmedPaymentsByMembership } from "@/lib/server/payments";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const MIGRATION_SQL_PATH = path.join(
  repoRoot,
  "prisma/migrations/20261011120000_add_payment_claims/migration.sql",
);
const SCHEMA_PATH = path.join(repoRoot, "prisma/schema.prisma");

/**
 * Tenant integrity and concurrency for payment claims, on a real
 * database (opt-in: RUN_DB_TESTS=true with a disposable DATABASE_URL).
 *
 * Claims are the dangerous almost-payment: the database and the
 * service together must guarantee that a claim can never reference
 * another gym's member/membership, can never be duplicated while
 * pending, can never exceed the pending cap under concurrent
 * submissions, can never be decided twice, and never moves a balance
 * until its single linked Payment exists.
 */
describe("payment claim tenant integrity", () => {
  describe("migration and schema coherence", () => {
    const migrationSql = readFileSync(MIGRATION_SQL_PATH, "utf8");
    const schema = readFileSync(SCHEMA_PATH, "utf8");

    it("creates payment_claims with composite tenant keys like payments", () => {
      expect(migrationSql).toMatch(/CREATE TABLE "payment_claims"/);
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"member_id"\s*\)\s*REFERENCES\s*"members"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"membership_id"\s*\)\s*REFERENCES\s*"memberships"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(schema).toMatch(/model PaymentClaim \{/);
    });

    it("links payments to claims with a tenant-safe composite key and one-to-one uniqueness", () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*"organization_id"\s*,\s*"payment_claim_id"\s*\)\s*REFERENCES\s*"payment_claims"\s*\(\s*"organization_id"\s*,\s*"id"\s*\)/,
      );
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "payments_organization_id_payment_claim_id_key"/,
      );
      expect(schema).toMatch(/@@unique\(\[organizationId,\s*paymentClaimId\]\)/);
    });

    it("declares the partial unique index that forbids duplicate pending claims", () => {
      expect(migrationSql).toMatch(
        /CREATE UNIQUE INDEX "payment_claims_no_duplicate_pending"/,
      );
      expect(migrationSql).toMatch(/WHERE "status" = 'PENDING'/);
      expect(migrationSql).toMatch(/COALESCE\("reference", ''\)/);
    });
  });

  describe.skipIf(process.env.RUN_DB_TESTS !== "true")(
    "database enforcement",
    () => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const createdOrgIds: string[] = [];
      const createdUserIds: string[] = [];
      let phoneCounter = 0;

      async function seedUser(tag: string, phone?: string) {
        const user = await db.user.create({
          data: {
            clerkUserId: `claims-${tag}-${suffix}`,
            ...(phone ? { phoneNumber: phone } : {}),
          },
          select: { id: true },
        });
        createdUserIds.push(user.id);
        return user;
      }

      async function seedGym(tag: string) {
        const org = await db.organization.create({
          data: { name: `Claims Gym ${tag} ${suffix}` },
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
        const owner = await seedUser(`owner-${tag}`);
        await db.organizationMembership.create({
          data: { userId: owner.id, organizationId: org.id, role: "OWNER" },
        });
        return { org, owner };
      }

      async function seedStaff(orgId: string, tag: string) {
        const staff = await seedUser(`staff-${tag}`);
        await db.organizationMembership.create({
          data: { userId: staff.id, organizationId: orgId, role: "STAFF" },
        });
        return staff;
      }

      async function seedMember(
        orgId: string,
        tag: string,
        fee = "1000",
      ): Promise<{
        memberUser: { id: string };
        member: { id: string };
        membership: { id: string };
        scope: MemberClaimScope;
      }> {
        phoneCounter += 1;
        const memberUser = await seedUser(
          `member-${tag}`,
          `92${String(phoneCounter).padStart(10, "0")}`,
        );
        const member = await db.member.create({
          data: {
            organizationId: orgId,
            name: `Claims Member ${tag}`,
            phoneNumber: "9000000021",
            userId: memberUser.id,
          },
          select: { id: true },
        });
        const membership = await db.membership.create({
          data: {
            organizationId: orgId,
            memberId: member.id,
            plan: "MONTHLY",
            startDate: new Date(Date.UTC(2026, 0, 1)),
            expiryDate: new Date(Date.UTC(2026, 1, 1)),
            fee: new Prisma.Decimal(fee),
          },
          select: { id: true },
        });
        return {
          memberUser,
          member,
          membership,
          scope: {
            userId: memberUser.id,
            organizationId: orgId,
            memberId: member.id,
          },
        };
      }

      beforeAll(async () => {
        await db.$queryRaw`SELECT 1`;
      });

      afterAll(async () => {
        if (createdOrgIds.length > 0) {
          await db.organization.deleteMany({
            where: { id: { in: createdOrgIds } },
          });
        }
        if (createdUserIds.length > 0) {
          await db.user.deleteMany({
            where: { id: { in: createdUserIds } },
          });
        }
        await db.$disconnect();
      });

      const claimInput = (amount: string) => ({
        amount,
        paymentMethod: "UPI",
        reference: "",
      });

      it("persists a PENDING claim + audit, and the claim alone moves no balance", async () => {
        const { org } = await seedGym("A1");
        const { scope, membership } = await seedMember(org.id, "A1");
        const { claimId } = await submitPaymentClaim(scope, claimInput("1000"));
        expect(claimId).toBeTruthy();

        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("PENDING");
        const audit = await db.auditLog.findFirst({
          where: { targetId: claimId, event: "PAYMENT_CLAIM_SUBMITTED" },
        });
        expect(audit?.actorUserId).toBe(scope.userId);

        const sums = await sumConfirmedPaymentsByMembership(org.id, [
          membership.id,
        ]);
        expect(sums.get(membership.id) ?? 0).toBe(0);
      });

      it("rejects a raw claim whose member belongs to another organization", async () => {
        const a = await seedGym("A2");
        const b = await seedGym("B2");
        const memberB = await seedMember(b.org.id, "B2");
        await expect(
          db.paymentClaim.create({
            data: {
              organizationId: a.org.id,
              memberId: memberB.member.id,
              membershipId: memberB.membership.id,
              claimedAmount: new Prisma.Decimal("100"),
              paymentMethod: "UPI",
              status: "PENDING",
            },
          }),
        ).rejects.toThrow();
      });

      it("rejects a payment linked to another organization's claim", async () => {
        const a = await seedGym("A3");
        const b = await seedGym("B3");
        const memberB = await seedMember(b.org.id, "B3");
        const { claimId } = await submitPaymentClaim(
          memberB.scope,
          claimInput("100"),
        );
        const memberA = await seedMember(a.org.id, "A3");
        await expect(
          db.payment.create({
            data: {
              organizationId: a.org.id,
              memberId: memberA.member.id,
              membershipId: memberA.membership.id,
              amount: new Prisma.Decimal("100"),
              paymentMethod: "UPI",
              confirmedAt: new Date(),
              confirmedBy: a.owner.id,
              paymentClaimId: claimId,
            },
          }),
        ).rejects.toThrow();
      });

      it("blocks duplicate pending claims, including under concurrent submission", async () => {
        const { org } = await seedGym("A4");
        const { scope } = await seedMember(org.id, "A4");
        const results = await Promise.allSettled([
          submitPaymentClaim(scope, claimInput("700")),
          submitPaymentClaim(scope, claimInput("700")),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const duplicates = results.filter(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof PaymentClaimDuplicateError,
        );
        expect(fulfilled).toHaveLength(1);
        expect(duplicates).toHaveLength(1);
        const pending = await db.paymentClaim.count({
          where: { memberId: scope.memberId, status: "PENDING" },
        });
        expect(pending).toBe(1);
      });

      it("enforces the pending cap of 3 under concurrent submissions", async () => {
        const { org } = await seedGym("A5");
        const { scope } = await seedMember(org.id, "A5");
        const amounts = ["100", "200", "300", "400", "500"];
        const results = await Promise.allSettled(
          amounts.map((amount) => submitPaymentClaim(scope, claimInput(amount))),
        );
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const limited = results.filter(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof PaymentClaimLimitError,
        );
        expect(fulfilled).toHaveLength(3);
        expect(limited).toHaveLength(2);
        const pending = await db.paymentClaim.count({
          where: { memberId: scope.memberId, status: "PENDING" },
        });
        expect(pending).toBe(3);
      });

      it("confirms exactly once under a double-confirm race and moves the balance once", async () => {
        const { org, owner } = await seedGym("A6");
        const { scope, membership } = await seedMember(org.id, "A6");
        const { claimId } = await submitPaymentClaim(scope, claimInput("1000"));

        const results = await Promise.allSettled([
          confirmPaymentClaim(owner.id, claimId),
          confirmPaymentClaim(owner.id, claimId),
        ]);
        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const conflicts = results.filter(
          (r) =>
            r.status === "rejected" &&
            r.reason instanceof PaymentClaimConflictError,
        );
        expect(fulfilled).toHaveLength(1);
        expect(conflicts).toHaveLength(1);

        const payments = await db.payment.findMany({
          where: { paymentClaimId: claimId },
        });
        expect(payments).toHaveLength(1);
        const sums = await sumConfirmedPaymentsByMembership(org.id, [
          membership.id,
        ]);
        expect(sums.get(membership.id)).toBe(100_000);
        const { outstandingPaise } = deriveMembershipPayments(
          100_000,
          sums.get(membership.id) ?? 0,
        );
        expect(outstandingPaise).toBe(0);

        // A later sequential confirm is also a conflict, never a payment.
        await expect(confirmPaymentClaim(owner.id, claimId)).rejects.toBeInstanceOf(
          PaymentClaimConflictError,
        );
        expect(
          await db.payment.count({ where: { paymentClaimId: claimId } }),
        ).toBe(1);
      });

      it("confirms a different received amount; only that amount moves the balance", async () => {
        const { org, owner } = await seedGym("A7");
        const { scope, membership } = await seedMember(org.id, "A7");
        const { claimId } = await submitPaymentClaim(scope, claimInput("1000"));
        const { paymentId } = await confirmPaymentClaim(owner.id, claimId, {
          amount: "400",
        });
        const payment = await db.payment.findUnique({
          where: { id: paymentId },
        });
        expect(payment?.amount.toString()).toBe("400");
        const sums = await sumConfirmedPaymentsByMembership(org.id, [
          membership.id,
        ]);
        const { outstandingPaise } = deriveMembershipPayments(
          100_000,
          sums.get(membership.id) ?? 0,
        );
        expect(outstandingPaise).toBe(60_000);

        const own = await listOwnPaymentClaims(scope);
        expect(own).toHaveLength(1);
        expect(own[0]).toMatchObject({
          status: "CONFIRMED",
          claimedAmountPaise: 100_000,
          confirmedAmountPaise: 40_000,
          paymentId,
        });
      });

      it("rejects without a payment, and the same claim may be resubmitted after rejection", async () => {
        const { org, owner } = await seedGym("A8");
        const { scope, membership } = await seedMember(org.id, "A8");
        const { claimId } = await submitPaymentClaim(scope, claimInput("250"));
        await rejectPaymentClaim(owner.id, claimId);
        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("REJECTED");
        expect(stored?.verifiedBy).toBe(owner.id);
        expect(
          await db.payment.count({ where: { paymentClaimId: claimId } }),
        ).toBe(0);
        const sums = await sumConfirmedPaymentsByMembership(org.id, [
          membership.id,
        ]);
        expect(sums.get(membership.id) ?? 0).toBe(0);

        // Decided claims leave the duplicate index: resubmission works.
        const again = await submitPaymentClaim(scope, claimInput("250"));
        expect(again.claimId).toBeTruthy();
        expect(again.claimId).not.toBe(claimId);
      });

      it("hides another gym's claim from confirmation as not found", async () => {
        const a = await seedGym("A9");
        const b = await seedGym("B9");
        const memberA = await seedMember(a.org.id, "A9");
        const { claimId } = await submitPaymentClaim(
          memberA.scope,
          claimInput("100"),
        );
        await expect(
          confirmPaymentClaim(b.owner.id, claimId),
        ).rejects.toBeInstanceOf(PaymentClaimNotFoundError);
        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("PENDING");
      });

      it("denies confirmation after the verifier was demoted", async () => {
        const { org } = await seedGym("A10");
        const staff = await seedStaff(org.id, "A10");
        const { scope } = await seedMember(org.id, "A10");
        const { claimId } = await submitPaymentClaim(scope, claimInput("100"));

        await db.organizationMembership.updateMany({
          where: { userId: staff.id, organizationId: org.id },
          data: { role: "MEMBER" },
        });
        await expect(
          confirmPaymentClaim(staff.id, claimId),
        ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("PENDING");
        expect(
          await db.payment.count({ where: { paymentClaimId: claimId } }),
        ).toBe(0);
      });

      it("denies rejection after the verifier's membership was removed", async () => {
        const { org } = await seedGym("A11");
        const staff = await seedStaff(org.id, "A11");
        const { scope } = await seedMember(org.id, "A11");
        const { claimId } = await submitPaymentClaim(scope, claimInput("100"));

        await db.organizationMembership.deleteMany({
          where: { userId: staff.id, organizationId: org.id },
        });
        await expect(
          rejectPaymentClaim(staff.id, claimId),
        ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("PENDING");
      });

      it("cannot confirm when the verifier is removed mid-request (revocation race)", async () => {
        const { org } = await seedGym("A12");
        const staff = await seedStaff(org.id, "A12");
        const { scope } = await seedMember(org.id, "A12");
        const { claimId } = await submitPaymentClaim(scope, claimInput("100"));

        // Hold the verifier's membership row under an external lock,
        // exactly as an in-flight revocation would contend for it.
        // The confirm's pre-transaction scope check still passes (the
        // membership exists and is STAFF at that moment) — the TOCTOU
        // window — but its in-transaction revalidation must block on
        // this lock, then find the row deleted and deny.
        let releaseGate!: () => void;
        const gate = new Promise<void>((resolve) => {
          releaseGate = resolve;
        });
        let markLocked!: () => void;
        const locked = new Promise<void>((resolve) => {
          markLocked = resolve;
        });
        const holdingTx = db.$transaction(
          async (tx) => {
            await tx.$queryRaw`
              SELECT id FROM organization_memberships
              WHERE user_id = ${staff.id}
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE
            `;
            markLocked();
            await gate;
            await tx.organizationMembership.deleteMany({
              where: { userId: staff.id },
            });
          },
          { timeout: 30_000 },
        );

        let confirmSettled = false;
        let confirmError: unknown = null;
        const confirmRun = (async () => {
          try {
            await confirmPaymentClaim(staff.id, claimId);
          } catch (error) {
            confirmError = error;
          } finally {
            confirmSettled = true;
          }
        })();

        let windowError: unknown = null;
        try {
          await locked;
          // While the row is held, the confirm must NOT be able to
          // settle: its first transactional step is the lock. (On the
          // pre-fix code it completed in milliseconds, deciding the
          // claim for a soon-to-be-revoked actor.)
          const deadline = Date.now() + 1_500;
          while (Date.now() < deadline) {
            expect(confirmSettled).toBe(false);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        } catch (error) {
          // Captured, not thrown yet: the gate must be released and
          // both outstanding promises drained below even when the
          // observation window itself fails.
          windowError = error;
        } finally {
          releaseGate();
        }
        const [holdOutcome] = await Promise.allSettled([
          holdingTx,
          confirmRun,
        ]);
        if (holdOutcome.status === "rejected") throw holdOutcome.reason;
        if (windowError) throw windowError;

        expect(confirmError).toBeInstanceOf(PaymentClaimAuthorizationError);
        const stored = await db.paymentClaim.findUnique({
          where: { id: claimId },
        });
        expect(stored?.status).toBe("PENDING");
        expect(
          await db.payment.count({ where: { paymentClaimId: claimId } }),
        ).toBe(0);
      });

      describe("C2 member payments surface", () => {
        async function seedSession(userId: string, orgId: string) {
          const rawToken = generateMemberSessionToken();
          await db.memberSession.create({
            data: {
              userId,
              organizationId: orgId,
              tokenHash: hashMemberSessionToken(rawToken),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000),
              lastSeenAt: new Date(),
            },
          });
          return rawToken;
        }

        it("summary derives the balance from confirmed payments only; a submitted claim moves nothing", async () => {
          const { org, owner } = await seedGym("C2S");
          const seeded = await seedMember(org.id, "C2S");
          await db.payment.create({
            data: {
              organizationId: org.id,
              memberId: seeded.member.id,
              membershipId: seeded.membership.id,
              amount: new Prisma.Decimal("400"),
              paymentMethod: "CASH",
              confirmedBy: owner.id,
              confirmedAt: new Date(),
            },
          });

          const before = await getOwnMembershipSummary(seeded.scope);
          expect(before).toMatchObject({
            plan: "MONTHLY",
            feePaise: 100_000,
            paidPaise: 40_000,
            outstandingPaise: 60_000,
            paymentStatus: "PARTIALLY_PAID",
          });

          await submitPaymentClaim(seeded.scope, claimInput("600"));

          const after = await getOwnMembershipSummary(seeded.scope);
          expect(after?.feePaise).toBe(before?.feePaise);
          expect(after?.paidPaise).toBe(before?.paidPaise);
          expect(after?.outstandingPaise).toBe(before?.outstandingPaise);
          expect(after?.paymentStatus).toBe(before?.paymentStatus);
        });

        it("summary is null without a membership and cannot be forged across gyms", async () => {
          const a = await seedGym("C2N");
          const b = await seedGym("C2N2");
          const seededA = await seedMember(a.org.id, "C2N");
          phoneCounter += 1;
          const bareUser = await seedUser(
            "member-C2N-bare",
            `93${String(phoneCounter).padStart(10, "0")}`,
          );
          const bareMember = await db.member.create({
            data: {
              organizationId: b.org.id,
              name: "Bare Member C2N",
              phoneNumber: "9000000099",
              userId: bareUser.id,
            },
            select: { id: true },
          });

          // No membership in the scoped gym -> null.
          expect(
            await getOwnMembershipSummary({
              userId: bareUser.id,
              organizationId: b.org.id,
              memberId: bareMember.id,
            }),
          ).toBeNull();

          // Gym A's member id presented under gym B's scope -> null:
          // the read is pinned to (organization, member) together.
          expect(
            await getOwnMembershipSummary({
              userId: seededA.memberUser.id,
              organizationId: b.org.id,
              memberId: seededA.member.id,
            }),
          ).toBeNull();
        });

        it("the claims route scopes by the real session and ignores forged body identity", async () => {
          const { org } = await seedGym("C2R");
          const other = await seedGym("C2R2");
          const seeded = await seedMember(org.id, "C2R");
          await db.organizationMembership.create({
            data: {
              userId: seeded.memberUser.id,
              organizationId: org.id,
              role: "MEMBER",
            },
          });
          const rawToken = await seedSession(seeded.memberUser.id, org.id);

          const post = (
            body: unknown,
            headers: Record<string, string> = {},
          ) =>
            postClaimRoute(
              new Request("https://gym.example.com/api/member-payments/claims", {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  host: "gym.example.com",
                  origin: "https://gym.example.com",
                  ...headers,
                },
                body: JSON.stringify(body),
              }),
            );

          cookieJar.set(MEMBER_SESSION_COOKIE_NAME, rawToken);
          const created = await post({
            amount: "250",
            paymentMethod: "UPI",
            reference: "UTR9",
            organizationId: other.org.id,
            memberId: "forged-member",
            userId: "forged-user",
          });
          expect(created.status).toBe(201);

          const stored = await db.paymentClaim.findMany({
            where: { memberId: seeded.member.id },
          });
          expect(stored).toHaveLength(1);
          expect(stored[0]?.organizationId).toBe(org.id);
          expect(stored[0]?.status).toBe("PENDING");
          expect(
            (await getOwnMembershipSummary(seeded.scope))?.paidPaise,
          ).toBe(0);

          const duplicate = await post({
            amount: "250",
            paymentMethod: "UPI",
            reference: "UTR9",
          });
          expect(duplicate.status).toBe(409);

          cookieJar.clear();
          const anonymous = await post({
            amount: "250",
            paymentMethod: "UPI",
            reference: "OTHER",
          });
          expect(anonymous.status).toBe(401);

          cookieJar.set(MEMBER_SESSION_COOKIE_NAME, rawToken);
          const crossOrigin = await post(
            { amount: "1", paymentMethod: "UPI", reference: "" },
            { origin: "https://evil.example.com" },
          );
          expect(crossOrigin.status).toBe(403);
          cookieJar.clear();
        });
      });

      describe("C3-S1 claim review reads", () => {
        it("review queue is org-scoped, FIFO, and carries display fields + confirmed-only balance context", async () => {
          const a = await seedGym("S1Q");
          const b = await seedGym("S1Q2");
          const staffA = await seedStaff(a.org.id, "S1Q");
          const m1 = await seedMember(a.org.id, "S1Q-a");
          const m2 = await seedMember(a.org.id, "S1Q-b");
          const mb = await seedMember(b.org.id, "S1Q-c");
          await db.payment.create({
            data: {
              organizationId: a.org.id,
              memberId: m1.member.id,
              membershipId: m1.membership.id,
              amount: new Prisma.Decimal("400"),
              paymentMethod: "CASH",
              confirmedBy: a.owner.id,
              confirmedAt: new Date(),
            },
          });
          const c1 = await submitPaymentClaim(m1.scope, claimInput("600"));
          const c2 = await submitPaymentClaim(m2.scope, claimInput("1000"));
          await submitPaymentClaim(mb.scope, claimInput("700"));

          const { claims: queue, totalPending } =
            await listPendingClaimsForReview(staffA.id);
          expect(totalPending).toBe(2);
          // Only gym A's claims, oldest first — gym B's claim never appears.
          expect(queue.map((claim) => claim.id)).toEqual([
            c1.claimId,
            c2.claimId,
          ]);
          expect(queue[0]).toMatchObject({
            memberName: "Claims Member S1Q-a",
            memberPhoneNumber: "9000000021",
            membershipPlan: "MONTHLY",
            membershipFeePaise: 100_000,
            paidPaise: 40_000,
            outstandingPaise: 60_000,
            status: "PENDING",
          });
          expect(queue[0]?.membershipExpiryDate).toBe(
            new Date(Date.UTC(2026, 1, 1)).toISOString(),
          );
          // The pending 600 claim is NOT in the paid total: only the
          // confirmed 400 counts.
          expect(queue[1]?.paidPaise).toBe(0);
          expect(queue[1]?.outstandingPaise).toBe(100_000);
        });

        it("member history is newest-first across statuses; foreign and missing members are indistinguishable", async () => {
          const a = await seedGym("S1H");
          const b = await seedGym("S1H2");
          const staffA = await seedStaff(a.org.id, "S1H");
          const staffB = await seedStaff(b.org.id, "S1H-b");
          const m = await seedMember(a.org.id, "S1H");
          const first = await submitPaymentClaim(m.scope, claimInput("300"));
          const second = await submitPaymentClaim(m.scope, {
            amount: "200",
            paymentMethod: "CASH",
            reference: "",
          });
          await confirmPaymentClaim(staffA.id, first.claimId);

          const { items: history, truncated } = await listClaimsForMember(
            staffA.id,
            m.member.id,
          );
          expect(truncated).toBe(false);
          expect(history.map((claim) => claim.id)).toEqual([
            second.claimId,
            first.claimId,
          ]);
          expect(history.map((claim) => claim.status)).toEqual([
            "PENDING",
            "CONFIRMED",
          ]);
          expect(history[1]?.confirmedAmountPaise).toBe(30_000);

          await expect(
            listClaimsForMember(staffB.id, m.member.id),
          ).rejects.toBeInstanceOf(PaymentClaimNotFoundError);
          await expect(
            listClaimsForMember(
              staffA.id,
              "99999999-9999-4999-8999-999999999999",
            ),
          ).rejects.toBeInstanceOf(PaymentClaimNotFoundError);
        });

        it("denies TRAINER on both review reads", async () => {
          const a = await seedGym("S1T");
          const trainer = await seedUser("trainer-S1T");
          await db.organizationMembership.create({
            data: {
              userId: trainer.id,
              organizationId: a.org.id,
              role: "TRAINER",
            },
          });
          const m = await seedMember(a.org.id, "S1T");
          await expect(
            listPendingClaimsForReview(trainer.id),
          ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
          await expect(
            listClaimsForMember(trainer.id, m.member.id),
          ).rejects.toBeInstanceOf(PaymentClaimAuthorizationError);
        });

        it("bounds the review queue per tenant while reporting the exact total", async () => {
          const a = await seedGym("S1CAP");
          const b = await seedGym("S1CAP2");
          const staffA = await seedStaff(a.org.id, "S1CAP");
          const staffB = await seedStaff(b.org.id, "S1CAP-b");
          const mA = await seedMember(a.org.id, "S1CAP");
          const mB = await seedMember(b.org.id, "S1CAP-b");

          // 105 pending claims in gym A, inserted directly: the
          // per-membership pending cap is a submission rule, not a
          // storage rule, and no other flow can grow a queue this far
          // in a test. Distinct references keep the
          // no-duplicate-pending partial unique index satisfied;
          // createdAt rises minute by minute so FIFO order is exact.
          const base = Date.UTC(2026, 9, 1, 0, 0, 0);
          const seedPending = (
            orgId: string,
            memberId: string,
            membershipId: string,
            prefix: string,
            count: number,
          ) =>
            db.paymentClaim.createMany({
              data: Array.from({ length: count }, (_, i) => ({
                organizationId: orgId,
                memberId,
                membershipId,
                claimedAmount: new Prisma.Decimal("100"),
                paymentMethod: "UPI" as const,
                reference: `${prefix}-${i}`,
                status: "PENDING" as const,
                createdAt: new Date(base + i * 60_000),
              })),
            });
          await seedPending(a.org.id, mA.member.id, mA.membership.id, "Q", 105);
          await seedPending(b.org.id, mB.member.id, mB.membership.id, "QB", 3);

          const queueA = await listPendingClaimsForReview(staffA.id);
          expect(queueA.totalPending).toBe(105);
          expect(queueA.claims).toHaveLength(PENDING_CLAIMS_QUEUE_LIMIT);
          // FIFO: the displayed page is exactly the oldest 100, in order.
          expect(queueA.claims[0]?.reference).toBe("Q-0");
          expect(queueA.claims[PENDING_CLAIMS_QUEUE_LIMIT - 1]?.reference).toBe(
            "Q-99",
          );

          // Gym B's queue is untouched by gym A's backlog — the bound
          // and the total are per-tenant.
          const queueB = await listPendingClaimsForReview(staffB.id);
          expect(queueB.totalPending).toBe(3);
          expect(queueB.claims).toHaveLength(3);
        });
      });
    },
  );
});
