import Link from "next/link";

import { requireEntitledOrganizationContext } from "@/lib/server/subscriptions";
import {
  getMemberPermissions,
  listMembers,
} from "@/lib/server/members";
import {
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  formatInr,
  type MembershipStatus,
  type PaymentStatus,
} from "@/lib/members";

import { AddMembersChoice } from "./add-members-choice";
import styles from "./members.module.css";

interface MembersSearchParams {
  q?: string;
  status?: string;
  payment?: string;
  page?: string;
}

const MEMBERSHIP_STATUS_VALUES: MembershipStatus[] = [
  "ACTIVE",
  "EXPIRING",
  "EXPIRED",
];
const PAYMENT_STATUS_VALUES: PaymentStatus[] = [
  "PAID",
  "PARTIALLY_PAID",
  "UNPAID",
  "OVERPAID",
];

function toQuery(params: MembersSearchParams): string {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (params.status) query.set("status", params.status);
  if (params.payment) query.set("payment", params.payment);
  if (params.page) query.set("page", params.page);
  const text = query.toString();
  return text ? `?${text}` : "";
}

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

/**
 * Members list (protected).
 *
 * The organization is resolved from the authenticated user's membership —
 * never from client input. Search and filter values arrive as URL query
 * params and are validated against known values before use.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<MembersSearchParams>;
}) {
  const { user, membership } = await requireEntitledOrganizationContext();
  const permissions = getMemberPermissions(membership.role);

  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const membershipStatus = MEMBERSHIP_STATUS_VALUES.includes(
    params.status as MembershipStatus,
  )
    ? (params.status as MembershipStatus)
    : undefined;
  const paymentStatus = PAYMENT_STATUS_VALUES.includes(
    params.payment as PaymentStatus,
  )
    ? (params.payment as PaymentStatus)
    : undefined;
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const hasFilters = q !== "" || membershipStatus !== undefined || paymentStatus !== undefined;

  const result = await listMembers(user.id, {
    search: q || undefined,
    membershipStatus,
    paymentStatus,
    page,
  });

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1>Members</h1>
        {permissions.canCreate && <AddMembersChoice />}
      </div>

      {result.total === 0 && !hasFilters ? (
        membership.role === "MEMBER" ? (
          <section className={styles.stateBox} aria-label="No linked member record">
            <h2>No member record found</h2>
            <p>
              No member record is linked to your account yet. Ask your gym to
              link your membership.
            </p>
          </section>
        ) : (
          <section className={styles.stateBox} aria-label="No members yet">
            <h2>Bring your members in</h2>
            <p>
              This gym already has members — start by adding them here. Add a
              single member manually, or bring your existing member records when
              migration options become available.
            </p>
            <div className={styles.stateActions}>
              {permissions.canCreate && (
                <Link href="/app/org/members/new" className={styles.button}>
                  Add manually
                </Link>
              )}
              <button type="button" className={styles.secondaryButton} disabled>
                Import existing members
                <span className={styles.comingSoon}>Coming soon</span>
              </button>
              <button type="button" className={styles.secondaryButton} disabled>
                Send on WhatsApp
                <span className={styles.comingSoon}>Coming soon</span>
              </button>
            </div>
          </section>
        )
      ) : (
        <>
          <form className={styles.toolbar} method="get" role="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search name or phone"
              aria-label="Search members by name or phone"
              className={styles.searchInput}
            />
            <select
              name="status"
              defaultValue={membershipStatus ?? ""}
              aria-label="Filter by membership status"
              className={styles.select}
            >
              <option value="">All statuses</option>
              {MEMBERSHIP_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {MEMBERSHIP_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <select
              name="payment"
              defaultValue={paymentStatus ?? ""}
              aria-label="Filter by payment status"
              className={styles.select}
            >
              <option value="">All payments</option>
              {PAYMENT_STATUS_VALUES.map((status) => (
                <option key={status} value={status}>
                  {PAYMENT_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
            <button type="submit" className={styles.secondaryButton}>
              Filter
            </button>
            {hasFilters && (
              <Link href="/app/org/members" className={styles.secondaryButton}>
                Clear
              </Link>
            )}
          </form>

          {result.total === 0 ? (
            <section className={styles.stateBox} aria-label="No matching members">
              <h2>No members match</h2>
              <p>
                No members match this search. Try a different name, phone
                number, or filter.
              </p>
              <div className={styles.stateActions}>
                <Link href="/app/org/members" className={styles.secondaryButton}>
                  Clear search
                </Link>
              </div>
            </section>
          ) : (
            <>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Phone</th>
                      <th scope="col">Status</th>
                      <th scope="col">Plan</th>
                      <th scope="col">Expiry</th>
                      <th scope="col">Payment</th>
                      <th scope="col">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <Link
                            href={`/app/org/members/${item.id}`}
                            className={styles.rowLink}
                          >
                            {item.name}
                          </Link>
                        </td>
                        <td>{item.phoneNumber}</td>
                        <td>
                          {item.membershipStatus ? (
                            <span className={membershipBadgeClass(item.membershipStatus)}>
                              {MEMBERSHIP_STATUS_LABELS[item.membershipStatus]}
                            </span>
                          ) : (
                            <span className={styles.empty}>—</span>
                          )}
                        </td>
                        <td>{item.planLabel ?? <span className={styles.empty}>—</span>}</td>
                        <td>
                          {item.expiryDate ? (
                            item.expiryDate.split("-").reverse().join("/")
                          ) : (
                            <span className={styles.empty}>—</span>
                          )}
                        </td>
                        <td>
                          {item.paymentStatus ? (
                            <span className={paymentBadgeClass(item.paymentStatus)}>
                              {PAYMENT_STATUS_LABELS[item.paymentStatus]}
                            </span>
                          ) : (
                            <span className={styles.empty}>—</span>
                          )}
                        </td>
                        <td>
                          {item.outstandingPaise !== null
                            ? formatInr(item.outstandingPaise)
                            : <span className={styles.empty}>—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className={styles.cards}>
                {result.items.map((item) => (
                  <li key={item.id} className={styles.card}>
                    <div className={styles.cardHeader}>
                      <p className={styles.cardName}>
                        <Link
                          href={`/app/org/members/${item.id}`}
                          className={styles.rowLink}
                        >
                          {item.name}
                        </Link>
                      </p>
                      {item.membershipStatus && (
                        <span className={membershipBadgeClass(item.membershipStatus)}>
                          {MEMBERSHIP_STATUS_LABELS[item.membershipStatus]}
                        </span>
                      )}
                    </div>
                    <p className={styles.cardMeta}>
                      <span>{item.phoneNumber}</span>
                      {item.planLabel && <span>{item.planLabel}</span>}
                      {item.expiryDate && (
                        <span>Expires {item.expiryDate.split("-").reverse().join("/")}</span>
                      )}
                    </p>
                    <p className={styles.cardMeta}>
                      {item.paymentStatus && (
                        <span className={paymentBadgeClass(item.paymentStatus)}>
                          {PAYMENT_STATUS_LABELS[item.paymentStatus]}
                        </span>
                      )}
                      {item.outstandingPaise !== null && item.outstandingPaise > 0 && (
                        <span>Outstanding {formatInr(item.outstandingPaise)}</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>

              <div className={styles.pagination}>
                <p>
                  Showing {(result.page - 1) * result.pageSize + 1}–
                  {Math.min(result.page * result.pageSize, result.total)} of{" "}
                  {result.total} members
                </p>
                <nav aria-label="Members pages">
                  {result.page > 1 ? (
                    <Link
                      className={styles.pageLink}
                      href={`/app/org/members${toQuery({ q: q || undefined, status: membershipStatus, payment: paymentStatus, page: String(result.page - 1) })}`}
                    >
                      Previous
                    </Link>
                  ) : (
                    <span className={styles.pageLink} aria-hidden="true">
                      Previous
                    </span>
                  )}
                  {result.page < result.totalPages ? (
                    <Link
                      className={styles.pageLink}
                      href={`/app/org/members${toQuery({ q: q || undefined, status: membershipStatus, payment: paymentStatus, page: String(result.page + 1) })}`}
                    >
                      Next
                    </Link>
                  ) : (
                    <span className={styles.pageLink} aria-hidden="true">
                      Next
                    </span>
                  )}
                </nav>
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
