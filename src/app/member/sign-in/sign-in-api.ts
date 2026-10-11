"use client";

import {
  SignInApiError,
  type SignInApi,
} from "@/lib/member-sign-in-flow";

/**
 * Fetch implementation of the sign-in flow's API surface, over the
 * existing member-auth routes (whose behavior is unchanged):
 *
 * - POST /api/member-auth/otp/request → 200 { challengeId };
 *   400 VALIDATION_ERROR; 503 OTP_UNAVAILABLE; 500 INTERNAL_ERROR.
 * - POST /api/member-auth/otp/verify → 200 { verified: true };
 *   every failure is the same generic 400 (503 on provider outage).
 * - POST /api/member-auth/link → 200 { linked: true } + session
 *   cookie; every failure is the same generic 400.
 *
 * A non-OK response becomes a SignInApiError carrying the HTTP status
 * (and the body's error code when parseable); a rejected fetch becomes
 * a SignInApiError with a null status, which the flow reads as "no
 * response arrived" rather than "the server said no".
 */
async function postJson(
  path: string,
  body: Record<string, string>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SignInApiError(null, null);
  }

  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    throw new SignInApiError(
      response.status,
      typeof code === "string" ? code : null,
    );
  }
  return json;
}

export const memberSignInApi: SignInApi = {
  async requestOtp(input) {
    const json = await postJson("/api/member-auth/otp/request", input);
    const challengeId = (json as { challengeId?: unknown } | null)
      ?.challengeId;
    if (typeof challengeId !== "string" || challengeId === "") {
      // A 200 without a usable challenge id cannot drive the flow;
      // surface it as a response-less failure so the member can retry.
      throw new SignInApiError(null, null);
    }
    return { challengeId };
  },

  async verifyOtp(input) {
    await postJson("/api/member-auth/otp/verify", input);
  },

  async link(input) {
    await postJson("/api/member-auth/link", input);
  },
};
