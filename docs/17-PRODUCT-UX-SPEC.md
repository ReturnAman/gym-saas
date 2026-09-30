# 17 — PRODUCT UX SPECIFICATION

**Project:** `gym-saas`
**Product Brand:** TBD
**Document Version:** 0.1
**Status:** Product definition
**Scope:** V1 product experience (owner console + member PWA)

---

# 1. Purpose

This document defines the user experience of the gym-saas product: who uses
it, what each experience contains, how the product areas are organized, and
how the interface should behave.

It translates the product requirements (`01-PRODUCT-REQUIREMENTS.md`) and user
flows (`02-USER-FLOWS.md`) into concrete UX direction for screen design and
implementation.

This document does not define the database schema, API contracts,
infrastructure, or visual brand. Those belong in their respective documents.
It describes product behavior and interface expectations only.

Related: `00-PROJECT-CHARTER.md`, `01-PRODUCT-REQUIREMENTS.md`,
`02-USER-FLOWS.md`, `08-PWA.md`.

---

# 2. Product UX Principles

The product experience must be:

1. **Simple on the surface.** A gym owner or member should accomplish daily
   tasks without training. Depth lives behind progressive disclosure, not on
   the first screen.
2. **Operationally useful for gym owners.** Every owner screen should help
   run the gym today — not showcase data for its own sake.
3. **Low-friction for members.** Check-in, payment status, and membership
   status must be reachable in seconds from a phone.
4. **Mobile-first for members.** The member experience is designed for the
   phone first; desktop is secondary.
5. **Responsive for owners.** The owner console is desktop-oriented for
   operational efficiency but must remain fully usable on mobile.
6. **Action-oriented.** Screens surface what can be done next, not just what
   exists. Lists lead to actions; statuses lead to resolutions.
7. **Clear about status.** Membership state, payment state, and verification
   state are always explicit. Nothing important is implied by absence.
8. **Progressively disclosed.** Advanced options (exports, corrections,
   settings) are one level deeper than daily tasks.
9. **Secure underneath.** The interface never leaks cross-tenant data and
   never implies that hiding a button is a permission. Backend authorization
   is authoritative; the UI reflects permissions but does not enforce them.
10. **Honest about money.** Payment state always distinguishes what is
    claimed from what is confirmed. The interface must never present a
    payment claim as a confirmed payment.

---

# 3. User Types

## 3.1 OWNER

The gym owner/operator. Primary paying customer. Full operational control of
their organization: gym profile and settings, members, memberships, payments
and payment verification, attendance, staff and roles, announcements,
dashboard, exports, and subscription/trial state.

## 3.2 ADMIN

Organization-level operational role. May perform many owner-like daily tasks
(member, attendance, payment, announcement operations). Does not automatically
receive every owner capability (e.g. subscription/billing-level actions).
Exact permission boundaries are defined in `05-AUTHORIZATION.md`.

## 3.3 STAFF

Gym operational user with assigned permissions. Typical scope: member
operations, attendance operations, payment verification, membership
operations. Must not receive unrestricted owner access by default.

## 3.4 TRAINER

Gym operational user with intentionally narrower permissions than staff.
Must not automatically receive access to financial or administrative
operations. Exact scope is defined in `05-AUTHORIZATION.md`.

## 3.5 MEMBER

Gym member. Uses the member-facing experience: onboarding via gym QR + OTP,
home, check-in, attendance history, membership status, payment status and
payment claims, announcements, occupancy. Members never see other members'
data and never see owner operational tooling.

## 3.6 SaaS administrator

Internal role (not a gym user). Manually verifies V1 SaaS subscription
payments (UPI/bank transfer) and enables/extends organization subscriptions.
The SaaS admin experience is out of scope for the V1 product UX; it is noted
here because the manual subscription flow touches the owner experience
(trial/subscription status visibility).

---

# 4. Product Areas

## 4.1 Owner/staff V1 areas

- **Dashboard** — operational command center: gym health today, attention
  items, quick actions.
- **Members** — member list, search, filtering, add/edit, member details with
  operational context; member migration (manual add, file import, WhatsApp
  submission) with mandatory human review before creation.
- **Memberships** — plans, member memberships, status, expiry, renewals.
- **Payments** — charges, payment claims, verification queue, confirmed
  payments, partial payments, outstanding balances.
- **Attendance** — check-in records, history, active sessions, occupancy,
  QR attendance configuration.
- **Staff** — staff list, roles, permissions, access changes.
- **Announcements** — create, publish, manage gym announcements.
- **Gym settings** — gym profile, contact info, payment/UPI configuration,
  QR configuration, operational settings, notification preferences.
- **Needs Attention** — prioritized list of items requiring action (expiring
  memberships, outstanding payments, pending verifications, inactive
  members).
- **CSV exports** — member, attendance, payment, and membership exports
  where applicable.

## 4.2 Member V1 areas

- **Home** — greeting, membership status, check-in action, attendance
  snapshot, payment status, announcements, occupancy.
- **Check-in** — gym QR-based attendance recording.
- **Attendance** — history, totals, attendance percentage.
- **Membership** — plan, status, start/end dates, days remaining, renewal
  information.
- **Payment status** — amount due, confirmed paid, outstanding, claim state.
- **Announcements** — gym announcements.
- **Occupancy** — live gym occupancy, when implemented.

## 4.3 Later areas (not V1)

Streaks, badges, consistency leaderboard, challenges, goals, progress
photos, partner offers, gym discovery, marketplace/affiliate functionality.
See section 21.

## 4.4 Explicit non-areas

The product is NOT initially a generic fitness app, social network, gym
marketplace, class-booking platform, payroll system, or workout-program
platform. The UX must not include class scheduling/booking, trainer
payroll/session tracking, or generic payment-provider flows in V1.

---

# 5. Information Architecture

The product has two distinct experiences behind one authentication system:

```text
Authenticated user
    │
    ├── Owner console (OWNER / ADMIN / STAFF / TRAINER)
    │     Operational, desktop-oriented, responsive.
    │     Organized by operational area (section 4.1).
    │
    └── Member experience (MEMBER)
          Personal, mobile-first PWA.
          Organized by the member's own status and actions (section 4.2).
```

IA rules:

1. **Organization context is explicit.** Every owner-console screen operates
   within one gym. If a user belongs to multiple gyms, gym selection happens
   once at entry; the active gym is always visible and switchable.
2. **Member and membership are separate concepts.** A member is a person
   (identity, contact, onboarding state). A membership is that person's
   time-bound product relationship with the gym (plan, dates, status,
   charges). The IA, navigation, and screens must keep them distinct —
   never merge them into one record or one screen section.
3. **Payment and membership renewal are separate domains.** Payment screens
   track money (charges, claims, confirmed payments, balances). Membership
   screens track the membership lifecycle (status, expiry, renewal).
   Renewal is an explicit action, never a side effect of payment.
4. **Needs Attention is derived, not stored.** It is a computed view over
   memberships, payments, and attendance — not a separate data area and not
   a notification inbox.
5. **Settings are separated from operations.** Gym settings, payment
   configuration, and QR configuration live in their own area, away from
   daily operational screens.

---

# 6. Navigation Model

## 6.1 Owner console

- Primary navigation is a persistent sidebar (desktop) collapsing to a
  compact navigation (mobile).
- Top-level items map 1:1 to the V1 areas in section 4.1: Dashboard,
  Members, Memberships, Payments, Attendance, Staff, Announcements, Needs
  Attention, Exports (or within relevant areas), Settings.
- Navigation items reflect the user's permissions: items the user cannot
  access are hidden (UX convenience only — the backend remains the
  authorization boundary).
- The active gym name and the user's role are always visible in the
  navigation chrome.

## 6.2 Member experience

- Primary navigation is a bottom tab bar (mobile-first PWA): Home,
  Check-in, Attendance, Membership, More (payments, announcements, profile).
  Exact tab labels are subject to screen design.
- Check-in is the most prominent action — reachable in one tap from Home
  and from its own tab.
- The active gym identity is visible; members belonging to multiple gyms
  select the gym at entry.

## 6.3 Cross-cutting navigation rules

- Every destructive or money-affecting action requires an explicit
  confirmation step.
- Deep links must land on the correct organization context or fail with a
  clear "not available" state — never silently show another gym's data.
- Back navigation must preserve list context (search, filters, scroll)
  where practical.

---

# 7. V1 Screen Inventory

## 7.1 Owner console

| # | Screen | Purpose |
|---|--------|---------|
| O-1 | Sign-in / onboarding | Owner phone OTP, gym creation, trial start |
| O-2 | Dashboard | Today's operational overview (section 10) |
| O-3 | Needs Attention | Prioritized actionable items |
| O-4 | Member list (`/app/org/members`) | Search, filter, browse members (section 11) |
| O-5 | Add member (`/app/org/members/new`) | Manual member creation with membership summary (section 11) |
| O-5a | Import members (`/app/org/members/import`) | Import inbox / migration job: one conceptual pipeline for all sources (CSV, Excel, photo, PDF, WhatsApp) — extraction → validation → mandatory human review → confirmation → creation. Each import job shows its source (e.g. Source: WhatsApp) and status (section 11) |
| O-5b | Import review (`/app/org/members/import/review`) | Review extracted records, fix problems, confirm import (section 11) |
| O-5c | Send on WhatsApp (handoff action) | First-class migration option: opens WhatsApp to our official business destination with a pre-filled, gym-identified message; the owner sends register photos, Excel/CSV, or PDFs. The submission enters the import inbox as a new job (Source: WhatsApp) — sending material never creates members by itself (section 11) |
| O-6 | Member details (`/app/org/members/[id]`) | Profile + membership + payments + attendance context (section 12) |
| O-7 | Edit member | Update member information |
| O-8 | Membership plans | List and manage plans |
| O-9 | Membership details | Status, dates, charges, renewal action |
| O-10 | Payment overview | Charges, outstanding totals, claim queue entry |
| O-11 | Payment verification queue | Review and confirm payment claims |
| O-12 | Payment details | Claim history, confirmed payments, corrections |
| O-13 | Attendance overview | Today's records, active sessions, occupancy |
| O-14 | Attendance history | Searchable/filterable records |
| O-15 | Staff list | Staff members and roles |
| O-16 | Staff details / access | Role assignment, access changes |
| O-17 | Announcements | List, create, manage |
| O-18 | Gym settings | Profile, contact, payment/UPI config, QR config, operational settings |
| O-19 | Subscription / trial | Trial status, manual payment instructions |
| O-20 | CSV exports | Export members, attendance, payments, memberships |

## 7.2 Member experience

| # | Screen | Purpose |
|---|--------|---------|
| M-1 | Gym identification | Scan gym QR → gym identified |
| M-2 | Phone entry + OTP | Member authentication |
| M-3 | Home | Status overview + check-in action |
| M-4 | Check-in | QR-based attendance recording + confirmation |
| M-5 | Attendance history | Records, totals, percentage |
| M-6 | Membership | Plan, status, dates, renewal info |
| M-7 | Payments | Amount due, paid, outstanding, claim state, "I have paid" |
| M-8 | Announcements | Gym announcements |
| M-9 | Occupancy | Live gym occupancy |
| M-10 | Profile | Member profile, gym selection (multi-gym), sign-out |

Screens not listed here are not V1. Engagement screens (streaks, badges,
leaderboards, challenges, goals, photos) belong to Later (section 21).

---

# 8. Owner Experience

The owner console is an operational command center. Design for a gym owner
checking the gym between sessions — often on a phone, sometimes on a
desktop.

Experience qualities:

- **Glanceable.** The dashboard answers the three questions (section 10)
  within seconds.
- **Action-led.** Every status has a next action attached: an expiring
  membership links to renewal; a pending claim links to verification.
- **Forgiving.** Destructive actions (deactivate member, remove staff
  access) confirm explicitly and explain consequences.
- **Auditable.** Money and access changes show who did what and when.
- **Fast for repetition.** Adding members, recording attendance corrections,
  and verifying payments are repetitive daily tasks — minimize taps per
  repetition.

The owner experience must never expose another gym's data, and must never
present a frontend permission check as the security boundary.

---

# 9. Member Experience

The member experience is a mobile-first PWA for daily gym life.

Experience qualities:

- **One-thumb.** Primary actions (check-in, view status) are reachable
  with one hand on a phone.
- **Reassuring.** Membership and payment status are stated plainly:
  what is active, what is due, what is pending — no ambiguity.
- **Fast.** Check-in must complete in seconds, including on poor
  connectivity; the interface must handle offline/degraded states
  gracefully (section 14).
- **Private.** A member sees only their own data and their gym's public
  announcements/occupancy.
- **Installable.** Follows the PWA direction in `08-PWA.md`: installable,
  app-like navigation, QR-friendly.

The member experience must never show owner operational tooling, other
members' data, or financial details beyond the member's own payment state.

---

# 10. Dashboard UX

The owner dashboard answers three questions:

1. **How is my gym doing today?**
2. **What needs my attention?**
3. **What can I do quickly?**

## 10.1 "How is my gym doing today?"

A compact status strip with the day's key figures:

- Total members / active members
- Today's check-ins
- Current occupancy (derived from active sessions)
- Outstanding payment total (from confirmed records)

Figures are computed from domain state. No manually maintained counters.

## 10.2 "What needs my attention?"

The Needs Attention list: the highest-value actionable items first.

- Payment claims awaiting verification
- Memberships expiring soon / expired
- Outstanding payments
- Inactive members (once defined)

Each item shows what it is, why it matters, and a direct link to the
resolving action. The exact prioritization rules are a product decision
(see section 22).

## 10.3 "What can I do quickly?"

Quick actions for the most frequent tasks:

- Add member
- Record/verify a payment
- Create announcement
- Export today's attendance

Quick actions are shortcuts only; they lead to the same validated flows as
navigating directly.

## 10.4 Dashboard rules

- The dashboard never shows data from another gym.
- Figures that cannot be computed (no data yet) show empty states, not
  zeros presented as facts (section 14).
- The dashboard is read-optimized; bulk operations live in their own areas.

---

# 11. Members UX

## 11.1 Migration-first assumption

The product is designed for already-operating local gyms. A gym signing up
may already have 100–500+ members recorded in Excel/CSV files, handwritten
registers, printed records, photographs/scans of register pages, or another
gym-management system. A zero-member gym is an edge case, not the primary
onboarding assumption.

Therefore the Members area is designed around:

> Existing gym → already has members → quickly migrate existing members →
> continue managing them in the SaaS.

Reducing migration effort is a core product goal. Manual one-by-one entry
is the fallback, not the primary path. Import (section 11.4) is a
first-class V1 capability, not an afterthought.

## 11.2 Member list (`/app/org/members`)

Header:

- Title: Members
- Primary CTA: Add Members — exposes three options, never nested under
  another menu (section 11.4): **Add manually**, **Import existing
  members**, **Send on WhatsApp**. On mobile the three appear as simple
  stacked actions; the WhatsApp option carries one supporting line:
  *"Already have member records? Send your register photos or member file
  on WhatsApp and we'll help you import them."*

List functionality:

- Search by name or phone number (server-side).
- Simple filters: membership status (active / expiring / expired), payment
  status (unpaid / partially paid / paid), activity (recent / inactive).
  Filter options must reflect real domain states — no placeholder filters.
- Member rows show: name, phone, membership status badge, payment status
  badge. Rows link to member details.
- Pagination or equivalent scalable list behavior. No complex enterprise
  data grid.
- The list must remain usable at 10, 100, and 500+ members: server-side
  search/filter/pagination; no client-side degradation.

States (see section 14): loading, populated, empty, no search results,
error.

Desktop: a simple table/list is acceptable. Mobile: readable cards/rows
(section 15). A gym owner doing migration review on a phone must be able
to work through the list comfortably.

## 11.3 Add member — manual (`/app/org/members/new`)

Fields:

1. **Name** — required.
2. **Phone number** — required, exactly 10 digits. V1 has no country-code
   field.
   - Valid: `9876543210`
   - Invalid: `987654321` (9 digits), `98765432101` (11 digits),
     `+919876543210` (country code), `98765abc10` (non-digits).
   - The interface must not silently convert arbitrary input into a valid
     number. Reject invalid input with an explicit message ("Phone number
     must be exactly 10 digits").
3. **Fee** — required. Total agreed fee for the selected membership
   period (₹).
4. **Membership plan** — required. Choices: Monthly, 3 Months, 6 Months,
   12 Months.
5. **Start date** — required. Must NOT default to today. The owner/staff
   explicitly provides the actual membership start date. This matters
   because migrating gyms enter members whose memberships started weeks or
   months earlier.

Derived (system-calculated, shown live):

- **Expiry date** = start date + plan duration. Example: start 01/08/2026
  + 6 Months → expiry 01/02/2027.

Membership summary (updates as inputs change):

```text
Plan:        6 Months
Fee:         ₹6,000
Start:       01 Aug 2026
Expires:     01 Feb 2027
Paid:        ₹0
Outstanding: ₹6,000
```

Payment rules for a newly created member:

- Paid = ₹0, Outstanding = Fee.
- Outstanding is derived from confirmed payments: fee − sum(confirmed
  payments). A payment claim is NOT a confirmed payment.
- Payment and membership renewal are separate domains. Creating a member
  never triggers renewal logic.
- No payment gateway; no Razorpay.

Other rules:

- Creating a member record does not create an application user account;
  the member onboards later via QR + OTP.
- Duplicate phone numbers within a gym are surfaced clearly at entry time
  (see 11.7) — never silently allowed, never silently merged.

## 11.4 Import members — import inbox / migration job (`/app/org/members/import`)

Import is a first-class V1 capability designed to remove the owner's/staff's
data-entry burden. There is a **single conceptual import pipeline** regardless
of how the material arrives — no separate member-creation system per source.

Conceptual flow:

```text
Source (CSV / Excel / photo / PDF / WhatsApp)
  ↓
Import inbox — one migration job per submission
  ↓
Extraction / normalization
  ↓
Validation
  ↓
Human review (mandatory)
  ↓
Confirmation
  ↓
Create members
```

Entry: Members → Add Members → one of three options:

1. **Add manually** — single member form (section 11.3).
2. **Import existing members** — upload files directly.
3. **Send on WhatsApp** — send the material to us over WhatsApp (section
   11.4.1).

Every import job carries a **source** (e.g. Source: CSV, Source: Photo
upload, Source: WhatsApp) and a **status** (received → processing → ready
for review → completed). "Submission received" and "members imported" are
different states and must never be conflated (see section 14).

### Upload sources

(UX-level; technical implementation is a later task and the interface must
not claim a format is supported before it is):

1. CSV — structured data.
2. Excel (.xlsx) — structured data.
3. Photograph/image of a register page — extraction-assisted.
4. Scanned document — extraction-assisted.
5. PDF — where appropriate.

The UX makes three things clear:

- CSV/Excel provide structured data directly.
- Images/scans are processed for extraction (OCR/AI-assisted) — the
  interface must not promise perfect extraction and must not present
  extracted information as guaranteed correct.
- Human review is required before any member is created.

Hard rule: **AI/OCR extraction must never directly create members without
human review.** The owner/staff sees extracted records first (screen O-5b).

### 11.4.1 Send on WhatsApp — WhatsApp-based migration

WhatsApp is a first-class migration option for owners/staff who find it
easier than file uploads — especially the phone-first owner with diary
pages, photos, Excel files, or PDFs in hand. It is exposed directly as
**"Send on WhatsApp"** alongside Add manually and Import existing members.

**Handoff UX**

- Selecting "Send on WhatsApp" opens WhatsApp to our **official business
  WhatsApp destination** (TBD — section 22).
- A message is **pre-filled where possible**, identifying the
  gym/account context as much as practical (exact content TBD — section
  22). The owner must not have to type an explanation of who is sending
  what.
- The owner then sends whatever they have: photos of register pages,
  Excel/CSV files (where WhatsApp supports the file type), PDFs/documents,
  multiple files/photos at once.
- The UX never requires the owner to understand OCR, parsing, APIs, or
  imports. The owner's mental model is simply: *"I have my member
  records. I'll send them on WhatsApp."*

**Operational model (conceptual — not automated in this spec)**

```text
Owner → opens WhatsApp → sends member material to us
  → we receive the material
  → associate it with the correct gym / import request
  → process / extract
  → review
  → owner/staff confirms
  → members are created
```

The automated WhatsApp ingestion implementation is explicitly NOT part of
this specification; only the owner-facing states are defined here.

**Owner experience after sending**

- *"Your member list has been received."* — submission acknowledged; no
  members exist yet.
- *"Processing your member list…"* — extraction running; still no
  members created.
- *"127 members found — 119 ready, 8 need attention"* → **"Review
  members"** — ready for mandatory human review (screen O-5b).
- Members are created only after the owner/staff confirms the review.

Sending a file or photo on WhatsApp must never imply automatic member
creation. The human-review requirement is unchanged.

**WhatsApp–gym association (product requirement)**

An incoming WhatsApp submission must be securely associated with the
correct gym / import request. The system must not accidentally attach one
gym's WhatsApp files to another gym. The exact technical association
mechanism (e.g. an import reference or account-specific identification in
the pre-filled message) is an implementation decision — TBD (section 22).

**Wording and promises**

Supporting copy (wording aligned with existing product language at screen
design):

> "Already have member records? Send your register photos or member file
> on WhatsApp and we'll help you import them."

The UX must NOT promise: perfect OCR, instant processing, automatic
import, zero review, or support for every file type.

## 11.5 Import review (`/app/org/members/import/review`)

After extraction, the review screen summarizes:

```text
127 records found
119 ready to import
8 need attention
```

The review screen always shows the import job's source (e.g. `Source:
WhatsApp`) and its status, so the owner knows where the material came
from and that these are extracted records awaiting confirmation — not
members already created.

Record table:

```text
Name         | Phone      | Fee    | Plan     | Start Date | Expiry     | Status
Rahul Sharma | 9876543210 | ₹6,000 | 6 Months | 01/08/2026 | 01/02/2027 | Ready
Amit Kumar   | 9812345678 | ₹3,000 | 3 Months | 15/09/2026 | 15/12/2026 | Ready
Priya        | —          | ₹4,500 | 6 Months | 01/07/2026 | 01/01/2027 | Phone missing
```

Review rules:

- Records needing attention are listed with the specific problem named
  (phone missing, fee unclear, date ambiguous, possible duplicate…).
- The user can edit problematic records inline before importing.
- The import is never all-or-nothing: a few problematic records must not
  force rejection of the entire batch. The user fixes the 8, then imports
  all 127.
- Primary action reflects the real count: "Import 127 members" (wording
  aligned with existing product language at screen design).
- Low-confidence extractions for important fields (fee, dates, phone) are
  marked for review — never silently invented.

## 11.6 Data quality and duplicates

Assume imported data is messy. The UX must surface these problems clearly:

- Missing phone number, missing fee, missing start date.
- Unclear text / ambiguous handwriting in images.
- Inconsistent date formats.
- Expired memberships (imported as-is with their real dates; status
  derives from dates — the interface must not "fix" dates silently).
- Partial/incomplete records.
- Duplicate names, duplicate phone numbers.

Rules:

- Never silently guess critical financial or membership information.
- If extraction confidence is low for an important field, mark the record
  for review rather than inventing a value.
- The system must not silently create obvious duplicate members merely
  because they appeared in an import. Possible duplicates are flagged in
  review with the conflicting existing record shown side by side; the user
  decides (keep both / merge / skip). The exact duplicate-detection rules
  are a product/implementation decision — TBD (section 22). The UX
  requirement is the review step itself, not the algorithm.

## 11.7 Edit member

- Edit is a focused form over the member's own fields (identity/contact),
  not their membership or payment state — those are separate domains with
  their own actions.
- Historical information is preserved; edits do not rewrite history.
- Phone number changes follow the recovery/update workflow (backend
  verified); the UX explains that changing the number affects the member's
  login identity.
- No delete-member workflow in V1. A person remains in the system after
  their membership expires; deactivation (if needed) is a separate,
  explicitly designed lifecycle state — TBD (section 22).
- No unnecessary fields. The form stays as small as the add-member form.

---

# 12. Member Details UX (`/app/org/members/[id]`)

Member details is the operational hub for one person. It presents the
member's context across domains without merging the domains.

**Identity**

- Name
- Phone

**Membership**

- Status (active / expiring / expired — derived from dates)
- Plan
- Start date
- Expiry date

**Financial**

- Total fee
- Paid (confirmed payments only)
- Outstanding (derived: fee − confirmed payments)

**Attendance**

- Section consistent with the attendance UX (recent check-ins, attendance
  percentage, active session state).

**Actions**

- Edit member.
- Membership/payment actions only where already defined (renewal as an
  explicit separate action; payment verification via the Payments area).
  No new actions are invented here.

Rules:

- Member (person) and membership (time-bound product) are visually
  separated — different sections, different actions.
- A person remains in the system after their membership expires. Expiry
  changes status; it never deletes the member. Deletion is not the normal
  lifecycle operation.
- Payment state always distinguishes claimed vs. confirmed (section 17).
- Attendance actions available to staff (e.g. corrections) are permission-
  gated and auditable.
- No cross-tenant leakage: the screen renders only the active gym's data.

---

# 13. Forms and Data-Entry Principles

1. **Ask only what operations need.** Every field must justify itself
   against a real workflow. Prefer fewer fields with sensible defaults.
2. **Validate early, explain clearly.** Inline validation for format issues;
   server validation is authoritative. Error messages name the field and
   the fix ("Phone number must be 10 digits").
3. **Money fields are exact.** Amounts use explicit currency (₹), reject
   ambiguity, and never silently round. The entered amount is the claimed
   amount; the verified amount is recorded separately at confirmation.
4. **Dates are unambiguous.** Membership dates show explicit day/month/year;
   relative labels ("in 3 days") supplement, never replace, exact dates.
5. **Destructive and money-affecting actions confirm.** Deactivation,
   access removal, payment confirmation, and corrections require explicit
   confirmation stating the consequence.
6. **Idempotency is visible.** Double-submits must not create duplicates;
   the interface disables the submit control while a request is in flight
   and the backend guards against duplicate business records.
7. **Draft loss is avoided** for long forms (settings, announcements):
   warn before navigating away with unsaved changes where practical.

## 13.1 Member form field rules (add / edit / import review)

These rules apply everywhere a member record is created or corrected —
manual add, import review, and edit:

- **Name:** required. No format guessing.
- **Phone:** required, exactly 10 digits, no country-code field in V1.
  Invalid input is rejected with an explicit message; never silently
  converted into a valid number.
- **Fee:** required, explicit ₹ amount. Never rounded silently, never
  guessed from extraction.
- **Plan:** required; one of Monthly, 3 Months, 6 Months, 12 Months in V1
  (whether plans become owner-configurable beyond these is TBD —
  section 22).
- **Start date:** required; never defaults to today. The user provides the
  actual start date (critical for migrating existing members).
- **Derived expiry:** start date + plan duration, shown live in the
  membership summary alongside plan, fee, start, paid (₹0 for new
  members), and outstanding (= fee).
- **Financial honesty:** paid/outstanding are derived from confirmed
  payments only. Import review must not present extracted fee text as a
  confirmed payment.

---

# 14. Empty / Loading / Error / Success States

Every screen and component must define these states; they are not
afterthoughts.

- **Empty.** Explain what is empty and what to do next. "No members yet —
  add your first member" with a direct action. Never show a blank table.
- **Loading.** Skeletons or spinners for async content; the layout must not
  jump when data arrives. Actions in flight disable their controls.
- **Error.** State what happened in plain language, what the user can do
  ("Try again", "Check your connection"), and never expose stack traces,
  database internals, or secrets. Authentication/authorization failures use
  generic messages that do not reveal which part failed.
- **Success.** Confirm the outcome and show the resulting state ("Payment
  of ₹1,200 confirmed. Outstanding: ₹800."). Success messages for
  multi-step flows state the next step ("Membership renewal is separate —
  renew now?").
- **Offline/degraded (member PWA).** Check-in and status screens must
  degrade gracefully on poor connectivity: queued actions are shown as
  pending, never as completed.

## 14.1 Manual add member — states

- **Default:** empty form with the membership summary updating as inputs
  change.
- **Validation error:** inline per-field messages naming the field and the
  fix; submit blocked until valid.
- **Submitting:** controls disabled, duplicate submits prevented.
- **Success:** confirmation showing the created member and membership
  summary; clear next actions (add another member, view member details).
- **Server error:** plain-language message, form data preserved, retry
  offered.

## 14.2 Members list — states

- **Loading:** skeleton rows; layout does not jump when data arrives.
- **Populated:** rows/cards with search, filters, pagination.
- **Empty:** explains the state and offers both paths — "Add your first
  member" and "Import existing members" (migration-first: import is
  equally prominent, not hidden).
- **No search results:** states the query found nothing; offers to clear
  search/filters.
- **Error:** plain-language message with retry; never a blank table.

## 14.3 Import — states

- **Upload:** source selection (CSV / Excel / image / scan / PDF),
  file picker, format guidance. Must not claim a format is supported
  before it is.
- **WhatsApp submission received:** "Your member list has been received."
  Acknowledges the material reached us. This is explicitly not member
  creation — no members exist at this point. The submission appears in
  the import inbox as a new job (Source: WhatsApp).
- **WhatsApp processing:** "Processing your member list…" The owner
  understands extraction is running; they wait. Still no members created.
- **Processing:** progress indication; the user understands extraction is
  running. Large register sets (e.g. 5 pages / ~150 members) must not
  time out silently.
- **Extraction complete:** summary counts (records found, ready,
  need attention) leading into review.
- **Review:** record table with per-record status (section 11.5).
- **Records needing attention:** problems named explicitly; inline
  correction.
- **Correction:** edited records re-validate immediately; status flips to
  ready when fixed.
- **Import confirmation:** final count ("Import 127 members"), explicit
  confirm step before creation.
- **Import success:** confirms how many members were created; links to
  the member list.
- **Partial/problem result:** if some records fail at creation, reports
  exactly which ones and why; successful ones are not rolled back
  silently — the result is explicit.
- **Processing failure:** plain-language error (e.g. unreadable file),
  no partial member creation, retry offered.

No backend behavior is invented here; these states describe the interface
contract that implementation must satisfy.

---

# 15. Responsive Behavior

- **Member experience:** designed mobile-first. All member screens and
  flows must be fully usable on a small phone screen. Desktop rendering is
  acceptable but not the design target.
- **Owner console:** desktop-oriented for operational efficiency (tables,
  queues, side-by-side context) but fully usable on mobile. Tables collapse
  to cards or prioritized columns; the sidebar becomes compact navigation;
  primary actions remain reachable.
- **Touch targets** meet platform minimums on all interactive elements.
- **No hover-dependent functionality.** Anything reachable by hover on
  desktop must be reachable by tap on mobile.

## 15.1 Member management responsive rules

- **Member list:** desktop shows a simple table (name, phone, membership
  status, payment status); mobile shows readable cards/rows with the same
  information and the same actions. No complex enterprise data grid on
  either.
- **Import review:** the review table must be usable on a phone — the most
  common migration scenario is an owner photographing registers with their
  phone and reviewing on the same device. Records needing attention are
  reachable and editable without horizontal scrolling where practical.
- **Add Members entry:** on mobile the three options — Add Member
  Manually, Import Existing Members, Send on WhatsApp — are simple
  stacked actions, not nested menus. The WhatsApp option has one
  supporting line explaining its purpose; no technical terminology.
- **Add member:** the form and live membership summary fit a phone screen;
  the summary stays visible (or one tap away) while filling the form.

---

# 16. Permission UX

- The interface reflects the user's permissions: actions the user cannot
  perform are hidden or disabled with an explanation where helpful.
- Hidden/disabled UI is a **convenience, not a security boundary.** Every
  protected operation is authorized on the backend regardless of what the
  UI shows.
- Permission denials are explicit but generic: "You don't have permission
  to do this." Never reveal which permission is missing or what a higher
  role could do.
- Role changes take effect on next authorization check; the UX must not
  imply instant client-side role switching grants access.
- Staff management screens make the consequences of role assignment clear
  (what the role can access), without turning the UI into the permission
  definition — the authorization model in `05-AUTHORIZATION.md` is
  authoritative.

---

# 17. Payment UX

Payment UX is governed by one rule: **a payment claim is not a confirmed
payment.** The interface must make the distinction unmissable.

## 17.1 Member payment screen

- Shows: amount due, confirmed amount paid, outstanding balance, and any
  pending claim with its state ("Awaiting gym verification").
- A pending claim is visually distinct from a confirmed payment (badge,
  color, label) — never presented as paid.
- "I have paid" creates a claim: the member selects it after paying the
  gym directly (UPI/QR shown on screen). The confirmation state says
  "Claim submitted — awaiting verification," not "Payment complete."

## 17.2 Verification queue (owner/staff)

- Pending claims are listed with member, claimed amount, date, and any
  reference the member provided.
- Verification records the **actual amount received**, method, optional
  reference/transaction ID, and verifier identity. The verified amount may
  differ from the claimed amount — the interface must allow and display
  this.
- Confirming is an explicit, auditable action with confirmation.
- Duplicate confirmation is prevented (idempotent backend; disabled
  controls in flight).

## 17.3 Partial payments

- Outstanding balance is always shown as derived: charge minus confirmed
  payments. Example presentation: "Charge ₹2,000 · Paid ₹1,200 ·
  Outstanding ₹800."
- Multiple confirmed payments against one charge are listed individually;
  the balance is computed, never hand-edited.

## 17.4 Renewal separation

- Payment confirmation screens never imply renewal. After confirming a
  payment, the interface offers renewal as an **explicit separate action**
  ("Confirm payment & renew" vs. "Confirm payment only" — exact workflow
  per section 22).
- Membership status changes only through the renewal action, never as a
  side effect of payment.

## 17.5 Corrections

- Confirmed payments are history. Corrections use explicit reversal or
  adjustment records, shown as such — never silent edits.
- The interface labels corrections clearly ("Adjustment: −₹200,
  reason recorded").

---

# 18. Notification / WhatsApp UX

- **In-app first.** Announcements and operational updates are visible
  in-app for both owner and member experiences.
- **WhatsApp as a channel, not the product.** The long-term direction is a
  centralized SaaS-controlled sender with personalized, tenant-scoped
  messages (expiry reminders, payment due, announcements).
- **User controls.** Gyms can choose which reminder types are enabled
  (exact control surface: TBD — product decision required). Members are
  not spammed: reminder frequency and quiet hours follow product policy
  (TBD — product decision required).
- **Transparency.** The member experience shows which notifications are
  enabled where relevant; the owner experience shows delivery status of
  sent notifications.
- **WhatsApp is never authentication.** OTP and auth flows never depend on
  WhatsApp; the UX never presents a WhatsApp message as proof of identity.

---

# 19. Accessibility / Usability Baseline

- Semantic HTML and logical heading order on every screen.
- All interactive elements keyboard-reachable with visible focus states.
- Form fields have associated labels; errors are announced to assistive
  technology.
- Color is never the only signal: status badges pair color with text
  labels (e.g. "PAID", "PENDING VERIFICATION").
- Contrast meets WCAG AA for text.
- Touch targets meet platform minimums (section 15).
- Motion is restrained; no animation that blocks task completion.
- Language is plain and operational — no jargon, no gym-slang that
  obscures meaning.

---

# 20. Figma Handoff Principles

When product screens move to Figma for approved screen design:

1. **One frame per screen in the V1 inventory** (section 7), named by its
   inventory ID (O-1…O-20 plus O-5a/O-5b/O-5c, M-1…M-10).
2. **States are frames, not annotations.** Empty, loading, error, and
   success states (section 14) get their own frames.
3. **Flows are linked.** Key journeys (section 9 of this doc; flows in
   `02-USER-FLOWS.md`) are prototyped as connected frame sequences.
4. **Components map to implementation.** Shared elements (status badges,
   member row, payment summary, confirmation dialogs) are Figma components
   with documented variants — not one-off drawings.
5. **Permissions are annotated.** Frames note which roles see which
   actions, referencing `05-AUTHORIZATION.md` — the backend remains
   authoritative.
6. **Copy is final in Figma.** Button labels, status text, and error
   messages are written as they will ship; no lorem ipsum in handoff
   frames.
7. **No new product decisions in Figma.** If design surfaces an undecided
   behavior, it is marked TBD and returned to this document — not silently
   decided in the design tool.

## 20.1 Member Management V1 — visual design specification

Implementation-ready screen specification for the ten finalized Member
Management V1 screens (sections 11–12). No design/Figma workflow exists in
the repository yet, so this subsection is the source of truth for Figma
frames and for implementation. Every product decision here comes from the
finalized UX in sections 11–16; where behavior is genuinely unspecified it
is marked TBD and returned to section 22.

### 20.1.0 Shared visual language (all screens)

- **Page hierarchy.** Owner console chrome (persistent navigation) →
  page header (title left, primary action right) → content region.
  One dominant primary action per screen; everything else is quieter.
- **Typography hierarchy (relative).** Page title > section heading >
  body > secondary metadata > caption. One typeface family; hierarchy is
  carried by size and weight, never by color alone.
- **Spacing principles.** One base-unit rhythm throughout: section gaps
  larger than group gaps, group gaps larger than field gaps; consistent
  horizontal page gutters; data rows dense but breathable. Exact values
  are set in Figma, not here.
- **Functional color roles, not a palette.** This spec does not define
  brand colors. Figma frames must name functional roles — primary action
  surface, destructive, success, warning, info, text-primary/secondary,
  borders, surfaces — so implementation tokens can be bound later.
  Status badges always pair a tint with a text label (section 19); color
  is never the only signal.
- **Forms.** Single-column forms; labels above fields; inline validation
  that names the field and the fix (section 13). Summary panels sit beside
  the form on desktop and above the submit action (one tap away) on mobile.
- **Data presentation.** Desktop uses tables for member and review data;
  mobile converts to cards or expandable rows — never squeeze a
  seven-column table onto a phone (section 15.1).
- **Errors.** Inline field errors for format issues; server errors as a
  plain-language banner with a retry action; no error codes shown to the
  user. The form's entered data is preserved.
- **Success.** Confirmation states name what happened and give the next
  action (counts where relevant: "127 members imported — View members").
- **Motion.** Restrained; nothing blocks task completion (section 19).
- **Accessibility.** Section 19 baseline on every screen: semantic
  headings, keyboard-reachable controls with visible focus, associated
  labels, errors announced to assistive technology, platform-minimum
  touch targets.
- **Product feel.** Trustworthy, simple, operational, fast, professional —
  suitable for a local gym owner. No arbitrary visual complexity.

---

### 20.1.1 Members list (O-4 — `/app/org/members`)

- **Page hierarchy.** Owner nav → header (Members title left; **Add
  Members** primary CTA right) → toolbar (search, simple filters) →
  member table/cards → pagination footer.
- **Desktop layout.** Table columns, in order: Name, Phone, Membership
  status, Payment status. Statuses render as text-labeled badges
  (e.g. ACTIVE, EXPIRING, UNPAID). Rows are links to member details.
  No complex enterprise data grid.
- **Toolbar.** Search field (name or phone, server-side) plus simple
  filters as compact selects or chips: membership status
  (active / expiring / expired), payment status (unpaid / partially
  paid / paid), activity (recent / inactive). Filters reflect real domain
  states — no placeholders.
- **Pagination.** Server-side page controls with a count summary; the
  list stays usable at 10, 100, and 500+ members.
- **Primary CTA:** Add Members (opens the three-choice step, 20.1.2).
  **Secondary:** search, filters, pagination.
- **Mobile behavior.** Condensed header with a prominent, reachable Add
  Members action; search bar; filters as horizontally scrollable chips or
  a single filter sheet. Members render as stacked cards: name as title,
  phone as secondary line, membership + payment badges; tap opens member
  details.
- **States.**
  - *Populated* (default): as above.
  - *Loading:* skeleton rows/cards; search stays interactive where
    practical.
  - *Empty (zero members):* plain state, no illustration required. Since
    a zero-member gym is an edge case, the empty state leans into
    migration: brief copy plus the three Add Members options
    ("Import your existing member records, send them on WhatsApp, or
    add members manually").
  - *No results:* shows the query/filter, "no members match", with a
    clear-search secondary action.
  - *Error:* plain-language banner with retry; list region preserved.
- **Accessibility.** Table uses proper header semantics; cards are list
  items containing links; search input has a visible label.

### 20.1.2 Add Members choice (entry step)

- **Trigger.** The Add Members CTA on the member list.
- **Layout.** Centered modal on desktop; bottom sheet on mobile. Not a
  route — a choice step.
- **Content hierarchy.** Heading "Add Members" → intro line: "Add a
  member yourself or bring your existing member records into the
  system." → three equally-weighted option cards:
  1. **Add manually** — "Add one member at a time."
  2. **Import existing members** — "Upload your Excel, CSV, photos, or
     documents."
  3. **Send on WhatsApp** — supporting copy: "Already have member
     records? Send your register photos or member file on WhatsApp and
     we'll help you import them."
- **WhatsApp placement.** The WhatsApp option is a peer of the other two,
  never hidden inside Import. It must not promise automatic import.
- **Visual.** Three stacked options of equal visual weight; neutral
  affordance (no brand-dependent iconography required). Selection navigates
  to manual add (20.1.3), import entry (20.1.4), or the WhatsApp handoff
  (20.1.8).
- **Accessibility.** Dialog semantics, focus moves into the dialog on
  open, Esc closes, focus returns to the Add Members CTA.

### 20.1.3 Add member — manual (O-5 — `/app/org/members/new`)

- **Page hierarchy.** Owner nav → header ("Add member", back to list) →
  single-column form → live membership summary → actions.
- **Fields (exact product scope).**
  - **Name** — required text input.
  - **Phone number** — required, exactly 10 digits. No country-code
    field. Invalid input is rejected with an explicit inline message
    ("Phone number must be exactly 10 digits") — never silently
    converted.
  - **Fee** — required ₹ amount. Explicit currency, no silent rounding.
  - **Membership plan** — required; segmented/radio choice: Monthly,
    3 Months, 6 Months, 12 Months.
  - **Start date** — required date input, **empty by default** (must not
    default to today). Explicit day/month/year.
- **Live membership summary.** A bordered summary panel showing Plan,
  Fee, Start date, Expiry date (derived: start + plan duration), Paid
  ₹0, Outstanding = Fee. Updates as inputs change; designed so the
  owner reads the financial/membership state at a glance. On desktop it
  sits beside the form; on mobile it stays visible or one tap away while
  filling the form.
- **Primary CTA:** "Add member" (wording aligned with product language
  at screen design). **Secondary:** Cancel / back to member list.
- **States.**
  - *Default:* empty form, summary shows placeholders until inputs
    arrive.
  - *Validation:* inline errors naming field + fix; summary highlights
    what is still missing.
  - *Submitting:* primary button disabled with progress indication;
    double-submit cannot create duplicates (section 13).
  - *Success:* confirmation naming the member, with next actions
    ("View member", "Add another member").
  - *Server error:* plain-language banner with retry; entered data
    preserved.
- **Mobile behavior.** Single column; summary collapsible but one tap
  away; large touch targets on the plan selector and date input.
- **Accessibility.** All fields labeled; errors announced; focus moves to
  the first error on failed validation.

### 20.1.4 Import existing members — entry (O-5a — `/app/org/members/import`)

- **Page hierarchy.** Owner nav → header ("Import existing members",
  back) → intro → source choices → format guidance.
- **Content.** Heading "Import Existing Members" → "Bring your existing
  member records into the system." → two large upload actions:
  1. **Upload Excel / CSV** — structured files.
  2. **Upload Photos / Documents** — register photos, scans, PDFs.
  Then the reassurance line: "We'll prepare the records for you to review
  before adding them."
- **Upload step.** Source selection → file picker with format guidance.
  The interface must not claim a format is supported before it is
  (section 11.4). No OCR/parsing/AI terminology in user-facing copy —
  "preparing your records" is the vocabulary.
- **Primary CTA:** the chosen upload action. **Secondary:** back to
  members; the WhatsApp route is offered as a peer alternative
  ("Prefer WhatsApp? Send your records on WhatsApp instead").
- **Mobile behavior.** Large touch targets; photo option can invoke the
  camera roll (UX-level). The whole entry fits a phone screen without
  scrolling past the two actions.
- **Flow.** Source → upload → processing (20.1.5) → review (20.1.6).
  The uploaded material becomes an import job in the inbox with its
  source shown.

### 20.1.5 Import processing (import job status)

- **Purpose.** The waiting state between submission and review. Two
  distinct owner-facing states, shown in the import inbox and as a
  status screen:
  - **"Your member list has been received."** — acknowledgment. The copy
    and layout make clear this is receipt of material, explicitly not
    member creation. No member records exist yet.
  - **"Processing your member list…"** — extraction running. Simple
    progress treatment (indeterminate or stepped); large register sets
    (e.g. 5 pages / ~150 members) must not time out silently.
- **Visual.** Calm waiting state — status icon/tint plus the two
  sentences above; the import job's source (e.g. Source: WhatsApp) and
  received time are shown. Nothing on this screen suggests members were
  created.
- **Transitions.** Received → processing → review-ready ("127 members
  found — Review members"). The owner can leave and return; the job's
  status is visible in the import inbox.
- **Failure.** "We couldn't read your file." Plain-language cause where
  known, no partial member creation, retry offered.

### 20.1.6 Import review (O-5b — `/app/org/members/import/review`)

- **Page hierarchy.** Owner nav → header ("Review members", back to
  import inbox) → summary header → record table/cards → sticky action bar.
- **Summary header.** "127 members found" as the title; beneath it two
  counts: "119 ready to import" and "8 need attention". The job's source
  (e.g. Source: WhatsApp) and status are shown — these are extracted
  records awaiting confirmation, not created members.
- **Desktop layout.** Table columns: Name | Phone | Fee | Plan |
  Start Date | Expiry | Status. Status renders as a text-labeled badge
  (Ready / Phone missing / Unclear fee / Missing start date /
  Possible duplicate).
- **Mobile behavior.** Records become cards or expandable rows: name as
  title, phone/fee/plan as secondary lines, status badge prominent;
  records needing attention are reachable and editable without horizontal
  scrolling (section 15.1).
- **Correction.** Rows/records edit inline; problems are named explicitly
  (never a generic "error"). Corrected records re-validate immediately
  and flip to Ready. Low-confidence extractions for fee, dates, or phone
  are forced into "needs attention" — never invented.
- **Never all-or-nothing.** Fixing the 8 must not block importing the
  119; the user corrects problems, then confirms the whole batch.
- **Primary CTA.** Sticky action bar: "Import 127 Members" — the label
  always reflects the actual record count being confirmed.
  **Secondary:** back to inbox (keeps progress), cancel import.
- **Post-confirmation states.** Success: "127 members imported" with a
  link to the member list. Partial/problem result: names exactly which
  records failed and why; successful ones are not rolled back silently.
- **Accessibility.** Table headers proper; on mobile each card exposes
  its status as text; inline editors are labeled and announced.

### 20.1.7 Duplicate review (within O-5b)

- **Pattern.** A non-destructive warning attached to the flagged record:
  "Possible duplicate" with the incoming record and the existing member
  shown side by side — name and phone for each.
- **Example state.**
  - Incoming: Rahul Sharma, 9876543210
  - Possible existing member: Rahul Sharma, 9876543210
- **Actions.** The user decides: **Keep both** / **Merge** / **Skip**.
  No silent merges, no silent duplicate creation. The matching algorithm
  itself is TBD (section 22) — the design specifies only the review
  interaction.
- **Visual.** Warning treatment (tint + "Possible duplicate" text label,
  never color-only). Desktop: side-by-side comparison; mobile: stacked
  comparison, actions as full-width buttons.
- **Accessibility.** The warning is announced; actions are real buttons
  with clear consequence labels.

### 20.1.8 WhatsApp handoff (O-5c)

- **Trigger.** "Send on WhatsApp" from the Add Members choice (20.1.2).
- **Explainer step (modal/sheet).** Before leaving the app, plain
  numbered steps set the expectation:
  1. WhatsApp opens.
  2. You send your member records — register photos, Excel/CSV, PDFs.
  3. We receive your submission.
  4. We prepare it for your review.
  5. You review the records.
  6. Members are created only after you confirm.
- **Primary CTA:** "Send on WhatsApp" — opens WhatsApp to our official
  business destination with a pre-filled, gym-identified message
  (sections 11.4.1, 22).
- **Hard rule.** Nothing here implies direct automatic member creation.
  The technical receiving mechanism is TBD — the design covers only the
  owner-facing states (20.1.5): submission received → processing →
  review in the import inbox as Source: WhatsApp.
- **Mobile behavior.** This flow is mobile-first: the handoff is one tap,
  and the explainer is short enough to read on a phone.
- **Accessibility.** The external-handoff is announced ("Opens
  WhatsApp"); focus returns sanely if the user comes back.

### 20.1.9 Member details (O-6 — `/app/org/members/[id]`)

- **Page hierarchy.** Owner nav → header (member name, back to list,
  Edit action) → four section cards → attendance section.
- **Sections (in order).**
  - **Member:** Name, Phone.
  - **Membership:** Status (badge: active / expiring / expired — derived
    from dates), Plan, Start date, Expiry date.
  - **Financial:** Total fee, Paid, Outstanding (derived from confirmed
    payments only; claims are not confirmations).
  - **Attendance:** recent check-ins, attendance percentage, active
    session state — consistent with the attendance UX.
- **Member ≠ membership.** An expired membership never removes the member
  record; the sections stay visually separate so the domains are not
  conflated.
- **Actions.** **Edit** (primary or secondary by context). Only
  already-defined actions appear — no invented shortcuts. Attendance
  actions (e.g. corrections) are permission-gated and noted as such.
- **Desktop layout.** Section cards in a two-column arrangement for
  related sections (Member + Membership, Financial + Attendance) or a
  single column where density hurts readability.
- **Mobile behavior.** Sections stack; each section is a card with a
  clear heading; the Edit action stays reachable.
- **Accessibility.** Sections use real headings; status badges are text
  labels; financial figures use explicit ₹ and unambiguous dates.

### 20.1.10 Edit member (O-7)

- **Scope.** A focused form over the member's own fields
  (identity/contact) — not their membership or payment state, which are
  separate domains with their own actions.
- **Rules.** Same field rules as manual add (section 13.1): phone stays
  exactly 10 digits, no silent conversion. Historical information is
  preserved; edits do not rewrite history. Changing the phone number
  follows the recovery/update workflow, and the UX explains it affects
  the member's login identity.
- **No delete workflow in V1.** Deactivation is a separate, explicitly
  designed lifecycle state — TBD (section 22).
- **States.** Default (prefilled), validation (inline errors), submitting
  (disabled primary), success (confirmation + back to details), server
  error (banner + retry, data preserved).
- **Primary CTA:** "Save changes". **Secondary:** Cancel (warns on
  unsaved changes where practical, per section 13).
- **Mobile behavior.** Single column; identical to the manual-add form
  patterns so owners learn one form language.

### 20.1.11 Figma frame checklist

Per section 20 principles, frames for Member Management V1:

- O-4 member list: populated, loading, empty, no-results, error
  (desktop + mobile).
- Add Members choice: modal (desktop) / bottom sheet (mobile).
- O-5 manual add: default, validation, submitting, success, server
  error (desktop + mobile).
- O-5a import entry: source choice + upload; processing states
  (received / processing / failure).
- O-5b import review: summary + table (desktop), cards (mobile);
  inline correction; duplicate-review warning; confirm bar; success
  and partial-result states.
- O-5c WhatsApp handoff: explainer + "Send on WhatsApp" action.
- O-6 member details (desktop + mobile).
- O-7 edit member (desktop + mobile).
- Shared components with variants: status badges (membership,
  payment, record status), member row/card, membership summary panel,
  confirmation dialogs, error banner.

# 21. V1 vs V1.5 vs Later

## 21.1 V1 — operational core

Owner console (§4.1, screens O-1…O-20 plus O-5a/O-5b/O-5c) and member experience (§4.2,
screens M-1…M-10) as specified in this document. Member management V1
includes manual add, import (CSV/Excel/image/scan/PDF at UX level), human
review of extracted records, member list/details/edit — designed for the
migration-first assumption (section 11.1). The product is complete
for V1 when a real gym can run daily operations on it (see success
criteria in `01-PRODUCT-REQUIREMENTS.md` §46).

## 21.2 V1.5 — operational depth (candidate)

- Inactive member detection (UX: surfaced in Needs Attention with clear
  definition of "inactive")
- Membership expiry reminders (UX: member + owner surfaces, frequency
  controls)
- Occupancy history and peak-hour views
- Richer operational analytics and reports
- Improved reminder controls

V1.5 items require their own UX decisions before design; they are not
automatically in scope after V1.

## 21.3 Later — engagement and ecosystem

- Attendance streaks, badges, consistency leaderboard, daily challenges,
  goals, achievements
- Private progress photos (local-first; explicit opt-in for any cloud
  backup)
- Partner offers, supplement partnerships, gym/member discounts
- Gym discovery, affiliate/commission features
- Advanced campaigns and communication tools

Later features must not complicate V1 IA or navigation. When they arrive,
they extend the member experience (new tabs/sections) without
restructuring the operational core.

---

# 22. Open UX Decisions

The following behaviors are not yet decided. They are marked here and must
not be silently resolved during design or implementation.

1. **Needs Attention prioritization.** Exact ranking rules for attention
   items (expiry vs. outstanding payment vs. pending verification).
   TBD — product decision required.
2. **Renewal workflow.** Whether payment confirmation offers "Confirm
   payment & renew" as a combined explicit action or keeps renewal fully
   separate; exact post-payment screen flow. TBD — product decision
   required.
3. **Trial member limit.** Exact initial member limit for the 7-day trial
   (docs suggest 10–20 as configurable). TBD — product decision required.
4. **Post-trial-expiration access.** Exact behavior when a trial expires
   (restricted vs. read-only; which actions remain). Data is preserved in
   all cases. TBD — product decision required.
5. **Notification controls.** Which reminder types gyms can toggle, default
   on/off state, frequency caps, quiet hours. TBD — product decision
   required.
6. **Occupancy presentation.** How "approximate" live occupancy is
   communicated (exact count vs. quiet/moderate/busy bands). TBD — product
   decision required.
7. **"Inactive member" definition.** Time threshold and conditions before a
   member is flagged inactive. TBD — product decision required.
8. **Membership plan model UX.** Exact plan fields and plan lifecycle
   (create/edit/archive) presentation. TBD — product decision required.
9. **Leaderboard privacy.** Opt-in/opt-out model and visibility rules for
   any future consistency leaderboard. TBD — product decision required.
10. **Multi-gym member switching UX.** Exact entry-point and switching
    interaction for members belonging to multiple gyms. TBD — product
    decision required.
11. **Export formats and scheduling.** Whether exports are download-only or
    also scheduled/emailed; exact format options. TBD — product decision
    required.
12. **Announcement targeting.** Whether announcements support targeting
    (all members vs. segments) in V1 or are broadcast-only. TBD — product
    decision required.
13. **Duplicate-detection rules.** What counts as a duplicate during
    manual add and import (phone match, name+phone match, fuzzy name
    match), and the exact review/merge/skip behavior. The UX requires the
    review step; the matching rules are TBD — product decision required.
14. **Import source support.** Which input formats are actually
    implemented at each stage (CSV/Excel parsing, image/scan/PDF
    extraction), file size and page-count limits, and the extraction
    provider. The UX must not claim a format is supported before it is.
    TBD — product decision required.
15. **Extraction confidence policy.** Confidence thresholds below which a
    field is forced into "needs attention," and how low-confidence values
    are presented. TBD — product decision required.
16. **Plan configurability.** Whether V1 plans stay fixed (Monthly, 3
    Months, 6 Months, 12 Months) in the add-member flow or become
    owner-configurable. TBD — product decision required.
17. **Member deactivation lifecycle.** Deletion is not the V1 lifecycle
    operation; the exact states for inactive/deactivated members and their
    UX are TBD — product decision required.
18. **WhatsApp receiving approach.** The official business WhatsApp
    destination, how the pre-filled handoff message is composed, and how an
    incoming submission becomes an import job (Source: WhatsApp).
    TBD — product/implementation decision required.
19. **WhatsApp–gym association mechanism.** How an incoming WhatsApp
    submission is securely tied to the correct gym / import request (e.g.
    an import reference or account-specific identification), so one gym's
    files can never attach to another gym. TBD — product/implementation
    decision required.
20. **WhatsApp media support.** Which file/media types and limits the
    WhatsApp route supports, and how unsupported material is communicated
    to the owner. TBD — product/implementation decision required.
21. **Migration operations during early rollout.** Whether processing is
    manual or automated at launch, how submissions are queued and handled,
    the expected turnaround communicated to the owner, and who reviews
    problem records. TBD — product/operations decision required.

---

# 23. Document Status

**Status:** Product UX specification; Member Management V1 UX finalized
(migration-first: manual add, import, WhatsApp-based migration, extraction
review, member list/details/edit). Implementation-ready visual design
specification for the ten Member Management V1 screens in §20.1.

This document evolves with approved product decisions. New UX decisions
must update the relevant section and remove the corresponding TBD entry in
section 22 — not accumulate as untracked assumptions.

Related documents: `00-PROJECT-CHARTER.md`, `01-PRODUCT-REQUIREMENTS.md`,
`02-USER-FLOWS.md`, `05-AUTHORIZATION.md`, `06-SECURITY.md`,
`08-PWA.md`, `20-CURRENT-STATE.md`.
