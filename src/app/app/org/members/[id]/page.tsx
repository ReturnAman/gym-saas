import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ATTENDANCE_SOURCE_LABELS,
  formatKolkataDate,
  formatKolkataDateTime,
  formatKolkataTime,
} from "@/lib/attendance";
import { requireOrganizationContext } from "@/lib/server/authorization";
import {
  getAttendancePermissions,
  getOpenSession,
  listMemberAttendance,
} from "@/lib/server/attendance";
import { getMemberDetail } from "@/lib/server/members";
import {
  PaymentClaimAuthorizationError,
  PaymentClaimNotFoundError,
  canVerifyPaymentClaim,
  listClaimsForMember,
  type PaymentClaimView,
} from "@/lib/server/payment-claims";
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

import { CheckInForm } from "../../attendance/check-in-form";
import { CheckOutForm } from "../../attendance/check-out-form";
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

const CLAIM_STATUS_LABELS: Record<PaymentClaimView["status"], string> = {
  PENDING: "Awaiting verification",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};

function claimBadgeClass(status: PaymentClaimView["status"]): string {
  if (status === "CONFIRMED") return `${styles.badge} ${styles.badgePaid}`;
  if (status === "PENDING") return `${styles.badge} ${styles.badgeExpiring}`;
  return `${styles.badge} ${styles.badgeUnpaid}`;
}

/**
 * The member's payment-claim history, or null when the section must
 * not render. Authorization lives in the claims service (OWNER /
 * ADMIN / STAFF); a denial here — or a member that vanished between
 * the detail load and this read — hides the section rather than
 * failing the whole page or disclosing anything.
 */
async function loadClaimHistory(
  userId: string,
  memberId: string,
): Promise<PaymentClaimView[] | null> {
  try {
    return await listClaimsForMember(userId, memberId);
  } catch (error) {
    if (
      error instanceof PaymentClaimAuthorizationError ||
      error instanceof PaymentClaimNotFoundError
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Member details (protected).
 *
 * Sections: Member, Membership, Financial, Payment claims, Attendance.
 * Payment claims (C3-S3) is a read-only history of the payments this
 * member has reported, shown only to roles that may verify claims;
 * decisions are made in the claim review queue, never here. Attendance
 * (Slice 1) shows the member's current open session or a staff check-in
 * control, plus recent attendance history; times are rendered in
 * Asia/Kolkata, the gym's local day. Check-in authorization,
 * one-open-session enforcement, and the expired-membership confirmation
 * all live server-side in the attendance service — this page only gates
 * the controls on the caller's role (TRAINER: view-only).
 */
export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, membership: orgMembership } = await requireOrganizationContext();
  const { id } = await params;
  const detail = await getMemberDetail(user.id, id);
  if (!detail) {
    notFound();
  }

  const membership = detail.membership;
  const attendancePermissions = getAttendancePermissions(orgMembership.role);
  const [openSession, attendanceHistory] = await Promise.all([
    getOpenSession(user.id, detail.id),
    listMemberAttendance(user.id, detail.id),
  ]);
  const history = attendanceHistory ?? [];
  const claimHistory = canVerifyPaymentClaim(orgMembership.role)
    ? await loadClaimHistory(user.id, detail.id)
    : null;

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

        {claimHistory !== null && (
          <section className={styles.section} aria-label="Payment claims">
            <h2>Payment claims</h2>
            <p>
              Payments this member has reported. A claim counts as paid
              only after the gym verifies it — pending claims are not
              included in the paid total above. To verify a claim, use
              the{" "}
              <Link href="/app/org/payment-claims">payment claims queue</Link>.
            </p>
            {claimHistory.length === 0 ? (
              <p className={styles.empty}>
                No payment claims from this member yet.
              </p>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Amount claimed</th>
                      <th scope="col">Method</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Submitted</th>
                      <th scope="col">Status</th>
                      <th scope="col">Confirmed amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {claimHistory.map((claim) => (
                      <tr key={claim.id}>
                        <td>{formatInr(claim.claimedAmountPaise)}</td>
                        <td>{PAYMENT_METHOD_LABELS[claim.paymentMethod]}</td>
                        <td>
                          {claim.reference ?? (
                            <span className={styles.empty}>—</span>
                          )}
                        </td>
                        <td>{formatKolkataDateTime(claim.submittedAt)}</td>
                        <td>
                          <span className={claimBadgeClass(claim.status)}>
                            {CLAIM_STATUS_LABELS[claim.status]}
                          </span>
                        </td>
                        <td>
                          {claim.status === "CONFIRMED" &&
                          claim.confirmedAmountPaise !== null
                            ? formatInr(claim.confirmedAmountPaise)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <section className={styles.section} aria-label="Attendance">
          <h2>Attendance</h2>
          {openSession ? (
            <div className={styles.detailActions}>
              <p className={styles.value}>
                In gym since {formatKolkataTime(new Date(openSession.checkInAt))}{" "}
                ({formatKolkataDate(new Date(openSession.checkInAt))})
              </p>
              {attendancePermissions.canManage && (
                <CheckOutForm
                  sessionId={openSession.id}
                  memberId={detail.id}
                  from="member"
                />
              )}
            </div>
          ) : (
            attendancePermissions.canCheckIn && (
              <CheckInForm memberId={detail.id} from="member" />
            )
          )}

          <h3>Recent visits</h3>
          {history.length === 0 ? (
            <p className={styles.empty}>No attendance records yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Check-in</th>
                    <th scope="col">Check-out</th>
                    <th scope="col">Source</th>
                    <th scope="col">Recorded by</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((session) => (
                    <tr key={session.id}>
                      <td>{formatKolkataDate(new Date(session.checkInAt))}</td>
                      <td>{formatKolkataTime(new Date(session.checkInAt))}</td>
                      <td>
                        {session.checkOutAt
                          ? formatKolkataTime(new Date(session.checkOutAt))
                          : "Still in gym"}
                      </td>
                      <td>{ATTENDANCE_SOURCE_LABELS[session.source]}</td>
                      <td>{session.checkedInByRole ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
