import { requireOrganizationContext } from "@/lib/server/authorization";
import {
  getOwnerSubscriptionView,
  isInOfferWindow,
  trialRemainingMs,
  type EffectiveSubscriptionState,
} from "@/lib/server/subscriptions";

import {
  acceptOfferAction,
  requestOfferAction,
} from "./actions";

/**
 * Owner subscription screen (trial/subscription slice).
 *
 * Deliberately NOT gated by entitlement: this is the recovery screen a
 * restricted owner must always be able to reach. It uses
 * requireOrganizationContext (authentication + membership only) and
 * renders the gym's own subscription state from server-derived
 * timestamps. Nothing here grants access — the protected pages stay
 * gated — and no support contact, price, or payment link is invented:
 * continuation is arranged with the Gym SaaS team, and the administrator
 * records any verified payment.
 *
 * Billing details are OWNER-only: the latest verified payment and the
 * suspension reason render only for the gym's owner. Other roles see
 * the state and the recovery text, never amounts or operator notes.
 */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const STATE_LABELS: Record<EffectiveSubscriptionState, string> = {
  TRIAL_ACTIVE: "Trial active",
  PENDING_PAYMENT: "Awaiting payment",
  ACTIVE: "Subscription active",
  EXPIRED: "Expired",
  SUSPENDED: "Suspended",
};

function formatRemaining(remainingMs: number | null): string | null {
  if (remainingMs === null) return null;
  const dayMs = 24 * 60 * 60_000;
  const days = Math.floor(remainingMs / dayMs);
  if (days >= 1) {
    return `You have ${days} day${days === 1 ? "" : "s"} left in your free trial.`;
  }
  const hours = Math.ceil(remainingMs / (60 * 60_000));
  return `You have ${hours} hour${hours === 1 ? "" : "s"} left in your free trial.`;
}

function formatInr(amount: { toString(): string }): string {
  return `₹${amount.toString()}`;
}

export default async function SubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { organization, membership } = await requireOrganizationContext();
  const params = await searchParams;
  const view = await getOwnerSubscriptionView(organization.id);
  const { subscription, state, offers, latestPayment } = view;
  const now = new Date();
  const remaining = trialRemainingMs(subscription, now);
  const remainingText = formatRemaining(remaining);
  const inOfferWindow = isInOfferWindow(subscription, now);
  const pendingOffer = offers.find((offer) => offer.status === "REQUESTED");
  const approvedOffer = offers.find((offer) => offer.status === "APPROVED");
  const isOwner = membership.role === "OWNER";

  return (
    <main>
      <h1>Subscription</h1>
      {params.notice && <p>{params.notice}</p>}
      <p>
        {organization.name} — {STATE_LABELS[state]}
      </p>

      {state === "TRIAL_ACTIVE" && (
        <>
          {subscription?.trialEndsAt && (
            <p>
              Your free trial ends on{" "}
              {dateFormat.format(subscription.trialEndsAt)}.
            </p>
          )}
          {remainingText && <p>{remainingText}</p>}
        </>
      )}

      {state === "ACTIVE" && subscription?.paidThroughAt && (
        <p>
          Your subscription is paid through{" "}
          {dateFormat.format(subscription.paidThroughAt)}.
        </p>
      )}

      {state === "EXPIRED" && (
        <>
          <p>
            Your trial or subscription period has ended, so normal gym
            operations are paused. Your gym&apos;s members, attendance
            history, payments and claims are preserved.
          </p>
          <p>
            To continue, contact the Gym SaaS team to arrange activation
            after payment verification.
          </p>
        </>
      )}

      {state === "PENDING_PAYMENT" && (
        <p>
          This gym has no active trial or paid subscription yet, so normal
          gym operations are paused. To activate it, contact the Gym SaaS
          team to arrange payment verification.
        </p>
      )}

      {state === "SUSPENDED" && (
        <>
          <p>
            Access to this gym is suspended, so normal gym operations are
            paused. Your gym&apos;s data is preserved.
          </p>
          {isOwner && subscription?.suspensionReason && (
            <p>Reason: {subscription.suspensionReason}</p>
          )}
          <p>
            To restore access, contact the Gym SaaS team.
          </p>
        </>
      )}

      {isOwner && latestPayment && (
        <p>
          Most recent verified subscription payment:{" "}
          {formatInr(latestPayment.amount)} for the period{" "}
          {dateFormat.format(latestPayment.periodStartAt)} to{" "}
          {dateFormat.format(latestPayment.periodEndAt)}.
        </p>
      )}

      <h2>Special offer</h2>
      {pendingOffer && (
        <p>
          Your offer request is awaiting administrator review. We will
          confirm the approved discount, expiry and agreed amount here
          once it is decided.
        </p>
      )}
      {!pendingOffer && approvedOffer && (
        <>
          <p>
            Approved offer: {approvedOffer.discountPercent}% off
            {approvedOffer.offerExpiresAt &&
              `, valid until ${dateFormat.format(approvedOffer.offerExpiresAt)}`}
            {approvedOffer.agreedAmount &&
              `, agreed amount ${formatInr(approvedOffer.agreedAmount)}`}
            .
          </p>
          {approvedOffer.applicablePeriodStartAt &&
            approvedOffer.applicablePeriodEndAt && (
              <p>
                Applicable to the period{" "}
                {dateFormat.format(approvedOffer.applicablePeriodStartAt)}{" "}
                to {dateFormat.format(approvedOffer.applicablePeriodEndAt)}.
              </p>
            )}
          {isOwner && (
            <form action={acceptOfferAction}>
              <input type="hidden" name="offerId" value={approvedOffer.id} />
              <button type="submit">Accept offer</button>
            </form>
          )}
        </>
      )}
      {!pendingOffer && !approvedOffer && inOfferWindow && isOwner && (
        <>
          <p>
            Like how things are running? Let&apos;s help you keep going.
          </p>
          <form action={requestOfferAction}>
            <button type="submit">Unlock your best offer</button>
          </form>
          <p>
            This sends a request for manual review. It does not promise a
            discount or start payment collection.
          </p>
        </>
      )}
      {!pendingOffer && !approvedOffer && !inOfferWindow && (
        <p>
          No offer is available right now. Offers open during the final 48
          hours of an active trial.
        </p>
      )}
      {!isOwner && (
        <p>
          Only the gym owner can request or accept offers. Your gym&apos;s
          owner can manage the subscription from this page.
        </p>
      )}
    </main>
  );
}
