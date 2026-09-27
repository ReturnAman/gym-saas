# ADR 012: Database Naming and ID Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Database / API / Engineering Conventions
- Related:
  - `04-DATABASE-DESIGN.md`
  - `07-API-SPECIFICATION.md`
  - `14-TECH-DECISIONS.md`
  - `decisions/002-DATABASE-ORM.md`
  - `decisions/010-DOMAIN-MODELING.md`
  - `decisions/011-DATABASE-SCHEMA-IMPLEMENTATION.md`

---

## 1. Context

The project needs consistent conventions for:

- database table names
- column names
- foreign keys
- primary keys
- identifiers exposed through APIs
- timestamps
- status fields
- enum values
- indexes
- constraints

Without explicit conventions, different developers or AI tools may introduce inconsistent naming and identifier patterns.

The project will be maintained by humans and multiple AI tools over time.

Therefore, conventions must prioritize:

1. consistency
2. readability
3. PostgreSQL compatibility
4. ORM compatibility
5. API clarity
6. security
7. maintainability
8. low migration friction

---

# 2. Decision

The project will use:

- `snake_case` for PostgreSQL table and column names
- singular conceptual entity names represented as plural table names
- `id` as the primary-key column name
- `<entity>_id` for foreign-key columns
- UTC-aware timestamps for stored instants
- `created_at` and `updated_at` for standard lifecycle timestamps
- explicit names for domain-specific timestamps
- stable generated identifiers rather than phone numbers
- identifiers that are opaque to clients
- no sequential business identifiers exposed as public resource identifiers
- explicit status values rather than overloaded booleans for meaningful state machines

The exact ID generation technology will remain compatible with PostgreSQL and the selected ORM.

---

# 3. Database Naming Convention

## 3.1 Tables

Tables use lowercase `snake_case` and plural names.

Examples:

```text
users
organizations
organization_memberships
members
membership_plans
memberships
charges
payments
payment_claims
attendance_records
announcements
notifications
saas_subscriptions
audit_logs
Avoid:

User
UsersTable
organizationMembership
paymentClaims
4. Columns

Columns use lowercase snake_case.

Examples:

organization_id
member_id
membership_plan_id
phone_verified_at
created_at
updated_at
checked_in_at

Avoid mixing styles:

organizationId
organization_id
OrganizationID

The PostgreSQL schema should use one convention consistently.

5. Primary Key Naming

Every major application table should normally use:

id

as its primary-key column.

Example:

CREATE TABLE members (
    id ... PRIMARY KEY
);

This keeps joins, ORM relations, repository methods, and migrations predictable.

Avoid:

member_id
member_uuid
member_pk
member_identifier

as the primary-key column name unless a specific technical reason requires it.

The entity type already provides the semantic meaning.

6. Foreign Key Naming

Foreign keys use:

<referenced_entity>_id

Examples:

organization_id
user_id
member_id
membership_id
membership_plan_id
charge_id
created_by
confirmed_by
reviewed_by

Where the relationship represents a user reference, the suffix should still describe the relationship clearly.

For example:

created_by
confirmed_by
reviewed_by

may reference:

users.id

The implementation should document these relationships through the ORM schema and database foreign keys.

7. Composite Foreign-Key Naming

When a relationship requires multiple columns, names should describe each component explicitly.

Example:

organization_id
member_id

Avoid opaque names such as:

relationship_key
scope
owner_reference

unless the relationship genuinely requires an abstract key.

8. Primary Key Type

The application will use generated opaque identifiers for primary keys.

The final concrete implementation may use a PostgreSQL-compatible generated identifier such as:

UUID

or another suitable opaque identifier.

The exact choice remains tied to the ORM/database proof of concept.

The important requirement is:

Application entity IDs must not depend on human-readable business data such as phone numbers.

9. Why Not Phone Numbers as IDs?

Phone numbers can change.

A member may:

change phone number
have an incorrectly entered phone number
lose access to an old number
share a number in unusual business circumstances
use a different phone for authentication later

Therefore:

phone

is an attribute.

It is not the identity of the entity.

Example:

Member
  id = stable generated ID
  phone = current phone number

Changing the phone should not change the member's identity.

10. Why Not Sequential Integer IDs?

Sequential IDs can expose information such as:

/users/1001
/users/1002
/users/1003

This can make resource enumeration easier and can reveal rough creation order.

Even when authorization is correctly implemented, opaque IDs provide an additional layer of protection against casual enumeration and reduce unnecessary information exposure.

Therefore, client-visible resource IDs should be opaque.

This does not replace authorization.

11. IDs Are Not Authorization

Opaque IDs are not a security boundary.

This is invalid reasoning:

"The ID is hard to guess, so authorization is unnecessary."

The backend must still verify:

authenticated user
        ↓
organization membership
        ↓
role/permission
        ↓
resource organization
        ↓
requested action

An attacker who somehow obtains a valid resource ID must still be denied if they are not authorized.

12. Internal IDs vs Public IDs

The initial implementation should avoid unnecessary duplication between:

internal_id
public_id

for every entity.

If the primary key itself is sufficiently opaque and safe to expose, it may serve as the resource identifier in APIs.

Do not create a second identifier merely because "public IDs are a good idea."

Additional public identifiers should only be introduced when there is a concrete requirement.

Examples of valid future reasons:

human-friendly member numbers
migration compatibility
external integrations
legacy identifiers
public referral codes
13. Human-Readable Business Numbers

If the product later needs something like:

Member #1042

that should be a separate business identifier.

It must not replace the primary key.

Conceptually:

members

id
organization_id
member_number
name
phone
...

The business identifier may be:

1042

while the internal ID remains opaque.

14. Tenant-Scoped Business Identifiers

If a gym wants member numbers, they may be unique within a gym rather than globally.

Example:

Gym A
Member #1001

Gym B
Member #1001

This can be represented by a scoped uniqueness constraint such as:

UNIQUE (organization_id, member_number)

if the product requires it.

The database should enforce the business rule rather than relying only on application checks.

15. API Identifier Convention

APIs should use the entity's stable identifier.

Example:

GET /api/members/{memberId}

The client should not identify a member using:

phone
name
email
member_number

unless the endpoint specifically represents a search/discovery operation.

For example:

GET /api/members?search=9876543210

may be a search operation.

It should not redefine the member's identity.

16. URL Identifiers

Resource URLs should use opaque identifiers.

Example:

/api/members/01J...

rather than:

/api/members/123

if sequential IDs are not used.

The exact ID representation depends on the final ID technology.

17. No Sensitive Data in IDs

Identifiers must not contain:

phone numbers
passwords
OTPs
authentication tokens
payment information
personal secrets

Bad examples:

member-9876543210
user-password123
payment-4111111111111111

Identifiers should contain no sensitive business information.

18. Timestamp Naming

Standard lifecycle timestamps:

created_at
updated_at

Use _at for timestamps representing a point in time.

Examples:

created_at
updated_at
verified_at
confirmed_at
reviewed_at
published_at
checked_in_at
checked_out_at
starts_at
ends_at
expires_at

Use _date for calendar dates when the value is intentionally date-only.

Examples:

start_date
end_date
due_date
birth_date

Do not use ambiguous names such as:

date
time
timestamp
when

when a more descriptive name is possible.

19. Boolean Naming

Boolean columns should use names that clearly communicate a true/false meaning.

Examples:

is_active
is_verified
is_enabled
is_public

Avoid ambiguous names such as:

active
status
flag
value

when the field is actually a boolean.

However, do not use a boolean where the domain has multiple meaningful states.

20. Boolean vs Status

Use a boolean for a simple binary fact.

Example:

is_enabled

Use a status when the entity has multiple meaningful states.

For example, payment should not be modeled as:

is_paid BOOLEAN

because payment can represent:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

Similarly, a payment claim may have:

PENDING
APPROVED
REJECTED

A status field should represent the actual state machine.

21. Status Naming

Status columns should normally use:

status

when there is one primary lifecycle/state dimension.

Examples:

members.status
memberships.status
payments.status
payment_claims.status
notifications.status
saas_subscriptions.status

If an entity has multiple independent state dimensions, they should be represented separately.

Do not create one giant status enum containing unrelated concepts.

22. Enum Value Naming

Database/application enum values should use stable uppercase semantic values where the chosen ORM supports this convention.

Examples:

OWNER
ADMIN
TRAINER
STAFF
MEMBER
PENDING
APPROVED
REJECTED
UNPAID
PARTIALLY_PAID
PAID

Enum values should represent domain concepts rather than UI labels.

The UI can translate:

PARTIALLY_PAID

into:

Partially paid
23. Display Names vs Stored Values

Database values should be stable.

Do not store presentation-specific text as the authoritative state.

Bad:

"Payment is waiting for owner verification"

Better:

PENDING

The frontend can render:

Payment verification pending

This allows UI copy to change without database migrations.

24. Monetary Column Naming

Money fields should clearly indicate their meaning.

Examples:

amount
price
claimed_amount

Avoid vague fields such as:

value
number
total
cost

when the semantic meaning is important.

For records with multiple monetary concepts, use explicit names:

charge_amount
paid_amount
outstanding_amount

However, derived values should not automatically become stored columns.

For example:

outstanding_amount

may be calculated from:

charge amount
-
confirmed payments

unless there is a documented reason to materialize it.

25. Currency

If monetary values are stored, the currency model should be explicit enough to avoid ambiguity.

For the initial product, the expected currency is INR.

The implementation should avoid hardcoding currency assumptions into generic financial calculations where doing so would make future extension unnecessarily difficult.

However, multi-currency support is not part of the initial product unless explicitly approved.

Do not build a full multi-currency system prematurely.

26. Date-Only Fields

Calendar dates should use names ending in _date.

Examples:

start_date
end_date
due_date

These should not be represented as timestamps merely because the database supports timestamps.

For example:

membership.start_date
membership.end_date

may represent gym membership calendar dates.

Attendance:

checked_in_at

represents a precise instant.

These are different concepts.

27. Organization-Scoped Index Naming

Indexes should follow a consistent naming convention.

Conceptually:

idx_<table>_<columns>

Examples:

idx_members_organization_id
idx_members_organization_id_phone
idx_memberships_member_id
idx_payments_organization_id
idx_attendance_records_member_id_checked_in_at

The exact generated names may be controlled by the ORM if they remain understandable.

28. Unique Constraint Naming

Unique constraints should use an explicit convention where supported.

Conceptually:

uq_<table>_<columns>

Examples:

uq_users_phone
uq_members_organization_id_phone
uq_members_organization_id_member_number

Constraint names should make migration errors understandable.

29. Foreign Key Constraint Naming

Foreign-key constraints should follow a predictable convention if explicitly named.

Conceptually:

fk_<table>_<column>_<referenced_table>

Example:

fk_members_organization_id_organizations

The ORM may generate these automatically.

Consistency matters more than manually naming every constraint if the generated names are clear and stable.

30. Index Selection

Naming conventions do not justify unnecessary indexes.

Every index should have a reason such as:

frequent lookup
tenant filtering
unique business rule
join performance
sorting/filtering
state-based processing

Before adding an index, consider:

query frequency
table size
write frequency
selectivity
existing indexes
31. API Field Naming

The database will use snake_case.

The API representation may use the project's chosen TypeScript/API convention.

The project must choose one consistent approach rather than allowing individual endpoints to invent their own style.

If the API uses camelCase, conversion should occur at the API boundary rather than producing a database with mixed naming conventions.

Example:

Database:
organization_id

API:
organizationId

This is acceptable if applied consistently.

The exact API serialization convention should follow 008-API-CONVENTIONS.md and the final implementation.

32. TypeScript Naming

Application code should follow standard TypeScript conventions.

Examples:

organizationId
memberId
membershipPlanId
createdAt
updatedAt

Types/classes:

Organization
OrganizationMembership
MembershipPlan
PaymentClaim
AttendanceRecord

Constants/enums should follow the established TypeScript style.

The database naming convention does not require TypeScript code to use snake_case.

33. Mapping Between Layers

The project should make the database/application boundary explicit.

Example:

PostgreSQL
organization_id

        ↓ mapping

TypeScript
organizationId

Avoid allowing database naming differences to leak unpredictably across the codebase.

The selected ORM should handle predictable mapping where practical.

34. External Provider IDs

External providers may have their own identifiers.

Examples:

provider_message_id
provider_customer_id
provider_event_id

These should remain separate from the application's internal IDs.

Example:

notifications.id
notifications.provider_message_id

Do not replace the internal notification ID with a WhatsApp/provider ID.

35. Webhook Event IDs

External webhook events may include provider-specific event IDs.

Where the provider guarantees uniqueness, those identifiers can be stored and used for idempotency.

Example:

provider_event_id

A suitable unique constraint may be applied when the provider's guarantees justify it.

This protects against duplicate webhook processing.

36. Authentication Provider IDs

Authentication providers may issue their own user identifiers.

These should be stored separately from the application's user ID.

Conceptually:

users.id
users.auth_provider_id

or through a dedicated identity mapping if the architecture requires it.

The application should not make the external authentication-provider ID the only domain identifier unless there is a deliberate architectural decision to do so.

This preserves the ability to change authentication providers later.

37. Phone Number Storage

Phone numbers should be normalized before comparison/storage according to the authentication design.

The database should not assume that:

+91 98765 43210

and:

09876543210

are automatically different people.

Normalization rules must be defined at the application boundary.

The exact phone normalization library/implementation is a separate implementation decision.

38. Sensitive Search Fields

Phone numbers may be used for member discovery/onboarding.

Search functionality must still respect:

organization scope
authorization
rate limits
privacy requirements
generic responses where enumeration risk exists

A database index on phone does not make the search operation safe by itself.

39. Naming Historical Records

Historical records should use names that explain the event or fact being preserved.

Examples:

payment
payment_claim
attendance_record
audit_log

Avoid generic tables such as:

history
events
records
data

unless they genuinely represent a generic event system.

40. Naming Domain Relationships

Use domain terminology consistently.

For example:

membership_plan
membership
charge
payment_claim
payment

Do not alternate between:

subscription
membership
plan
package

for the same concept.

The product has two separate subscription concepts:

Gym member membership
SaaS subscription for the gym

Their database names must remain distinct.

41. Avoid Ambiguous owner_id

owner_id should not be used casually.

The product supports multiple owners through organization membership.

Therefore, ownership is represented through:

organization_memberships
role = OWNER

rather than assuming:

organizations.owner_id

unless a future requirement explicitly introduces a separate primary-owner concept.

This prevents the database from incorrectly modeling:

one organization = one owner

when the product supports multiple owners.

42. Creator Fields

When the product needs to know who created a record, use an explicit field:

created_by

with a foreign key to the relevant user identity.

Examples:

announcements.created_by
audit_logs.actor_user_id

The field should describe the relationship.

Do not overload:

owner_id

to mean creator.

43. Organization ID on Audit Records

Audit records should include:

organization_id

when the action is tenant-specific.

This allows:

tenant-scoped audit retrieval
authorization filtering
efficient queries
clearer historical context

System-level actions may not belong to a particular organization and should be modeled accordingly.

44. IDs in Logs

Application logs should avoid exposing sensitive identifiers unnecessarily.

It may be appropriate to log:

organizationId
memberId
requestId

for debugging and tracing.

However, logs must not contain:

OTP
password
access token
API key
payment credentials

The logging policy in AGENTS.md remains authoritative.

45. IDs in Error Messages

API errors should not expose unnecessary internal information.

Avoid errors such as:

Foreign key violation on organization ID 9b...

to end users.

Use safe domain-level errors.

Example:

Member not found

or:

You do not have access to this member

depending on the endpoint and enumeration considerations.

Internal diagnostics may contain additional information in protected logs.

46. Migration Compatibility

Naming conventions should remain stable after the schema becomes production data.

Changing:

organization_id

to:

gym_id

later creates unnecessary migration and code churn unless the domain meaning genuinely changes.

Therefore, terminology must be selected carefully before implementation.

47. Naming Review Checklist

Before approving a schema:

 Tables use lowercase snake_case
 Tables use consistent plural naming
 Primary keys use id
 Foreign keys use <entity>_id
 Timestamps use descriptive _at names
 Date-only values use _date
 Booleans use clear is_/has_ naming where appropriate
 Status values represent real domain states
 Phone numbers are not primary keys
 Sensitive information is not encoded into IDs
 External provider IDs are separate from internal IDs
 Business identifiers are separate from internal IDs
 Tenant scope is explicit
 Constraint/index names are understandable
 API naming remains consistent with API conventions
 TypeScript naming remains consistent with application conventions
48. What This Decision Does Not Finalize

This ADR does not finalize:

UUID vs UUIDv7 vs another generated ID format
exact ORM mapping syntax
exact PostgreSQL enum implementation
exact API serialization strategy
public-facing human member-number format
external provider identity mapping implementation
multi-currency support
advanced audit/event architecture

Those decisions should be made only when the relevant implementation requirements are known.

49. Consequences
Positive
Consistent database schema
Easier ORM usage
Easier collaboration between humans and AI tools
Easier migrations
Clearer API/database boundaries
Reduced accidental identifier leakage
Better tenant-scoped query readability
Easier debugging
Stable domain terminology
Negative
Requires discipline across the codebase
Naming changes later may require migrations
API/database mapping may require serialization work
Opaque IDs are less human-readable during debugging
Some conventions require additional documentation

These costs are accepted in exchange for long-term consistency.

50. Final Rule

Use names that explain the domain.

Use stable opaque identifiers for identity.

Use business identifiers separately from internal IDs.

Use explicit states instead of overloaded booleans.

Keep database naming consistent.

Keep API and TypeScript naming consistent within their own layers.

Do not treat identifier obscurity as authorization.

Do not encode sensitive information into identifiers.

When a naming decision affects domain meaning, correctness, security, or future migrations, document the decision instead of letting individual AI tools or developers invent their own convention.
