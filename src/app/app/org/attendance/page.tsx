import Link from "next/link";

import {
  ATTENDANCE_SOURCE_LABELS,
  formatKolkataDate,
  formatKolkataTime,
} from "@/lib/attendance";
import { requireOrganizationContext } from "@/lib/server/authorization";
import {
  getAttendancePermissions,
  listTodayAttendance,
} from "@/lib/server/attendance";

import { CheckOutAllForm, CheckOutForm } from "./check-out-form";
import styles from "./attendance.module.css";

/**
 * Gym attendance for today (protected).
 *
 * "Today" is the Asia/Kolkata calendar day — the gym's local day — with
 * the bounds converted to UTC inside the service. Authorization is
 * enforced again inside listTodayAttendance; this page only gates the
 * management controls on the caller's role: OWNER/ADMIN/STAFF manage,
 * TRAINER views only.
 */
export default async function AttendancePage() {
  const { user, membership } = await requireOrganizationContext();
  const permissions = getAttendancePermissions(membership.role);
  const sessions = await listTodayAttendance(user.id);
  const now = new Date();
  const openCount = sessions.filter((s) => s.checkOutAt === null).length;

  return (
    <main>
      <div className={styles.pageHeader}>
        <h1>Attendance — today</h1>
      </div>
      <p className={styles.hint}>
        {formatKolkataDate(now)} · {sessions.length}{" "}
        {sessions.length === 1 ? "check-in" : "check-ins"} today
      </p>

      {sessions.length === 0 ? (
        <p className={styles.empty}>No check-ins yet today.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">Check-in</th>
                <th scope="col">Check-out</th>
                <th scope="col">Status</th>
                <th scope="col">Source</th>
                <th scope="col">Recorded by</th>
                {permissions.canManage && <th scope="col">Action</th>}
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <Link
                      href={`/app/org/members/${session.memberId}`}
                      className={styles.rowLink}
                    >
                      {session.memberName}
                    </Link>
                  </td>
                  <td>{formatKolkataTime(new Date(session.checkInAt))}</td>
                  <td>
                    {session.checkOutAt
                      ? formatKolkataTime(new Date(session.checkOutAt))
                      : "—"}
                  </td>
                  <td>
                    {session.checkOutAt ? (
                      <span
                        className={`${styles.badge} ${styles.badgeCheckedOut}`}
                      >
                        Checked out
                      </span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeInGym}`}>
                        In gym
                      </span>
                    )}
                  </td>
                  <td>{ATTENDANCE_SOURCE_LABELS[session.source]}</td>
                  <td>{session.checkedInByRole ?? "—"}</td>
                  {permissions.canManage && (
                    <td>
                      {session.checkOutAt === null && (
                        <CheckOutForm
                          sessionId={session.id}
                          memberId={session.memberId}
                          from="gym"
                        />
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {permissions.canManage && openCount > 0 && (
        <div className={styles.endOfDay}>
          <p className={styles.hint}>
            Forgotten check-outs? Close every open session for the day.
          </p>
          <CheckOutAllForm />
        </div>
      )}
    </main>
  );
}
