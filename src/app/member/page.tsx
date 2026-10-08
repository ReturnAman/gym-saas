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
      </main>
    );
  }

  const { organization, member, membership, session } = context;

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
    </main>
  );
}
