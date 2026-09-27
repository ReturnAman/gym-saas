# Technical Decisions

## Project

- Project: gym-saas
- Document: Technical Decisions
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

# 1. Purpose

This document records important technical decisions for gym-saas.

The purpose is to:

- establish a technical source of truth
- prevent repeated architectural debates
- make trade-offs explicit
- keep AI-assisted development aligned
- document important alternatives
- make future changes deliberate

This document should contain decisions that materially affect the architecture, development workflow, security, cost, or maintainability of the system.

---

# 2. Decision Status

Each decision should have one of these statuses:

- DECIDED
- PROVISIONALLY DECIDED
- OPEN
- SUPERSEDED

AI tools must not silently change a DECIDED architectural choice.

A change to a major decision requires:

1. identifying the existing decision
2. explaining why it no longer fits
3. evaluating alternatives
4. updating this document
5. updating affected documents
6. obtaining human approval

---

# 3. Decision: Product Architecture

### Status

DECIDED

### Decision

The product will initially use a modular application architecture rather than microservices.

### Rationale

The product is early-stage and needs:

- low operational complexity
- fast development
- simple deployment
- straightforward debugging
- low infrastructure cost

The application should have clear domain boundaries internally without requiring separate services.

### Consequence

Potential domains can remain logically separated:

```text
Authentication
Organizations
Members
Memberships
Attendance
Payments
Subscriptions
Notifications
Announcements
These remain part of the same application initially.

4. Decision: Multi-Tenant Architecture
Status

DECIDED

Decision

The SaaS will use a multi-tenant architecture.

Each gym is represented as an independent organization/tenant.

Requirements
organizations are isolated
users may belong to multiple organizations
organization membership determines access
backend authorization is mandatory
tenant scope must be enforced server-side
Consequence

Every tenant-sensitive operation must consider:

Authenticated user
+
Organization membership
+
Role
+
Resource ownership
5. Decision: Database
Status

DECIDED

Decision

PostgreSQL is the primary database technology.

Rationale

The domain contains strongly relational data:

users
organizations
organization memberships
members
memberships
payments
attendance
subscriptions
notifications
audit records

The system also requires:

transactions
constraints
relationships
consistent financial state
tenant isolation
Consequence

MongoDB will not be introduced merely because student credits are available.

6. Decision: Database Source of Truth
Status

DECIDED

Decision

PostgreSQL is the source of truth for core business data.

Important state must not be maintained independently in multiple unrelated systems.

Examples:

payment state
membership state
attendance state
organization membership
subscription state

Caching or derived systems may exist later, but PostgreSQL remains authoritative.

7. Decision: Frontend Technology
Status

PROVISIONALLY DECIDED

Decision

The frontend will use:

Next.js
React
TypeScript
PWA
Rationale

This provides:

strong TypeScript support
web-first delivery
PWA support
good developer ecosystem
suitable owner desktop experience
suitable member mobile experience
one primary application surface
Consequence

Native Android/iOS applications are not required for V1.

8. Decision: PWA First
Status

DECIDED

Decision

The initial product will be a Progressive Web App.

Rationale

The target users primarily need:

mobile member access
QR scanning
attendance
payment status
announcements
owner/staff management

A PWA allows one product to serve:

mobile members
desktop owners
desktop staff

without maintaining separate native applications.

9. Decision: Backend Architecture
Status

PROVISIONALLY DECIDED

Decision

The backend will initially be implemented within the main Next.js application while keeping business/domain logic separated from UI concerns.

Rationale

A separate backend service would introduce additional:

deployment
infrastructure
authentication integration
networking
operational complexity

without a demonstrated V1 requirement.

Future

A separate backend service may be introduced if real requirements justify it.

10. Decision: Authentication vs Authorization
Status

DECIDED

Decision

Authentication and authorization are separate concerns.

Authentication answers:

Who is this user?

Authorization answers:

What may this user do in this organization and resource?

Consequence

An authentication provider does not replace application authorization.

The application must enforce:

organization membership
roles
permissions
resource ownership
tenant isolation

server-side.

11. Decision: Authentication Provider
Status

OPEN

Current Direction

Clerk is the leading candidate because of its student benefit and support for authentication workflows.

Requirements

The selected provider must support the required authentication flow, including phone/OTP where used.

Evaluation Criteria

The final decision should consider:

student/free-plan limits
OTP/SMS cost
session handling
developer experience
security
reliability
migration difficulty
production pricing
vendor lock-in
Rule

Do not implement provider-specific assumptions throughout the application before this decision is finalized.

12. Decision: Phone Number Identity
Status

DECIDED

Decision

A phone number is not the primary identity key of the application.

The architecture separates:

Phone
  ↓
Identity discovery / authentication

User ID
  ↓
Application identity

Organization Membership
  ↓
Authorization
Consequence

The system must not use phone numbers as permanent foreign-key identity throughout the domain.

13. Decision: Member Onboarding
Status

DECIDED

Decision

Members are added by the gym first.

The member later activates/accesses the application using:

Permanent Gym QR
      ↓
Gym identified
      ↓
Phone entered
      ↓
Membership association checked
      ↓
OTP
      ↓
User account
      ↓
Organization membership
      ↓
Member access
Security Rules
QR identifies the gym.
QR does not authenticate the member.
OTP proves control of the phone.
Backend authorization determines access.
Generic responses should reduce membership enumeration.
14. Decision: Owner Onboarding
Status

DECIDED

Decision

Owner onboarding initially uses:

Phone
 ↓
OTP
 ↓
User account
 ↓
Minimal gym details
 ↓
Organization creation
 ↓
OWNER membership
 ↓
Trial subscription
Important Rule

Phone verification proves control of the phone.

It does not by itself prove legal ownership of a gym.

15. Decision: Multiple Organizations
Status

DECIDED

Decision

One user may belong to multiple organizations.

A user may:

own multiple gyms
work at multiple gyms
belong to multiple gyms as a member

Authorization is evaluated within the selected organization context.

16. Decision: Roles
Status

DECIDED

Initial roles:

OWNER
ADMIN
STAFF
TRAINER
MEMBER

Roles are organization-specific.

A user's role in one organization does not automatically grant the same role in another organization.

17. Decision: Trial Model
Status

DECIDED

Decision

New gym organizations initially receive a:

7-day free trial

A member limit may be applied as a product/trial entitlement.

Important Separation

Trial/subscription state belongs to the SaaS organization.

Member gym memberships are a separate domain.

18. Decision: Trial Abuse Prevention
Status

DECIDED

Initial Rule

One introductory trial per verified owner account.

Rationale

This provides a simple initial abuse-control mechanism without requiring complex identity systems.

Future

Additional fraud/abuse controls may be introduced if actual abuse appears.

19. Decision: Subscription Model
Status

DECIDED

The entitlement model is:

Subscription
    ↓
Plan
    ↓
Entitlements
    ↓
Feature / Action checks

Business logic should not be scattered across the codebase as:

if trial
if premium
if paid

without using the entitlement model.

20. Decision: SaaS Subscription Payments
Status

DECIDED

Decision

V1 will not integrate Razorpay or another payment gateway for gym-owner SaaS subscription payments.

Initial process:

Gym Owner
   ↓
UPI / Bank
   ↓
Manual verification
   ↓
Subscription enabled/extended
Rationale

The initial product has a small number of gyms and manual verification is acceptable.

This avoids premature payment-gateway complexity and fees.

21. Decision: Member-to-Gym Payments
Status

DECIDED

Decision

The SaaS does not hold or transfer gym membership money.

The member pays the gym directly.

Member
  ↓
Gym UPI / QR
  ↓
Gym receives money
  ↓
Member submits "I have paid"
  ↓
Owner/authorized staff verifies
22. Decision: Payment Claim vs Confirmed Payment
Status

DECIDED

A member's:

"I have paid"

action creates a payment claim.

It does not create a confirmed payment.

State distinction:

Payment Claim
     ≠
Confirmed Payment

Only an authorized owner/staff action confirms the payment.

23. Decision: Partial Payments
Status

DECIDED

Partial payments are supported.

Example:

Charge = ₹1,000

Payment 1 = ₹400

Outstanding = ₹600
Status = PARTIALLY_PAID

Outstanding balance is calculated from confirmed payment records.

It must not be stored as an independently editable value without a clear reason.

24. Decision: Payment Status
Status

DECIDED

Initial payment states:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

The exact use of OVERPAID will depend on the final payment rules.

25. Decision: Payment and Membership Separation
Status

DECIDED

Payment and membership renewal are separate domains.

A payment claim must not automatically renew membership.

Payment confirmation must not silently renew membership unless an explicit approved rule exists.

26. Decision: Payment Corrections
Status

DECIDED

Confirmed payment history should not be silently edited or deleted.

Future correction mechanisms should use concepts such as:

Reversal
Adjustment
Correction

The exact implementation will be defined in the database/application design.

27. Decision: WhatsApp Architecture
Status

DECIDED

WhatsApp notifications will use a centralized SaaS sender rather than requiring every gym owner to configure their own WhatsApp number.

Conceptually:

Gym A ─┐
Gym B ─┼→ SaaS Notification System → Central WhatsApp Provider
Gym C ─┘

Messages remain personalized and tenant-aware.

28. Decision: WhatsApp Provider Boundary
Status

DECIDED

WhatsApp provider-specific code must remain behind a notification provider boundary.

Conceptually:

Notification System
        ↓
Provider Interface
        ↓
WhatsApp Provider

This prevents the notification domain from depending directly on one provider implementation.

29. Decision: OpenWA
Status

DECIDED

OpenWA may be used for experimentation or local pilot testing if appropriate.

It is not the production foundation for the SaaS.

Rationale

The project requires a production-safe commercial messaging strategy.

OpenWA is based on an unofficial/community-maintained WhatsApp integration approach and introduces account/restriction risk.

The production direction is an official WhatsApp integration.

30. Decision: WhatsApp and Authentication
Status

DECIDED

WhatsApp must not become the authentication foundation.

Authentication remains a separate system.

WhatsApp is a notification channel.

31. Decision: Notification Architecture
Status

DECIDED

The notification architecture is:

Event
  ↓
Notification Rule
  ↓
Notification Job
  ↓
Queue / Processing
  ↓
Provider
  ↓
Delivery Status

The initial implementation may simplify the queue/processing layer when volume is small.

The architecture should remain compatible with asynchronous processing later.

32. Decision: Attendance Model
Status

DECIDED

Attendance should represent check-in/check-out activity.

Live occupancy is derived from active attendance sessions.

Check-in
   ↓
Active Session
   ↓
Check-out
   ↓
Completed Attendance

Duplicate operations must be handled safely.

33. Decision: Occupancy
Status

DECIDED

Live occupancy represents members currently checked in according to active attendance state.

The initial implementation should favor correctness and simplicity.

Caching or event-driven occupancy may be introduced later if measured performance requires it.

34. Decision: Member Engagement
Status

PROVISIONALLY DECIDED

Future member engagement should emphasize consistency rather than raw attendance totals.

Potential concepts:

streaks
badges
consistency score
goals
challenges
achievements
leaderboard

These are not required for initial implementation.

35. Decision: Leaderboard Philosophy
Status

PROVISIONALLY DECIDED

If a leaderboard is introduced, it should prefer consistency-oriented measurement rather than simply rewarding the longest-tenured/highest-total-attendance members.

The exact scoring formula is intentionally not finalized.

Leaderboard participation should eventually support privacy/opt-out controls.

36. Decision: Progress Photos
Status

PROVISIONALLY DECIDED

Progress photos should prefer a local-first approach where practical.

The product should not automatically upload personal progress photos to cloud storage in V1.

Optional cloud backup can be considered later.

37. Decision: PWA
Status

DECIDED

The first product experience will be a PWA.

Primary experiences:

Member → mobile-first
Owner/Staff → responsive desktop + mobile

Native applications are outside V1 scope.

38. Decision: API Authorization
Status

DECIDED

Every protected backend operation must perform server-side authorization.

Authorization should consider:

Authentication
Organization membership
Role
Resource ownership
Tenant scope

Frontend UI restrictions are not security controls.

39. Decision: Database Migrations
Status

DECIDED

Database schema changes must be performed through version-controlled migrations.

Production schemas must not be manually modified as the normal workflow.

Destructive migrations require explicit review.

40. Decision: Testing
Status

DECIDED

Testing will prioritize:

authentication
authorization
tenant isolation
payments
attendance
membership state
subscriptions
critical user journeys

Coverage percentage alone is not the primary quality metric.

41. Decision: CI
Status

DECIDED

GitHub Actions will be used as the initial CI mechanism.

Expected validation includes:

Lint
Typecheck
Tests
Build

Additional checks may be introduced when required.

42. Decision: Deployment Architecture
Status

OPEN

Current Direction

Use a simple managed hosting architecture.

Expected shape:

Users
  ↓
HTTPS
  ↓
Application
  ↓
PostgreSQL
Providers Under Consideration

Potential options include:

Azure
Heroku
another suitable managed hosting provider
Selection Criteria
student benefit
recurring cost
reliability
deployment simplicity
database integration
scaling
migration difficulty
operational control

Final provider selection requires explicit approval.

43. Decision: Infrastructure Complexity
Status

DECIDED

The following are not V1 defaults:

Kubernetes
microservices
service mesh
Redis
message broker
read replicas
database sharding
dedicated search infrastructure

They may be introduced later if measured requirements justify them.

44. Decision: Caching
Status

OPEN

Caching is not required for initial V1 implementation.

Possible future candidates:

gym settings
entitlement information
dashboard data
occupancy

Caching must be introduced only after identifying an actual performance requirement.

45. Decision: Background Jobs
Status

PROVISIONALLY DECIDED

Background processing may initially use a simple implementation.

A queue/worker architecture should be introduced when:

notification volume increases
retries become important
scheduled processing grows
exports become expensive
user requests become blocked by asynchronous work
46. Decision: Error Tracking
Status

OPEN

Sentry is a candidate because of the student benefit.

Selection criteria:

student/free pricing
privacy controls
Next.js compatibility
error quality
performance monitoring
retention
cost after student benefits
47. Decision: ORM
Status

OPEN

The project will use an ORM/query layer appropriate for PostgreSQL and TypeScript.

Candidates may include:

Prisma
Drizzle

The final choice must consider:

migrations
type safety
query flexibility
developer experience
performance
debugging
PostgreSQL support
long-term maintainability

The ORM decision must be made before implementation of the database layer.

48. Decision: Testing Framework
Status

OPEN

The project requires:

unit testing
integration testing
API testing
frontend testing
end-to-end testing

Candidate tools may include:

Vitest
Playwright
framework-native testing tools

The exact combination will be selected based on the final application stack.

49. Decision: API Style
Status

PROVISIONALLY DECIDED

The application will use a clear HTTP API boundary for client-to-server communication.

The API should provide:

authentication enforcement
authorization
validation
tenant scope
consistent errors
predictable responses

The exact API conventions will be finalized during implementation.

50. Decision: API Versioning
Status

OPEN

V1 does not require complex API versioning infrastructure.

If public/external APIs are introduced later, versioning strategy will be evaluated.

Internal application APIs should prioritize simplicity.

51. Decision: File Storage
Status

OPEN

V1 does not require significant cloud file storage.

If file storage becomes necessary, object storage should be preferred for large binary files.

Potential use cases:

progress photos
exports
gym assets
52. Decision: Infrastructure as Code
Status

OPEN

Infrastructure-as-code tooling is not required before infrastructure complexity justifies it.

If infrastructure grows sufficiently, a suitable IaC solution may be introduced.

The choice should consider:

project size
provider
maintainability
learning value
operational overhead
53. Decision: Secrets
Status

DECIDED

Secrets must:

remain outside Git
use environment variables/secret management
be separated by environment
never be logged
be rotated if exposed

Examples:

Database credentials
Authentication secrets
WhatsApp credentials
Cloud credentials
API keys
54. Decision: Source of Truth
Status

DECIDED

GitHub repository documentation and approved implementation are the primary engineering source of truth.

Priority:

Approved code
    ↓
Architecture / decision documents
    ↓
Feature specifications
    ↓
AI_CONTEXT
    ↓
AGENTS
    ↓
CURRENT-STATE
    ↓
Conversation context

If sources conflict, the conflict must be surfaced rather than silently resolved.

55. Decision: AI Tool Independence
Status

DECIDED

The project must not depend on one AI provider.

The repository is the persistent source of truth.

AI tools may include:

ChatGPT
Cursor
GitHub Copilot
other coding/review tools

AI tools are workers/reviewers/teachers.

The human remains responsible for:

architecture
approvals
security decisions
product decisions
final code review
56. Decision: AI Development Workflow
Status

DECIDED

The preferred workflow is:

Requirement
    ↓
Security analysis
    ↓
Architecture/data impact
    ↓
Implementation plan
    ↓
Human approval where required
    ↓
Implementation
    ↓
Tests
    ↓
Validation
    ↓
Diff review
    ↓
Documentation
    ↓
Current-state update

AI must not silently change major architectural decisions.

57. Decision: No Whole-SaaS Generation
Status

DECIDED

AI must not be instructed to generate the entire SaaS in one operation.

Development should proceed:

Feature
  ↓
Issue
  ↓
Plan
  ↓
Implementation
  ↓
Tests
  ↓
PR
  ↓
Review

This improves:

correctness
reviewability
security
learning
maintainability
58. Decision: Domain and Brand
Status

OPEN

The parent-company placeholder is:

XYZ

The product brand and production domain are not finalized.

Do not hard-code the temporary brand into architecture.

59. Decision: Production Domain Timing
Status

DECIDED

Do not purchase the final domain until:

product naming is sufficiently finalized
the product approaches real pilot usage
the domain choice is validated

Student domain benefits can then be evaluated.

60. Decision: Cost Strategy
Status

DECIDED

Initial development should minimize personal spending.

Target:

₹0 – ₹1,000/month

where practical.

Production infrastructure should increasingly be funded by customer revenue.

Free/student benefits should be used responsibly without creating poor architectural decisions.

61. Decision: Customer Money
Status

DECIDED

The SaaS should not hold gym membership money in V1.

Member payments go directly to the gym.

The SaaS records payment-related business state but does not act as the gym's payment custodian.

62. Decision: Data Integrity Priority
Status

DECIDED

For money, authorization, tenant isolation, and important business state:

Correctness > Convenience

Examples:

payment claim ≠ confirmed payment
frontend check ≠ authorization
phone number ≠ user identity
payment record ≠ membership renewal
QR code ≠ authentication
63. Decision: Scalability Philosophy
Status

DECIDED

Scale only when real workload demonstrates a need.

Preferred progression:

Correct implementation
      ↓
Measure
      ↓
Optimize queries
      ↓
Improve indexes
      ↓
Scale resources
      ↓
Introduce caching/background processing
      ↓
Split components only if justified
64. Decision: Security Philosophy
Status

DECIDED

Security must be designed into the system rather than added after implementation.

Every backend feature should consider:

Authentication
Authorization
Tenant isolation
Resource ownership
Input validation
Rate limiting
Replay/concurrency
Sensitive data
Auditability
65. Decision: What AI Must Ask Before Changing

AI must seek human approval before changing:

core architecture
database technology
authentication architecture
authorization model
tenant isolation
payment architecture
payment gateway
production infrastructure
major third-party services
microservice architecture
security controls
destructive database operations
66. Open Decisions Before Implementation

The following important decisions remain open and should be resolved before the corresponding implementation work:

Authentication provider
ORM/query layer
Exact testing framework
Production hosting provider
PostgreSQL hosting provider
Error tracking provider
Exact API conventions
Infrastructure-as-code approach if required
Production WhatsApp provider implementation
Final product/domain name

Open does not mean forgotten.

Open decisions should be resolved deliberately when their implementation becomes relevant.

67. Decision Record Format

Future major decisions should follow this format:

## Decision: <Name>

### Status

DECIDED / PROVISIONALLY DECIDED / OPEN / SUPERSEDED

### Context

Why does this decision matter?

### Decision

What was decided?

### Alternatives

What other options were considered?

### Rationale

Why was this option selected?

### Consequences

What does this decision make easier or harder?

### Revisit Conditions

Under what circumstances should this decision be reconsidered?
68. Superseded Decisions

When a decision changes, do not silently delete the old decision.

Instead:

mark the old decision as SUPERSEDED
record the new decision
explain the reason
identify affected documents
update implementation where required

This preserves architectural history.

69. Relationship With Other Documents

This document records decisions arising from:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
08-PWA.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md

When a technical decision changes, affected documents must also be reviewed.
