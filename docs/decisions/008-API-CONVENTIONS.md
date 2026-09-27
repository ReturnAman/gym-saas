# ADR 008 — API Conventions

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Backend / API / Architecture

---

# 1. Context

gym-saas has a web/PWA frontend and server-side application logic.

The frontend needs to communicate with backend functionality for:

- Authentication-related operations
- Organizations
- Members
- Memberships
- Payments
- Attendance
- Announcements
- Notifications
- Subscriptions
- Dashboard data

The API layer must provide a predictable contract between the frontend and backend.

---

# 2. Goals

The API should be:

- Secure
- Predictable
- Tenant-aware
- Type-safe where practical
- Easy to test
- Easy to understand
- Consistent
- Suitable for a modular monolith
- Capable of evolving without unnecessary complexity

---

# 3. Initial API Direction

The initial application will use server-side API capabilities within the Next.js application.

The project does not require a separate backend service initially.

Conceptually:

```text
PWA / Browser
      ↓
Next.js API Layer
      ↓
Application / Domain Logic
      ↓
Database
The exact endpoint structure should be defined consistently across resources.

5. Resource-Oriented Design

API resources should represent meaningful domain concepts.

Examples:

organizations
members
memberships
payments
attendance
announcements
notifications
subscriptions

Avoid endpoints that expose internal implementation details.

Prefer:

POST /api/members

over:

POST /api/createMemberRecord
6. Authentication

Protected API requests must establish the authenticated application user.

The backend must not trust:

User ID supplied by the client
Role supplied by the client
Organization ownership supplied by the client
Permission supplied by the client

The authenticated identity must come from the server-side authentication mechanism.

7. Authorization

Authentication alone is insufficient.

Each protected operation must verify:

Authenticated user
Organization context
Organization membership
Role/permission
Resource ownership
Business rules

Conceptually:

Request
  ↓
Authentication
  ↓
Organization Membership
  ↓
Permission
  ↓
Resource Ownership
  ↓
Business Validation
  ↓
Operation
8. Tenant Isolation

Every tenant-owned resource must be scoped to an organization.

Example:

Member
  ↓
organizationId

The server must ensure that a request for a resource belongs to the organization in which the user is authorized to operate.

A client must not be able to bypass tenant isolation by changing an ID.

9. Organization Context

The API may receive an organization identifier through an appropriate route, session/context mechanism, or request structure.

Regardless of how it is supplied:

The server must verify that the authenticated user has access to that organization.

Example:

/api/organizations/{organizationId}/members

does not mean that the caller automatically has access to the organization.

10. Request Validation

All externally supplied input must be validated on the server.

Examples:

Required fields
String lengths
Numeric ranges
Date formats
Enumerated values
IDs
Payment amounts
Phone numbers
Pagination parameters
Filters

Frontend validation improves user experience.

Backend validation provides the security boundary.

11. Response Design

Responses should be predictable and consistent.

A successful response should contain only the information the client needs.

Do not expose:

Database credentials
Internal secrets
Authentication tokens
Internal provider credentials
Sensitive database details
Unnecessary personal information
12. Error Responses

API errors should be safe and predictable.

Common categories include:

400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
422 Unprocessable Entity
429 Too Many Requests
500 Internal Server Error

The exact use of each status should remain consistent.

13. Error Shape

The API should eventually use a consistent error structure.

Conceptually:

{
  "error": {
    "code": "MEMBERSHIP_NOT_FOUND",
    "message": "Membership could not be found."
  }
}

Internal implementation details should not be exposed.

For example, avoid returning:

PostgreSQL foreign key constraint failed...

to the client.

14. Error Codes

Where useful, stable application-level error codes should be used.

Examples:

UNAUTHORIZED
FORBIDDEN
MEMBER_NOT_FOUND
MEMBERSHIP_NOT_FOUND
PAYMENT_ALREADY_CONFIRMED
INVALID_PAYMENT_AMOUNT
DUPLICATE_ATTENDANCE
ORGANIZATION_ACCESS_DENIED

Error codes should describe meaningful application behavior rather than database implementation details.

15. HTTP Semantics

Use HTTP methods consistently.

GET

Retrieve data.

POST

Create a resource or perform an operation where creation semantics are appropriate.

PATCH

Partially update an existing resource.

DELETE

Delete/remove a resource when deletion is actually part of the domain.

Not every domain operation needs to be forced into CRUD.

16. State Transitions

Some operations represent business state transitions rather than simple updates.

Examples:

Payment Claim
     ↓
Confirm Payment

or:

Membership
     ↓
Renew

These operations may use explicit action-oriented endpoints where that makes the business operation clearer.

The API should not expose unrestricted state mutation such as:

PATCH payment
{
  "status": "PAID"
}

if doing so would allow clients to bypass payment business rules.

17. Payment API Rules

Payment operations require additional protection.

The client must not directly determine:

Confirmed payment state
Outstanding balance
Membership renewal state
Authorized confirmer

The server must calculate and validate these.

Example conceptual flow:

POST payment claim
        ↓
Claim Created

Owner verifies
        ↓
Server validates permission
        ↓
Server validates payment
        ↓
Confirmed Payment Created
18. Payment Idempotency

Financial operations should consider idempotency.

Example:

Request A
   ↓
Confirm Payment

Network timeout

Request A retried
   ↓
Confirm Payment

The system must avoid accidentally creating duplicate confirmed payment records.

The exact idempotency implementation will be defined during payment implementation.

19. Attendance API Rules

Attendance operations must prevent unintended duplicates.

The server must validate:

Authenticated user
Organization
Member relationship
Check-in eligibility
Duplicate state
Attendance timing/business rules

The client cannot simply submit:

status = CHECKED_IN

and expect the server to trust it.

20. Pagination

List endpoints should support pagination where result sets may grow.

Potential resources include:

Members
Payments
Attendance
Notifications
Announcements

The exact pagination strategy should be selected based on actual requirements.

Initial implementations may use straightforward page/limit semantics where appropriate.

21. Filtering

List endpoints may support filters such as:

status
search
date
membership
payment state

Filtering must be performed server-side.

The client should not be expected to download an entire tenant dataset and filter sensitive data locally.

22. Sorting

Sorting should be explicit and limited to supported fields.

The API must not blindly interpolate arbitrary client-provided SQL/order expressions.

Allowed sorting fields should be controlled by the backend.

23. Search

Member search may support fields such as:

Name
Phone
Membership status

Search must remain tenant-scoped.

The backend should apply appropriate normalization and validation.

24. Sensitive Data

API responses should follow data minimization.

For example:

A member list may not need to expose every internal field associated with the member.

Return only what the current role and screen require.

25. Role-Based Response Data

Different roles may receive different data.

For example:

OWNER
ADMIN
STAFF
TRAINER
MEMBER

The API should not simply return all data and rely on the frontend to hide fields.

26. API and Domain Separation

The API layer should not contain the entire business domain.

Prefer:

API Route
   ↓
Application Service
   ↓
Domain / Business Logic
   ↓
Database Access

This allows business rules to be tested independently of HTTP.

27. Database Access

API handlers should not contain large amounts of raw database logic.

Avoid:

Route
 ├── validation
 ├── authorization
 ├── database queries
 ├── payment calculation
 ├── notification creation
 └── response formatting

inside one giant function.

Prefer smaller layers with clear responsibilities.

28. Transactions

API operations that require multiple related database writes should use appropriate transaction boundaries.

Examples:

Owner onboarding
Payment confirmation
Membership renewal
Important state transitions

The transaction boundary belongs to the business operation, not merely to the HTTP request.

29. Concurrency

API operations must consider concurrent requests.

Important cases:

Duplicate attendance
Duplicate payment confirmation
Simultaneous membership updates
Notification retries

The backend must not assume requests arrive sequentially.

30. Rate Limiting

Rate limiting should be applied to sensitive or abuse-prone endpoints.

Potential targets:

OTP requests
OTP verification
Authentication-related operations
Public QR/member discovery endpoints
Expensive operations
Notification-triggering endpoints

The exact rate limits should be defined during implementation/security review.

31. Public vs Protected Endpoints

Endpoints should be explicitly classified.

Public / Limited

Potential examples:

Gym identification from permanent QR
Authenticated

Examples:

Member profile
Attendance
Membership
Payments
Staff/Owner Authorized

Examples:

Member management
Payment confirmation
Announcements
Staff management

Public endpoints must expose minimal information.

32. QR Endpoint Security

A permanent gym QR identifies an organization.

It must not authenticate the user.

A QR-related endpoint should expose only the information necessary to begin the onboarding/check-in flow.

Do not expose:

Member lists
Payment data
Staff data
Private gym information
33. Idempotency

Idempotency should be considered for operations where retries could create duplicate business state.

Potential examples:

Payment confirmation
Attendance
Notification creation
Membership renewal

The implementation should choose an appropriate mechanism for each operation.

34. API Versioning

API versioning remains open.

The project should not introduce complex versioning infrastructure before it is needed.

If versioning becomes necessary, it should be introduced consistently.

Possible future approaches include:

/api/v1/...

or another documented strategy.

35. Backward Compatibility

When APIs are consumed only by the application's own frontend, coordinated frontend/backend changes may be possible.

However, production deployments should avoid breaking existing clients unexpectedly.

If external consumers are introduced later, stronger compatibility/versioning requirements will apply.

36. API Documentation

The API contract should eventually be documented.

Potential approaches include:

OpenAPI
Generated API documentation
Typed contracts
Explicit endpoint documentation

The exact documentation mechanism remains open.

37. Type Safety

The project should use TypeScript throughout the application.

Where practical, API request and response types should be shared or generated in a controlled way.

Avoid duplicating the same type definitions manually across frontend and backend when a safer approach exists.

However, shared types must not cause inappropriate coupling between unrelated layers.

38. Serialization

API responses should use predictable serialization.

Special care should be taken with:

Dates
Timestamps
Decimal monetary values
IDs
Null values
Enumerations

Financial values must not suffer from inappropriate floating-point handling.

The exact money representation will be defined by the database/domain design.

39. Security Headers

Production API responses should use appropriate security headers through the hosting/application architecture.

Exact configuration belongs in:

06-SECURITY.md
10-DEVOPS.md
40. Logging

API logs should provide useful operational context without exposing sensitive data.

Do not log:

OTPs
Authentication tokens
Passwords
API secrets
Database credentials
Unnecessary payment information
41. Testing Requirements

Every protected API feature should have tests for:

Valid request
Invalid request
Unauthenticated request
Unauthorized role
Wrong organization
Wrong resource
Invalid state transition
Relevant concurrency behavior

Critical financial and security operations require especially strong coverage.

42. API Performance

The initial API should prioritize:

Correctness
Clear queries
Appropriate indexes
Reasonable response sizes

Do not prematurely introduce:

GraphQL
Multiple backend services
Complex caching
Distributed systems

Performance optimization should be evidence-driven.

43. API Security Checklist

Before considering an endpoint complete:

[ ] Authentication checked
[ ] Organization context checked
[ ] Membership checked
[ ] Permission checked
[ ] Resource ownership checked
[ ] Input validated
[ ] Tenant isolation verified
[ ] Sensitive fields excluded
[ ] Business rules enforced
[ ] State transitions validated
[ ] Concurrency considered
[ ] Rate limiting considered
[ ] Errors sanitized
[ ] Tests added
44. Decision
Current Status

Resource-oriented HTTP APIs within the Next.js modular monolith are the initial API direction.

The API will prioritize:

Server-side authentication
Server-side authorization
Tenant isolation
Input validation
Explicit business rules
Safe errors
Predictable responses
Appropriate transactions
Idempotency for critical operations
Minimal unnecessary complexity
45. Consequences
Positive
Simple initial architecture
Easy frontend integration
Familiar HTTP semantics
Good testability
Clear security boundaries
Easy incremental development
No separate API service required
Trade-offs
API conventions must be maintained consistently
Future external consumers may require stronger versioning
Some complex operations require explicit action endpoints
Type sharing must be managed carefully
46. Future Reassessment

Reassess API architecture when:

External API consumers are introduced
Mobile native applications are introduced
API traffic grows significantly
Versioning becomes necessary
Backend deployment needs diverge from frontend deployment
A separate service boundary becomes justified
47. Related Documents
03-SYSTEM-ARCHITECTURE.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
12-SCALABILITY.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
48. Approval

Decision Owner: Project Owner

Status: Proposed

API Style: Resource-oriented HTTP

Backend: Next.js server-side/API

API Versioning: TBD

API Documentation: TBD

Approval Date: N/A
