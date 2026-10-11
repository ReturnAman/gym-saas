import Link from "next/link";

import { resolveCheckInLanding } from "@/lib/server/member-check-in";

import { CheckInButton } from "./check-in-button";

/**
 * Member check-in landing page — the target of the gym's QR code
 * (/member/check-in?gym=<organizationId>).
 *
 * The gym parameter identifies the gym the member is standing in; it
 * authenticates nothing. Every state is resolved server-side from the
 * member session (see resolveCheckInLanding): signed-out visitors are
 * sent to sign in for THIS gym, a session for a different gym sees a
 * mismatch with safe recovery actions, and only a session matching the
 * QR gym can reach the check-in button. The post-link recovery rule
 * applies here too — this page renders from the actual session, never
 * from a link response, so it is the ground truth after any sign-in
 * attempt.
 */

const checkInTimeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export default async function MemberCheckInPage({
  searchParams,
}: {
  searchParams: Promise<{ gym?: string }>;
}) {
  const params = await searchParams;
  const gymId = params.gym?.trim() ? params.gym.trim() : null;
  const state = await resolveCheckInLanding(gymId);

  switch (state.kind) {
    case "signed_out":
      return (
        <main>
          <h1>Member check-in</h1>
          {state.qrGymName ? (
            <p>Sign in to check in at {state.qrGymName}.</p>
          ) : (
            <p>Scan your gym&apos;s QR code to sign in and check in.</p>
          )}
          {state.gymId && (
            <p>
              <Link href={`/member/sign-in?gym=${state.gymId}`}>Sign in</Link>
            </p>
          )}
        </main>
      );

    case "no_gym":
      return (
        <main>
          <h1>Member check-in</h1>
          <p>Open your gym&apos;s QR code to check in.</p>
          <p>
            <Link href="/member/scan">Scan the gym QR code</Link>
          </p>
          <p>
            <Link href="/member">Your membership</Link>
          </p>
        </main>
      );

    case "mismatch":
      return (
        <main>
          <h1>Member check-in</h1>
          <p>
            This code is for {state.qrGymName ?? "a different gym"}. You&apos;re
            signed in to {state.sessionGymName}.
          </p>
          <p>
            <Link href={`/member/sign-in?gym=${state.gymId}`}>
              Sign in to {state.qrGymName ?? "this gym"}
            </Link>
          </p>
          <p>
            <Link href="/member">Go to {state.sessionGymName}</Link>
          </p>
        </main>
      );

    case "unavailable":
      return (
        <main>
          <h1>Member check-in</h1>
          <p>
            We couldn&apos;t load your member record. Please see the front
            desk.
          </p>
        </main>
      );

    case "ready":
      return (
        <main>
          <h1>{state.gymName}</h1>
          <p>Welcome, {state.memberName}.</p>
          {gymId && <CheckInButton gymId={gymId} />}
        </main>
      );

    case "checked_in":
      return (
        <main>
          <h1>{state.gymName}</h1>
          <p>You&apos;re checked in.</p>
          <p>
            Checked in at{" "}
            {checkInTimeFormat.format(new Date(state.checkInAt))}.
          </p>
        </main>
      );
  }
}
