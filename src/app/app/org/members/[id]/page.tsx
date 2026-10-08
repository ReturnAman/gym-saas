import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOrganizationContext } from "@/lib/server/authorization";
import { getMemberDetail } from "@/lib/server/members";
import {
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
  formatDate,
  formatInr,
  parseDateInput,
  type MembershipStatus,
  type PaymentStatus,
} from "@/lib/members";

import styles from "../members.module.css";

function membershipBadgeClass(status: MembershipStatus): string {
  if (status === "ACTIVE") return `${styles.badge} ${styles.badgeActive}`;
  if (status === "EXPIRING") return `${styles.badge} ${styles.badgeExpiring}`;
  return `${styles.badge} ${styles.badgeExpired}`;
}

function paymentBadgeClass(status: PaymentStatus): string {
  if (status === "PAID") return `${styles.badge} ${styles.badgePaid}`;
  if (status === "PARTIALLY_PAID" || status === "OVERPAID")
    return `${styles.badge} ${styles.badgeExpiring}`;
  return `${styles.badge} ${styles.badgeUnpaid}`;
}

function displayDate(isoDate: string): string {
  const parsed = parseDateInput(isoDate);
  return parsed ? formatDate(parsed) : isoDate;
}

/**
 * Member details (protected).
 *
 * Four sections: Member, Membership, Financial, Attendance. Attendance is a
 * placeholder section only — attendance tracking is a later slice and is not
 * implemented here.
 */
export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await requireOrganizationContext();
  const { id } = await params;
  const detail = await getMemberDetail(user.id, id);
  if (!detail) {
    notFound();
  }

  const membership = detail.membership;

  return (
    <main>
      <h1>{detail.name}</h1>

      <div className={styles.sections}>
        <section className={styles.section} aria-label="Member">
          <h2>Member</h2>
          <dl className={styles.details}>
            <div className={styles.detailRow}>
              <dt className={styles.term}>Name</dt>
              <dd className={styles.value}>{detail.name}</dd>
            </div>
            <div className={styles.detailRow}>
              <dt className={styles.term}>Phone</dt>
              <dd className={styles.value}>{detail.phoneNumber}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.section} aria-label="Membership">
          <h2>Membership</h2>
          {membership ? (
            <dl className={styles.details}>
              <div className={styles.detailRow}>
                <dt className={styles.term}>Status</dt>
                <dd className={styles.value}>
                  <span className={membershipBadgeClass(membership.membershipStatus)}>
                    {MEMBERSHIP_STATUS_LABELS[membership.membershipStatus]}
                  </span>
                </dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.term}>Plan</dt>
                <dd className={styles.value}>{membership.planLabel}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.term}>Start date</dt>
                <dd className={styles.value}>{displayDate(membership.startDate)}</dd>
              </div>
              <div className={styles.detailRow}>
                <dt className={styles.term}>Expiry date</dt>
                <dd className={styles.value}>{displayDate(membership.expiryDate)}</dd>
              </div>
            </dl>
          ) : (
            <p className={styles.empty}>No membership on record.</p>
          )}
        </section>

        <section className={styles.section} aria-label="Financial">
          <h2>Financial</h2>
          {membership ? (
            <>
              <dl className={styles.details}>
                <div className={styles.detailRow}>
                  <dt className={styles.term}>Total fee</dt>
                  <dd className={styles.value}>{formatInr(membership.feePaise)}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.term}>Paid</dt>
                  <dd className={styles.value}>{formatInr(membership.paidPaise)}</dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.term}>Outstanding</dt>
                  <dd className={styles.value}>
                    {formatInr(membership.outstandingPaise)}
                  </dd>
                </div>
                <div className={styles.detailRow}>
                  <dt className={styles.term}>Payment status</dt>
                  <dd className={styles.value}>
                    <span className={paymentBadgeClass(membership.paymentStatus)}>
                      {PAYMENT_STATUS_LABELS[membership.paymentStatus]}
                    </span>
                  </dd>
                </div>
              </dl>

              <h3>Payment history</h3>
              {membership.payments.length === 0 ? (
                <p className={styles.empty}>No payments recorded yet.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Amount</th>
                        <th scope="col">Method</th>
                        <th scope="col">Reference</th>
                        <th scope="col">Date</th>
                        <th scope="col">Confirmed by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {membership.payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatInr(payment.amountPaise)}</td>
                          <td>{PAYMENT_METHOD_LABELS[payment.paymentMethod]}</td>
                          <td>
                            {payment.reference ?? (
                              <span className={styles.empty}>—</span>
                            )}
                          </td>
                          <td>{formatDate(new Date(payment.confirmedAt))}</td>
                          <td>{payment.confirmedByRole ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {detail.permissions.canRecordPayment && (
                <div className={styles.detailActions}>
                  <Link
                    href={`/app/org/members/${detail.id}/payments/new`}
                    className={styles.button}
                  >
                    Record payment
                  </Link>
                </div>
              )}
            </>
          ) : (
            <p className={styles.empty}>No financial records.</p>
          )}
        </section>

        <section className={styles.section} aria-label="Attendance">
          <h2>Attendance</h2>
          <p className={styles.empty}>No attendance records yet.</p>
        </section>
      </div>

      <div className={styles.detailActions}>
        <Link href="/app/org/members" className={styles.secondaryButton}>
          Back to members
        </Link>
        {detail.permissions.canEdit && (
          <Link
            href={`/app/org/members/${detail.id}/edit`}
            className={styles.button}
          >
            Edit member
          </Link>
        )}
      </div>
    </main>
  );
}
