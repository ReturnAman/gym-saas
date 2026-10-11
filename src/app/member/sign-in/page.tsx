import Link from "next/link";

import { SignInForm } from "./sign-in-form";

/**
 * Member sign-in page — the phone → OTP → link flow for ONE gym
 * (/member/sign-in?gym=<organizationId>), reached from the gym's QR
 * landing or the check-in mismatch recovery.
 *
 * The gym parameter is discovery context only (it came from the QR
 * code, which identifies the gym but authenticates nothing): it scopes
 * the sign-in attempt, and the resulting session is verified
 * server-side at every later step. Without a gym there is nothing to
 * sign in to — the member needs their gym's QR code.
 */
export default async function MemberSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ gym?: string }>;
}) {
  const params = await searchParams;
  const gymId = params.gym?.trim() ? params.gym.trim() : null;

  if (!gymId) {
    return (
      <main>
        <h1>Member sign-in</h1>
        <p>Scan your gym&apos;s QR code to sign in.</p>
        <p>
          <Link href="/member">Your membership</Link>
        </p>
      </main>
    );
  }

  return (
    <main>
      <h1>Member sign-in</h1>
      <SignInForm key={gymId} gymId={gymId} />
    </main>
  );
}
