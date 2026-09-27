# System Architecture

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** Architecture Definition  
**Scope:** V1 and planned evolution

---

# 1. Purpose

This document defines the technical architecture of gym-saas.

It translates the approved product requirements and user flows into a concrete system structure.

This document defines:

- application boundaries
- frontend/backend responsibilities
- authentication and authorization boundaries
- multi-tenant architecture
- data architecture
- domain boundaries
- external service boundaries
- notification architecture
- payment architecture
- deployment principles
- scalability principles
- reliability and security boundaries

This document does not define every database column, API endpoint, UI component, or infrastructure configuration.

Those details belong in the appropriate technical documents.

---

# 2. Architectural Goals

The system should prioritize:

1. Security
2. Tenant isolation
3. Correctness
4. Data integrity
5. Maintainability
6. Simplicity
7. Testability
8. Clear domain boundaries
9. Reasonable operating cost
10. Ability to evolve without premature complexity

The system should be capable of supporting a real SaaS product while remaining simple enough for a small engineering team to operate.

---

# 3. Architectural Principles

## 3.1 Multi-Tenant by Design

The product is a multi-tenant SaaS application.

Each gym organization is an independent tenant.

Tenant isolation is mandatory from the beginning.

The system must never depend on frontend behavior to enforce tenant isolation.

---

## 3.2 Authentication and Authorization Are Separate

Authentication answers:

> Who is this user?

Authorization answers:

> What may this user do in this organization?

The authentication provider may establish identity.

The application remains responsible for organization membership, roles, permissions, and resource authorization.

---

## 3.3 Backend Is the Security Boundary

Frontend checks are for user experience.

The backend must independently enforce:

- authentication
- organization membership
- roles
- permissions
- resource ownership
- tenant isolation
- state transitions
- sensitive operations

No security-sensitive operation should rely only on client-side validation.

---

## 3.4 Single Source of Truth

Important business state should have one authoritative source.

Examples:

- membership state comes from membership records
- payment state comes from payment/charge records
- outstanding balance is derived from financial records
- organization access comes from organization membership
- active occupancy comes from attendance/session state

Duplicate manually maintained state should be avoided where possible.

---

## 3.5 Simple Architecture First

The initial system should use a modular monolithic architecture.

We will not start with microservices.

The system should have clear internal domain boundaries while remaining deployable as one application.

---

## 3.6 Replaceable External Providers

External providers should be isolated behind clear application boundaries when there is a realistic possibility of replacement.

Important provider boundaries include:

- authentication
- WhatsApp/notifications
- storage
- hosting/infrastructure

Provider-specific code should not leak throughout the domain layer.

---

# 4. High-Level Architecture

The initial architecture consists of:

```text
                    ┌───────────────────────┐
                    │       Users           │
                    │                       │
                    │ Owners / Staff        │
                    │ Members               │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │       PWA / Web       │
                    │                       │
                    │ Next.js + TypeScript  │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Application Backend   │
                    │                       │
                    │ Auth / Authorization  │
                    │ Domain Logic          │
                    │ API / Server Actions  │
                    │ Validation            │
                    └───────┬─────┬─────────┘
                            │     │
                ┌───────────┘     └──────────────┐
                ▼                                ▼
      ┌───────────────────┐            ┌────────────────────┐
      │   PostgreSQL      │            │ External Providers │
      │                   │            │                    │
      │ Organizations     │            │ Auth               │
      │ Users             │            │ WhatsApp           │
      │ Memberships       │            │ Storage             │
      │ Members           │            │ Other services      │
      │ Attendance        │            │                    │
      │ Payments          │            └────────────────────┘
      │ Subscriptions     │
      │ Notifications     │
      └───────────────────┘
5. Application Architecture

The initial application will use a modular monolith.

The application should be logically separated into domains even though the domains run within the same deployed application.

Initial domain areas include:

Authentication
Authorization
Organizations
Users
Members
Memberships
Attendance
Payments
Subscriptions
Notifications
Announcements
Exports
Dashboard

These domains should communicate through explicit application/domain boundaries rather than uncontrolled cross-module access.

6. Frontend Architecture
6.1 Technology

Initial frontend technology:

Next.js
TypeScript
React
PWA capabilities

The frontend should be designed primarily for mobile usage because members are expected to access the product frequently from phones.

6.2 Frontend Responsibilities

The frontend is responsible for:

rendering UI
navigation
collecting user input
displaying application state
client-side usability validation
loading/error states
responsive behavior
PWA behavior
presenting authorized functionality

The frontend is not responsible for enforcing security.

6.3 Frontend Business Logic

Simple presentation logic may exist in the frontend.

Security-sensitive business rules must remain on the backend.

Examples of backend-owned rules:

whether a user can access a gym
whether a member can check in
whether staff can confirm a payment
whether a payment claim can transition state
whether a user can modify another member
whether a user can access an organization
7. Backend Architecture

The backend will initially be part of the same Next.js application.

The backend should contain clear separation between:

Request / Transport
        ↓
Validation
        ↓
Authentication
        ↓
Authorization
        ↓
Application Service
        ↓
Domain Logic
        ↓
Data Access
        ↓
PostgreSQL

The exact implementation pattern may use route handlers, server actions, or other appropriate Next.js server mechanisms.

The choice should be documented in the API specification and technical decisions.

8. Domain Layer

Business rules should not be scattered across UI components.

Important domain behavior should be centralized in appropriate application/domain modules.

Examples:

MemberService
MembershipService
AttendanceService
PaymentService
SubscriptionService
NotificationService

Names are illustrative.

The implementation should use clear names based on actual responsibilities.

9. Database Architecture
9.1 Database

The primary database will be:

PostgreSQL

PostgreSQL is the authoritative persistent data store for core application data.

9.2 Why PostgreSQL

The product contains strongly related business entities including:

organizations
users
organization memberships
members
membership plans
memberships
charges
payments
attendance
subscriptions
notifications

These relationships and financial/state transitions benefit from relational constraints and transactional behavior.

9.3 Database as Source of Truth

Core business state should be persisted in PostgreSQL.

External providers should not become the application's authoritative source of business state.

For example:

WhatsApp delivery status is external information but notification records belong to the application.
Authentication identity may be managed by an external provider but organization membership belongs to the application.
Payment made directly to the gym must be represented by application payment records after verification.
10. Multi-Tenant Architecture
10.1 Tenant

An organization represents a gym/business tenant.

Tenant-scoped data should contain an explicit relationship to the organization where appropriate.

10.2 Organization Membership

Users access organizations through organization memberships.

Conceptually:

User
 │
 ├── Organization Membership → Organization A
 │                              Role: OWNER
 │
 └── Organization Membership → Organization B
                                Role: STAFF

A user account and organization membership must remain separate concepts.

10.3 Tenant Access

For a protected tenant-scoped request:

Authenticated User
        ↓
Determine Organization
        ↓
Verify Organization Membership
        ↓
Verify Role / Permission
        ↓
Verify Resource Scope
        ↓
Perform Operation
10.4 Tenant Isolation

Every relevant query and mutation must be appropriately scoped to the organization.

Tenant isolation must be enforced in backend application logic and supported by database design.

The database design must make accidental cross-tenant access difficult.

11. Identity Architecture

The system separates:

Authentication Identity
        ↓
Application User
        ↓
Organization Membership
        ↓
Role / Permission

Phone number is not the primary identity key for application entities.

Phone numbers may be used for:

OTP delivery
member discovery
owner authentication
staff/member onboarding

but should not be used as the fundamental relational identity key.

12. Authentication Architecture

The initial product may use Clerk as the authentication provider.

The authentication provider is responsible for authentication mechanisms such as:

OTP delivery/verification
authentication sessions
identity management

The application remains responsible for:

user-to-organization relationships
roles
permissions
tenant isolation
resource authorization
application-specific account state

The application must not assume:

Authenticated = Authorized.

13. Authorization Architecture

Authorization is application-owned.

The authorization system should evaluate:

User
+
Organization
+
Membership
+
Role / Permission
+
Resource
+
Action

Examples:

Can this user view this member?

Can this user edit this member?

Can this user confirm this payment?

Can this user export organization data?

Can this user manage staff?

Every sensitive operation must be authorized server-side.

The detailed role and permission model will be defined in:

05-AUTHORIZATION.md

14. Member Onboarding Architecture

The member onboarding flow is:

Gym QR
   ↓
Identify Organization
   ↓
Member enters phone
   ↓
Backend checks member association
   ↓
OTP
   ↓
OTP verification
   ↓
User account
   ↓
Organization Membership
   ↓
Member Experience

The QR code identifies the organization.

The QR code does not authenticate the member.

Phone number is used for discovery.

OTP establishes control of the phone number.

Organization membership establishes application authorization.

15. Attendance Architecture

Attendance is represented as application data rather than only a UI event.

Conceptually:

Member
   ↓
Check In
   ↓
Attendance Record / Active Session
   ↓
Check Out
   ↓
Completed Attendance

Attendance data supports:

attendance history
attendance percentage
streak calculations
occupancy
analytics
future engagement features

Duplicate attendance creation must be prevented.

Concurrency behavior must be defined in the database and API design.

16. Live Occupancy Architecture

Live occupancy should be derived from active attendance sessions.

Conceptually:

Active Attendance Sessions
          ↓
      Count Active
          ↓
    Current Occupancy

The system should avoid maintaining an independently editable occupancy number as the primary source of truth.

This reduces state synchronization problems.

17. Membership Architecture

Membership represents the member's relationship with a gym's membership offering.

Membership should be separate from:

user identity
payment records
payment claims
attendance records

Membership information may include:

plan
start date
expiry date
status
applicable charge

Exact fields will be defined in the database design.

18. Payment Architecture
18.1 V1 SaaS Subscription Payment

Gym owners pay the SaaS manually using supported UPI/bank payment methods.

No Razorpay integration is required for V1.

Subscription activation is performed after administrative verification.

18.2 Member-to-Gym Payment

Member payments are made directly to the gym.

The SaaS does not hold or transfer those funds.

The application records the financial state relevant to gym operations.

18.3 Payment Flow
Member
   ↓
View Amount Due
   ↓
Pay Gym Directly
   ↓
"I Have Paid"
   ↓
Payment Claim
   ↓
Verification Queue
   ↓
Authorized Staff
   ↓
Confirm Actual Amount
   ↓
Confirmed Payment
   ↓
Outstanding Recalculated
18.4 Payment Domain Separation

The following concepts remain separate:

Charge
Payment Claim
Confirmed Payment
Membership Renewal

A payment claim is not a confirmed payment.

A confirmed payment is not automatically a membership renewal.

18.5 Payment Balance

Outstanding amount is derived from:

Charge Total - Sum of Confirmed Payments

The system should not rely on a manually editable balance field as the authoritative source.

19. Subscription Architecture

SaaS subscription state is separate from organization data.

Conceptually:

Organization
      ↓
Subscription
      ↓
Plan
      ↓
Entitlements
      ↓
Feature / Action Access

Feature availability should be controlled through entitlement logic rather than scattered checks such as:

if trial

throughout the application.

20. Notification Architecture

Notifications should follow a provider-independent model.

Conceptually:

Business Event
      ↓
Notification Rule
      ↓
Notification Job
      ↓
Queue / Worker
      ↓
Notification Provider
      ↓
Delivery Status

The initial implementation may be simpler if the V1 scale does not require a dedicated queue infrastructure.

However, the domain boundary should allow asynchronous processing to be introduced later.

21. WhatsApp Architecture

The intended production direction is a centralized SaaS WhatsApp sender.

The architecture should support personalized messages for each:

organization
member
membership
payment
notification event

Example:

Organization A
   ↓
Member Rahul
   ↓
Membership expires in 3 days
   ↓
Personalized notification

The centralized sender does not mean that all users receive identical messages.

Messages should identify the relevant gym and member context where appropriate.

WhatsApp-specific implementation must remain isolated behind a notification provider boundary.

WhatsApp must not be used as the authentication system.

22. WhatsApp Provider Strategy

The production foundation should use the appropriate official Meta WhatsApp API approach.

Unofficial or reverse-engineered WhatsApp gateways should not become the production dependency for the SaaS.

Any experimental provider should remain isolated behind the notification provider interface.

The notification domain should not depend directly on provider-specific APIs.

23. Background Processing

Some operations may eventually require asynchronous processing.

Examples:

WhatsApp notifications
reminder generation
large CSV exports
analytics aggregation
scheduled jobs

The V1 system should not introduce distributed infrastructure without a demonstrated need.

Initial synchronous implementation is acceptable where scale and reliability requirements permit it.

The architecture should leave a clear path to background workers.

24. File and Object Storage

Core structured application data belongs in PostgreSQL.

Files and objects should use appropriate object storage when required.

Potential future examples:

exported CSV files
gym assets
member progress photos
optional media backups

Member progress photos are intended to be local-first initially.

Photos should not automatically become cloud-stored application data unless the feature explicitly requires it.

25. PWA Architecture

The member experience should be installable as a Progressive Web App.

The PWA should prioritize:

mobile usability
fast loading
responsive layouts
appropriate offline behavior
installability
reliable navigation

Offline functionality should not bypass server-side authorization or create unsafe financial/attendance state.

Offline support should be introduced carefully for operations where consistency can be maintained.

26. QR Architecture

The gym's permanent QR code should contain or reference enough information to identify the organization.

The QR must not contain:

authentication credentials
secret tokens
privileged access credentials
reusable authentication sessions

Possession of a QR code must not grant privileged access.

27. API Architecture

The backend API should be organized around business capabilities rather than database tables alone.

Examples of capability areas:

/auth
/organizations
/staff
/members
/memberships
/attendance
/payments
/subscriptions
/notifications
/announcements
/exports

Exact endpoint naming and transport conventions will be defined in:

07-API-SPECIFICATION.md

28. Validation Architecture

Input validation should occur at the backend boundary.

Validation should cover:

required fields
data formats
numeric limits
state transitions
organization scope
role permissions
business constraints

Client-side validation may duplicate basic checks for better UX but cannot replace server-side validation.

29. Transaction Boundaries

Database transactions should be used when multiple related state changes must succeed or fail together.

Examples may include:

organization creation + owner membership
payment confirmation + related financial state
membership state changes involving multiple records
attendance state changes where consistency requires atomicity

Transactions should be used deliberately rather than everywhere.

30. Concurrency

The system must account for concurrent requests for operations such as:

duplicate check-ins
payment verification
membership updates
staff role changes
subscription activation

Correctness must not depend on the assumption that only one request can arrive at a time.

The exact database constraints, locking, idempotency, and transaction strategies will be defined in later technical documents.

31. Error Handling

The backend should return predictable application-level errors.

Errors should:

avoid leaking sensitive internal information
avoid exposing database internals
provide useful client-facing information
distinguish validation failures from authorization failures where appropriate
be safe to log

Sensitive values such as OTPs, tokens, API keys, and secrets must never be logged.

32. Auditability

Security-sensitive and business-critical operations should be auditable where appropriate.

Potential audit events include:

role changes
staff access changes
payment confirmation
payment corrections
subscription activation
important membership changes
security-sensitive account recovery

Audit records should identify the actor and relevant organization/resource context where appropriate.

33. Observability

The system should eventually provide:

structured application logs
error tracking
basic performance monitoring
health checks
relevant operational metrics

Sensitive user data should not be unnecessarily included in logs.

Sentry or another appropriate service may be used for error monitoring.

Observability implementation will be defined in:

11-OBSERVABILITY.md

34. Environment Separation

The system should maintain clear separation between environments.

At minimum:

Development
Test
Production

Production credentials must never be committed to the repository.

Environment variables should be used for secrets and environment-specific configuration.

35. Secrets Management

Secrets may include:

authentication provider secrets
WhatsApp credentials
database credentials
cloud credentials
API keys
signing secrets
encryption keys

Secrets must:

never be committed to Git
never appear in source code
never appear in documentation
never appear in logs
be provided through secure environment configuration

.env.example may contain variable names but never real secrets.

36. Deployment Architecture

The initial system should use a simple managed deployment architecture.

Conceptually:

GitHub
   ↓
CI/CD
   ↓
Application Deployment
   ↓
Next.js Application
   ↓
Managed PostgreSQL
   ↓
External Providers

The exact hosting provider will be selected in the infrastructure and technical-decision documents.

Provider choice should not unnecessarily affect domain architecture.

37. CI/CD Architecture

The repository should use automated checks for changes before production deployment.

Initial checks should include:

formatting
linting
type checking
automated tests
build validation

Production deployment should not occur from unreviewed or failing changes.

38. Scalability Strategy

The initial system should optimize for simplicity rather than hypothetical large-scale traffic.

Expected early architecture:

One application
+
Managed PostgreSQL
+
External managed services

If usage grows, the architecture may evolve through:

query/index optimization
database optimization
caching where justified
background jobs
object storage
horizontal application scaling
dedicated workers
service extraction only when justified

Microservices are not a V1 requirement.

39. Cost Strategy

The initial architecture should prioritize low operating cost while preserving production correctness.

Student benefits may be used where appropriate.

Examples include:

GitHub Student benefits
Azure student resources
MongoDB credits where relevant
Clerk student benefits
Sentry student benefits
other eligible development resources

Benefits should not determine architecture by themselves.

A technology should be selected because it is appropriate for the product first.

40. External Service Boundaries

The initial external dependencies may include:

Capability	Initial Direction
Authentication	Clerk
Database	PostgreSQL
WhatsApp	Official Meta API direction
Error monitoring	Sentry or equivalent
Hosting	Managed cloud platform
Source control	GitHub
File storage	Managed object storage when needed

These choices remain subject to the technical decision process and available student benefits.

41. What We Will Not Build Initially

The following are intentionally excluded from the initial architecture:

microservices
Kubernetes
complex event-driven infrastructure
custom authentication system
custom OTP delivery infrastructure
payment gateway for SaaS subscription
payment gateway for member-to-gym payments
unofficial WhatsApp production dependency
large-scale analytics infrastructure
complex recommendation systems
full e-commerce platform
native iOS/Android applications
automatic cloud storage of member progress photos
unnecessary caching infrastructure

These may be reconsidered only when a demonstrated requirement exists.

42. Architecture Decision Boundaries

The following decisions require explicit documentation before implementation:

database technology
authentication provider
authorization model
tenant isolation strategy
payment architecture
WhatsApp provider
production hosting
storage strategy
background processing strategy
major third-party services
security-sensitive architecture changes

The application should not silently replace an approved architectural decision.

43. Architecture Evolution

The architecture is expected to evolve as the product gains real usage.

Changes should be made when supported by:

actual product requirements
operational evidence
security requirements
performance requirements
maintainability concerns
cost considerations

Architecture should not be changed merely because a newer technology is available.

44. Relationship to Other Documents

This document provides the high-level system architecture.

Related documents:

00-PROJECT-CHARTER.md — project direction
01-PRODUCT-REQUIREMENTS.md — product behavior
02-USER-FLOWS.md — user journeys
04-DATABASE-DESIGN.md — database structure
05-AUTHORIZATION.md — roles and permissions
06-SECURITY.md — security controls
07-API-SPECIFICATION.md — API contracts
08-PWA.md — PWA architecture
09-TESTING.md — testing strategy
10-DEVOPS.md — deployment and operations
11-OBSERVABILITY.md — monitoring and error tracking
12-SCALABILITY.md — scaling strategy
13-COST-INFRASTRUCTURE.md — infrastructure and cost
14-TECH-DECISIONS.md — explicit technology decisions
45. Document Status

Current status: Initial architecture definition.

This document establishes the initial architectural direction.

Detailed implementation decisions must be documented in the relevant technical documents before the corresponding feature is implemented.

No production application implementation should begin until the required architecture and security decisions have been documented sufficiently for the feature being implemented.


### After pasting

Commit it separately:

```text
docs: define system architecture
