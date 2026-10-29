import Link from "next/link";

/**
 * Restricted-access notice for members (trial/subscription slice).
 *
 * Deliberately unauthenticated and generic: it reveals nothing about
 * the gym's subscription state beyond "restricted", grants no access,
 * and links only to the member landing. The member session itself is
 * untouched — signing in again works as soon as the gym's access is
 * restored.
 */
export default function MemberRestrictedPage() {
  return (
    <main>
      <h1>Gym access is paused</h1>
      <p>
        This gym&apos;s subscription is currently restricted, so member
        features are unavailable right now. Your membership and history
        are preserved.
      </p>
      <p>Please ask the gym for help, or check back later.</p>
      <p>
        <Link href="/member">Your membership</Link>
      </p>
    </main>
  );
}
