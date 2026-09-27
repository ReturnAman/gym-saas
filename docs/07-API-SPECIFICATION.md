# API Specification

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** API Definition  
**Scope:** V1

---

# 1. Purpose

This document defines the initial backend API contract for gym-saas.

It translates the approved:

- product requirements
- user flows
- system architecture
- database design
- authorization model
- security requirements

into application-level backend operations.

This document defines:

- API principles
- authentication requirements
- authorization requirements
- organization scoping
- endpoint structure
- request/response conventions
- validation
- errors
- pagination
- filtering
- idempotency
- state transitions

This document does not define:

- frontend component implementation
- database migrations
- cloud infrastructure
- provider-specific deployment configuration

---

# 2. API Architecture

The initial backend will be part of the Next.js application.

The API layer follows this conceptual structure:

```text
Request
  ↓
Authentication
  ↓
Input Validation
  ↓
Organization Context
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

The exact implementation may use:

Route Handlers
Server Actions
server-side application services

The choice should be consistent within each use case and documented in technical decisions.

3. API Design Principles

The API should prioritize:

Security
Tenant isolation
Correctness
Explicit contracts
Predictable errors
Strong validation
Idempotency where required
Simple implementation
Maintainability
Minimal data exposure
4. Authentication

Protected API operations require an authenticated user unless explicitly documented as public.

Authentication may be handled by Clerk or the approved authentication provider.

The backend must derive the authenticated application user from the authenticated session.

The client must not be trusted to provide:

userId
role
permissions

as proof of identity or authorization.

5. Authorization

After authentication, protected operations must verify:

Authenticated User
        ↓
Organization Membership
        ↓
Role / Permission
        ↓
Resource Scope
        ↓
Business Rules

Authorization is always enforced server-side.

Frontend visibility is not a security mechanism.

6. Organization Context

Tenant-scoped operations require an organization context.

The application may obtain organization context from:

URL structure
authenticated session context
request parameters
server-side routing

However, the backend must independently verify that the authenticated user belongs to the requested organization.

Conceptually:

requestedOrganizationId
        ↓
Does authenticated user belong to it?
        ↓
Does user have required permission?
        ↓
Proceed

Selecting an organization in the client does not grant access.

7. API Namespace

Initial API routes may follow:

/api/v1/...

The exact Next.js routing structure will be finalized during implementation.

The /v1 namespace provides a clear boundary for future API evolution.

8. General Request Rules

All protected requests must:

authenticate the user
validate input
resolve organization context
enforce authorization
enforce tenant scope
apply business rules
return safe errors

All IDs received from clients must be treated as untrusted input.

9. General Response Rules

Successful responses should return only the data required by the operation.

Responses should not unnecessarily expose:

internal database implementation details
secrets
authentication information
other users' private data
unrelated tenant data
internal provider credentials

Response structures should remain consistent across related endpoints.

10. Error Response

The API should use a predictable error structure.

Conceptually:

{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "The requested resource could not be found."
  }
}

The exact response format may evolve, but errors should contain:

stable machine-readable code
safe human-readable message

Sensitive internal details must not be exposed.

11. Error Categories

Initial error categories include:

UNAUTHENTICATED
FORBIDDEN
NOT_FOUND
VALIDATION_ERROR
CONFLICT
RATE_LIMITED
INVALID_STATE
INTERNAL_ERROR
EXTERNAL_SERVICE_ERROR

Exact HTTP status mapping will be finalized during implementation.

12. Resource Not Found vs Unauthorized Resource

When a resource does not belong to the user's authorized organization, the API should avoid revealing unnecessary information about the resource's existence.

The exact behavior should be consistent across resource types.

This helps reduce cross-tenant enumeration.

13. Validation

All externally supplied input must be validated on the backend.

Validation includes:

required fields
types
formats
string lengths
numeric ranges
enum values
date values
organization scope
resource relationships
state transitions

Client-side validation may duplicate simple checks for UX but cannot replace backend validation.

14. ID Format

Application identifiers should use stable identifiers appropriate for the selected database/application architecture.

The API must not rely on phone numbers as entity identifiers.

Clients should use entity IDs returned by the API.

IDs should not be assumed to grant authorization.

15. Authentication Endpoints

Authentication itself may be handled primarily by the authentication provider.

The application API may provide application-specific operations such as:

GET /api/v1/me
GET /api/v1/me/organizations

The application should not recreate authentication-provider functionality unnecessarily.

16. Current User
16.1 Get Current User
GET /api/v1/me
Authentication

Required.

Purpose

Return the authenticated application's relevant user information.

Response

Conceptually:

{
  "id": "user-id",
  "displayName": "User Name",
  "phoneNumber": "..."
}

Only appropriate fields should be returned.

17. User Organizations
17.1 List My Organizations
GET /api/v1/me/organizations
Authentication

Required.

Purpose

Return organizations the authenticated user belongs to.

Response

Conceptually:

{
  "organizations": [
    {
      "id": "organization-id",
      "name": "Gym Name",
      "role": "OWNER"
    }
  ]
}

Only organizations to which the user belongs may be returned.

18. Organization Endpoints
18.1 Get Organization
GET /api/v1/organizations/{organizationId}
Permission

Organization membership plus appropriate organization-view permission.

Rules
organization must exist
user must belong to organization
response must be tenant-scoped
18.2 Update Organization
PATCH /api/v1/organizations/{organizationId}
Permission

Appropriate organization-settings permission.

Request
{
  "name": "Example Gym",
  "phone": "...",
  "email": "...",
  "address": "..."
}

Only permitted fields may be updated.

The server must ignore or reject unauthorized fields.

19. Member Endpoints
19.1 List Members
GET /api/v1/organizations/{organizationId}/members
Permission

members.view

Supported Query Parameters

Potential parameters:

search
status
page
limit
sort
Rules

All returned members must belong to the requested organization.

19.2 Get Member
GET /api/v1/organizations/{organizationId}/members/{memberId}
Permission

members.view

Additional Rule

For a MEMBER, the requested member must be the authenticated user's own member record.

19.3 Create Member
POST /api/v1/organizations/{organizationId}/members
Permission

members.create

Request
{
  "name": "Member Name",
  "phoneNumber": "...",
  "membership": {
    "planId": "plan-id",
    "startDate": "YYYY-MM-DD"
  }
}
Rules
organization must be authorized
phone number must be validated
plan must belong to the same organization
membership must be created according to business rules
19.4 Update Member
PATCH /api/v1/organizations/{organizationId}/members/{memberId}
Permission

members.update

Request

Only permitted fields may be modified.

Rules
member must belong to organization
caller must have permission
sensitive identity changes may require additional validation
20. Member Onboarding Endpoints

The QR code identifies the organization.

The QR code itself does not authenticate the member.

20.1 Start Member Onboarding
POST /api/v1/member-onboarding/start
Request
{
  "organizationId": "organization-id",
  "phoneNumber": "..."
}
Purpose

Begin the member OTP onboarding process.

Rules
organization must be valid
phone number must be validated
system checks member eligibility
response should avoid membership enumeration
OTP rate limiting must apply
20.2 Complete Member Onboarding

The exact OTP verification operation may be handled by the authentication provider.

After successful authentication, the application must establish/link:

Authenticated User
        ↓
Member
        ↓
OrganizationMembership

The application must verify the relationship server-side.

21. Membership Plan Endpoints
21.1 List Plans
GET /api/v1/organizations/{organizationId}/membership-plans
Permission

Appropriate membership-plan view permission.

21.2 Create Plan
POST /api/v1/organizations/{organizationId}/membership-plans
Permission

membership-plans.create

Request
{
  "name": "Monthly",
  "duration": 30,
  "price": 1000
}

The exact duration representation will be finalized during implementation.

21.3 Update Plan
PATCH /api/v1/organizations/{organizationId}/membership-plans/{planId}
Permission

Appropriate plan-management permission.

Historical membership/payment data must not be silently corrupted by plan changes.

22. Membership Endpoints
22.1 Get Member Memberships
GET /api/v1/organizations/{organizationId}/members/{memberId}/memberships
Authorization

Caller must have appropriate organization permission.

A MEMBER may only access their own memberships.

22.2 Create Membership
POST /api/v1/organizations/{organizationId}/members/{memberId}/memberships
Permission

memberships.create

Request
{
  "planId": "plan-id",
  "startDate": "YYYY-MM-DD"
}

The server determines applicable business state.

22.3 Update Membership
PATCH /api/v1/organizations/{organizationId}/members/{memberId}/memberships/{membershipId}
Permission

memberships.update

The backend must validate the requested state transition.

22.4 Renew Membership
POST /api/v1/organizations/{organizationId}/members/{memberId}/memberships/{membershipId}/renew
Permission

memberships.renew

Rules

Membership renewal is separate from payment confirmation.

A payment claim must not automatically invoke this operation.

23. Attendance Endpoints
23.1 Check In
POST /api/v1/organizations/{organizationId}/attendance/check-in
Permission

attendance.create

For MEMBER:

organization membership must be valid
operation applies to their own member record
Request

The member identity should be derived from the authenticated user where possible.

The client must not be able to impersonate another member by simply providing a member ID.

23.2 Check Out
POST /api/v1/organizations/{organizationId}/attendance/check-out
Permission

attendance.create

The backend determines the relevant active session.

23.3 List Attendance
GET /api/v1/organizations/{organizationId}/attendance
Permission

attendance.view

Query Parameters

Potential parameters:

memberId
from
to
status
page
limit

All filters remain tenant-scoped.

23.4 Correct Attendance
PATCH /api/v1/organizations/{organizationId}/attendance/{attendanceId}
Permission

attendance.correct

The backend must validate the correction and record an audit event where appropriate.

24. Occupancy Endpoint
24.1 Current Occupancy
GET /api/v1/organizations/{organizationId}/occupancy
Permission

Appropriate occupancy-view permission.

Response

Conceptually:

{
  "currentOccupancy": 18
}

The value must be derived from active attendance sessions.

It must not rely on an independently editable occupancy counter.

25. Payment Endpoints

Payment operations are security-sensitive.

25.1 List Charges
GET /api/v1/organizations/{organizationId}/charges
Permission

payments.view

Members may only receive their own relevant charges.

25.2 Get Charge
GET /api/v1/organizations/{organizationId}/charges/{chargeId}
Authorization

Organization permission plus appropriate member/resource access.

26. Payment Claim Endpoints
26.1 Create Payment Claim
POST /api/v1/organizations/{organizationId}/charges/{chargeId}/payment-claims
Permission

For MEMBER:

only their own charge
valid organization membership
Request
{
  "claimedAmount": 1000,
  "paymentMethod": "UPI",
  "reference": "optional-reference"
}
Rules
claim is not a confirmed payment
amount must be validated
charge must belong to organization
member must have access to charge
duplicate/replay behavior must be handled
claim enters a pending state
27. Payment Claim Queue
27.1 List Pending Claims
GET /api/v1/organizations/{organizationId}/payment-claims
Permission

payments.confirm

Query Parameters

Potential parameters:

status
memberId
from
to
page
limit
28. Payment Confirmation
28.1 Confirm Payment
POST /api/v1/organizations/{organizationId}/payment-claims/{claimId}/confirm
Permission

payments.confirm

Request
{
  "actualAmount": 1000,
  "paymentMethod": "UPI",
  "reference": "optional-reference"
}
Rules

The backend must verify:

authenticated user
organization membership
payment-confirmation permission
claim organization
claim state
associated charge
member relationship
amount
duplicate confirmation state

The operation should be transactional where required.

29. Payment Rejection
29.1 Reject Payment Claim
POST /api/v1/organizations/{organizationId}/payment-claims/{claimId}/reject
Permission

payments.confirm

Request
{
  "reason": "Payment could not be verified."
}

The claim should move to an appropriate rejected state.

The exact state model will be finalized during implementation.

30. Payment History
30.1 List Payments
GET /api/v1/organizations/{organizationId}/payments
Permission

payments.view

Query Parameters

Potential parameters:

memberId
chargeId
from
to
status
page
limit

Members must only receive their own permitted payment history.

31. Payment Correction
31.1 Correct Payment

The exact endpoint will depend on the final reversal/adjustment model.

Potential structure:

POST /api/v1/organizations/{organizationId}/payments/{paymentId}/adjust
Permission

Restricted payment-management permission.

Rules

Confirmed payment history must remain auditable.

The operation must not silently overwrite the historical payment.

32. Announcements
32.1 List Announcements
GET /api/v1/organizations/{organizationId}/announcements
Authorization

Organization member.

Members receive only announcements for their organization.

32.2 Create Announcement
POST /api/v1/organizations/{organizationId}/announcements
Permission

announcements.create

Request
{
  "title": "Gym Holiday",
  "content": "The gym will be closed tomorrow."
}
32.3 Update Announcement
PATCH /api/v1/organizations/{organizationId}/announcements/{announcementId}
Permission

announcements.update

33. Staff Endpoints
33.1 List Staff
GET /api/v1/organizations/{organizationId}/staff
Permission

staff.view

33.2 Add Staff
POST /api/v1/organizations/{organizationId}/staff
Permission

staff.create

Request
{
  "phoneNumber": "...",
  "displayName": "...",
  "role": "STAFF"
}

The exact account-linking flow will depend on the authentication implementation.

33.3 Change Staff Role
PATCH /api/v1/organizations/{organizationId}/staff/{membershipId}/role
Permission

staff.roles.update

Request
{
  "role": "ADMIN"
}
Rules
caller must have role-management permission
target membership must belong to organization
role transition must be valid
owner protection rules apply
action should be audited
33.4 Remove Staff Access
POST /api/v1/organizations/{organizationId}/staff/{membershipId}/disable
Permission

staff.remove

The user account itself is not necessarily deleted.

Organization access may be disabled.

34. Subscription Endpoints
34.1 Get Subscription
GET /api/v1/organizations/{organizationId}/subscription
Permission

subscription.view

34.2 SaaS Subscription Activation

Manual administrative subscription verification may use a separate SaaS-admin API surface.

Conceptually:

POST /api/v1/admin/organizations/{organizationId}/subscription/activate
Authorization

SaaS administrator only.

Rules

The endpoint must not be available to ordinary gym users.

35. Notification Endpoints
35.1 List Notifications
GET /api/v1/organizations/{organizationId}/notifications
Authorization

Appropriate organization permission.

35.2 Notification Rules
GET /api/v1/organizations/{organizationId}/notification-rules
PATCH /api/v1/organizations/{organizationId}/notification-rules/{ruleId}
Authorization

Appropriate notification-management permission.

36. Export Endpoints
36.1 Create Export
POST /api/v1/organizations/{organizationId}/exports
Permission

exports.create

Request

Conceptually:

{
  "type": "MEMBERS"
}

Possible future types:

MEMBERS
ATTENDANCE
PAYMENTS
MEMBERSHIPS

The backend must restrict available export types according to authorization.

37. Dashboard Endpoint
37.1 Get Dashboard
GET /api/v1/organizations/{organizationId}/dashboard
Authorization

Appropriate dashboard permission.

Response May Include
member count
active memberships
expiring memberships
outstanding payment information
pending payment claims
attendance information
current occupancy
needs-attention items

Dashboard data must remain tenant-scoped.

38. Needs Attention Endpoint
GET /api/v1/organizations/{organizationId}/needs-attention
Authorization

Appropriate organization/dashboard permission.

Potential Items
membership_expiring
membership_expired
payment_pending_verification
payment_outstanding
inactive_member

The exact rules for generating these items will evolve with the product.

39. Pagination

Collection endpoints should support pagination when the dataset may become large.

Conceptually:

?page=1&limit=20

The exact pagination strategy may later use:

offset pagination
cursor pagination

V1 may use offset pagination for simplicity where appropriate.

Pagination limits must be bounded server-side.

The client must not be able to request arbitrarily large datasets.

40. Filtering

Filtering should be supported only for documented fields.

Examples:

status
memberId
from
to
search

The server must validate filter values.

Filters must not bypass tenant scope or authorization.

41. Sorting

Sorting should be restricted to explicitly supported fields.

The client must not be allowed to inject arbitrary database expressions into sorting parameters.

Example:

?sort=createdAt

is acceptable if createdAt is an approved sortable field.

42. Search

Member search may support:

name
phone number
other approved member identifiers

Search must remain organization-scoped.

Search responses must not reveal unrelated organizations.

Phone-number search should be appropriately protected against abuse.

43. Idempotency

Idempotency should be used where repeated requests could create duplicate business effects.

Potential examples:

check-in
payment confirmation
payment claim submission
subscription activation
notification dispatch

The exact mechanism may use:

unique database constraints
state checks
idempotency keys
transactions

The simplest correct mechanism should be chosen for each operation.

44. State Transition Validation

The API must not allow arbitrary state mutation.

Unsafe conceptual request:

{
  "paymentStatus": "PAID"
}

Instead, the API should expose business operations such as:

POST /payment-claims/{id}/confirm

This ensures that state changes pass through domain rules.

45. HTTP Method Principles

Where HTTP semantics are used:

GET
    Read data

POST
    Create or perform an explicit action

PATCH
    Partial update

DELETE
    Only when destructive deletion is explicitly supported

Business state transitions may use action endpoints where that makes the domain behavior clearer.

46. DELETE Policy

The API should not expose destructive DELETE endpoints merely because a database entity exists.

For important business entities, prefer:

disable
archive
cancel
deactivate
reversal
adjustment

when historical data must remain intact.

47. Date and Time

APIs must use an unambiguous date/time representation.

Date-only business values such as membership dates should be distinguished from timestamps.

Examples:

Membership date:
YYYY-MM-DD

Timestamp:
ISO 8601 timestamp

The exact timezone strategy must be documented in the technical decisions.

48. Money Representation

API monetary values must have an unambiguous representation.

The API must not use floating-point behavior that can introduce monetary precision errors.

The exact representation will be finalized during implementation.

49. API Security Checklist

Every protected endpoint should be reviewed against:

[ ] Authentication required?
[ ] Organization context required?
[ ] Organization membership verified?
[ ] Permission verified?
[ ] Resource belongs to organization?
[ ] Resource-level authorization required?
[ ] Subscription entitlement required?
[ ] Input validated?
[ ] State transition validated?
[ ] Replay/concurrency considered?
[ ] Rate limiting required?
[ ] Sensitive response fields minimized?
[ ] Safe errors?
[ ] Audit event required?
50. API Testing Requirements

Tests should cover:

Authentication
unauthenticated request rejected
invalid session rejected
Authorization
unauthorized role rejected
missing organization membership rejected
wrong organization rejected
wrong resource rejected
Tenant Isolation
manipulated organization ID rejected
cross-tenant member access rejected
cross-tenant payment access rejected
cross-tenant attendance access rejected
Validation
invalid input rejected
missing required fields rejected
invalid state transition rejected
invalid IDs rejected
Payments
member cannot confirm payment
unauthorized staff cannot confirm payment
duplicate confirmation prevented
partial payment handled correctly
Attendance
duplicate check-in prevented
member cannot check in as another member
cross-tenant attendance blocked
51. API Versioning

The initial API namespace is:

/api/v1

Breaking changes should not silently change the meaning of existing contracts.

API versioning should be used when compatibility requirements justify it.

The system should avoid premature version proliferation.

52. External Provider Boundaries

The API layer should not expose provider-specific implementation unnecessarily.

For example, application code should conceptually call:

NotificationService

rather than spreading provider-specific WhatsApp API calls throughout the product.

The same principle applies to authentication and storage integrations.

53. API and Database Separation

The API contract should represent business concepts.

It should not simply expose database tables directly.

For example:

Prefer:

POST /payment-claims/{id}/confirm

over:

PATCH /payments/{id}
{
  "status": "CONFIRMED"
}

when confirmation is a sensitive domain operation.

54. API Documentation Evolution

As implementation begins, every production API operation should have:

purpose
authentication requirement
authorization requirement
request schema
response schema
errors
state-transition rules
tenant-scope behavior
idempotency behavior where relevant

The API specification must be updated when approved behavior changes.

55. What We Will Not Do

The API will not:

trust client-provided roles
trust client-provided organization authorization
expose unrestricted database CRUD
expose arbitrary database sorting/filtering
allow members to confirm their own payments
allow arbitrary financial state mutation
allow cross-tenant resource access
expose secrets
return unnecessary sensitive information
create destructive endpoints without an approved business requirement
56. Relationship to Other Documents

This document depends on:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md

Related documents:

08-PWA.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
57. Document Status

Current status: Initial V1 API definition.

This document establishes the intended backend contract before implementation.

Exact framework-specific routing, schema validation library, ORM integration, and transport implementation must follow the architecture and security decisions documented elsewhere.

No production API implementation should begin until the relevant endpoint's authentication, authorization, validation, tenant-scope, data-integrity, and security requirements are sufficiently defined.
