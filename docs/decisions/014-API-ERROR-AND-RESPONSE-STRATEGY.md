# ADR 014: API Error and Response Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: API / Backend / Error Handling
- Related:
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `09-TESTING.md`
  - `decisions/008-API-CONVENTIONS.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`

---

## 1. Context

The gym SaaS API will be used by:

- owner interfaces
- staff interfaces
- trainer interfaces
- member interfaces
- the PWA
- background jobs
- future integrations

The API must provide predictable behavior for:

- successful requests
- validation failures
- authentication failures
- authorization failures
- missing resources
- state conflicts
- rate limits
- database failures
- external-provider failures
- unexpected server errors

Inconsistent error formats make frontend development, testing, debugging, and AI-assisted development harder.

The API must also avoid exposing:

- database internals
- stack traces
- secrets
- authentication information
- unnecessary personal information
- tenant-specific information through unsafe errors

---

# 2. Decision

The API will use a consistent resource-oriented HTTP response strategy.

The system will:

1. use appropriate HTTP status codes
2. return predictable JSON responses
3. use stable machine-readable error codes
4. provide safe human-readable messages
5. include validation details when appropriate
6. avoid leaking internal implementation details
7. distinguish authentication from authorization
8. distinguish missing resources from business-state conflicts
9. preserve generic responses where enumeration risk exists
10. include request/correlation identifiers where useful for debugging
11. keep frontend error handling separate from backend error classification

---

# 3. Successful Response Principles

Successful responses should communicate the result clearly.

Typical status codes:

```text
200 OK
201 Created
204 No Content
Examples:

GET resource
→ 200
POST create resource
→ 201
DELETE resource with no response body
→ 204

The API should not return 200 OK for every situation simply because the request reached the server.

HTTP status codes should communicate the broad result category.

4. Error Categories

Errors should be classified into meaningful categories.

Initial categories include:

VALIDATION_ERROR
AUTHENTICATION_REQUIRED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
INVALID_STATE
DEPENDENCY_ERROR
INTERNAL_ERROR

The exact error-code list may evolve.

The goal is stable semantics rather than a huge error taxonomy.

5. Error Response Shape

The API should use a predictable structure.

Conceptually:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {}
  }
}

For request tracing, an optional request identifier may be included:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong.",
    "requestId": "..."
  }
}

The exact casing and serialization convention must remain consistent with the final API implementation.

6. Error Code

The code identifies the machine-readable category.

Example:

PAYMENT_CLAIM_ALREADY_PROCESSED

The frontend should primarily use error codes for behavior.

It should not parse the human-readable message:

"Payment claim has already been processed."

to determine what happened.

7. Human-Readable Message

The message should be understandable to the client/user.

Good:

This payment claim has already been processed.

Bad:

Prisma P2025: Record to update not found.

The user-facing message must never expose ORM/database internals.

8. Validation Errors

Invalid input should normally return:

400 Bad Request

or another appropriate validation status according to the final API convention.

Example:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {
      "phone": "Enter a valid phone number.",
      "amount": "Amount must be greater than zero."
    }
  }
}

Validation errors should identify fields where doing so is safe and useful.

9. Authentication Errors

If the request does not contain valid authentication:

401 Unauthorized

Example:

{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Authentication is required."
  }
}

Do not return:

"Your Clerk token is invalid because ..."

or expose provider-specific authentication details unnecessarily.

10. Authorization Errors

If the user is authenticated but not permitted to perform an operation:

403 Forbidden

Example:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}

Authorization must always be enforced server-side.

Frontend visibility checks are not authorization.

11. Resource Not Found

If a requested resource does not exist, use:

404 Not Found

Example:

{
  "error": {
    "code": "MEMBER_NOT_FOUND",
    "message": "Member not found."
  }
}

However, resource existence must sometimes be intentionally hidden.

12. Enumeration Protection

Authentication and membership flows can reveal sensitive information if errors distinguish:

phone belongs to a member

from:

phone does not belong to a member

Where enumeration is a concern, use intentionally generic responses.

Example:

If phone is eligible:
    OTP sent

If phone is not eligible:
    same outward response

The API must not allow attackers to discover the gym's member list by repeatedly submitting phone numbers.

13. Conflict Errors

Use:

409 Conflict

when the request conflicts with the current resource state.

Examples:

payment claim already processed
member number already exists
duplicate organization membership
resource version conflict

Example:

{
  "error": {
    "code": "PAYMENT_CLAIM_ALREADY_PROCESSED",
    "message": "This payment claim has already been processed."
  }
}
14. Invalid State Transitions

Business-state conflicts should have explicit errors.

Example:

PENDING
   ↓
APPROVED

A request attempting:

APPROVED
   ↓
APPROVED

may return:

409 Conflict

with:

PAYMENT_CLAIM_ALREADY_PROCESSED

The API should communicate the domain conflict rather than expose a generic database failure.

15. Rate Limiting

Rate-limited requests should return:

429 Too Many Requests

Example:

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}

This is especially important for:

OTP requests
OTP verification
login attempts
member discovery
public QR endpoints
notification operations
expensive APIs
16. Retry Information

Where useful, rate-limit responses may include retry information.

Example:

Retry-After

The exact implementation depends on the infrastructure.

Do not encourage aggressive client retries.

17. Dependency Failures

External services may fail.

Examples:

WhatsApp provider
authentication provider
email provider
payment provider in future

The API should not expose raw provider errors.

Bad:

Meta error #131026: ...

Better:

{
  "error": {
    "code": "DEPENDENCY_ERROR",
    "message": "The notification service is temporarily unavailable."
  }
}

Internal logs may contain provider diagnostics when safe.

18. Internal Server Errors

Unexpected failures should return:

500 Internal Server Error

with a generic response.

Example:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again."
  }
}

Never expose:

stack traces
SQL queries
database connection strings
filesystem paths
environment variables
secrets
provider credentials
internal architecture details
19. Request ID

Requests should have a request/correlation identifier where practical.

Example:

X-Request-Id: abc123

The application may generate one if the incoming request does not provide an acceptable identifier.

The identifier can be included in safe error responses:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong.",
    "requestId": "abc123"
  }
}

This allows support/debugging workflows without exposing internal diagnostics.

20. Request ID Security

Request IDs must not contain:

user phone numbers
authentication tokens
payment information
secrets
predictable sensitive information

They should be opaque.

21. Error Logging

When an unexpected error occurs, the server should log enough information to diagnose it.

Useful information may include:

requestId
route
method
timestamp
authenticated user ID
organization ID where appropriate
error category
safe stack trace

Logs must follow the security rules in AGENTS.md.

Do not log:

OTP
password
access token
API key
secret
full sensitive payment data
22. Frontend Error Handling

The frontend should not have to understand every backend implementation detail.

Instead, it should map stable error codes to UI behavior.

Example:

PAYMENT_CLAIM_ALREADY_PROCESSED
        ↓
show:
"This payment has already been processed."

The frontend should not depend on:

HTTP 500

meaning a specific business condition.

Business conditions should have explicit codes.

23. Error Messages and Localization

Initial V1 does not require a full localization system.

However, error codes should remain stable so presentation text can change later.

For example:

MEMBER_NOT_FOUND

can eventually map to different languages without changing backend semantics.

24. Validation Location

Input validation should happen at the API boundary.

Examples:

phone format
amount > 0
required name
valid dates
valid enum values

However, validation does not replace authorization or database constraints.

The layers serve different purposes:

API validation
    ↓
business rules
    ↓
authorization
    ↓
database constraints

The exact ordering may vary by operation, but all relevant protections must exist.

25. Authorization Error vs Not Found

The application must deliberately decide whether an unauthorized resource should return:

403

or:

404

depending on information-disclosure risk and endpoint semantics.

For sensitive resources, returning 404 may prevent attackers from learning that the resource exists.

The decision should be consistent for similar endpoints.

26. Member-Specific Access

For member APIs, the backend must verify that the requested resource belongs to the authenticated member or authorized organization.

Example:

Member A requests Member B's payment

The server must reject the request.

The response should not expose:

Member B's name
phone
payment amount
membership status

before authorization succeeds.

27. Tenant-Aware Errors

Errors must not accidentally leak another organization's information.

Bad:

"Member 8f... exists, but belongs to Organization XYZ."

Better:

"Member not found."

or an appropriate authorization response.

Tenant isolation applies to error behavior as well as successful responses.

28. Business Rule Errors

Business rules should have explicit machine-readable codes when the client needs to react differently.

Examples:

MEMBERSHIP_EXPIRED
PAYMENT_ALREADY_CONFIRMED
PAYMENT_CLAIM_ALREADY_PROCESSED
TRIAL_EXPIRED
FEATURE_NOT_AVAILABLE
MEMBER_NOT_ACTIVE

The list should grow only when the frontend or another client genuinely needs the distinction.

Do not create dozens of unnecessary codes.

29. Feature/Entitlement Errors

If an organization lacks access to a feature, the backend must enforce it.

Possible response:

{
  "error": {
    "code": "FEATURE_NOT_AVAILABLE",
    "message": "This feature is not available on your current plan."
  }
}

The frontend may use this to show an upgrade message.

The frontend must not be the only enforcement point.

30. Trial Expiration

Trial expiration should be represented as a business/entitlement condition.

Do not expose internal subscription calculations.

Example:

TRIAL_EXPIRED

or:

FEATURE_NOT_AVAILABLE

depending on the endpoint.

The exact error code should reflect what the client needs to do.

31. Payment API Errors

Payment-related APIs require especially careful error handling.

Possible codes:

PAYMENT_AMOUNT_INVALID
PAYMENT_CLAIM_NOT_FOUND
PAYMENT_CLAIM_ALREADY_PROCESSED
PAYMENT_NOT_AUTHORIZED
PAYMENT_STATE_INVALID

Do not expose:

database constraint name
SQL error
ORM exception
internal payment calculation details

unless explicitly required for internal diagnostics.

32. Payment Confirmation Failure

If two staff members try to confirm the same claim:

Staff A → success
Staff B → conflict

Staff B should receive a safe state-conflict response such as:

PAYMENT_CLAIM_ALREADY_PROCESSED

The UI can then refresh the claim.

This is preferable to displaying:

500 Internal Server Error
33. Attendance Errors

Potential attendance errors include:

MEMBER_NOT_ACTIVE
MEMBERSHIP_EXPIRED
ATTENDANCE_DUPLICATE
ATTENDANCE_NOT_ALLOWED

The exact business rules must be defined before implementation.

The backend should return the appropriate domain error rather than relying on frontend assumptions.

34. OTP Errors

OTP endpoints require special care because error messages can aid abuse.

Avoid revealing:

phone exists
phone does not exist
OTP is valid for another account

unless the product flow explicitly requires that information.

Possible generic responses:

OTP_SENT
OTP_INVALID
OTP_EXPIRED
TOO_MANY_ATTEMPTS
RATE_LIMITED

The exact outward response should be designed alongside the authentication flow.

Never include the actual OTP in API responses.

35. Authentication Provider Errors

The application should translate provider-specific errors into application-level semantics where practical.

For example:

Authentication provider:
Some provider-specific error

Application:
AUTHENTICATION_REQUIRED

This reduces vendor lock-in.

Provider details may remain in internal logs.

36. API Error Stability

Once clients depend on an error code, changing its meaning should be treated as an API contract change.

For example:

PAYMENT_CLAIM_ALREADY_PROCESSED

must consistently represent that business condition.

Do not reuse the same code for unrelated conditions.

37. Error Response Versioning

The API should avoid unnecessary response-version complexity in V1.

If the error structure changes incompatibly later, the API versioning strategy defined in the API specification should be used.

Small additive changes should preferably remain backward compatible.

38. No Raw Exception Responses

Never return raw exceptions to clients.

Bad:

return Response.json(error);

if error may contain:

stack
SQL
filesystem paths
provider details
secrets

Instead:

internal error
    ↓
classify
    ↓
safe API error
39. Error Mapping Layer

A centralized error-mapping mechanism may be used.

Conceptually:

Domain Error
     ↓
Application Error
     ↓
HTTP Response

Example:

PaymentClaimAlreadyProcessed
        ↓
409
PAYMENT_CLAIM_ALREADY_PROCESSED

This prevents every route from inventing its own error format.

40. Avoid Giant Error Abstractions

The error system should remain understandable.

Do not create a huge framework that hides:

HTTP status
domain state
authorization
database errors

behind multiple layers of abstraction.

A small explicit error model is preferred.

41. Database Error Mapping

Known database errors may be translated into safe domain/API errors.

Example:

unique constraint violation
        ↓
MEMBER_NUMBER_ALREADY_EXISTS

if the application knows exactly which business constraint was violated.

Unknown database errors should become safe internal errors.

Never expose raw database error messages.

42. Transaction Error Mapping

If a transaction fails because another request won a race:

transaction
    ↓
constraint/state conflict

the application should classify it correctly.

It should not automatically become:

500

if the failure represents an expected concurrent business conflict.

43. HTTP Status Reference

Initial convention:

Situation	HTTP Status
Successful read/update	200
Resource created	201
Successful deletion with no body	204
Invalid request/input	400
Authentication required/failed	401
Authenticated but not allowed	403
Resource not found	404
State/business conflict	409
Too many requests	429
Unexpected server failure	500
Temporary dependency/service failure	5xx as appropriate

The exact status-code mapping can be refined during implementation.

44. Error Contract Example

Example validation response:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {
      "amount": "Amount must be greater than zero."
    }
  }
}

Example authorization response:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}

Example conflict:

{
  "error": {
    "code": "PAYMENT_CLAIM_ALREADY_PROCESSED",
    "message": "This payment claim has already been processed."
  }
}

Example internal failure:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again.",
    "requestId": "..."
  }
}
45. Client Retry Rules

The frontend should not blindly retry every error.

Generally:

4xx business/validation error
→ do not automatically retry

Potentially retryable:

429
temporary 5xx
network failure

But retries must respect:

idempotency
backoff
user intent
operation semantics

A POST that creates financial state should not be blindly repeated.

46. Offline/PWA Errors

The PWA may encounter:

network unavailable
request timeout
stale state
duplicate submission

The client should distinguish:

network failure

from:

server rejected request

A network failure does not mean the operation definitely failed.

For state-changing operations, the client must avoid creating duplicate requests when the server may already have processed the first request.

Idempotency may be required for such flows.

47. API Error Testing

Automated tests should verify:

Validation
invalid input
→ expected status/code
Authentication
unauthenticated request
→ 401
Authorization
authenticated but unauthorized request
→ expected 403/404 behavior
Tenant isolation
Organization A requests Organization B resource
→ rejected
Conflict
already processed operation
→ 409 + stable error code
Rate limiting
too many requests
→ 429
Internal error
unexpected failure
→ safe 500 response
Sensitive data
error response contains no secret/OTP/token/database details
48. Documentation Requirements

Every externally consumed API error should be documented when the client needs to handle it.

Documentation should include:

endpoint
HTTP status
error code
meaning
client behavior

Example:

POST /api/payment-claims/:id/confirm

409
PAYMENT_CLAIM_ALREADY_PROCESSED

Meaning:
Another authorized action already processed this claim.

Client behavior:
Refresh the payment claim and display its current state.
49. Error Monitoring

Unexpected server errors should be captured by the project's error-tracking system when enabled.

The monitoring system should receive:

exception type
safe stack trace
request ID
route
environment
relevant non-sensitive context

It should not receive:

OTPs
passwords
access tokens
API secrets
unnecessary personal data
full sensitive payment information
50. Security Review Checklist

Before approving an API endpoint, verify:

 Authentication is enforced where required.
 Authorization is enforced server-side.
 Tenant scope is enforced.
 Validation errors are safe.
 Resource existence is not leaked unnecessarily.
 Error messages do not expose secrets.
 Database errors are mapped safely.
 Provider errors are mapped safely.
 Rate-limit errors are handled.
 State conflicts are explicit.
 Request IDs do not contain sensitive information.
 Logs do not contain secrets.
 Error behavior cannot be used for easy tenant/member enumeration.
51. What This Decision Does Not Finalize

This ADR does not finalize:

exact API serialization casing
exact error-code catalog
exact API versioning mechanism
exact request ID implementation
exact rate-limit infrastructure
exact localization system
exact monitoring provider
exact OpenAPI tooling

Those decisions can be finalized during API implementation.

52. Consequences
Positive
Predictable API behavior
Easier frontend development
Easier automated testing
Better debugging
Safer error handling
Reduced information leakage
Better tenant isolation
Cleaner provider abstraction
Easier AI-assisted development
Negative
Requires maintaining an error-code contract
Requires explicit error mapping
Some endpoint-specific behavior needs careful design
Generic security-safe errors may provide less detail to users
More upfront API design work

These costs are accepted because API consistency and security are important for a multi-tenant SaaS.

53. Final Rule

API errors are part of the product contract.

Use HTTP status codes for broad outcomes.

Use stadocs/decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md
# ADR 014: API Error and Response Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: API / Backend / Error Handling
- Related:
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `09-TESTING.md`
  - `decisions/008-API-CONVENTIONS.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`

---

## 1. Context

The gym SaaS API will be used by:

- owner interfaces
- staff interfaces
- trainer interfaces
- member interfaces
- the PWA
- background jobs
- future integrations

The API must provide predictable behavior for:

- successful requests
- validation failures
- authentication failures
- authorization failures
- missing resources
- state conflicts
- rate limits
- database failures
- external-provider failures
- unexpected server errors

Inconsistent error formats make frontend development, testing, debugging, and AI-assisted development harder.

The API must also avoid exposing:

- database internals
- stack traces
- secrets
- authentication information
- unnecessary personal information
- tenant-specific information through unsafe errors

---

# 2. Decision

The API will use a consistent resource-oriented HTTP response strategy.

The system will:

1. use appropriate HTTP status codes
2. return predictable JSON responses
3. use stable machine-readable error codes
4. provide safe human-readable messages
5. include validation details when appropriate
6. avoid leaking internal implementation details
7. distinguish authentication from authorization
8. distinguish missing resources from business-state conflicts
9. preserve generic responses where enumeration risk exists
10. include request/correlation identifiers where useful for debugging
11. keep frontend error handling separate from backend error classification

---

# 3. Successful Response Principles

Successful responses should communicate the result clearly.

Typical status codes:

```text
200 OK
201 Created
204 No Content

Examples:

GET resource
→ 200
POST create resource
→ 201
DELETE resource with no response body
→ 204

The API should not return 200 OK for every situation simply because the request reached the server.

HTTP status codes should communicate the broad result category.

4. Error Categories

Errors should be classified into meaningful categories.

Initial categories include:

VALIDATION_ERROR
AUTHENTICATION_REQUIRED
FORBIDDEN
NOT_FOUND
CONFLICT
RATE_LIMITED
INVALID_STATE
DEPENDENCY_ERROR
INTERNAL_ERROR

The exact error-code list may evolve.

The goal is stable semantics rather than a huge error taxonomy.

5. Error Response Shape

The API should use a predictable structure.

Conceptually:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {}
  }
}

For request tracing, an optional request identifier may be included:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong.",
    "requestId": "..."
  }
}

The exact casing and serialization convention must remain consistent with the final API implementation.

6. Error Code

The code identifies the machine-readable category.

Example:

PAYMENT_CLAIM_ALREADY_PROCESSED

The frontend should primarily use error codes for behavior.

It should not parse the human-readable message:

"Payment claim has already been processed."

to determine what happened.

7. Human-Readable Message

The message should be understandable to the client/user.

Good:

This payment claim has already been processed.

Bad:

Prisma P2025: Record to update not found.

The user-facing message must never expose ORM/database internals.

8. Validation Errors

Invalid input should normally return:

400 Bad Request

or another appropriate validation status according to the final API convention.

Example:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {
      "phone": "Enter a valid phone number.",
      "amount": "Amount must be greater than zero."
    }
  }
}

Validation errors should identify fields where doing so is safe and useful.

9. Authentication Errors

If the request does not contain valid authentication:

401 Unauthorized

Example:

{
  "error": {
    "code": "AUTHENTICATION_REQUIRED",
    "message": "Authentication is required."
  }
}

Do not return:

"Your Clerk token is invalid because ..."

or expose provider-specific authentication details unnecessarily.

10. Authorization Errors

If the user is authenticated but not permitted to perform an operation:

403 Forbidden

Example:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}

Authorization must always be enforced server-side.

Frontend visibility checks are not authorization.

11. Resource Not Found

If a requested resource does not exist, use:

404 Not Found

Example:

{
  "error": {
    "code": "MEMBER_NOT_FOUND",
    "message": "Member not found."
  }
}

However, resource existence must sometimes be intentionally hidden.

12. Enumeration Protection

Authentication and membership flows can reveal sensitive information if errors distinguish:

phone belongs to a member

from:

phone does not belong to a member

Where enumeration is a concern, use intentionally generic responses.

Example:

If phone is eligible:
    OTP sent

If phone is not eligible:
    same outward response

The API must not allow attackers to discover the gym's member list by repeatedly submitting phone numbers.

13. Conflict Errors

Use:

409 Conflict

when the request conflicts with the current resource state.

Examples:

payment claim already processed
member number already exists
duplicate organization membership
resource version conflict

Example:

{
  "error": {
    "code": "PAYMENT_CLAIM_ALREADY_PROCESSED",
    "message": "This payment claim has already been processed."
  }
}
14. Invalid State Transitions

Business-state conflicts should have explicit errors.

Example:

PENDING
   ↓
APPROVED

A request attempting:

APPROVED
   ↓
APPROVED

may return:

409 Conflict

with:

PAYMENT_CLAIM_ALREADY_PROCESSED

The API should communicate the domain conflict rather than expose a generic database failure.

15. Rate Limiting

Rate-limited requests should return:

429 Too Many Requests

Example:

{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  }
}

This is especially important for:

OTP requests
OTP verification
login attempts
member discovery
public QR endpoints
notification operations
expensive APIs
16. Retry Information

Where useful, rate-limit responses may include retry information.

Example:

Retry-After

The exact implementation depends on the infrastructure.

Do not encourage aggressive client retries.

17. Dependency Failures

External services may fail.

Examples:

WhatsApp provider
authentication provider
email provider
payment provider in future

The API should not expose raw provider errors.

Bad:

Meta error #131026: ...

Better:

{
  "error": {
    "code": "DEPENDENCY_ERROR",
    "message": "The notification service is temporarily unavailable."
  }
}

Internal logs may contain provider diagnostics when safe.

18. Internal Server Errors

Unexpected failures should return:

500 Internal Server Error

with a generic response.

Example:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again."
  }
}

Never expose:

stack traces
SQL queries
database connection strings
filesystem paths
environment variables
secrets
provider credentials
internal architecture details
19. Request ID

Requests should have a request/correlation identifier where practical.

Example:

X-Request-Id: abc123

The application may generate one if the incoming request does not provide an acceptable identifier.

The identifier can be included in safe error responses:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong.",
    "requestId": "abc123"
  }
}

This allows support/debugging workflows without exposing internal diagnostics.

20. Request ID Security

Request IDs must not contain:

user phone numbers
authentication tokens
payment information
secrets
predictable sensitive information

They should be opaque.

21. Error Logging

When an unexpected error occurs, the server should log enough information to diagnose it.

Useful information may include:

requestId
route
method
timestamp
authenticated user ID
organization ID where appropriate
error category
safe stack trace

Logs must follow the security rules in AGENTS.md.

Do not log:

OTP
password
access token
API key
secret
full sensitive payment data
22. Frontend Error Handling

The frontend should not have to understand every backend implementation detail.

Instead, it should map stable error codes to UI behavior.

Example:

PAYMENT_CLAIM_ALREADY_PROCESSED
        ↓
show:
"This payment has already been processed."

The frontend should not depend on:

HTTP 500

meaning a specific business condition.

Business conditions should have explicit codes.

23. Error Messages and Localization

Initial V1 does not require a full localization system.

However, error codes should remain stable so presentation text can change later.

For example:

MEMBER_NOT_FOUND

can eventually map to different languages without changing backend semantics.

24. Validation Location

Input validation should happen at the API boundary.

Examples:

phone format
amount > 0
required name
valid dates
valid enum values

However, validation does not replace authorization or database constraints.

The layers serve different purposes:

API validation
    ↓
business rules
    ↓
authorization
    ↓
database constraints

The exact ordering may vary by operation, but all relevant protections must exist.

25. Authorization Error vs Not Found

The application must deliberately decide whether an unauthorized resource should return:

403

or:

404

depending on information-disclosure risk and endpoint semantics.

For sensitive resources, returning 404 may prevent attackers from learning that the resource exists.

The decision should be consistent for similar endpoints.

26. Member-Specific Access

For member APIs, the backend must verify that the requested resource belongs to the authenticated member or authorized organization.

Example:

Member A requests Member B's payment

The server must reject the request.

The response should not expose:

Member B's name
phone
payment amount
membership status

before authorization succeeds.

27. Tenant-Aware Errors

Errors must not accidentally leak another organization's information.

Bad:

"Member 8f... exists, but belongs to Organization XYZ."

Better:

"Member not found."

or an appropriate authorization response.

Tenant isolation applies to error behavior as well as successful responses.

28. Business Rule Errors

Business rules should have explicit machine-readable codes when the client needs to react differently.

Examples:

MEMBERSHIP_EXPIRED
PAYMENT_ALREADY_CONFIRMED
PAYMENT_CLAIM_ALREADY_PROCESSED
TRIAL_EXPIRED
FEATURE_NOT_AVAILABLE
MEMBER_NOT_ACTIVE

The list should grow only when the frontend or another client genuinely needs the distinction.

Do not create dozens of unnecessary codes.

29. Feature/Entitlement Errors

If an organization lacks access to a feature, the backend must enforce it.

Possible response:

{
  "error": {
    "code": "FEATURE_NOT_AVAILABLE",
    "message": "This feature is not available on your current plan."
  }
}

The frontend may use this to show an upgrade message.

The frontend must not be the only enforcement point.

30. Trial Expiration

Trial expiration should be represented as a business/entitlement condition.

Do not expose internal subscription calculations.

Example:

TRIAL_EXPIRED

or:

FEATURE_NOT_AVAILABLE

depending on the endpoint.

The exact error code should reflect what the client needs to do.

31. Payment API Errors

Payment-related APIs require especially careful error handling.

Possible codes:

PAYMENT_AMOUNT_INVALID
PAYMENT_CLAIM_NOT_FOUND
PAYMENT_CLAIM_ALREADY_PROCESSED
PAYMENT_NOT_AUTHORIZED
PAYMENT_STATE_INVALID

Do not expose:

database constraint name
SQL error
ORM exception
internal payment calculation details

unless explicitly required for internal diagnostics.

32. Payment Confirmation Failure

If two staff members try to confirm the same claim:

Staff A → success
Staff B → conflict

Staff B should receive a safe state-conflict response such as:

PAYMENT_CLAIM_ALREADY_PROCESSED

The UI can then refresh the claim.

This is preferable to displaying:

500 Internal Server Error
33. Attendance Errors

Potential attendance errors include:

MEMBER_NOT_ACTIVE
MEMBERSHIP_EXPIRED
ATTENDANCE_DUPLICATE
ATTENDANCE_NOT_ALLOWED

The exact business rules must be defined before implementation.

The backend should return the appropriate domain error rather than relying on frontend assumptions.

34. OTP Errors

OTP endpoints require special care because error messages can aid abuse.

Avoid revealing:

phone exists
phone does not exist
OTP is valid for another account

unless the product flow explicitly requires that information.

Possible generic responses:

OTP_SENT
OTP_INVALID
OTP_EXPIRED
TOO_MANY_ATTEMPTS
RATE_LIMITED

The exact outward response should be designed alongside the authentication flow.

Never include the actual OTP in API responses.

35. Authentication Provider Errors

The application should translate provider-specific errors into application-level semantics where practical.

For example:

Authentication provider:
Some provider-specific error

Application:
AUTHENTICATION_REQUIRED

This reduces vendor lock-in.

Provider details may remain in internal logs.

36. API Error Stability

Once clients depend on an error code, changing its meaning should be treated as an API contract change.

For example:

PAYMENT_CLAIM_ALREADY_PROCESSED

must consistently represent that business condition.

Do not reuse the same code for unrelated conditions.

37. Error Response Versioning

The API should avoid unnecessary response-version complexity in V1.

If the error structure changes incompatibly later, the API versioning strategy defined in the API specification should be used.

Small additive changes should preferably remain backward compatible.

38. No Raw Exception Responses

Never return raw exceptions to clients.

Bad:

return Response.json(error);

if error may contain:

stack
SQL
filesystem paths
provider details
secrets

Instead:

internal error
    ↓
classify
    ↓
safe API error
39. Error Mapping Layer

A centralized error-mapping mechanism may be used.

Conceptually:

Domain Error
     ↓
Application Error
     ↓
HTTP Response

Example:

PaymentClaimAlreadyProcessed
        ↓
409
PAYMENT_CLAIM_ALREADY_PROCESSED

This prevents every route from inventing its own error format.

40. Avoid Giant Error Abstractions

The error system should remain understandable.

Do not create a huge framework that hides:

HTTP status
domain state
authorization
database errors

behind multiple layers of abstraction.

A small explicit error model is preferred.

41. Database Error Mapping

Known database errors may be translated into safe domain/API errors.

Example:

unique constraint violation
        ↓
MEMBER_NUMBER_ALREADY_EXISTS

if the application knows exactly which business constraint was violated.

Unknown database errors should become safe internal errors.

Never expose raw database error messages.

42. Transaction Error Mapping

If a transaction fails because another request won a race:

transaction
    ↓
constraint/state conflict

the application should classify it correctly.

It should not automatically become:

500

if the failure represents an expected concurrent business conflict.

43. HTTP Status Reference

Initial convention:

Situation	HTTP Status
Successful read/update	200
Resource created	201
Successful deletion with no body	204
Invalid request/input	400
Authentication required/failed	401
Authenticated but not allowed	403
Resource not found	404
State/business conflict	409
Too many requests	429
Unexpected server failure	500
Temporary dependency/service failure	5xx as appropriate

The exact status-code mapping can be refined during implementation.

44. Error Contract Example

Example validation response:

{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Some fields are invalid.",
    "details": {
      "amount": "Amount must be greater than zero."
    }
  }
}

Example authorization response:

{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action."
  }
}

Example conflict:

{
  "error": {
    "code": "PAYMENT_CLAIM_ALREADY_PROCESSED",
    "message": "This payment claim has already been processed."
  }
}

Example internal failure:

{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again.",
    "requestId": "..."
  }
}
45. Client Retry Rules

The frontend should not blindly retry every error.

Generally:

4xx business/validation error
→ do not automatically retry

Potentially retryable:

429
temporary 5xx
network failure

But retries must respect:

idempotency
backoff
user intent
operation semantics

A POST that creates financial state should not be blindly repeated.

46. Offline/PWA Errors

The PWA may encounter:

network unavailable
request timeout
stale state
duplicate submission

The client should distinguish:

network failure

from:

server rejected request

A network failure does not mean the operation definitely failed.

For state-changing operations, the client must avoid creating duplicate requests when the server may already have processed the first request.

Idempotency may be required for such flows.

47. API Error Testing

Automated tests should verify:

Validation
invalid input
→ expected status/code
Authentication
unauthenticated request
→ 401
Authorization
authenticated but unauthorized request
→ expected 403/404 behavior
Tenant isolation
Organization A requests Organization B resource
→ rejected
Conflict
already processed operation
→ 409 + stable error code
Rate limiting
too many requests
→ 429
Internal error
unexpected failure
→ safe 500 response
Sensitive data
error response contains no secret/OTP/token/database details
48. Documentation Requirements

Every externally consumed API error should be documented when the client needs to handle it.

Documentation should include:

endpoint
HTTP status
error code
meaning
client behavior

Example:

POST /api/payment-claims/:id/confirm

409
PAYMENT_CLAIM_ALREADY_PROCESSED

Meaning:
Another authorized action already processed this claim.

Client behavior:
Refresh the payment claim and display its current state.
49. Error Monitoring

Unexpected server errors should be captured by the project's error-tracking system when enabled.

The monitoring system should receive:

exception type
safe stack trace
request ID
route
environment
relevant non-sensitive context

It should not receive:

OTPs
passwords
access tokens
API secrets
unnecessary personal data
full sensitive payment information
50. Security Review Checklist

Before approving an API endpoint, verify:

 Authentication is enforced where required.
 Authorization is enforced server-side.
 Tenant scope is enforced.
 Validation errors are safe.
 Resource existence is not leaked unnecessarily.
 Error messages do not expose secrets.
 Database errors are mapped safely.
 Provider errors are mapped safely.
 Rate-limit errors are handled.
 State conflicts are explicit.
 Request IDs do not contain sensitive information.
 Logs do not contain secrets.
 Error behavior cannot be used for easy tenant/member enumeration.
51. What This Decision Does Not Finalize

This ADR does not finalize:

exact API serialization casing
exact error-code catalog
exact API versioning mechanism
exact request ID implementation
exact rate-limit infrastructure
exact localization system
exact monitoring provider
exact OpenAPI tooling

Those decisions can be finalized during API implementation.

52. Consequences
Positive
Predictable API behavior
Easier frontend development
Easier automated testing
Better debugging
Safer error handling
Reduced information leakage
Better tenant isolation
Cleaner provider abstraction
Easier AI-assisted development
Negative
Requires maintaining an error-code contract
Requires explicit error mapping
Some endpoint-specific behavior needs careful design
Generic security-safe errors may provide less detail to users
More upfront API design work

These costs are accepted because API consistency and security are important for a multi-tenant SaaS.

53. Final Rule

API errors are part of the product contract.

Use HTTP status codes for broad outcomes.

Use stable error codes for machine-readable semantics.

Use human-readable messages for users.

Never expose internal implementation details.

Never use frontend error handling as a security boundary
For every new endpoint, explicitly define:

success response
+
validation errors
+
authentication behavior
+
authorization behavior
+
not-found behavior
+
conflict behavior
+
rate-limit behavior
+
unexpected failure behavior

The API should fail predictably, safely, and in a way that allows the client to recover when recovery is possible.
