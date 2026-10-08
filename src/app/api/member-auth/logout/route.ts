import { NextResponse } from "next/server";

import {
  clearMemberSessionCookie,
  isSameOriginRequest,
  readMemberSessionToken,
  revokeMemberSession,
} from "@/lib/server/member-session";

/**
 * POST /api/member-auth/logout — end the member session.
 *
 * Revocation is server-side: the session row is marked revoked, so the
 * token stops working everywhere immediately; clearing the cookie is just
 * hygiene. Idempotent — no cookie, an unknown token, or an already-revoked
 * session all return the same success. Origin-checked because the request
 * is authenticated by the cookie alone.
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
  await revokeMemberSession(await readMemberSessionToken());
  await clearMemberSessionCookie();
  return NextResponse.json({ loggedOut: true });
}
