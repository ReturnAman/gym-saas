import Link from "next/link";

import { formatKolkataDateTime } from "@/lib/attendance";
import { getOwnOpenSession } from "@/lib/server/attendance";
import { getMemberContext } from "@/lib/server/member-session";

/**
 * Member authentication proof page (ADR 021, milestone scope).
 *
 * This is NOT the member home — it exists to prove that a gym-scoped
 * member session resolves the correct User, Member, Organization, and
 * MEMBER role entirely from the server-side session. Nothing here accepts
 * a client-supplied organization ID: the cookie → session row →
 * membership chain is the only input. Without a valid session it renders
 * a generic signed-out state and no data.
 */
export default async function MemberPage() {
  const context = await getMemberContext();

  if (!context || !context.member) {
    return (
      <main>
        <h1>Member sign-in</h1>
        <p>No active member session.</p>
        <p>Scan your gym&apos;s QR code to sign in and check in.</p>
        <p>
          <Link href="/member/scan">Scan gym QR</Link>
        </p>
      </main>
    );
  }

  const { organization, member, membership, session } = context;
  const openSession = await getOwnOpenSession(context);

  return (
    <main>
      <h1>{organization.name}</h1>
      <p>Signed in as a member of this gym.</p>
      <dl>
        <dt>Member</dt>
        <dd>{member.name}</dd>
        <dt>Phone</dt>
        <dd>{member.phoneNumber}</dd>
        <dt>Role</dt>
        <dd>{membership.role}</dd>
        <dt>Session expires</dt>
        <dd>{session.expiresAt.toISOString()}</dd>
      </dl>
      <h2>Attendance</h2>
      {openSession && (
        <p>
          You&apos;re in the gym — checked in at{" "}
          {formatKolkataDateTime(openSession.checkInAt)}.
        </p>
      )}
      <p>
        <Link href="/member/attendance">View your attendance</Link>
      </p>
      <p>
        <Link href="/member/scan">Scan gym QR</Link>
      </p>
    </main>
  );
}
