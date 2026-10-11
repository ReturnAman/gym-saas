import "server-only";

import {
  getOwnOpenSession,
  type AttendanceSessionItem,
} from "./attendance";
import { db } from "./db";
import {
  getMemberContext,
  type MemberSessionContext,
} from "./member-session";

/**
 * Member check-in landing state (QR flow).
 *
 * The landing page is a pure function of three inputs: the QR gym claim
 * (a client-supplied organization ID — discovery information only), the
 * server-resolved member context (the only authorization input), and the
 * member's open session in the SESSION's gym. The state machine keeps
 * those strictly separate: a QR gym that does not match the session gym
 * yields "mismatch" and can never reach a check-in affordance.
 *
 * The QR gym's display name is looked up only for the signed-out and
 * mismatch states (explaining which gym the code belongs to). An
 * organization name is public information — it is printed on the QR
 * poster at the gym — so resolving it from the claimed ID leaks nothing;
 * it is never used for authorization.
 */

export type CheckInLandingState =
  | { kind: "signed_out"; gymId: string | null; qrGymName: string | null }
  | { kind: "no_gym" }
  | {
      kind: "mismatch";
      gymId: string;
      qrGymName: string | null;
      sessionGymName: string;
    }
  | { kind: "unavailable" }
  | { kind: "ready"; gymName: string; memberName: string }
  | {
      kind: "checked_in";
      gymName: string;
      memberName: string;
      checkInAt: string;
    };

export function resolveCheckInLandingState(input: {
  gymId: string | null;
  qrGymName: string | null;
  context: MemberSessionContext | null;
  openSession: AttendanceSessionItem | null;
}): CheckInLandingState {
  const { gymId, qrGymName, context, openSession } = input;

  if (!context) {
    return { kind: "signed_out", gymId, qrGymName };
  }
  if (!gymId) {
    return { kind: "no_gym" };
  }
  if (gymId !== context.session.organizationId) {
    return {
      kind: "mismatch",
      gymId,
      qrGymName,
      sessionGymName: context.organization.name,
    };
  }
  if (!context.member) {
    // The session is valid but the linked Member record no longer
    // exists — nothing member-specific can be shown or done.
    return { kind: "unavailable" };
  }
  if (openSession) {
    return {
      kind: "checked_in",
      gymName: context.organization.name,
      memberName: context.member.name,
      checkInAt: openSession.checkInAt,
    };
  }
  return {
    kind: "ready",
    gymName: context.organization.name,
    memberName: context.member.name,
  };
}

/**
 * Resolve the landing state for a request: session context first, the
 * public QR-gym name only when it will actually be displayed, and the
 * open session only in the session's own gym.
 */
export async function resolveCheckInLanding(
  gymId: string | null,
): Promise<CheckInLandingState> {
  const context = await getMemberContext();

  let qrGymName: string | null = null;
  if (gymId && (!context || gymId !== context.session.organizationId)) {
    try {
      const organization = await db.organization.findUnique({
        where: { id: gymId },
        select: { name: true },
      });
      qrGymName = organization?.name ?? null;
    } catch {
      qrGymName = null;
    }
  }

  let openSession: AttendanceSessionItem | null = null;
  if (context && gymId === context.session.organizationId && context.member) {
    openSession = await getOwnOpenSession(context);
  }

  return resolveCheckInLandingState({
    gymId,
    qrGymName,
    context,
    openSession,
  });
}
