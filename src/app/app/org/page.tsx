import Link from "next/link";

import {
  getOwnerSubscriptionView,
  isInOfferWindow,
  requireEntitledOrganizationContext,
  trialRemainingMs,
} from "@/lib/server/subscriptions";
import {
  dismissOfferPromptAction,
  requestOfferAction,
} from "../subscription/actions";

/**
 * The organization's protected area (minimal foundation).
 *
 * Requires authentication AND organization membership AND an active
 * entitlement: restricted gyms are redirected to /app/subscription by
 * requireEntitledOrganizationContext before anything renders. The
 * organization is derived from server-side membership data only — no
 * client-provided organization ID or role is accepted as authoritative.
 *
 * The trial banner below is server-rendered from stored timestamps:
 * remaining time is computed here, never from browser state. The
 * final-48-hour offer prompt appears only while the trial is live and
 * inside its window, only when no offer request is pending, and only
 * until the owner dismisses it.
 */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

export default async function OrganizationPage() {
  const { organization, membership } =
    await requireEntitledOrganizationContext();
  const view = await getOwnerSubscriptionView(organization.id);
  const { subscription, state } = view;
  const now = new Date();
  const remaining = trialRemainingMs(subscription, now);
  const remainingDays =
    remaining === null ? null : Math.floor(remaining / (24 * 60 * 60_000));
  const inOfferWindow = isInOfferWindow(subscription, now);
  const pendingOffer = view.offers.find(
    (offer) => offer.status === "REQUESTED",
  );
  const approvedOffer = view.offers.find(
    (offer) => offer.status === "APPROVED",
  );
  const promptDismissed = !!subscription?.offerPromptDismissedAt;
  const showOfferPrompt =
    inOfferWindow &&
    !pendingOffer &&
    !approvedOffer &&
    !promptDismissed &&
    membership.role === "OWNER";

  return (
    <main>
      <h1>{organization.name}</h1>
      <p>Your role: {membership.role}</p>

      {state === "TRIAL_ACTIVE" && subscription?.trialEndsAt && (
        <section>
          <h2>Free trial</h2>
          <p>
            Your trial ends on {dateFormat.format(subscription.trialEndsAt)}.
          </p>
          {remainingDays !== null && (
            <p>
              You have {remainingDays} day{remainingDays === 1 ? "" : "s"}{" "}
              left in your free trial.
            </p>
          )}
          <p>
            <Link href="/app/subscription">View subscription</Link>
          </p>
        </section>
      )}

      {state === "ACTIVE" && subscription?.paidThroughAt && (
        <p>
          Subscription paid through{" "}
          {dateFormat.format(subscription.paidThroughAt)}.{" "}
          <Link href="/app/subscription">View subscription</Link>
        </p>
      )}

      {pendingOffer && (
        <p>
          Your offer request is awaiting administrator review.{" "}
          <Link href="/app/subscription">View subscription</Link>
        </p>
      )}

      {approvedOffer && (
        <p>
          Approved offer: {approvedOffer.discountPercent}% off.{" "}
          <Link href="/app/subscription">View subscription</Link>
        </p>
      )}

      {showOfferPrompt && (
        <section>
          <h2>Like how things are running? Let&apos;s help you keep going.</h2>
          <form action={requestOfferAction}>
            <button type="submit">Unlock your best offer</button>
          </form>
          <form action={dismissOfferPromptAction}>
            <button type="submit">Dismiss</button>
          </form>
        </section>
      )}

      <p>
        <Link href="/app/org/members">Members</Link>
      </p>
      <p>
        <Link href="/app/org/attendance">Attendance</Link>
      </p>
      <p>
        <Link href="/app/org/payment-claims">Payment claims</Link>
      </p>
      <p>
        <Link href="/app/org/join-requests">Pending members</Link>
      </p>
      <p>
        <Link href="/app/org/staff">Staff</Link>
      </p>
      <p>
        <Link href="/app/org/settings">Gym settings</Link>
      </p>
    </main>
  );
}
