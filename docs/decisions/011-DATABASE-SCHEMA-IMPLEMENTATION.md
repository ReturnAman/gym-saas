# ADR 011: Database Schema Implementation Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Database / Data Modeling
- Related:
  - `04-DATABASE-DESIGN.md`
  - `05-AUTHORIZATION.md`
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `14-TECH-DECISIONS.md`
  - `decisions/002-DATABASE-ORM.md`
  - `decisions/010-DOMAIN-MODELING.md`

---

## 1. Context

The gym SaaS requires a relational database that can safely support:

- multiple organizations (gyms)
- users and authentication identities
- organization memberships and roles
- gym members
- membership plans
- active and historical memberships
- charges and payments
- payment claims
- attendance
- announcements
- notifications
- SaaS subscriptions
- entitlements
- audit records

The system is multi-tenant.

Tenant isolation and data integrity are therefore database and backend concerns, not only frontend concerns.

The schema must support the current product without prematurely implementing unnecessary complexity.

The implementation should also remain compatible with the selected PostgreSQL ORM and allow direct SQL when required for database-specific capabilities.

---

## 2. Decision

The database schema will be implemented as a PostgreSQL relational schema using:

1. explicit relational tables
2. primary keys
3. foreign keys
4. unique constraints
5. check constraints where appropriate
6. indexes based on real query patterns
7. timestamps for important lifecycle records
8. deliberate nullability
9. explicit status/state fields where the domain requires them
10. database migrations as the only normal schema-change mechanism

The schema will model important domain relationships explicitly rather than storing business state in loosely structured JSON fields.

The application will enforce authorization and tenant isolation in backend application logic, while the database will provide structural integrity through constraints and relationships.

---

## 3. Core Schema Principles

### 3.1 Every tenant-owned record must have a clear organization boundary

For records that belong to a gym organization, the schema should make the organization relationship explicit.

Examples:

- Member → Organization
- Membership → Organization
- Payment → Organization
- Attendance → Organization
- Announcement → Organization
- Notification → Organization

The backend must verify that the authenticated actor is authorized for the organization before accessing or modifying the record.

An organization ID supplied by the client must never be treated as proof of authorization.

---

### 3.2 Primary keys must not be phone numbers

Phone numbers are authentication/discovery data.

They are not identity primary keys.

The system should use stable generated identifiers for application entities.

Examples:

```text
User ID
Organization ID
Member ID
Membership ID
Payment ID
Attendance ID
Phone numbers may have appropriate uniqueness constraints depending on the entity and business rule, but they are not the primary identifier for domain entities.

3.3 Authentication identity and gym membership are separate

A User represents an application identity.

A Member represents a person's gym-specific membership record.

They must not be treated as the same concept.

A person may:

have an application account
belong to multiple organizations
be a member of one or more gyms
have different roles in different organizations

Therefore:

User
  ↓
OrganizationMembership
  ↓
Organization

and, where applicable:

User
  ↓
Member
  ↓
Organization

The exact relationship must follow the approved database design.

4. Initial Domain Tables

The initial schema is expected to contain tables representing the following concepts.

This is a conceptual schema list, not a command to create every table immediately.

Identity
users

Stores application-level user identity.

Possible fields:

id
phone
phone_verified_at
created_at
updated_at

Authentication-provider-specific identifiers may also be stored where required.

Organization
organizations

Represents a gym tenant.

Possible fields:

id
name
phone
email
address
status
created_at
updated_at

Organization settings should be modeled deliberately rather than placing unrelated configuration into a large unstructured field.

Organization Membership
organization_memberships

Connects users to organizations.

Possible fields:

id
organization_id
user_id
role
status
created_at
updated_at

This table is the primary authorization relationship between a user and organization.

Possible roles:

OWNER
ADMIN
TRAINER
STAFF
MEMBER

The exact role permissions are defined by authorization documentation, not by the database alone.

A unique constraint should prevent accidental duplicate active membership relationships where the business model requires uniqueness.

Gym Member
members

Represents a gym member/customer.

Possible fields:

id
organization_id
user_id
name
phone
status
joined_at
created_at
updated_at

The user_id relationship may initially be nullable because a gym can create a member before the member completes application onboarding.

This supports the intended flow:

Owner creates member
        ↓
Member exists in gym
        ↓
Member scans gym QR
        ↓
Phone entered
        ↓
OTP verification
        ↓
User account linked

The system must prevent an authenticated user from being linked to an unrelated organization without appropriate authorization.

5. Membership Domain

Membership and membership plan are separate concepts.

Membership Plan
membership_plans

Represents reusable plans configured by a gym.

Examples:

Monthly
Quarterly
Half-Yearly
Yearly

Possible fields:

id
organization_id
name
duration_days
price
status
created_at
updated_at

A plan is a reusable definition.

Membership
memberships

Represents a member's actual membership/subscription to a gym plan.

Possible fields:

id
organization_id
member_id
membership_plan_id
start_date
end_date
status
created_at
updated_at

Membership history must be preserved.

A member may have multiple historical memberships.

The schema must not assume that one member can have only one membership record forever.

6. Payment Domain

Payments must be modeled separately from membership.

The initial payment model consists conceptually of:

Charge
Payment
Payment Claim
Charge

A charge represents an amount the member owes.

Possible fields:

id
organization_id
member_id
membership_id
amount
description
status
due_date
created_at
updated_at

The exact charge model may evolve as the billing requirements become clearer.

Payment

A payment represents money actually confirmed as received by the gym.

Possible fields:

id
organization_id
member_id
charge_id
amount
method
reference
received_at
confirmed_at
confirmed_by
status
created_at
updated_at

Possible payment methods:

UPI
CASH
CARD
OTHER

A payment claim is not a payment.

Only an authorized gym-side actor can confirm that money was actually received.

Payment Claim

A payment claim represents the member saying:

I have paid.

Possible fields:

id
organization_id
member_id
charge_id
claimed_amount
payment_method
reference
status
claimed_at
reviewed_at
reviewed_by
created_at
updated_at

Possible states:

PENDING
APPROVED
REJECTED

The exact state model should remain explicit.

A payment claim must never automatically become a confirmed payment merely because it was submitted.

7. Payment Integrity

The schema and application logic must preserve the following invariant:

Outstanding Amount
=
Charge Amount
-
Sum of Confirmed Payments

The application must not use a manually editable balance field as the authoritative source if that would create multiple sources of truth.

If a balance/cache is later introduced for performance, it must be treated as derived state with a defined synchronization strategy.

8. Partial Payments

The schema must support partial payments.

Example:

Membership charge: ₹2,000

Payment 1: ₹1,000
Payment 2: ₹500

Confirmed total: ₹1,500
Outstanding: ₹500

The system must not assume:

one charge = one payment

Payment status must be derived from actual confirmed payment totals where practical.

Possible states include:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

Whether OVERPAID is implemented in the initial version should be determined during implementation based on the approved requirements.

9. Payment Immutability

Confirmed payment history should not be silently overwritten.

The system should avoid allowing ordinary editing of confirmed financial records in a way that destroys historical truth.

If correction functionality is required later, use explicit mechanisms such as:

reversal
adjustment
correction record

rather than rewriting history without an audit trail.

10. Attendance Domain
attendance_records

Represents a member's attendance/check-in.

Possible fields:

id
organization_id
member_id
checked_in_at
checked_out_at
source
created_at
updated_at

Possible check-in sources:

QR
OWNER
STAFF
OTHER

The exact values should be finalized during schema implementation.

Attendance must always be scoped to an organization.

The backend must verify that the member belongs to the organization associated with the attendance operation.

11. QR Attendance

The gym QR code identifies the gym/organization.

It must not authenticate a user.

The database should therefore not treat the QR value itself as a member identity credential.

The intended flow is:

QR
 ↓
Organization identification
 ↓
User authentication
 ↓
Membership authorization
 ↓
Attendance creation

Any QR secret/token used for operational purposes must be protected appropriately and must not expose unnecessary internal identifiers.

12. Announcements
announcements

Represents messages published by a gym.

Possible fields:

id
organization_id
title
body
status
published_at
created_by
created_at
updated_at

Announcements must be organization-scoped.

Members should only receive/read announcements belonging to organizations in which they have the appropriate membership/access.

13. Notifications

Notifications are separate from announcements.

An announcement is product content.

A notification is delivery/activity information.

Possible table:

notifications

Possible fields:

id
organization_id
member_id
type
channel
status
recipient
template_id
provider_message_id
created_at
sent_at
delivered_at
failed_at

The exact schema depends on the final notification implementation.

Notification records must remain tenant-scoped.

Provider-specific fields should not unnecessarily leak into the rest of the domain model.

14. SaaS Subscription

The gym's subscription to the SaaS product is separate from the gym's membership billing.

Conceptually:

Organization
    ↓
SaaS Subscription
    ↓
Plan
    ↓
Entitlements

Possible table:

saas_subscriptions

Possible fields:

id
organization_id
plan
status
starts_at
ends_at
verified_at
verified_by
created_at
updated_at

V1 does not require an online payment gateway.

The owner may pay the SaaS manually through UPI/bank transfer.

An authorized administrator verifies the payment and activates/extends the subscription.

15. Entitlements

Feature access should not be determined by scattered conditions such as:

if trial
if paid
if plan === "pro"

The system should conceptually support:

Subscription
    ↓
Plan
    ↓
Entitlements
    ↓
Feature/action authorization

The first implementation may keep this simple.

A full entitlement table system is not required unless the actual product needs it.

The important decision is that subscription state and feature access remain conceptually separate.

16. Audit Records

Security-sensitive actions should have an audit trail.

Possible table:

audit_logs

Possible fields:

id
organization_id
actor_user_id
action
entity_type
entity_id
metadata
created_at

Examples:

MEMBER_CREATED
MEMBER_UPDATED
PAYMENT_CONFIRMED
PAYMENT_CLAIM_REJECTED
MEMBERSHIP_RENEWED
ROLE_CHANGED
SUBSCRIPTION_UPDATED

Audit metadata must not contain secrets such as:

OTPs
authentication tokens
API keys
passwords
private credentials

Sensitive personal information should only be recorded when necessary.

17. Foreign Keys

Foreign keys should be used for important relational integrity.

Examples:

organization_memberships.organization_id
    → organizations.id

organization_memberships.user_id
    → users.id

members.organization_id
    → organizations.id

members.user_id
    → users.id

memberships.member_id
    → members.id

memberships.membership_plan_id
    → membership_plans.id

payments.member_id
    → members.id

Foreign-key behavior on deletion must be selected deliberately.

Do not automatically use cascading deletes everywhere.

Deleting an organization or member can have significant historical and financial consequences.

18. Deletion Strategy

The application should distinguish between:

delete
deactivate
archive

These are not automatically equivalent.

For important business records such as:

payments
attendance
membership history
audit logs

hard deletion should be avoided unless there is a clearly documented reason.

For entities such as members or plans, an inactive/archive state may be preferable to physical deletion.

19. Unique Constraints

Unique constraints should enforce real business invariants.

Examples may include:

users.phone

if the authentication model requires globally unique verified phone numbers.

For tenant-scoped entities, uniqueness may instead be:

(organization_id, value)

Examples:

(organization_id, plan_name)

if plan names must be unique within a gym.

The exact constraints must be derived from approved requirements.

Do not add uniqueness merely because a field "looks unique."

20. Indexing Strategy

Indexes should support actual query patterns.

Important query patterns include:

members by organization
members by organization + status
members by organization + phone
memberships by member
memberships by organization + end_date
payments by organization
payments by member
payments by charge
attendance by organization + date
attendance by member + date
announcements by organization + publication status
notifications by organization + status

Indexes should not be added blindly to every column.

The implementation should balance:

read performance
write performance
storage
query patterns
maintenance cost
21. Tenant-Scoped Query Pattern

Backend queries for organization-owned data should always make tenant scope explicit.

Conceptually:

SELECT *
FROM members
WHERE organization_id = :organizationId
  AND id = :memberId;

Not:

SELECT *
FROM members
WHERE id = :memberId;

The second pattern is dangerous if authorization is checked separately and later accidentally omitted.

Application service/repository patterns should make tenant scoping difficult to forget.

22. Cross-Tenant Access Protection

A resource ID alone must never be considered sufficient authorization.

Example:

organization A
    member ID = abc

organization B
    authenticated owner
    requests member ID = abc

The request must fail because the member does not belong to organization B.

The backend should verify:

authenticated user
        ↓
organization membership
        ↓
requested resource organization

before allowing the operation.

23. Concurrency

The database implementation must account for concurrent operations.

Important examples include:

Payment confirmation

Two staff members should not accidentally create conflicting financial state.

Attendance

Repeated QR scans should not unintentionally create duplicate attendance records if the product defines duplicate prevention.

Membership renewal

Two simultaneous renewal requests must not create inconsistent membership state.

Role changes

Authorization changes should not result in partial database state.

Transactions should be used where multiple writes must succeed or fail together.

24. Idempotency

Operations that may be retried should have an idempotency strategy where appropriate.

Important examples:

payment confirmation
notification processing
webhook processing
membership renewal
attendance creation

The exact implementation may use:

unique business keys
idempotency keys
provider event IDs
transaction constraints

depending on the operation.

Idempotency must be designed around the actual operation rather than added as a generic abstraction everywhere.

25. Timestamps

Important domain records should normally include timestamps such as:

created_at
updated_at

Lifecycle-specific timestamps should be added where meaningful.

Examples:

phone_verified_at
confirmed_at
claimed_at
reviewed_at
published_at
checked_in_at
starts_at
ends_at

Do not add meaningless timestamps simply for consistency.

26. Nullability

Nullability must communicate real business meaning.

For example:

member.user_id

may initially be nullable because the gym member may not yet have completed onboarding.

By contrast, a payment's:

organization_id
member_id
amount

should normally be required because a payment without these relationships would be invalid in the domain.

Avoid using nullable fields as a substitute for undefined business rules.

27. Enum Strategy

Enums or constrained string values may be used for stable state fields such as:

role
membership_status
payment_status
payment_method
notification_status
subscription_status

The choice between PostgreSQL enums and application-level constrained values should be evaluated against migration flexibility and ORM support.

The schema implementation must not introduce excessive rigidity without a clear benefit.

28. JSON Fields

JSON/JSONB should not become the default solution for relational business data.

Avoid storing important entities like:

member
membership
payment
attendance

as large JSON documents.

JSON may be appropriate for:

provider metadata
flexible audit metadata
non-critical configuration
external webhook payload snapshots where justified

The source of truth for core business data should remain relational.

29. Monetary Values

Money must not be represented using floating-point numbers.

The implementation should use an exact representation appropriate for PostgreSQL and the selected ORM.

Possible approaches include:

numeric/decimal

or integer minor units where appropriate.

The exact approach should be finalized during ORM/schema implementation.

Currency should also be explicit where the domain could eventually support multiple currencies.

For the initial Indian gym product, INR is expected, but the schema should not accidentally introduce floating-point financial calculations.

30. Date and Time

The application should store timestamps in a consistent timezone-aware representation.

Gym-local dates matter for:

attendance
membership expiry
payment due dates
notifications
daily challenges
occupancy
analytics

The schema should distinguish between:

instant in time

and:

calendar date

where necessary.

For example:

checked_in_at

represents an instant.

A membership:

start_date
end_date

may represent calendar dates.

Timezone handling must be explicit in application logic.

31. Migration Strategy

All schema changes must be represented as version-controlled migrations.

Normal workflow:

Change requirement
        ↓
Update schema definition
        ↓
Generate/create migration
        ↓
Review migration
        ↓
Apply locally
        ↓
Run tests
        ↓
Apply in deployment pipeline

Do not manually modify production schema as the normal workflow.

Migrations must be reviewed for:

destructive changes
data loss
locking
index creation cost
nullability changes
constraint compatibility
rollback implications
32. Destructive Changes

Destructive database operations require explicit review.

Examples:

DROP TABLE
DROP COLUMN
changing a required column to incompatible type
removing historical payment data
removing audit records

Before destructive changes:

identify affected data
determine whether migration is reversible
determine whether backup/recovery is available
determine application compatibility
review deployment order
obtain required human approval
33. Seed Data

Development/test seed data may be created for:

organizations
users
members
plans
memberships
payments
attendance

Seed data must never contain real customer information.

Production seed behavior must be treated separately from development fixtures.

34. Test Database

Automated tests should run against an isolated database environment.

Tests must not depend on a developer's personal production-like database.

Important integration tests should verify:

foreign keys
unique constraints
tenant isolation
payment state transitions
partial payment calculations
membership relationships
attendance relationships
authorization-sensitive queries
35. ORM Boundary

The schema implementation must remain compatible with the selected ORM.

The ORM should provide:

migrations
type-safe queries
transactions
relations
constraints
testability

The ORM must not prevent the use of PostgreSQL capabilities when those capabilities are genuinely required.

Direct SQL may be used when justified.

Direct SQL should not become an excuse to bypass normal schema rules.

36. Repository/Data Access Boundary

Application code should avoid scattering raw database queries throughout UI components or unrelated modules.

A reasonable conceptual structure is:

API / Server Action
        ↓
Authorization
        ↓
Application Service
        ↓
Repository / Data Access
        ↓
ORM
        ↓
PostgreSQL

The exact implementation may remain simpler in early development.

The important requirement is that:

authorization is explicit
business rules are not hidden inside UI code
tenant scoping is consistently applied
database access remains testable
37. Soft Delete

Soft deletion should only be introduced where there is a clear business requirement.

Possible approach:

deleted_at

However, soft deletion introduces additional complexity because every query may need to exclude deleted records.

Therefore it should not automatically be added to every table.

For financial and historical records, retaining records through immutable/history-preserving behavior is generally more important than generic soft deletion.

38. Schema Evolution

The schema will evolve as the product is validated with real gyms.

The project should prefer:

small migration

over:

large speculative schema

Do not build tables solely because they might be useful someday.

Examples of features that may remain unimplemented until validated:

advanced leaderboard scoring
partner offers
gym discovery
affiliate tracking
cloud progress-photo backup
advanced campaign analytics

The schema should support current requirements without unnecessarily implementing future systems.

39. Initial Implementation Order

The database implementation should proceed in dependency order.

Phase 1 — Identity and tenancy
users
organizations
organization_memberships
Phase 2 — Members
members
Phase 3 — Memberships
membership_plans
memberships
Phase 4 — Payments
charges
payment_claims
payments
Phase 5 — Attendance
attendance_records
Phase 6 — Communication
announcements
notifications
Phase 7 — SaaS billing/access
saas_subscriptions
entitlements

Only the tables actually required by the current implementation should be introduced.

40. Required Database Tests

At minimum, database/integration tests should cover:

Tenant isolation
Organization A cannot access Organization B data.
Membership relationship
Member belongs to the expected organization.
User linking
Member cannot be linked to an unauthorized organization.
Payment
Claim != confirmed payment.
Partial payment produces correct outstanding amount.
Unauthorized role cannot confirm payment.
Attendance
Attendance cannot be created for an unrelated organization member.
Constraints
Invalid foreign-key relationships fail.
Invalid required fields fail.
Duplicate values fail where uniqueness is required.
41. Security Review Checklist

Before approving a schema change, review:

 Does every tenant-owned entity have a clear organization relationship?
 Can a resource accidentally be accessed cross-tenant?
 Are foreign keys present where required?
 Are important invariants represented by constraints?
 Are payment records protected from accidental mutation?
 Are sensitive fields minimized?
 Are secrets excluded?
 Are indexes appropriate?
 Does the migration preserve existing data?
 Could the migration lock a large table?
 Is the change backward compatible with the application deployment order?
 Are tests added or updated?
 Is the relevant documentation updated?
42. What This Decision Does Not Decide

This ADR does not finalize:

Prisma vs Drizzle
exact PostgreSQL hosting provider
exact production database size
exact connection pooling configuration
exact schema naming convention beyond project standards
exact enum implementation
exact ID-generation strategy
exact backup provider
advanced analytics schema
future payment gateway schema
future cloud photo-storage schema

Those decisions should be made when their implementation requirements are known.

43. Consequences
Positive
Strong relational integrity
Explicit tenant boundaries
Better financial data correctness
Easier querying and reporting
Clear domain relationships
Safer schema evolution
Better testability
Less hidden business state
Compatibility with a modular monolith
Ability to evolve without premature infrastructure complexity
Negative
More tables than a simple document-oriented design
More migration work
More deliberate schema design
Requires careful transaction handling
Requires developers to understand relational modeling
Some future features may require additional migrations

These costs are accepted because the core product contains financial, membership, authorization, and attendance data where correctness is more important than schema simplicity alone.

44. Final Rule

The database is a source of structural truth.

Application code owns business workflows and authorization.

The frontend is never a security boundary.

The database should enforce what the database can safely enforce.

The backend must enforce what requires application context.

Financial history, tenant isolation, identity relationships, and membership relationships must be treated as correctness-critical.

Prefer a small, explicit, relational schema that matches the current product over a large speculative schema designed for hypothetical future features.
