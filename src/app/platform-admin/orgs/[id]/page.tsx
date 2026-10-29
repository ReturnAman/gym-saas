import Link from "next/link";
import { notFound } from "next/navigation";

import { newIdempotencyToken } from "@/lib/idempotency";

import {
  getPlatformAdminOrganizationDetail,
  requirePlatformAdmin,
} from "@/lib/server/platform-admin";

import {
  extendTrialAction,
  reactivateAction,
  recordPaymentAction,
  reviewOfferAction,
  suspendAction,
} from "../../actions";

/**
 * Platform-admin gym detail (trial/subscription slice).
 *
 * One gym's subscription state, verified SaaS payment history, offer
 * requests, and recent SaaS audit events — plus the audited admin
 * actions. The organization ID comes from the route, and every action
 * re-checks platform-admin authorization server-side before mutating.
 * Owner contact details shown here come only from the application's own
 * data model (owner display name via Clerk directory, presentation-only).
 */

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
});

function formatMoney(amount: { toString(): string }): string {
  return `₹${amount.toString()}`;
}

export default async function PlatformAdminOrgPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  await requirePlatformAdmin();
  const { id } = await params;
  const query = await searchParams;
  const detail = await getPlatformAdminOrganizationDetail(id);
  if (!detail) {
    notFound();
  }
  const { organization, subscription, state, payments, offers, auditLogs } =
    detail;
  const pendingOffers = offers.filter((offer) => offer.status === "REQUESTED");

  return (
    <main>
      <p>
        <Link href="/platform-admin">Back to platform admin</Link>
      </p>
      <h1>{organization.name}</h1>
      {query.notice && <p>{query.notice}</p>}
      <p>Subscription state: {state}</p>
      {detail.ownerDisplayName && (
        <p>Owner: {detail.ownerDisplayName}</p>
      )}
      {subscription?.trialStartedAt && subscription?.trialEndsAt && (
        <p>
          Trial: {dateFormat.format(subscription.trialStartedAt)} to{" "}
          {dateFormat.format(subscription.trialEndsAt)}
        </p>
      )}
      {subscription?.paidThroughAt && (
        <p>Paid through: {dateFormat.format(subscription.paidThroughAt)}</p>
      )}
      {subscription?.suspendedAt && (
        <p>
          Suspended: {dateFormat.format(subscription.suspendedAt)}
          {subscription.suspensionReason &&
            ` — reason: ${subscription.suspensionReason}`}
        </p>
      )}

      <h2>Record verified payment and activate</h2>
      <p>
        Enter the payment you have actually received. Recording it grants
        the paid period below; it never changes gym-member payments or
        memberships. A suspended gym stays suspended until reactivated.
      </p>
      <form action={recordPaymentAction}>
        <input type="hidden" name="organizationId" value={organization.id} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={newIdempotencyToken()}
        />
        <label htmlFor="amount">Amount (INR)</label>
        <input id="amount" name="amount" type="text" required />
        <label htmlFor="receivedAt">Received date</label>
        <input id="receivedAt" name="receivedAt" type="date" required />
        <label htmlFor="periodStartAt">Period start</label>
        <input id="periodStartAt" name="periodStartAt" type="date" required />
        <label htmlFor="periodEndAt">Period end</label>
        <input id="periodEndAt" name="periodEndAt" type="date" required />
        <label htmlFor="reference">Reference (optional)</label>
        <input id="reference" name="reference" type="text" />
        <label htmlFor="notes">Notes (optional)</label>
        <input id="notes" name="notes" type="text" />
        <button type="submit">Record payment and activate</button>
      </form>

      <h2>Suspend</h2>
      <form action={suspendAction}>
        <input type="hidden" name="organizationId" value={organization.id} />
        <label htmlFor="reason">Reason (required)</label>
        <input id="reason" name="reason" type="text" required maxLength={280} />
        <label>
          <input type="checkbox" name="confirm" required /> I confirm this
          suspension restricts the gym immediately.
        </label>
        <button type="submit">Suspend gym</button>
      </form>

      <h2>Extend trial</h2>
      <form action={extendTrialAction}>
        <input type="hidden" name="organizationId" value={organization.id} />
        <label htmlFor="days">Days (1–90)</label>
        <input id="days" name="days" type="number" min={1} max={90} required />
        <label htmlFor="extendReason">Reason (required)</label>
        <input
          id="extendReason"
          name="reason"
          type="text"
          required
          maxLength={280}
        />
        <button type="submit">Extend trial</button>
      </form>

      <h2>Reactivate</h2>
      <p>
        If a valid trial or paid period remains, only the reason is needed.
        Otherwise, check the payment box and enter the new paid period —
        it is recorded and activated in the same step.
      </p>
      <form action={reactivateAction}>
        <input type="hidden" name="organizationId" value={organization.id} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={newIdempotencyToken()}
        />
        <label htmlFor="reactivateReason">Reason (required)</label>
        <input
          id="reactivateReason"
          name="reason"
          type="text"
          required
          maxLength={280}
        />
        <label>
          <input type="checkbox" name="withPayment" /> Grant a new paid period
        </label>
        <label htmlFor="reactivateAmount">Amount (INR)</label>
        <input id="reactivateAmount" name="amount" type="text" />
        <label htmlFor="reactivateReceivedAt">Received date</label>
        <input id="reactivateReceivedAt" name="receivedAt" type="date" />
        <label htmlFor="reactivatePeriodStartAt">Period start</label>
        <input id="reactivatePeriodStartAt" name="periodStartAt" type="date" />
        <label htmlFor="reactivatePeriodEndAt">Period end</label>
        <input id="reactivatePeriodEndAt" name="periodEndAt" type="date" />
        <label htmlFor="reactivateReference">Reference (optional)</label>
        <input id="reactivateReference" name="reference" type="text" />
        <label htmlFor="reactivateNotes">Notes (optional)</label>
        <input id="reactivateNotes" name="notes" type="text" />
        <button type="submit">Reactivate gym</button>
      </form>

      <h2>Offer requests</h2>
      {pendingOffers.length === 0 ? (
        <p>No pending offer requests.</p>
      ) : (
        pendingOffers.map((offer) => (
          <form key={offer.id} action={reviewOfferAction}>
            <input type="hidden" name="organizationId" value={organization.id} />
            <input type="hidden" name="offerId" value={offer.id} />
            <p>
              Requested {dateFormat.format(offer.requestedAt)}.
            </p>
            <label>
              Decision
              <select name="decision" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                <option value="APPROVED">Approve</option>
                <option value="DECLINED">Decline</option>
              </select>
            </label>
            <label>
              Discount (approve only: 5 or 10)
              <select name="discountPercent" defaultValue="">
                <option value="">—</option>
                <option value="5">5%</option>
                <option value="10">10%</option>
              </select>
            </label>
            <label>
              Offer expiry
              <input name="offerExpiresAt" type="date" />
            </label>
            <label>
              Applicable period start
              <input name="applicablePeriodStartAt" type="date" />
            </label>
            <label>
              Applicable period end
              <input name="applicablePeriodEndAt" type="date" />
            </label>
            <label>
              Agreed amount (INR, when known)
              <input name="agreedAmount" type="text" />
            </label>
            <label>
              Notes
              <input name="notes" type="text" />
            </label>
            <button type="submit">Decide offer</button>
          </form>
        ))
      )}
      {offers.filter((offer) => offer.status !== "REQUESTED").length > 0 && (
        <ul>
          {offers
            .filter((offer) => offer.status !== "REQUESTED")
            .map((offer) => (
              <li key={offer.id}>
                {offer.status}
                {offer.discountPercent !== null &&
                  ` — ${offer.discountPercent}%`}
                {offer.agreedAmount &&
                  ` — agreed ${formatMoney(offer.agreedAmount)}`}
                {offer.offerExpiresAt &&
                  ` — expires ${dateFormat.format(offer.offerExpiresAt)}`}
                {offer.acceptedAt &&
                  ` — accepted ${dateFormat.format(offer.acceptedAt)}`}
              </li>
            ))}
        </ul>
      )}

      <h2>Verified SaaS payments</h2>
      {payments.length === 0 ? (
        <p>No SaaS payments recorded.</p>
      ) : (
        <ul>
          {payments.map((payment) => (
            <li key={payment.id}>
              {formatMoney(payment.amount)} — received{" "}
              {dateFormat.format(payment.receivedAt)} — period{" "}
              {dateFormat.format(payment.periodStartAt)} to{" "}
              {dateFormat.format(payment.periodEndAt)}
              {payment.reference && ` — ref: ${payment.reference}`}
            </li>
          ))}
        </ul>
      )}

      <h2>Recent SaaS admin actions</h2>
      {auditLogs.length === 0 ? (
        <p>No SaaS admin actions recorded.</p>
      ) : (
        <ul>
          {auditLogs.map((log) => (
            <li key={log.id}>
              {log.event} — {dateFormat.format(log.createdAt)}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
