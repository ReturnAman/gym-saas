# ADR 019: API Security and Rate Limiting Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Security / API / Infrastructure
- Related:
  - `05-AUTHORIZATION.md`
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `09-TESTING.md`
  - `10-DEVOPS.md`
  - `11-OBSERVABILITY.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md`
  - `decisions/015-AUTHENTICATION-AND-AUTHORIZATION-IMPLEMENTATION.md`
  - `decisions/017-AUDIT-LOGGING-STRATEGY.md`
  - `decisions/018-CONFIGURATION-AND-ENVIRONMENT-STRATEGY.md`

---

## 1. Context

The SaaS exposes backend APIs used by:

- gym owners
- administrators
- trainers
- staff
- members
- authenticated application clients
- background jobs
- external providers/webhooks

The API is a security boundary.

Authentication alone is not sufficient.

Every request must be evaluated for:

```text
Authentication
Authorization
Tenant isolation
Input validity
Abuse/rate limits
Resource ownership
State-transition validity
Concurrency
Sensitive-data exposure

The system must also protect endpoints from accidental or malicious excessive requests.

2. Decision

API security will follow a layered model:

Request
  ↓
Transport/security checks
  ↓
Authentication
  ↓
Input validation
  ↓
Tenant resolution
  ↓
Authorization
  ↓
Business rules
  ↓
Transaction/concurrency controls
  ↓
Response

Rate limiting will be applied according to endpoint risk rather than using one universal limit.

Critical security-sensitive operations will have stricter controls than ordinary authenticated reads.

3. HTTPS

Production APIs must be served over HTTPS.

Sensitive requests must never rely on plaintext HTTP in production.

Examples include:

OTP verification
authentication callbacks
member information
payment information
attendance
organization administration
4. Authentication First

Protected endpoints must establish the authenticated identity before performing protected business operations.

Conceptually:

Request
  ↓
Authenticated user?
  ├── No → 401
  └── Yes
       ↓
Continue

Authentication and authorization remain separate concerns.

5. Authorization

A valid authenticated user does not automatically have access to every resource.

The backend must verify:

user
organization
role
permission
resource

where applicable.

Frontend checks are not considered security controls.

6. Tenant Isolation

Every tenant-owned resource must be scoped to the correct organization.

Example:

Authenticated User
        ↓
Organization Membership
        ↓
Organization
        ↓
Requested Resource

The API must not trust an organization ID supplied by the client without verifying that the authenticated user has access to it.

7. Resource Ownership

Where resources have additional ownership constraints, the backend must verify them.

For example:

Organization
    ↓
Member
    ↓
Membership

A user belonging to Organization A must not be able to access a Member belonging to Organization B by changing an ID in the request.

8. IDOR Protection

The API must protect against insecure direct object reference vulnerabilities.

Unsafe conceptual behavior:

GET /api/members/member_B

where the server returns member_B simply because the ID exists.

Correct behavior:

Request
  ↓
Authenticate
  ↓
Resolve organization
  ↓
Check member belongs to organization
  ↓
Authorize role
  ↓
Return resource
9. Generic Not-Found Behavior

Where appropriate, unauthorized access to a resource may return a generic:

404 Not Found

rather than revealing that the resource exists.

This can reduce information leakage.

The exact behavior should follow the API error strategy.

10. Input Validation

All externally supplied input must be validated server-side.

Examples:

query parameters
path parameters
request bodies
headers
webhook payloads
pagination values
filter values
amounts
dates
status transitions

Never assume frontend validation is sufficient.

11. Input Validation Rules

Validation should cover:

type
required fields
format
length
range
allowed values
relationships
business constraints

Example:

payment amount

should not merely be checked as a number.

It must also satisfy the application's payment rules.

12. Unknown Fields

The API should intentionally decide how unknown request fields are handled.

For security-sensitive endpoints, silently accepting unexpected fields can create ambiguity.

Example:

{
  "amount": 1000,
  "role": "OWNER"
}

If the endpoint does not support role, it should not accidentally apply it through generic object updates.

Mass-assignment vulnerabilities must be avoided.

13. Explicit Update Fields

Update operations should explicitly define which fields are mutable.

Avoid patterns conceptually equivalent to:

update(resource, request.body)

without field filtering.

Prefer:

update(resource, {
    name,
    phone,
    ...
})

with explicit authorization for each sensitive field where necessary.

14. Rate Limiting

Rate limiting will protect high-risk and abuse-prone endpoints.

Rate limits should consider:

user
IP address
organization
phone number
device/request fingerprint where appropriate
endpoint
operation

Not every endpoint requires all dimensions.

15. Authentication Rate Limits

Authentication-related endpoints require strict controls.

Examples:

OTP request
OTP verification
OTP resend
account recovery

Controls may include:

per-phone limits
per-IP limits
per-device/request limits
resend cooldown
verification attempt limits
temporary lockouts
16. OTP Request Protection

The OTP request flow should include:

short expiration
resend cooldown
maximum requests per time window
maximum verification attempts
IP/request throttling
abuse monitoring

Exact numeric values should be selected during implementation and security testing.

They should not be hardcoded into unrelated business logic.

17. OTP Enumeration Protection

The API should avoid revealing whether a phone number belongs to a member or owner account when the user is not yet authenticated.

Avoid responses such as:

"This phone number is not registered."

where that would reveal account or membership existence.

Prefer a generic response where appropriate.

18. Login/Verification Attempts

Repeated invalid verification attempts should be limited.

Example:

OTP entered
    ↓
Attempts remaining?
    ├── No → reject/temporarily block
    └── Yes → verify

Attempt counters must be enforced server-side.

19. Passwords

The initial authentication design uses OTP/provider-based authentication rather than application-managed passwords.

Therefore the application should not introduce a custom password system unless explicitly approved.

If passwords are introduced later, that requires a separate security decision.

20. Public Endpoints

Public endpoints should be treated as potentially abusable even when authentication is not required.

Examples may include:

public gym information
QR-based gym identification
public application routes
health checks

Public endpoints should expose only intentionally public information.

21. QR-Based Member Entry

The permanent gym QR code identifies the organization.

It does not authenticate the member.

Flow:

Scan QR
   ↓
Identify gym
   ↓
Enter phone
   ↓
OTP
   ↓
Authenticated user
   ↓
Membership authorization

The QR value must not be treated as an authentication credential.

22. API Keys

If internal service-to-service APIs use API keys, they must:

be secret
be scoped appropriately
be rotated
never be logged
never be exposed to browsers

API keys must not replace normal user authorization for user-facing endpoints.

23. Background Jobs

Background jobs are not automatically trusted simply because they originate from the application's worker.

Jobs should carry enough context to safely execute the intended operation.

For tenant-sensitive operations, the job should include or resolve:

organization
resource
operation

and verify that the operation is still valid when executed.

24. Webhooks

External webhooks must be treated as untrusted input.

Webhook handling should include, where supported:

signature verification
provider validation
payload validation
idempotency
replay protection
safe processing

A webhook must not be trusted merely because it reaches a private endpoint.

25. Webhook Rate Limiting

Webhook endpoints may require different protection from public user APIs.

The system should avoid rejecting legitimate provider retries solely because of an overly aggressive generic rate limit.

Provider-specific retry behavior should be considered when setting limits.

26. Idempotency

Retryable mutation endpoints should support idempotency where duplicate execution could cause harm.

Examples:

payment confirmation
external webhook processing
notification enqueueing
important state transitions

The exact idempotency mechanism depends on the operation.

27. Payment API Protection

Payment-related endpoints require additional controls.

The backend must:

authenticate the actor
authorize the role
verify organization scope
validate payment amount
validate payment state
prevent duplicate confirmation
handle concurrent updates
maintain audit history

A payment claim must never become a confirmed payment merely because the client sends a different status.

28. Payment Claim

Member payment claim:

Member
  ↓
"I have paid"
  ↓
Payment Claim

does not mean:

Confirmed Payment

Only an authorized owner/staff workflow may confirm the payment according to the product's authorization rules.

29. Attendance API Protection

Attendance operations must prevent unintended duplicate records or repeated check-ins.

The API should enforce the application's attendance rules server-side.

Potential duplicate requests must be handled safely.

30. Attendance QR

If QR attendance is implemented:

QR
  ↓
identify gym
  ↓
authenticate member
  ↓
verify membership/access
  ↓
check attendance rules
  ↓
record attendance

The QR itself must not be sufficient to impersonate a member.

31. Pagination

List endpoints should use bounded pagination.

The API should not allow arbitrary requests such as:

?pageSize=10000000

without enforcing a maximum.

Example conceptual model:

default page size
maximum page size
validated cursor/page

Exact limits are implementation decisions.

32. Filtering

Filters must be validated.

Do not allow clients to construct arbitrary database queries.

For example:

sort=name

should map to an explicitly supported database field.

Avoid directly inserting client-provided strings into SQL/order clauses.

33. Search

Search endpoints should have reasonable limits.

Controls may include:

minimum search length
maximum query length
pagination
rate limiting
tenant scoping

Search must never bypass organization authorization.

34. Sorting

Sort fields should come from an allowlist.

Example:

allowed:
name
createdAt
membershipExpiry

rather than allowing arbitrary SQL expressions.

35. Response Size

APIs should avoid returning unnecessary data.

For example, a member list does not need to return:

internal audit information
private implementation fields
authentication metadata
provider tokens

unless explicitly required.

36. Sensitive Data Minimization

Responses should contain only the information required for the requested operation.

Particularly sensitive data includes:

OTP information
authentication tokens
private credentials
internal IDs where unnecessary
payment-sensitive details
unnecessary personal information
37. Phone Numbers

Phone numbers are personal information.

APIs should expose them only where required by the user's role and the feature.

Avoid returning full phone numbers in public endpoints.

38. Payment Information

Payment information must be scoped to authorized users.

Members should see their own relevant payment state.

Owners/staff should see payment information for their organization according to role permissions.

One organization must never see another organization's payment records.

39. Error Responses

API errors must follow the strategy defined in ADR 014.

Errors should provide:

HTTP status
machine-readable error code
safe human-readable message
request ID where appropriate

They must not expose:

stack traces
SQL queries
database internals
tokens
secrets
private provider responses
40. Authentication Errors

Typical behavior:

401 Unauthorized

for missing/invalid authentication.

Do not return detailed information that helps attackers understand authentication internals.

41. Authorization Errors

Typical behavior:

403 Forbidden

when the user is authenticated but lacks permission.

Where resource existence should remain hidden, 404 may be more appropriate.

42. Validation Errors

Invalid client input should generally produce:

400 Bad Request

with safe, actionable validation information.

The response should not reveal internal schema implementation details unnecessarily.

43. Conflict Errors

Business-state conflicts should generally use:

409 Conflict

Examples:

duplicate operation
invalid state transition
concurrent update conflict
already-confirmed payment
44. Rate-Limit Errors

When a request exceeds a configured rate limit:

429 Too Many Requests

should be returned where appropriate.

The response may include retry guidance when safe and useful.

45. Rate-Limit Strategy

The initial implementation should avoid premature distributed infrastructure.

Possible initial mechanisms include:

provider/platform rate limiting
database-backed counters
in-memory limits where appropriate for local development

The final implementation depends on deployment architecture.

46. Distributed Rate Limiting

Once multiple application instances exist, process-local rate limiting may become insufficient.

Example:

Request → Instance A
Request → Instance B
Request → Instance C

Each instance having an independent counter can weaken the intended limit.

A shared rate-limit mechanism may therefore be introduced when horizontal scaling requires it.

This does not justify adding Redis prematurely.

47. Rate-Limit Categories

Conceptually, endpoints can be grouped as:

Very High Risk
OTP request
OTP verification
account recovery
High Risk
payment confirmation
role changes
owner changes
sensitive mutations
webhooks
Medium Risk
member creation
membership changes
attendance mutation
announcement creation
Lower Risk
authenticated reads
dashboard data
ordinary lists

Actual limits will be determined during implementation/testing.

48. Organization-Level Abuse Controls

The application may enforce organization-level limits for:

member creation
staff creation
notifications
exports
bulk operations

where necessary.

These limits are separate from security rate limits.

For example:

plan entitlement

is not the same as:

request rate limit
49. Plan Limits

Product limits may include:

maximum members
maximum staff
maximum exports
notification limits

These are business entitlements.

They must not be implemented as generic security rate limits.

50. Bulk Operations

Bulk APIs require special protection because one request may affect many records.

Examples:

bulk member import
bulk notification creation
bulk membership updates
CSV processing

The system should validate:

maximum batch size
authorization
tenant scope
individual record validity
transaction behavior
51. CSV Import

CSV imports must not bypass normal authorization or data validation.

Imported records remain tenant-scoped.

The import process should:

authenticate
authorize
validate file
validate rows
enforce limits
process safely
report failures
52. File Uploads

If file uploads are introduced later, APIs must validate:

file type
file size
ownership
tenant
access permissions
storage destination

Client-provided MIME type alone should not be trusted.

Progress photos are currently local-first and cloud upload is not a V1 requirement.

53. CORS

Cross-origin access should be explicitly configured.

Production APIs should not use:

Access-Control-Allow-Origin: *

for authenticated sensitive APIs unless there is a specific and reviewed reason.

Allowed origins should be intentionally configured.

54. CSRF

The final CSRF strategy depends on the authentication mechanism and cookie/token architecture.

If browser cookies are used for authenticated requests, CSRF protections must be considered.

If a framework/provider provides appropriate protections, they should be configured correctly rather than duplicated unnecessarily.

This ADR does not finalize the exact CSRF mechanism.

55. Security Headers

Production responses should use appropriate security headers where applicable.

Potential controls include:

Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
frame protections
strict transport security

Exact policy values should be tested against the application.

56. Request IDs

Each API request should have a traceable request identifier.

Conceptually:

Request
  ↓
requestId
  ↓
logs
  ↓
errors
  ↓
support/debugging

Request IDs must not contain secrets or sensitive personal information.

57. Logging

Security-relevant events should be logged appropriately.

Examples:

authentication failures
rate-limit events
authorization failures
webhook failures
important state-transition failures

Do not log:

OTP
authentication tokens
passwords
API secrets
full sensitive payment data
58. Audit vs Technical Logs

Technical logs answer:

What happened technically?

Audit logs answer:

Who performed an important business/security action?

They remain separate systems as defined in ADR 017.

59. Monitoring

Rate-limit violations and authentication abuse should be observable.

Useful metrics may include:

OTP requests
OTP failures
429 responses
authentication failures
authorization failures
webhook failures
payment conflicts

Monitoring should avoid collecting unnecessary personal data.

60. Alerting

Alerts should focus on meaningful operational/security events.

Examples:

sustained OTP abuse
unexpected authentication failure spike
large increase in 429 responses
webhook failure spike
payment processing errors

Alert thresholds should be established after observing normal traffic.

61. API Versioning

API versioning should not be introduced solely for theoretical future compatibility.

If breaking changes become necessary, the project should define an explicit migration strategy.

The initial application may use the current API structure without unnecessary version layers.

62. Internal API Calls

Code inside the same modular monolith should not unnecessarily call its own HTTP endpoints.

Prefer:

API route
  ↓
domain/application service

rather than:

API route
  ↓
HTTP request to another internal route
  ↓
domain service

This reduces unnecessary complexity.

63. Service Boundaries

The API security model should not require microservices.

The initial architecture remains a modular monolith.

If services are split later, service-to-service authentication and authorization will require a separate architecture/security decision.

64. Provider Calls

External provider calls should not occur before necessary authorization and validation.

For example:

Invalid payment operation

should not reach the external provider simply because the API accepted the request.

65. External Provider Failures

External provider failures should not corrupt local business state.

For example:

WhatsApp provider unavailable

must not undo a valid payment confirmation or membership update merely because notification delivery failed.

Notification processing remains a separate concern.

66. Transaction Boundaries

Security checks and business state mutations should be ordered carefully.

For critical operations:

Authenticate
  ↓
Authorize
  ↓
Validate
  ↓
Transaction
  ↓
State mutation
  ↓
Audit

External network calls should generally remain outside database transactions.

67. Concurrency

Security-sensitive operations must account for concurrent requests.

Examples:

two payment confirmations
two membership renewals
two attendance check-ins
two role changes

The database transaction/concurrency strategy from ADR 013 must be followed.

68. Replay Protection

Operations involving sensitive state changes should consider replay.

Examples:

webhooks
payment confirmation requests
idempotent mutations

A request being repeated must not unintentionally perform the same business action twice.

69. Sensitive State Transitions

State transitions must be validated against the current server state.

Never trust the client to provide a valid transition such as:

UNPAID → PAID

The server determines whether the transition is allowed.

70. Security Testing

API tests should cover:

Authentication
unauthenticated request
expired authentication
invalid authentication
Authorization
wrong role
wrong organization
wrong resource
Tenant isolation
Organization A → Organization B resource

must fail.

Rate limiting
repeated OTP request
repeated verification

must eventually be limited.

State integrity
duplicate payment confirmation
invalid payment amount
invalid state transition

must be rejected.

71. Security Test Matrix

At minimum, important endpoints should be tested across:

Anonymous
Authenticated MEMBER
Authenticated STAFF
Authenticated TRAINER
Authenticated ADMIN
Authenticated OWNER
Wrong Organization User

Not every endpoint supports every role, but the authorization behavior must be explicit.

72. API Security Review Checklist

Before merging a new API endpoint:

[ ] Authentication requirement defined
[ ] Organization scope defined
[ ] Role/permission requirement defined
[ ] Resource ownership checked
[ ] Input validation implemented
[ ] Unknown fields handled safely
[ ] Rate limit considered
[ ] Sensitive response fields reviewed
[ ] Error responses safe
[ ] State transitions validated
[ ] Concurrency considered
[ ] Idempotency considered
[ ] Audit requirement considered
[ ] Tests added
73. What This Decision Does Not Finalize

This ADR does not finalize:

exact rate-limit numbers
exact rate-limit infrastructure
exact CSRF implementation
exact CORS configuration
exact security-header values
distributed rate-limiting technology
API gateway selection
WAF selection
DDoS protection provider

These can be decided when deployment and implementation requirements are concrete.

74. Consequences
Positive
Consistent API security model
Stronger tenant isolation
Reduced abuse risk
Safer authentication flows
Safer payment operations
Better observability
Predictable API behavior
Easier security testing
Reduced accidental data exposure
Negative
More validation and authorization code
More security tests
Rate-limit configuration requires tuning
Some APIs become more complex
Distributed deployments may eventually require shared rate limiting

These costs are accepted because the API is a primary security boundary.

75. Final Rule

Every API endpoint must answer:

Who is calling?
Which organization are they acting in?
What are they allowed to do?
Which resource are they allowed to access?
Is the input valid?
Can this request be abused or replayed?
Can concurrent requests corrupt state?
Does the response reveal anything unnecessary?
Should the action be audited?

If these questions cannot be answered clearly, the endpoint is not ready for implementation.
