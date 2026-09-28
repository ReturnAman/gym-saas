# Database Design

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** Database Definition  
**Database:** PostgreSQL  
**Scope:** V1 and planned evolution

---

# 1. Purpose

This document defines the database architecture and core data model for gym-saas.

It translates the approved product requirements, user flows, and system architecture into a relational data model.

This document defines:

- core entities
- relationships
- tenant boundaries
- identity relationships
- membership structure
- attendance structure
- payment structure
- subscription structure
- notification structure
- important constraints
- indexing principles
- data integrity rules

This document does not define:

- complete API contracts
- UI implementation
- deployment configuration
- exact ORM implementation
- every future feature's schema

Those details belong in the appropriate documents.

---

# 2. Database Technology

The primary database is:

**PostgreSQL**

PostgreSQL is the authoritative persistent data store for core application data.

The application should use a migration-based schema management approach.

Production database schema changes must be performed through reviewed migrations.

Manual production schema modifications should not be used as the normal workflow.

---

# 3. Core Database Principles

The database should prioritize:

1. Data integrity
2. Tenant isolation
3. Referential integrity
4. Explicit relationships
5. Appropriate constraints
6. Appropriate indexes
7. Transactional correctness
8. Auditable financial state
9. Simple maintainable structure
10. Avoidance of duplicate sources of truth

---

# 4. Identity Model

The system separates authentication identity from application identity.

Conceptually:

```text
Authentication Provider
        ↓
      User
        ↓
OrganizationMembership
        ↓
   Organization
A phone number is not the primary identity key.

The internal user identifier should be stable even if the user's phone number changes.

5. Core Entities

The initial database contains the following major entities:

User
Organization
OrganizationMembership

Member
MembershipPlan
Membership

Charge
PaymentClaim
Payment

AttendanceSession

Subscription
Plan
Entitlement

Announcement
Notification
NotificationRule

AuditLog

Some entities may be introduced incrementally as features are implemented.

6. User
6.1 Purpose

Represents an application-level person/account.

A user may have access to one or more organizations.

6.2 Conceptual Fields
User
----
id
authenticationProviderId
phoneNumber
phoneNumberVerifiedAt
displayName
status
createdAt
updatedAt

The exact field names and types will be finalized during implementation.

6.3 Rules
id is the primary application identity.
Phone number is not the primary key.
Authentication-provider identifiers should be unique where appropriate.
A user may belong to multiple organizations.
User deletion must be handled carefully because historical records may reference the user.
7. Organization
7.1 Purpose

Represents a gym/business tenant.

7.2 Conceptual Fields
Organization
------------
id
name
phone
email
address
status
createdAt
updatedAt

Additional gym-specific settings may be added as the product evolves.

7.3 Rules
Every tenant-scoped business record must ultimately belong to an organization where appropriate.
Organization IDs must be treated as security-sensitive tenant boundaries.
Deleting an organization requires explicit policy and must not be casually implemented.
8. OrganizationMembership
8.1 Purpose

Connects a user to an organization and defines their role/access.

8.2 Conceptual Fields
OrganizationMembership
----------------------
id
organizationId
userId
role
status
createdAt
updatedAt
8.3 Relationship
User
  │
  ├── OrganizationMembership ── Organization
  │
  └── OrganizationMembership ── Organization
8.4 Rules
A user may belong to multiple organizations.
A user should not have duplicate active memberships for the same organization unless explicitly supported.
Role changes must be authorized.
Membership status must be considered during authorization.
Organization membership is an authorization boundary.
9. Member
9.1 Purpose

Represents a gym member as a business entity.

A Member is not necessarily the same thing as a User.

A gym may create a member record before that person creates or links an application account.

9.2 Conceptual Fields
Member
------
id
organizationId
userId
name
phoneNumber
status
createdAt
updatedAt
9.3 Relationship
Organization
     │
     └── Member
             │
             └── optional User
9.4 Rules
A member belongs to an organization.
A member may be linked to a user after OTP onboarding.
The phone number may be used for member discovery.
Phone number is not the member's primary identity key.
Historical member records should not be casually deleted.
10. MembershipPlan
10.1 Purpose

Represents a reusable membership offering configured by a gym.

Examples:

Monthly
Quarterly
Annual
10.2 Conceptual Fields
MembershipPlan
--------------
id
organizationId
name
duration
price
status
createdAt
updatedAt
10.3 Rules
A plan belongs to one organization.
Plans from one organization must never be accessible to another organization.
Historical memberships should not be broken when a plan changes.
Plan changes must not silently rewrite historical payment information.
11. Membership
11.1 Purpose

Represents a member's actual membership period/entitlement.

11.2 Conceptual Fields
Membership
----------
id
organizationId
memberId
membershipPlanId
startDate
endDate
status
chargeAmount
createdAt
updatedAt
11.3 Relationship
Organization
     │
     └── Member
           │
           └── Membership
                 │
                 └── MembershipPlan
11.4 Rules
Membership belongs to an organization.
Membership belongs to a member.
Membership references a plan where appropriate.
Membership should preserve the applicable charge information needed for historical correctness.
Membership state must be validated on the backend.
Renewal is a business operation separate from payment confirmation.
12. Charge
12.1 Purpose

Represents an amount that the gym expects to receive for a membership or other supported charge.

12.2 Conceptual Fields
Charge
------
id
organizationId
memberId
membershipId
amount
currency
status
description
dueDate
createdAt
updatedAt
12.3 Rules
Charge belongs to an organization.
Charge belongs to the relevant member.
Charge may be associated with a membership.
Amount must be validated.
Financial amounts must use a representation appropriate for exact monetary calculations.
Charges must not be silently rewritten after financial activity depends on them.
13. PaymentClaim
13.1 Purpose

Represents a member saying:

I have paid.

A claim is not proof of payment.

13.2 Conceptual Fields
PaymentClaim
------------
id
organizationId
memberId
chargeId
claimedAmount
paymentMethod
reference
status
submittedAt
verifiedAt
verifiedBy
createdAt
updatedAt
13.3 Rules
A claim is not a confirmed payment.
A member must not be able to mark their own claim as confirmed.
Verification requires appropriate organization permission.
Duplicate claims should be handled safely.
Claim status transitions must be validated.
14. Payment
14.1 Purpose

Represents a confirmed payment received by the gym.

14.2 Conceptual Fields
Payment
-------
id
organizationId
memberId
chargeId
paymentClaimId
amount
paymentMethod
reference
confirmedAt
confirmedBy
status
createdAt
updatedAt
14.3 Rules
Payment belongs to an organization.
Payment belongs to the relevant member.
Payment confirmation must be performed by an authorized user.
Confirmed payment history should remain auditable.
Payments should not normally be silently edited or deleted.
Corrections should use explicit reversal/adjustment mechanisms when required.
15. Payment State Model

The payment-related model distinguishes:

Charge
   ↓
PaymentClaim
   ↓
Confirmed Payment

These are separate concepts.

A claim cannot be treated as a confirmed payment.

16. Outstanding Balance

Outstanding amount is derived from financial records.

Conceptually:

Outstanding
=
Charge Total
-
SUM(Confirmed Payments)

The database/application should avoid treating a manually editable balance field as the authoritative financial state.

Payment state may be represented as:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

The exact transition rules will be enforced by the application and supported by database constraints where appropriate.

17. Payment and Membership Separation

Payment and membership are separate domains.

The following must not be assumed to be equivalent:

Payment confirmed
≠
Membership renewed

A confirmed payment should not automatically change membership dates unless an explicit approved renewal rule exists.

18. AttendanceSession
18.1 Purpose

Represents a member's active or completed gym visit.

18.2 Conceptual Fields
AttendanceSession
-----------------
id
organizationId
memberId
checkInAt
checkOutAt
status
createdAt
updatedAt
18.3 Rules
Attendance belongs to an organization.
Attendance belongs to a member.
An active session should have appropriate state.
Duplicate active sessions should be prevented according to business rules.
Check-in/check-out operations must be concurrency-safe.
19. Occupancy

Live occupancy is derived from active attendance sessions.

Conceptually:

COUNT(
  active AttendanceSession
)

The system should not maintain a separate manually editable occupancy number as the authoritative source.

20. Subscription
20.1 Purpose

Represents an organization's SaaS subscription state.

20.2 Conceptual Fields
Subscription
------------
id
organizationId
planId
status
startAt
endAt
verifiedAt
verifiedBy
createdAt
updatedAt
20.3 Rules
Subscription belongs to an organization.
Subscription state is separate from organization existence.
Trial expiration must not delete organization data.
Subscription activation must be controlled by authorized backend logic.
Manual V1 subscription verification must be auditable.
21. SaaS Plan
21.1 Purpose

Represents a product subscription plan.

Conceptually:

Plan
----
id
name
status
createdAt
updatedAt

The plan may reference entitlements that determine available product functionality.

22. Entitlement
22.1 Purpose

Represents a feature/action available under a plan.

Conceptually:

Entitlement
-----------
id
key
description

Examples may include:

member_limit
whatsapp_reminders
advanced_analytics
csv_exports

Exact entitlement keys should be defined deliberately rather than scattered throughout application code.

23. Subscription Access Model

Conceptually:

Organization
     ↓
Subscription
     ↓
Plan
     ↓
Entitlements
     ↓
Feature / Action

This allows feature access to be controlled centrally.

The application should avoid scattered checks such as:

if trial
if paid
if pro

throughout business logic.

24. Announcement
24.1 Purpose

Represents an organization announcement visible to appropriate members.

24.2 Conceptual Fields
Announcement
------------
id
organizationId
title
content
status
publishedAt
createdBy
createdAt
updatedAt
24.3 Rules
Announcement belongs to an organization.
Only authorized users may create or modify announcements.
Members may only retrieve announcements belonging to their organization.
25. Notification
25.1 Purpose

Represents an application notification and its delivery state.

25.2 Conceptual Fields
Notification
------------
id
organizationId
memberId
messageType
templateId
recipientPhone
provider
providerMessageId
status
createdAt
updatedAt
25.3 Rules

Notifications must remain tenant-scoped.

Notification records should preserve enough information to understand delivery state without storing unnecessary sensitive information.

26. NotificationRule
26.1 Purpose

Represents a configured rule controlling whether a particular notification should be generated.

Conceptually:

NotificationRule
----------------
id
organizationId
messageType
enabled
configuration
createdAt
updatedAt

The exact configuration model will be defined when notification functionality is implemented.

27. AuditLog
27.1 Purpose

Represents important security or business actions performed by users or system processes.

27.2 Conceptual Fields
AuditLog
--------
id
organizationId
actorUserId
action
resourceType
resourceId
metadata
createdAt
27.3 Potential Events

Examples include:

staff role change
staff access removal
payment confirmation
payment correction
subscription activation
important membership changes
security-sensitive recovery

Audit logging should avoid storing secrets or unnecessary sensitive data.

28. Relationship Overview

The core relationships can be represented as:

User
 │
 ├───────────────┐
 │               │
 ▼               ▼
OrganizationMembership
 │
 ▼
Organization
 │
 ├── Member
 │     │
 │     ├── Membership
 │     │      │
 │     │      └── MembershipPlan
 │     │
 │     ├── AttendanceSession
 │     │
 │     ├── Charge
 │     │      │
 │     │      ├── PaymentClaim
 │     │      │
 │     │      └── Payment
 │     │
 │     └── User (optional linked account)
 │
 ├── Announcement
 │
 ├── NotificationRule
 │
 ├── Notification
 │
 └── Subscription
        │
        └── Plan
              │
              └── Entitlement
29. Tenant-Scoped Data

The following entities are organization-scoped:

OrganizationMembership
Member
MembershipPlan
Membership
Charge
PaymentClaim
Payment
AttendanceSession
Subscription
Announcement
NotificationRule
Notification
AuditLog

Every query involving these entities must respect organization scope.

30. Foreign Keys

Foreign-key relationships should be used wherever appropriate.

Examples:

OrganizationMembership.organizationId
    → Organization.id

OrganizationMembership.userId
    → User.id

Member.organizationId
    → Organization.id

Member.userId
    → User.id

Membership.memberId
    → Member.id

Membership.membershipPlanId
    → MembershipPlan.id

Charge.memberId
    → Member.id

Payment.chargeId
    → Charge.id

AttendanceSession.memberId
    → Member.id

The exact foreign-key behavior for deletion must be selected carefully.

Historical financial and attendance records should not be accidentally deleted through cascading operations.

31. Unique Constraints

Unique constraints should be used where the business rules require uniqueness.

Potential examples include:

User.authenticationProviderId
OrganizationMembership(userId, organizationId)

Additional uniqueness constraints may be required for:

organization-specific plan names where appropriate
external provider identifiers
notification provider message IDs
other domain-specific identifiers

Unique constraints should be defined deliberately during schema implementation.

32. Indexing Strategy

Indexes should support common access patterns.

Likely index targets include:

OrganizationMembership.organizationId
OrganizationMembership.userId

Member.organizationId
Member.phoneNumber
Member.status

Membership.organizationId
Membership.memberId
Membership.endDate
Membership.status

Charge.organizationId
Charge.memberId
Charge.dueDate

PaymentClaim.organizationId
PaymentClaim.status
PaymentClaim.memberId

Payment.organizationId
Payment.memberId
Payment.chargeId

AttendanceSession.organizationId
AttendanceSession.memberId
AttendanceSession.status
AttendanceSession.checkInAt

Notification.organizationId
Notification.memberId
Notification.status

Indexes should be validated against actual query patterns rather than added indiscriminately.

33. Tenant-Aware Query Rule

Application code must not perform tenant-scoped queries without establishing the relevant organization context.

Unsafe conceptual pattern:

findMember(memberId)

Safer conceptual pattern:

findMember(
    organizationId,
    memberId
)

The exact implementation may vary, but tenant scope must be enforced.

34. Financial Data Integrity

Financial records require stronger integrity controls than ordinary profile information.

The system must ensure:

amounts are valid
amounts use exact monetary representation
payment confirmation is authorized
payment claims cannot directly become confirmed payments without verification
duplicate confirmation is prevented
historical payment records remain auditable
outstanding balances are derived correctly
partial payments are supported
corrections do not silently destroy history
35. State Integrity

State transitions must be validated.

Examples:

PaymentClaim:
PENDING → CONFIRMED
PENDING → REJECTED
Membership:
ACTIVE → EXPIRED
ACTIVE → CANCELLED
AttendanceSession:
ACTIVE → COMPLETED

Exact states and transitions will be finalized during implementation.

Invalid transitions should be rejected by backend/domain logic.

36. Concurrency and Transactions

The database design must support safe concurrent operations.

Important examples:

Duplicate Check-In

Two requests arriving simultaneously should not unintentionally create duplicate active attendance sessions.

Payment Confirmation

Two staff members should not accidentally confirm the same payment claim twice.

Membership Updates

Concurrent membership changes should not silently overwrite important data.

Subscription Activation

Repeated administrative actions should not create inconsistent subscription periods.

Transactions, constraints, locking, or idempotency mechanisms should be used where appropriate.

37. Soft Delete and Historical Data

The system should avoid destructive deletion where historical business records are important.

Potentially recoverable/business entities may use a status or archival approach instead of immediate hard deletion.

Examples include:

members
staff memberships
plans
memberships
financial records

The exact retention and deletion policy will be defined in the security/data-retention design.

38. Data Retention

The application must preserve information necessary for:

current business operations
payment history
attendance history
auditability
subscription records

Retention requirements may evolve based on legal, operational, and product requirements.

No destructive retention policy should be implemented without an approved requirement.

39. Database Migrations

All schema changes should be managed through version-controlled migrations.

Migration changes should be:

reviewed
tested
reversible where practical
safe for existing data
documented when they materially affect behavior

Destructive migrations require explicit review.

40. ORM / Data Access

The application uses Prisma as the TypeScript ORM / database access layer
for PostgreSQL (decided 2026-09-29; see `decisions/002-DATABASE-ORM.md`,
status Accepted).

The decision is recorded in:

14-TECH-DECISIONS.md
decisions/002-DATABASE-ORM.md

The ORM must not become a substitute for understanding the underlying PostgreSQL data model.

Database constraints and indexes remain important even when an ORM is used.

41. Database Security

Database credentials must:

never be committed
never appear in source code
never appear in logs
be stored in secure environment configuration

Application database access should use least-privilege principles where practical.

Production database access should be restricted to authorized infrastructure and personnel.

42. Database Backup and Recovery

Production PostgreSQL must eventually have:

automated backups
defined retention
recovery procedures
monitoring of backup health
documented restoration procedures

Backup configuration belongs in the infrastructure/DevOps documentation.

A backup is not considered useful unless restoration can be performed successfully.

43. Future Entities

Future product features may introduce additional entities such as:

Challenge
Achievement
LeaderboardEntry
Goal
ProgressPhoto
Partner
Offer
AffiliateEvent

These should not be added to the V1 schema solely because they may exist in the future.

They should be introduced when their requirements are sufficiently defined.

44. What We Will Not Do

The database design will not:

use phone numbers as primary keys
store payment balance only as a manually editable field
treat payment claims as confirmed payments
use frontend state as a source of truth
allow cross-tenant queries without authorization
introduce MongoDB merely because a student credit exists
introduce multiple databases without a demonstrated requirement
create microservice-specific databases prematurely
use destructive cascading deletes for important historical financial data without explicit approval
45. Relationship to Other Documents

This document depends on:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md

Related documents:

05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
46. Document Status

Current status: Initial database definition.

This document defines the conceptual relational model.

The exact implementation schema, migration strategy, constraints, indexes, and ORM mappings must be reviewed during implementation.

No production database schema should be created until the relevant database design and security decisions have been sufficiently reviewed and approved.


### Then

Save it and commit:

```text
docs: define database architecture
