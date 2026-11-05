# ADR 022: Member Self-Check-In (QR)

- Status: Accepted
- Date: 2026-10-10
- Revised: 2026-10-11 — in-app QR scanning added; the static QR's
  presence limitation stated explicitly; TRAINER manual check-in
  permitted (see §2 items 8–10)
- Decision Type: Attendance / Authorization / Audit
- Related:
  - `02-USER-FLOWS.md` (§9 Member Onboarding and Authentication, §12 Check-In, §15 Attendance History)
  - `04-DATABASE-DESIGN.md` (§18 AttendanceSession, §19 Occupancy)
  - `05-AUTHORIZATION.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/017-AUDIT-LOGGING-STRATEGY.md`
  - `decisions/021-MEMBER-AUTHENTICATION-AND-SESSIONS.md`

---

## 1. Context

Attendance Slice 1 gave staff a manual check-in flow: authorized staff
record a member's arrival, an expired membership requires an explicit
staff confirmation, and every manual add/check-out writes an audit
event. Members, however, had no way to record their own attendance.

ADR 021 established the member identity path: the gym's permanent QR
code identifies the gym only, phone OTP proves control of the phone,
and a gym-scoped member session carries the authenticated identity.
Self-check-in builds on that session — the QR code itself must never
become a credential.

Two product questions needed explicit decisions rather than silent
defaults: what happens when a member whose membership has expired
tries to check themselves in (there is no staff member present to make
the Slice 1 confirmation judgment), and whether a routine self
check-in should write an audit event.

## 2. Decision

1. **The QR encodes a URL, nothing more.** The gym's printed poster
   encodes only the canonical member check-in URL —
   `{APP_URL}/member/check-in?gym={organizationId}` — generated
   server-side from the validated `APP_URL` and the organization
   resolved from the signed-in staff user's server-side context. The
   code identifies the gym and authenticates nobody; possession of the
   URL grants no access.

2. **A valid member session is required.** Self-check-in resolves the
   user, organization, OrganizationMembership, and Member record
   exclusively from the gym-scoped member session (ADR 021),
   server-side. No client-supplied organization ID, member ID, or
   phone number is ever used to scope the operation. The check-in POST
   is same-origin guarded, like the other member mutations.

3. **The QR gym claim is compared before any write.** The request
   carries the scanned gym as a claim; the server compares it to the
   session's organization before invoking the check-in logic. A
   mismatch writes nothing — it means the member holds a session for a
   different gym — and the landing page offers the safe recovery:
   sign in to the QR gym, or continue to the session's gym.

4. **Expired memberships are blocked for self-check-in.** If the
   member's latest membership is EXPIRED, self-check-in is refused
   with the instruction "Please see the front desk." A member cannot
   confirm their own expired check-in. The staff manual flow's
   explicit confirmation (Slice 1) remains the only override. A member
   with no membership record is likewise blocked. Membership status is
   re-derived server-side on every submission.

5. **Normal self-check-in writes no audit event.** Per ADR 017 §45,
   attendance records themselves are the authoritative attendance
   history, and creating one does not require a separate audit entry
   for every normal member check-in. Self check-in therefore writes
   only the `AttendanceSession` row (source `QR`, recorded by the
   member's own user). Staff manual check-in/check-out audit behavior
   (`ATTENDANCE_MANUALLY_ADDED` / `ATTENDANCE_CHECKED_OUT`) is
   unchanged.

6. **Duplicate protection is shared with the staff flow.** Self
   check-in uses the same service core and the same database
   guarantee: one open session per member per gym, backstopped by the
   partial unique index. A repeated self check-in does not create a
   second record — it returns the already-checked-in state.

7. **Members can view only their own attendance.** The member history
   surface reads sessions strictly by the session context's
   organization and member (latest 30), with times displayed in
   Asia/Kolkata. There is no member-facing path to another member's or
   another gym's records.

8. **The QR is static, and scanning happens inside the app.** The
   poster never rotates and carries no time-based challenge. Members
   can scan it from inside the app (`/member/scan`) instead of relying
   on the phone's camera app opening a separate browser: the camera is
   requested only when the member chooses to scan, frames are decoded
   locally (jsQR — the native BarcodeDetector API is unavailable in
   Safari, so it cannot be the only path), and a decoded code is
   accepted only when it matches this application's origin and the
   check-in route exactly and carries a gym identifier. The scanned
   text is never navigated to directly — the app navigates to its own
   check-in URL built from the validated identifier — and scanning is
   not check-in: the member still confirms on the check-in landing,
   which resolves the session (or the sign-in flow) exactly as for any
   other arrival. Session rules are unchanged: OTP is required only
   when there is no valid member session, never per visit. The scan
   page is public (scan first, sign in after, gym preserved) and keeps
   a manual fallback for members who cannot scan.

9. **A static QR does not prove physical presence.** A printed code
   can be photographed and shared, so a successful self check-in
   proves that an authenticated member presented the gym's identifier
   — not that they were physically at the gym. This is an accepted
   limitation of a static poster. What protects the gym is not the
   poster's secrecy (there is none) but the member session and the
   backend authorization behind it: the QR confers no identity, no
   gym scope, and no attendance record by itself.

10. **Trainers may record manual check-ins.** A member without a
    phone (or unable to scan) can be checked in at the front desk by
    OWNER, ADMIN, STAFF, or TRAINER. Trainer check-in goes through
    the same staff flow — server-side organization scoping, latest-
    membership derivation, the expired-membership confirmation
    two-step, the `ATTENDANCE_MANUALLY_ADDED` audit event, and the
    one-open-session duplicate protection — and the acting trainer is
    recorded as the actor. The widening is check-in only: check-out
    and end-of-day remain OWNER/ADMIN/STAFF, and trainers gain no
    unrelated write access (payments remain OWNER/ADMIN/STAFF).

## 3. Consequences

- The QR poster is stable and safe to display publicly at the gym:
  it contains no secret and confers no privilege. If `APP_URL` ever
  changes, posters printed with the old address stop working and must
  be reprinted; the QR page states this operationally.
- Expired members are never silently allowed in by the self-service
  path, and never silently blocked without instruction — they are
  directed to staff, who can apply the Slice 1 confirmation judgment.
- Audit volume stays proportionate: staff actions are audited,
  routine member arrivals are represented by the attendance record
  itself.
- **No member self-check-out in V1.** Sessions are closed by staff
  check-out or the end-of-day action. An overnight open session
  therefore blocks the member's next self check-in (one-open-session
  rule) until staff close it; the member's own history makes the state
  visible to them.
- **Sessions remain per-gym with a single session cookie** (ADR 021):
  signing in to another gym replaces the current session cookie, and
  the member re-proves membership per gym. The check-in landing's
  mismatch state handles this explicitly.
- **Live SMS depends on the provisioned APITxT configuration**
  (ADR 021): without it, OTP delivery fails closed and self check-in
  is unreachable in production, while all server-side behavior remains
  as specified here.
- **Presence is asserted, not proven** (§2 item 9): a photographed
  poster plus a valid member session can produce a check-in from
  anywhere. Gyms accept this in exchange for a poster that never
  needs reprinting or powered hardware; the attendance record still
  attributes every check-in to an authenticated member or a recorded
  staff/trainer actor.
- **Front-desk coverage no longer needs staff roles**: trainers can
  admit a phoneless member, with the same confirmation judgment and
  audit trail as staff — but closing sessions (check-out, end-of-day)
  stays with OWNER/ADMIN/STAFF.

## 4. Rejected Alternatives

- **Letting members confirm their own expired membership** — the
  Slice 1 confirmation exists precisely because an expired check-in is
  a staff judgment; a self-confirm checkbox would silently defeat it.
- **Auditing every self check-in** — rejected by ADR 017 §45: the
  attendance row is the history. Administrative modifications remain
  the audit-worthy events.
- **Treating the QR code (or a per-gym secret in it) as proof of
  presence or identity** — rejected by the standing product rule: the
  QR identifies the gym only. Presence is asserted by the
  authenticated member under their own session, which is the record
  the gym relies on.
- **An external QR generation service** — unnecessary network
  dependency and data exposure for a value the server can render
  locally; QR codes are generated in-process.
- **Rotating or time-based QR challenges** — rejected for V1: they
  would require a powered, connected display at the door and
  re-synchronize the poster with the server clock, while the actual
  security boundary is the member session, not the code. A static
  poster's presence limitation (§2 item 9) is accepted instead.
- **Mandatory biometric hardware** — out of scope for V1 for the same
  reason: identity is established by the OTP-proven member session,
  and no attendance decision depends on door hardware.
