import Link from "next/link";
import { notFound } from "next/navigation";

import {
  PAYMENT_METHOD_LABELS,
  formatDate,
  formatInr,
} from "@/lib/members";
import { requireOrganizationContext } from "@/lib/server/authorization";
import { getMemberDetail } from "@/lib/server/members";

import { ReversePaymentForm } from "./reverse-form";
import styles from "../../../../members.module.css";

/**
 * Reverse Payment page (protected).
 *
 * The payment is loaded through the member detail, so it is already
 * scoped to the caller's organization — a payment ID from another gym
 * is indistinguishable from a missing one. Authorization to actually
 * reverse (OWNER/ADMIN) is enforced again inside reversePayment; this
 * page only decides whether to render the form, a permission notice,
 * or the fully-reversed state.
 */
export default async function ReversePaymentPage({
  params,
}: {
  params: Promise<{ id: string; paymentId: string }>;
}) {
  const { user } = await requireOrganizationContext();
  const { id, paymentId } = await params;
  const detail = await getMemberDetail(user.id, id);
  if (!detail || !detail.membership) {
    notFound();
  }

  const payment = detail.membership.payments.find((p) => p.id === paymentId);
  if (!payment) {
    notFound();
  }
  const priorReversals = detail.membership.reversals.filter(
    (reversal) => reversal.paymentId === payment.id,
  );
  const fullyReversed = payment.remainingReversiblePaise <= 0;

  return (
    <main>
      <h1>Reverse payment</h1>
      <p>
        Member:{" "}
        <Link href={`/app/org/members/${detail.id}`}>{detail.name}</Link>
      </p>

      <dl className={styles.details}>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Payment amount</dt>
          <dd className={styles.value}>{formatInr(payment.amountPaise)}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Method</dt>
          <dd className={styles.value}>
            {PAYMENT_METHOD_LABELS[payment.paymentMethod]}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Reference</dt>
          <dd className={styles.value}>{payment.reference ?? "—"}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Date</dt>
          <dd className={styles.value}>
            {formatDate(new Date(payment.confirmedAt))}
          </dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Already reversed</dt>
          <dd className={styles.value}>{formatInr(payment.reversedPaise)}</dd>
        </div>
        <div className={styles.detailRow}>
          <dt className={styles.term}>Still reversible</dt>
          <dd className={styles.value}>
            {formatInr(payment.remainingReversiblePaise)}
          </dd>
        </div>
      </dl>

      {priorReversals.length > 0 && (
        <>
          <h2>Reversals of this payment</h2>
          <ul>
            {priorReversals.map((reversal) => (
              <li key={reversal.id}>
                {formatInr(reversal.amountPaise)} — {reversal.reason} —{" "}
                {formatDate(new Date(reversal.reversedAt))}
                {reversal.explanation ? ` — ${reversal.explanation}` : ""}
              </li>
            ))}
          </ul>
        </>
      )}

      {fullyReversed ? (
        <div className={styles.detailActions}>
          <button type="button" disabled className={styles.button}>
            Reverse payment
          </button>
          <p>
            This payment has been <strong>Fully reversed</strong>, so it
            cannot be reversed again.
          </p>
        </div>
      ) : detail.permissions.canReversePayment ? (
        <ReversePaymentForm
          memberId={detail.id}
          paymentId={payment.id}
          remainingPaise={payment.remainingReversiblePaise}
        />
      ) : (
        <p role="alert" className={styles.formError}>
          Only the gym owner or an admin can reverse a payment.
        </p>
      )}
    </main>
  );
}
