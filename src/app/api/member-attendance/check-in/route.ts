import { NextResponse } from "next/server";

import {
  AttendanceAlreadyCheckedInError,
  AttendanceMembershipExpiredError,
  AttendanceNoMembershipError,
  AttendanceNotFoundError,
  checkInSelf,
} from "@/lib/server/attendance";
import {
  getMemberContext,
  isSameOriginRequest,
} from "@/lib/server/member-session";

/**
 * POST /api/member-attendance/check-in — member self-check-in (QR flow).
 *
 * Authenticated solely by the gym-scoped member session cookie (ADR 021):
 * organization, member, and actor all come from the resolved member
 * context — never from the request. The body's only meaningful field is
 * `gym`, the organization ID carried by the scanned QR code; it is a
 * claim to compare against the session, never a scope to trust. A
 * mismatch is rejected before the attendance service is invoked, so a
 * member can never write attendance into a gym their session does not
 * belong to. Any other body fields are ignored entirely.
 *
 * Guard order matters: origin first (the request is authenticated by
 * the cookie alone), then the session, then the gym comparison, then
 * the service.
 */
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Request origin could not be verified.",
        },
      },
      { status: 403 },
    );
  }

  const context = await getMemberContext();
  if (!context) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in required.",
        },
      },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return genericFailure();
  }
  const { gym } = (body ?? {}) as { gym?: unknown };
  if (typeof gym !== "string" || gym.trim() === "") {
    return genericFailure();
  }

  if (gym !== context.session.organizationId) {
    return NextResponse.json(
      {
        error: {
          code: "GYM_MISMATCH",
          message: "This check-in code is for a different gym.",
        },
      },
      { status: 400 },
    );
  }

  try {
    await checkInSelf(context);
    return NextResponse.json({ result: "checked_in" });
  } catch (error) {
    if (error instanceof AttendanceAlreadyCheckedInError) {
      return NextResponse.json({ result: "already_checked_in" });
    }
    if (error instanceof AttendanceMembershipExpiredError) {
      return NextResponse.json(
        {
          error: {
            code: "MEMBERSHIP_EXPIRED",
            message:
              "Your membership has expired. Please see the front desk.",
          },
        },
        { status: 400 },
      );
    }
    if (
      error instanceof AttendanceNoMembershipError ||
      error instanceof AttendanceNotFoundError
    ) {
      return NextResponse.json(
        {
          error: {
            code: "CHECK_IN_FAILED",
            message: "Could not check in. Please see the front desk.",
          },
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Something went wrong. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}

function genericFailure() {
  return NextResponse.json(
    {
      error: {
        code: "CHECK_IN_FAILED",
        message: "Could not check in. Please try again.",
      },
    },
    { status: 400 },
  );
}
