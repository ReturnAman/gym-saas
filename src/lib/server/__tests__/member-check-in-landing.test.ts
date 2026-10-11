import { describe, expect, it } from "vitest";

import type { AttendanceSessionItem } from "@/lib/server/attendance";
import { resolveCheckInLandingState } from "@/lib/server/member-check-in";
import type { MemberSessionContext } from "@/lib/server/member-session";

const ORG_A = "c3298d3b-a07f-33eb-de2b-00333455cf3f";
const ORG_B = "e57a1b2c-3d4e-4f50-a6b7-c8d9e0f1a2b3";

function contextFixture(
  overrides: {
    organizationId?: string;
    organizationName?: string;
    member?: { id: string; name: string } | null;
  } = {},
): MemberSessionContext {
  const organizationId = overrides.organizationId ?? ORG_A;
  return {
    session: { id: "session-1", organizationId },
    user: { id: "user-1" },
    organization: {
      id: organizationId,
      name: overrides.organizationName ?? "Gym A",
    },
    membership: { organizationId, role: "MEMBER" },
    member:
      overrides.member === null
        ? null
        : {
            id: overrides.member?.id ?? "member-1",
            name: overrides.member?.name ?? "Test Member",
          },
  } as unknown as MemberSessionContext;
}

function openSessionFixture(checkInAt: string): AttendanceSessionItem {
  return {
    id: "attendance-1",
    memberId: "member-1",
    checkInAt,
    checkOutAt: null,
    source: "QR",
    checkedInByRole: "MEMBER",
  };
}

describe("resolveCheckInLandingState", () => {
  it("returns signed_out with the QR gym passthrough when there is no session", () => {
    expect(
      resolveCheckInLandingState({
        gymId: ORG_B,
        qrGymName: "Gym B",
        context: null,
        openSession: null,
      }),
    ).toEqual({ kind: "signed_out", gymId: ORG_B, qrGymName: "Gym B" });
  });

  it("returns signed_out with nulls when there is no session and no QR gym", () => {
    expect(
      resolveCheckInLandingState({
        gymId: null,
        qrGymName: null,
        context: null,
        openSession: null,
      }),
    ).toEqual({ kind: "signed_out", gymId: null, qrGymName: null });
  });

  it("returns no_gym when a session exists but no QR gym was supplied", () => {
    expect(
      resolveCheckInLandingState({
        gymId: null,
        qrGymName: null,
        context: contextFixture(),
        openSession: null,
      }),
    ).toEqual({ kind: "no_gym" });
  });

  it("returns mismatch when the QR gym differs from the session gym", () => {
    expect(
      resolveCheckInLandingState({
        gymId: ORG_B,
        qrGymName: "Gym B",
        context: contextFixture(),
        openSession: null,
      }),
    ).toEqual({
      kind: "mismatch",
      gymId: ORG_B,
      qrGymName: "Gym B",
      sessionGymName: "Gym A",
    });
  });

  it("returns unavailable when the session gym matches but the linked Member is gone", () => {
    expect(
      resolveCheckInLandingState({
        gymId: ORG_A,
        qrGymName: null,
        context: contextFixture({ member: null }),
        openSession: null,
      }),
    ).toEqual({ kind: "unavailable" });
  });

  it("returns checked_in carrying the open session's check-in time", () => {
    const checkInAt = "2026-10-10T01:00:00.000Z";
    expect(
      resolveCheckInLandingState({
        gymId: ORG_A,
        qrGymName: null,
        context: contextFixture(),
        openSession: openSessionFixture(checkInAt),
      }),
    ).toEqual({
      kind: "checked_in",
      gymName: "Gym A",
      memberName: "Test Member",
      checkInAt,
    });
  });

  it("returns ready when the gym matches and there is no open session", () => {
    expect(
      resolveCheckInLandingState({
        gymId: ORG_A,
        qrGymName: null,
        context: contextFixture(),
        openSession: null,
      }),
    ).toEqual({
      kind: "ready",
      gymName: "Gym A",
      memberName: "Test Member",
    });
  });
});
