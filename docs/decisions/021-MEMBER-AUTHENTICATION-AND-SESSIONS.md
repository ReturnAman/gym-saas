# ADR 021: Member Authentication and Sessions

- Status: Accepted
- Date: 2026-10-09
- Decision Type: Authentication / Security / Identity
- Related:
  - `02-USER-FLOWS.md` (§9 Member Onboarding and Authentication)
  - `05-AUTHORIZATION.md`
  - `06-SECURITY.md`
  - `decisions/001-AUTHENTICATION.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md`
  - `decisions/015-AUTHENTICATION-AND-AUTHORIZATION-IMPLEMENTATION.md`
  - `decisions/017-AUDIT-LOGGING-STRATEGY.md`
  - `decisions/019-API-SECURITY-AND-RATE-LIMITING.md`

---

## 1. Context

Gym members are not gym staff. The member onboarding flow (02-USER-FLOWS
§9) authenticates a member by proving control of the phone number the gym
has on file: the gym's QR code identifies the gym only, the phone number
is discovery only, and an SMS OTP proves control of the phone.

Clerk is the approved authentication provider for owners and staff
(ADR 001, ADR 015), who authenticate with their own accounts. Members
have no Clerk accounts and must not be given staff credentials. Forcing
member authentication through Clerk would couple a high-volume,
low-privilege population to the staff identity system and to a phone/OTP
configuration the product does not control there.

The member OTP foundation already exists: 2Factor AUTOGEN/VERIFY behind a
provider abstraction, verified challenges in `member_otp_challenges`, and
database-backed rate limiting (ADR 019). What was missing is everything
after verification: identity, linking, and a session.

## 2. Decision

Member authentication is a **separate, application-managed path** from
Clerk authentication. The two paths intentionally share exactly one
thing: the application `User` model and the `OrganizationMembership`
authorization boundary.

1. **Staff/owner authentication remains Clerk.** Clerk sessions,
   `getCurrentUser()`, and the `/app` surface are unchanged.

2. **Member authentication uses phone OTP** (2Factor, per the OTP
   foundation) **plus application-managed, database-backed sessions**.
   No Clerk involvement of any kind: the member path never calls
   `auth()`/`getCurrentUser()`, never reads Clerk session state, and
   never creates or modifies a Clerk session.

3. **Unified identity, separate credentials.** `User` carries two
   nullable, unique identifiers: `clerkUserId` (Clerk identities) and
   `phoneNumber` (verified phone identities). A verified phone number
   represents exactly one User globally. A member user typically has
   `clerkUserId = NULL`. No separate MemberIdentity model exists.

4. **Two-hats rule.** One User *may* hold both identities, and one person
   may be OWNER/STAFF (via Clerk) and MEMBER (via OTP). However, member
   linking **always resolves/creates the phone-backed User by verified
   phone** and never attempts to find, reuse, or attach to a Clerk-only
   User. A phone OTP therefore can only ever establish a **MEMBER-scoped
   session** — it can never grant OWNER/ADMIN/STAFF privileges, regardless
   of what other identities the same person holds.

5. **Identity merging is explicitly deferred.** If a person currently
   has both a Clerk User and a phone-backed User, those are two User
   rows until a future, separate, explicitly authenticated merge/link
   flow is designed and approved. No silent merging ever occurs.

6. **Linking consumes a verified challenge, exactly once.**
   `member_otp_challenges.consumedAt` marks consumption (the status enum
   is unchanged: VERIFIED means "OTP proven"; consumedAt means "used for
   linking"). Linking runs in one database transaction: atomically claim
   the VERIFIED challenge (only within 5 minutes of `verifiedAt`),
   resolve/create the phone-backed User, resolve Member candidates for
   (organization, phone), apply the linking rules, ensure an
   OrganizationMembership (created as MEMBER; an existing role is never
   modified), create the member session, and write the `MEMBER_LINKED`
   audit event. The session cookie is set only after commit.

7. **Linking rules.** OTP proves control of the phone, not which
   duplicate Member record belongs to the person. Exactly one unlinked
   candidate links; a record already linked to the same User is
   idempotent success; a record linked to another User is never
   overwritten (generic failure); multiple unlinked candidates fail
   generically for staff resolution; a User already linked to a
   different Member in the same gym fails generically. A partial unique
   index on `members(organization_id, user_id) WHERE user_id IS NOT
   NULL` backstops the one-link-per-gym invariant in the database.

8. **Member sessions are gym-scoped and opaque-token based.** A
   `member_sessions` row binds User + Organization. The raw token is 32
   cryptographically random bytes; only its SHA-256 hash is stored. The
   raw token exists solely in an HttpOnly cookie (`gym_member_session`;
   Secure, SameSite=Lax, Path=/, Max-Age 30 days). Absolute lifetime is
   30 days, idle lifetime is 7 days, both enforced server-side at resolve
   time. Logout revokes the session row server-side. Every member request
   resolves the organization from the server-side session — never from a
   client-supplied organization ID — and authorization still derives from
   the live OrganizationMembership row. There is no gym switcher: a
   multi-gym member establishes a separate session per gym by proving
   membership in each.

9. **No new infrastructure.** Sessions and rate limiting are
   database-backed (ADR 019). No Redis, no new service.

## 3. Consequences

- Member and staff authentication evolve independently; a Clerk outage
  or configuration change does not affect member sign-in, and vice versa.
- Staff surfaces remain exactly as secure as before: they resolve
  identity only through Clerk, and a member session cookie is meaningless
  there. Member surfaces never see Clerk state.
- Session revocation, expiry, and audit are fully under application
  control for the member path.
- The two-hats duplication (two User rows for one person) is an accepted,
  visible consequence until the deferred merge flow exists; analytics or
  staff views keyed by User will see the identities separately.
- ADR 001/015 are amended in scope by this record: Clerk is the
  authentication provider **for owners/staff**; member authentication is
  application-managed as specified here.

## 4. Rejected Alternatives

- **Clerk phone OTP for members** — couples members to the staff
  identity provider and its dashboard configuration; the OTP provider
  decision (2Factor) and the separate-path requirement supersede it.
- **Stateless JWT member sessions** — cannot be revoked server-side
  without a denylist (reintroducing state) and do not fit the
  database-backed controls of ADR 019.
- **A separate MemberIdentity model** — unnecessary: nullable unique
  identifiers on User express both identity kinds with no concrete
  schema constraint against it, and a single identity table keeps
  OrganizationMembership and audit references uniform.
- **Attaching phone identities to Clerk Users during linking** —
  rejected by the two-hats rule: it would require reading Clerk state in
  the member path and blur the privilege boundary. Deferred to an
  explicitly authenticated merge flow.
