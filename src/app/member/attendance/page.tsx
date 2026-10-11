import Link from "next/link";

import {
  attendanceSourceLabel,
  formatKolkataDate,
  formatKolkataDateTime,
  formatKolkataTime,
} from "@/lib/attendance";
import {
  getOwnOpenSession,
  listOwnAttendance,
} from "@/lib/server/attendance";
import { requireMemberContext } from "@/lib/server/member-session";

/**
 * Member attendance history (Attendance Slice 2, S4).
 *
 * Everything on this page is scoped by the verified member session: the
 * context resolver is the only input, and both attendance queries take
 * that context — no value from the request can steer them to another
 * gym or another person's records. All times render in Asia/Kolkata.
 */
export default async function MemberAttendancePage() {
  const context = await requireMemberContext();

  if (!context.member) {
    return (
      <main>
        <h1>Your attendance</h1>
        <p>
          We couldn&apos;t load your member record. Please see the front
          desk.
        </p>
      </main>
    );
  }

  const [openSession, history] = await Promise.all([
    getOwnOpenSession(context),
    listOwnAttendance(context, 30),
  ]);
  const sessions = history ?? [];

  return (
    <main>
      <h1>Your attendance</h1>
      <p>{context.organization.name}</p>
      {openSession && (
        <p>
          You&apos;re in the gym — checked in at{" "}
          {formatKolkataDateTime(openSession.checkInAt)}.
        </p>
      )}
      {sessions.length === 0 ? (
        <p>No attendance records yet.</p>
      ) : (
        <ul>
          {sessions.map((session) => (
            <li key={session.id}>
              {formatKolkataDate(session.checkInAt)} — Checked in{" "}
              {formatKolkataTime(session.checkInAt)} ·{" "}
              {session.checkOutAt
                ? `Checked out ${formatKolkataTime(session.checkOutAt)}`
                : "Still in the gym"}{" "}
              · {attendanceSourceLabel(session.source)}
            </li>
          ))}
        </ul>
      )}
      <p>
        <Link href="/member">Back to your membership</Link>
      </p>
    </main>
  );
}
