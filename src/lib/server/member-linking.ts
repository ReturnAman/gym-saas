import "server-only";

import { Prisma } from "@prisma/client";

import { AUDIT_EVENT_MEMBER_LINKED, writeAuditEvent } from "./audit";
import { db } from "./db";
import { createMemberSession } from "./member-session";

/**
 * Member linking (ADR 021): consume a VERIFIED OTP challenge and turn it
 * into a linked Member + OrganizationMembership + gym-scoped session.
 *
 * Two-hats rule: this path is completely independent from Clerk. It never
 * calls Clerk's auth helpers, never inspects Clerk session state, and
 * always resolves/creates the PHONE-BACKED User by the challenge's
 * verified phone number. A person who is also an OWNER/STAFF via Clerk
 * therefore (for now) has a separate phone-backed User; merging the two
 * identities is a future, explicitly authenticated flow (ADR 021).
 *
 * Linking rules (approved): OTP proves control of the phone, not which
 * duplicate Member record belongs to the person.
 * - exactly one unlinked candidate          → link it
 * - already linked to this same User         → idempotent success
 * - any candidate linked to another User     → fail generically, never overwrite
 * - multiple unlinked candidates             → fail generically (staff resolve)
 * - user linked to a different Member in gym → fail generically
 * - never silently merge Members
 *
 * Every failure throws MemberLinkingError and the route renders one
 * generic response. Because the claim happens inside the same
 * transaction, a failed link rolls the claim back — the challenge stays
 * consumable until its 5-minute window closes.
 */

/** A verified challenge may be consumed within 5 minutes of verification. */
export const LINKING_WINDOW_MS = 5 * 60_000;

export class MemberLinkingError extends Error {
  constructor() {
    super("Linking failed.");
    this.name = "MemberLinkingError";
  }
}

export interface MemberLinkResult {
  rawToken: string;
  userId: string;
  memberId: string;
  organizationId: string;
}

export async function linkVerifiedChallenge(input: {
  organizationId: string;
  challengeId: string;
}): Promise<MemberLinkResult> {
  const { organizationId, challengeId } = input;
  const now = new Date();
  const windowStart = new Date(now.getTime() - LINKING_WINDOW_MS);

  try {
    return await db.$transaction(async (tx) => {
      // 1. Atomically claim the challenge: exactly one conditional update
      //    flips consumedAt, and only for a VERIFIED, unconsumed challenge
      //    inside its linking window, in this organization. Concurrent or
      //    replayed claims update 0 rows.
      const claim = await tx.memberOtpChallenge.updateMany({
        where: {
          id: challengeId,
          organizationId,
          status: "VERIFIED",
          consumedAt: null,
          verifiedAt: { gt: windowStart },
        },
        data: { consumedAt: now },
      });
      if (claim.count !== 1) {
        throw new MemberLinkingError();
      }
      const challenge = await tx.memberOtpChallenge.findFirst({
        where: { id: challengeId, organizationId },
      });
      if (!challenge) {
        throw new MemberLinkingError();
      }
      // The phone always comes from the claimed challenge — never from
      // client input.
      const phoneNumber = challenge.phoneNumber;

      // 2. Resolve/create the phone-backed User by verified phone.
      const user = await tx.user.upsert({
        where: { phoneNumber },
        update: {},
        create: { phoneNumber },
      });

      // 3–4. Resolve Member candidates and apply the linking rules.
      const candidates = await tx.member.findMany({
        where: { organizationId, phoneNumber },
      });
      const linkedToMe = candidates.filter((m) => m.userId === user.id);
      const linkedToOther = candidates.filter(
        (m) => m.userId !== null && m.userId !== user.id,
      );
      const unlinked = candidates.filter((m) => m.userId === null);
      if (linkedToOther.length > 0) {
        throw new MemberLinkingError();
      }

      let member = linkedToMe[0] ?? null;
      if (!member) {
        const candidate = unlinked.length === 1 ? unlinked[0] : undefined;
        if (!candidate) {
          throw new MemberLinkingError();
        }
        // This user must not already be linked to a different Member in
        // the same gym (regardless of that record's phone).
        const existingLink = await tx.member.findFirst({
          where: { organizationId, userId: user.id },
        });
        if (existingLink) {
          throw new MemberLinkingError();
        }
        member = await tx.member.update({
          where: { id: candidate.id },
          data: { userId: user.id },
        });
      }

      // 5. Ensure an OrganizationMembership. An existing row's role is
      //    never modified — only a missing row is created, as MEMBER.
      const existingMembership =
        await tx.organizationMembership.findUnique({
          where: { userId_organizationId: { userId: user.id, organizationId } },
        });
      if (!existingMembership) {
        await tx.organizationMembership.create({
          data: { userId: user.id, organizationId, role: "MEMBER" },
        });
      }

      // 6. Create the gym-scoped member session (inside the transaction).
      const { rawToken } = await createMemberSession(tx, {
        userId: user.id,
        organizationId,
      });

      // 7. Audit — the first moment an actor User exists for this flow.
      await writeAuditEvent(tx, {
        organizationId,
        actorUserId: user.id,
        event: AUDIT_EVENT_MEMBER_LINKED,
        targetType: "Member",
        targetId: member.id,
        metadata: { challengeId },
      });

      // 8. Commit (implicit). The route sets the cookie only after this
      //    promise resolves, using the returned raw token.
      return {
        rawToken,
        userId: user.id,
        memberId: member.id,
        organizationId,
      };
    });
  } catch (error) {
    if (error instanceof MemberLinkingError) throw error;
    // A unique-violation (e.g. the partial members(organization_id,
    // user_id) index, or a racing user creation) is a linking-rule
    // failure, not a server fault — surface it generically.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new MemberLinkingError();
    }
    throw error;
  }
}
