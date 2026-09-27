# ADR 010 — Domain Modeling

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Domain / Architecture / Data

---

# 1. Context

gym-saas is a multi-tenant gym management SaaS.

The product contains several related business domains:

- Identity
- Organizations
- Organization membership
- Roles and permissions
- Gym members
- Memberships
- Membership plans
- Charges
- Payments
- Attendance
- Occupancy
- Announcements
- Notifications
- Subscriptions
- Entitlements

The application should model these domains explicitly rather than treating the entire product as one collection of CRUD tables.

---

# 2. Domain Modeling Principles

The domain model should prioritize:

- Clear ownership
- Explicit relationships
- Strong invariants
- Tenant isolation
- Data integrity
- Understandable business rules
- Testability
- Minimal accidental coupling

The model should reflect actual product concepts.

Avoid creating abstractions merely because they appear architecturally sophisticated.

---

# 3. Core Domain Boundaries

The initial domain can be organized conceptually into:

```text
Identity
    ↓
Organization
    ↓
Organization Membership
    ↓
Gym Operations
    ├── Members
    ├── Memberships
    ├── Attendance
    ├── Payments
    └── Announcements

Platform
    ├── Subscription
    ├── Plan
    └── Entitlements

Communication
    └── Notifications
4. Identity Domain

The identity domain represents the application user.

Core concept:

User

A User represents an authenticated application identity.

A User is not automatically a member of every organization.

5. User

A User may:

Authenticate
Belong to multiple organizations
Have different roles in different organizations
Act as an owner in one organization
Act as staff in another organization
Act as a member in another organization

Conceptually:

User
 ├── OrganizationMembership A
 ├── OrganizationMembership B
 └── OrganizationMembership C
6. Organization Domain

An Organization represents a gym/tenant.

Core concept:

Organization

The organization is the primary tenant boundary.

Tenant-owned data must be associated with an organization directly or through an explicitly authorized relationship.

7. Organization Membership

Organization membership connects a User to an Organization.

Conceptually:

User
   ↓
OrganizationMembership
   ↓
Organization

The membership also contains the user's role within that organization.

8. Roles

Initial roles:

OWNER
ADMIN
STAFF
TRAINER
MEMBER

A role belongs to the organization membership rather than globally defining the user.

Example:

User A
 ├── Gym A → OWNER
 └── Gym B → TRAINER
9. Permissions

Roles determine a user's permission set.

Permissions should be evaluated within an organization context.

The system should avoid storing a large collection of arbitrary client-controlled permissions.

The initial implementation may use explicit role-based authorization.

A more granular permission model can be introduced if real product requirements justify it.

10. Gym Member Domain

A gym member represents the customer/member of a gym.

Conceptually:

Organization
      ↓
Member

A Member belongs to a specific organization.

Member data must remain tenant-scoped.

11. User vs Member

User and Member are separate concepts.

A User represents:

An authenticated application identity.

A Member represents:

A person's membership/customer relationship with a specific gym.

They should not be treated as interchangeable.

Conceptually:

User
  ↓
May have
  ↓
Member relationship
  ↓
Organization
12. Why User and Member Are Separate

This separation supports:

Members who have not completed onboarding
Members who may belong to multiple gyms
Different organization-specific membership data
Staff/owners who are also gym members
Authentication independent of gym business data

The domain model should not assume:

One phone number = One gym member
13. Membership Domain

Membership represents a member's actual membership relationship/period with the gym.

Conceptually:

Member
   ↓
Membership
   ↓
Plan

A member may have multiple membership records over time.

14. Membership Plan

A Membership Plan defines a gym's configured membership offering.

Examples:

Monthly
Quarterly
Half-Yearly
Annual

A plan may define:

Name
Duration
Price
Description
Active/inactive state

The exact fields belong in the database design.

15. Membership vs Plan

A plan is a reusable configuration.

A membership is a specific member's enrollment.

Example:

Plan:
Monthly
₹1,500
30 days

        ↓

Member:
Rahul
Membership:
1 Jan → 30 Jan

The system should preserve the actual membership/charge information even if the plan later changes.

16. Charge Domain

A Charge represents an amount owed.

Conceptually:

Membership
      ↓
Charge

A charge should represent a financial obligation independently from payment records.

17. Payment Domain

A Payment represents money actually confirmed as received by the gym.

Conceptually:

Charge
   ↓
Confirmed Payments

One charge may have multiple payments.

Example:

Charge = ₹1,500

Payment 1 = ₹500
Payment 2 = ₹1,000

Confirmed Total = ₹1,500
18. Payment Claim

A Payment Claim represents a member saying:

I have paid.

A claim is not equivalent to a confirmed payment.

Conceptually:

Member
  ↓
Payment Claim
  ↓
Owner / Authorized Staff
  ↓
Verification
  ↓
Confirmed Payment

This distinction is a core financial invariant.

19. Payment State

Payment state should be derived from structured financial records.

Conceptually:

Charge
   +
Confirmed Payments
   ↓
Payment Status

Possible states:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

The system must not treat a payment claim as confirmed payment.

20. Payment and Membership Separation

Payment and membership renewal are related but distinct.

For example:

Payment Confirmed

does not automatically mean:

Membership Renewed

unless an explicit business rule says so.

This prevents accidental membership changes caused by payment state alone.

21. Attendance Domain

Attendance represents a member visiting/checking into the gym.

Conceptually:

Member
   ↓
Attendance

Attendance should contain the information required to determine:

Who checked in
Which organization
When
Whether an active session exists
22. Attendance Session

A session can represent the period during which a member is considered present.

Conceptually:

Check In
   ↓
Active Session
   ↓
Check Out / Session Completion

The exact attendance lifecycle will be defined in the database/API implementation.

23. Occupancy Domain

Occupancy represents the number of members currently considered present.

It should preferably be derived from active attendance sessions.

Conceptually:

Active Attendance Sessions
          ↓
      Occupancy

Avoid maintaining duplicate occupancy state unless a real performance requirement requires it.

24. Announcements

Announcements represent gym communication to members.

Conceptually:

Organization
      ↓
Announcement
      ↓
Members

An announcement belongs to the organization.

The system may later support:

Publish time
Expiry
Audience
Read state

These details are not required for the initial domain model.

25. Notification Domain

Notifications represent attempts or planned communication through external channels.

Examples:

WhatsApp
Future email
Future push notifications

A notification belongs to the application rather than directly representing a WhatsApp message.

26. Notification Provider

The provider is an external delivery mechanism.

Conceptually:

Notification
     ↓
Provider
     ↓
External Channel

The application should remain the source of truth for notification state.

27. Notification vs Announcement

An Announcement is a product/content concept.

A Notification is a delivery concept.

For example:

Announcement
    ↓
Notification
    ↓
WhatsApp

They should not be modeled as the same entity.

28. Subscription Domain

A Subscription represents an organization's SaaS subscription.

Conceptually:

Organization
      ↓
Subscription
      ↓
Plan

This is the gym's relationship with XYZ's SaaS product.

It is separate from a gym member's membership.

29. Subscription vs Membership

These two concepts must never be confused.

SaaS Subscription
Gym
 ↓
XYZ SaaS
Gym Membership
Member
 ↓
Gym

They represent completely different financial/business relationships.

30. Plan Naming

There are two separate types of plans:

Membership Plan

Gym-defined offering to members.

SaaS Plan

XYZ-defined subscription plan for gyms.

They should remain separate domain concepts even if both contain fields such as:

Name
Price
Duration
Features
31. Entitlements

Entitlements define what a SaaS subscription is allowed to use.

Conceptually:

Subscription
     ↓
SaaS Plan
     ↓
Entitlements
     ↓
Feature / Action

Examples may include:

Maximum members
Automated WhatsApp reminders
Analytics
Advanced reports

The exact entitlement matrix remains a product/pricing decision.

32. Audit Information

Certain sensitive actions should produce audit information.

Examples:

Payment confirmation
Role changes
Staff changes
Subscription changes
Security-sensitive actions

Audit information should identify:

Actor
Organization
Action
Relevant entity
Timestamp

The exact audit model will be defined separately.

33. Domain Ownership

Every major entity should have an understandable ownership relationship.

Examples:

Organization
 ├── Members
 ├── Membership Plans
 ├── Memberships
 ├── Charges
 ├── Payments
 ├── Attendance
 ├── Announcements
 └── Notifications

This makes tenant isolation easier to reason about.

34. Cross-Domain References

Domains may reference one another where required.

Example:

Payment
 ├── Organization
 ├── Member
 ├── Charge
 └── Actor

However, domains should not become unnecessarily dependent on internal implementation details of other domains.

35. Business Invariants

Important invariants include:

Identity
Phone number ≠ primary identity key
Tenant Isolation
User may access only authorized organizations
Payment
Claim ≠ Confirmed Payment
Payment Balance
Outstanding =
Charge Total - Confirmed Payments
Membership
Payment confirmation ≠ automatic membership renewal
Attendance
Duplicate check-in must be prevented
Authorization
Frontend role ≠ trusted authorization
36. State Transitions

Important state changes should be modeled explicitly.

Examples:

Payment Claim
     ↓
Confirmed Payment
Membership
     ↓
Active
     ↓
Expired
     ↓
Renewed
Attendance
     ↓
Checked In
     ↓
Active Session
     ↓
Completed

The exact state machines will be documented in the relevant feature/API/database specifications.

37. Avoid Generic "Status" Fields

A generic status field should not become a substitute for understanding the domain.

For example:

payment.status

should not contain arbitrary values that encode multiple concepts.

Separate concepts should remain separate.

Example:

Payment Claim
Confirmed Payment
Membership State

should not be collapsed into one giant status field.

38. Domain Logic vs Database Logic

The database should enforce appropriate structural invariants.

The application/domain layer should enforce business behavior.

Example:

Database
→ foreign key
→ unique constraint
→ not-null constraint

Application
→ user may confirm payment
→ payment amount must be valid
→ membership renewal rules
→ notification rules

Neither layer should be expected to replace the other.

39. Domain Logic vs UI

Business rules must not exist only in frontend components.

For example:

The frontend may display:

Confirm Payment

but the backend must determine whether the current user is actually authorized to confirm it.

40. Domain Services

Domain/application services may be introduced when business operations span multiple entities.

Examples:

OwnerOnboardingService
PaymentService
AttendanceService
MembershipService
NotificationService
SubscriptionService

These should represent real business boundaries rather than become generic utility containers.

41. Avoid Giant Services

Avoid a single service such as:

GymService

containing every operation in the entire application.

Prefer meaningful boundaries.

42. Avoid Premature Domain-Driven Design Complexity

The project should use domain modeling principles without introducing unnecessary enterprise architecture.

Do not automatically create:

Aggregates for every table
Domain events for every CRUD operation
Multiple bounded-context services
Complex factories
Generic repositories
Event sourcing

unless a real problem requires them.

43. Domain Events

Domain/application events may be useful for secondary actions.

Example:

Payment Confirmed
      ↓
Notification Event
      ↓
WhatsApp Notification

However, not every database write needs to become an event.

Events should be introduced where asynchronous or decoupled behavior provides a real benefit.

44. Source of Truth

Each important concept should have one authoritative source.

Examples:

User Identity
→ Authentication / User model

Organization Membership
→ OrganizationMembership

Payment State
→ Charges + Confirmed Payments

Membership State
→ Membership

Attendance
→ Attendance records / sessions

Subscription
→ Subscription

Avoid maintaining duplicate authoritative state across unrelated tables.

45. Data Ownership

The domain model should make ownership clear.

For example:

Member
 └── organizationId

Payment
 └── organizationId

Attendance
 └── organizationId

Announcement
 └── organizationId

Where a direct organization reference is appropriate, it should be considered carefully because it can simplify tenant-scoped querying and authorization.

46. Multi-Gym Members

The domain model must support a person interacting with multiple gyms.

Conceptually:

User
 ├── Organization A → Member
 └── Organization B → Member

The organization-specific member relationship must not be represented only by the global User record.

47. Staff and Member Overlap

A person may have different relationships with the same or different organizations.

For example:

User
 ├── Gym A → OWNER
 └── Gym B → MEMBER

The domain model should not assume one global role.

Roles belong to organization membership.

48. Future Engagement Domain

Future features may introduce:

Streaks
Badges
Challenges
Goals
Achievements
Leaderboards

These should be added as separate concepts when the features become real.

Do not add all future tables to the initial database merely because they appear in the roadmap.

49. Progress Photo Domain

Progress photos are future functionality.

The domain model should eventually separate:

Photo Metadata

from:

Actual File/Object

if cloud storage is introduced.

The initial V1 domain does not require this feature.

50. Domain Modeling Decision
Current Status

The core domain boundaries are defined conceptually.

Primary domains:

Identity
Organization
Authorization
Members
Memberships
Payments
Attendance
Announcements
Notifications
SaaS Subscription
Entitlements
Audit

The initial implementation should remain a modular monolith.

51. Consequences
Positive
Clear business concepts
Easier authorization reasoning
Better tenant isolation
Better testability
Clearer database design
Easier future feature development
Reduced accidental coupling
Trade-offs
More explicit modeling
More entities and relationships
Some concepts require careful state handling
Developers must understand domain boundaries
52. Future Reassessment

Reassess domain boundaries when:

A new major product area is introduced
Existing domains become too large
Business rules become difficult to isolate
Team size increases
A service boundary becomes justified
New external integrations create meaningful domain boundaries
53. Related Documents
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
009-BACKGROUND-JOBS.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
54. Approval

Decision Owner: Project Owner

Status: Proposed

Architecture: Modular Monolith

Primary Domain: Gym Management SaaS

Approval Date: N/A
