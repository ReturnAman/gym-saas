# Security

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** Security Definition  
**Scope:** V1 and planned evolution

---

# 1. Purpose

This document defines the security requirements and security model for gym-saas.

Security is a core architectural requirement because the application handles:

- user identity
- phone numbers
- organization membership
- member information
- attendance information
- payment information
- staff permissions
- subscription information
- notifications
- operational business data

This document defines:

- security principles
- authentication security
- authorization security
- tenant isolation
- OTP security
- QR security
- API security
- payment security
- data protection
- secrets management
- logging
- abuse prevention
- security testing
- incident considerations

---

# 2. Security Principles

The system must prioritize:

1. Tenant isolation
2. Least privilege
3. Backend authorization
4. Secure authentication
5. Data integrity
6. Defense in depth
7. Minimal sensitive-data exposure
8. Secure defaults
9. Auditable sensitive operations
10. Simplicity over unnecessary security complexity

Security controls should be applied at the actual trust boundary rather than relying on UI behavior.

---

# 3. Security Boundaries

The major security boundaries are:

```text
User Device
    ↓
PWA / Browser
    ↓
Application Backend
    ↓
PostgreSQL
    ↓
External Providers
The backend is the primary application security boundary.

The browser/client must be treated as untrusted.

4. Threat Model

The system should account for threats including:

stolen or compromised sessions
OTP abuse
OTP guessing
OTP brute force
membership enumeration
organization enumeration
IDOR/resource-access attacks
cross-tenant data access
privilege escalation
unauthorized payment confirmation
payment manipulation
duplicate financial operations
QR misuse
malicious API requests
automated abuse
leaked credentials
exposed secrets
malicious or compromised staff accounts
accidental data exposure
insecure exports
excessive logging of sensitive data
dependency vulnerabilities
malicious client-side behavior

The system should be designed assuming that a user may deliberately manipulate requests.

5. Authentication Security

Authentication may use Clerk or another approved authentication provider.

The application must treat the authentication provider as responsible for authentication while retaining application ownership of authorization.

Authentication must establish a reliable authenticated user identity.

6. Authentication vs Authorization

The following distinction is mandatory:

Authentication
    =
Who are you?

Authorization
    =
What are you allowed to do?

Successful authentication does not grant access to any organization resource automatically.

The backend must verify organization membership and permissions.

7. OTP Security

OTP is a security-sensitive mechanism.

The system must implement appropriate controls including:

short OTP lifetime
maximum verification attempts
resend cooldown
request rate limiting
verification rate limiting
IP/request throttling where appropriate
device/session abuse controls where appropriate
invalidation after successful verification
invalidation after expiration
protection against repeated automated requests

OTP values must never be logged.

OTP values must never be returned through APIs after creation.

OTP values must never be stored in plaintext by the application if the chosen authentication provider does not require it.

8. OTP Enumeration Protection

The system must avoid revealing whether a phone number belongs to a particular gym.

For example, an attacker should not be able to repeatedly submit arbitrary phone numbers and determine:

This person is a member of Gym X.

Responses should therefore be sufficiently generic where appropriate.

Rate limiting must complement generic responses.

9. OTP Abuse Prevention

The system should detect and limit patterns such as:

many OTP requests for one phone number
many phone numbers from one IP
many requests from one device
repeated incorrect OTP submissions
repeated requests across organizations
automated OTP abuse

The exact thresholds should be configurable rather than hard-coded throughout the application.

10. Session Security

Authenticated sessions must be handled using the approved authentication provider and secure application practices.

The application must:

avoid exposing authentication tokens unnecessarily
avoid storing secrets in unsafe browser-accessible locations
use secure transport
invalidate access appropriately when authorization is removed
respect authentication-provider session behavior

The application must not implement a custom authentication system unless explicitly approved.

11. Phone Number Security

Phone numbers are personal information.

The system should:

minimize unnecessary exposure
avoid exposing phone numbers to unauthorized users
avoid putting phone numbers into URLs where unnecessary
avoid logging full phone numbers unnecessarily
protect exported phone numbers
restrict access according to role

Phone numbers must not be treated as primary database identity keys.

12. QR Code Security

The gym QR code is an organization-identification mechanism.

It must not be an authentication credential.

The QR code must not contain:

passwords
OTPs
authentication tokens
privileged session credentials
reusable secret credentials

Possession of the QR code must not grant privileged access.

13. QR Abuse

An attacker may photograph or share a gym QR code.

This is acceptable because the QR only identifies the organization.

Actual member access still requires:

QR
 ↓
Phone
 ↓
OTP
 ↓
Authenticated User
 ↓
Organization Membership

Therefore sharing the QR must not bypass authentication.

14. Tenant Isolation

Tenant isolation is one of the highest-priority security requirements.

Every tenant-scoped request must verify:

Authenticated User
        ↓
Organization Membership
        ↓
Requested Organization
        ↓
Resource Organization

A user must never access another organization's data by manipulating:

organization ID
member ID
membership ID
payment ID
attendance ID
announcement ID
notification ID
any other resource identifier
15. IDOR Protection

Insecure Direct Object Reference vulnerabilities must be explicitly prevented.

Unsafe conceptual implementation:

GET /members/{memberId}

where the backend retrieves the member solely by ID.

The backend must also verify organization scope and authorization.

Conceptually:

find member
where member.id = requestedId
and member.organizationId = authorizedOrganizationId

The exact implementation may differ.

16. Authorization Enforcement

Every protected operation must perform appropriate server-side authorization.

The backend must consider:

authenticated user
organization
organization membership
role
permission
resource ownership/scope
subscription entitlement where applicable
business state

Frontend permission checks are not security controls.

17. Privilege Escalation Protection

Users must not be able to escalate privileges by modifying client requests.

Examples of prohibited behavior:

role=OWNER

or:

organizationId=anotherOrganization

or:

confirmed=true

or:

paymentStatus=PAID

Client-provided security-sensitive state must never be trusted.

The backend must derive or validate sensitive state.

18. Payment Security

Payment data requires strong integrity controls.

The system must distinguish:

Charge
Payment Claim
Confirmed Payment
Membership Renewal

A member payment claim is not a confirmed payment.

19. Payment Claim Security

A MEMBER may submit:

I have paid.

The system must not treat this as proof of payment.

The claim should enter a verification state.

Only authorized staff may confirm the actual payment.

20. Payment Confirmation Security

Payment confirmation must require:

authenticated user
organization membership
payment-verification permission
valid target payment/claim
valid payment state
valid amount
tenant scope

The system must prevent duplicate confirmation.

Concurrent confirmation requests must be handled safely.

21. Payment Amount Integrity

The client must not be trusted to determine final financial state.

For example, a malicious request must not be able to change:

amountReceived = 1

into an unauthorized financial record without backend validation.

The backend must validate:

amount
currency
associated charge
organization
member
payment state
authorization
22. Payment History Protection

Confirmed payment records should not normally be silently edited or deleted.

Corrections should use an explicit auditable mechanism such as:

reversal
adjustment
correction record

The exact mechanism will be defined during payment implementation.

23. Membership Renewal Security

Payment confirmation and membership renewal are separate operations.

The system must not allow:

Payment claimed
    ↓
Automatic renewal

unless an explicitly approved renewal rule exists.

A payment claim must never automatically extend membership.

24. Financial Calculations

Outstanding balance should be derived from authoritative financial records.

Conceptually:

Outstanding
=
Charge Total
-
Sum of Confirmed Payments

The application must not rely on an untrusted client-provided balance.

Financial amounts must use an exact representation suitable for monetary calculations.

25. Attendance Security

Attendance operations must be protected against:

duplicate check-ins
unauthorized check-ins
cross-tenant attendance access
unauthorized attendance correction
manipulation of another member's attendance
concurrent duplicate requests

Attendance correction must require appropriate permission.

26. Data Validation

All backend inputs must be validated.

Validation should include:

type
format
required fields
length
numeric boundaries
enum/state values
organization scope
relationship validity
business rules

Client-side validation may improve UX but cannot replace backend validation.

27. API Security

Backend endpoints must:

require authentication where appropriate
enforce authorization
validate input
enforce tenant scope
prevent unauthorized state changes
return safe errors
avoid exposing internal implementation details

APIs must not trust:

organization IDs
user IDs
roles
permissions
payment status
membership status
administrative flags

provided by the client without server-side verification.

28. Request Abuse and Rate Limiting

Rate limiting should be applied to abuse-sensitive operations.

Important examples:

OTP requests
OTP verification
authentication endpoints
member onboarding
payment claim creation
payment confirmation
sensitive administrative actions
expensive exports
notification-triggering operations

Limits should be based on actual threat/risk and adjusted as usage data becomes available.

29. Replay and Idempotency

Important operations must consider replayed requests.

Examples:

check-in
payment confirmation
payment claim submission
subscription activation
notification submission

The system should use appropriate:

unique constraints
state checks
idempotency keys
transactions
locking

where required.

Not every endpoint requires an idempotency key.

30. Concurrency Security

Security and data integrity must hold even when multiple requests occur simultaneously.

Important cases include:

Two check-ins at the same time
Two staff members confirming one payment
Two membership updates
Two role changes
Two subscription activations

Application logic must not assume requests are sequential.

31. CSRF Protection

State-changing browser requests must be protected against cross-site request forgery where applicable to the chosen authentication/session architecture.

The exact mechanism depends on the final Next.js/API/authentication implementation.

The implementation must not disable CSRF protections merely for convenience.

32. XSS Protection

User-controlled content may include:

member names
gym names
announcements
notes
other text fields

The application must safely render user-controlled content.

The system must avoid unsafe HTML injection.

Any feature allowing rich HTML must receive explicit security review.

33. Injection Protection

Database queries must use parameterized queries or safe ORM/database mechanisms.

The application must not construct SQL queries by directly concatenating untrusted user input.

The same principle applies to:

shell commands
HTML
URLs
external provider requests
other interpreters
34. Secrets Management

Secrets may include:

database credentials
authentication provider secrets
WhatsApp credentials
API keys
signing secrets
cloud credentials
encryption keys

Secrets must:

never be committed to Git
never be hard-coded
never be included in screenshots
never be placed in public frontend code
never be logged
never be stored in documentation

.env.example may contain variable names only.

35. Environment Separation

At minimum:

Development
Test
Production

must remain logically separated.

Production credentials must not be used in local development.

Development/test data should not contain unnecessary real member information.

36. Logging Security

Logs must not contain:

OTP values
passwords
authentication tokens
API secrets
database credentials
private keys
unnecessary full phone numbers
unnecessary sensitive payment information

Logs should use identifiers where possible instead of sensitive raw values.

37. Error Message Security

Errors must be useful without revealing sensitive internal information.

The application should not expose:

database connection details
SQL queries
stack traces in production
authentication secrets
internal infrastructure details
other users' information
cross-tenant resource existence where inappropriate
38. Audit Logging

Security-sensitive actions should be auditable.

Potential events include:

role changes
staff access changes
payment confirmation
payment correction
membership correction
attendance correction
subscription activation
account recovery
sensitive settings changes

Audit logs should include relevant:

actor
organization
action
resource
timestamp

Audit records must not contain secrets.

39. Account Recovery

Account recovery is security-sensitive.

If an owner loses access to their phone:

Normal OTP authentication may no longer work.
The application must not provide an insecure self-service bypass.
A controlled support/recovery process should be used initially.
Identity/ownership verification should be performed according to the approved recovery procedure.
Recovery actions should be audited.

The exact recovery workflow requires additional security review before implementation.

40. Staff Account Security

Staff accounts must use their own authenticated identities.

Shared credentials should not be used.

This allows the system to determine:

who performed an action
which organization they acted in
which role they had
which sensitive operation they performed

This is particularly important for payment and administrative operations.

41. Authentication Provider Security

The selected authentication provider must be configured according to its current security recommendations.

The application should minimize reliance on provider-specific behavior outside the authentication boundary.

If the authentication provider changes in the future, application authorization should remain intact.

42. WhatsApp Security

WhatsApp is a notification channel, not an authentication system.

WhatsApp credentials must be protected as secrets.

Notification records must be tenant-scoped.

The application must not expose provider credentials to the browser.

Business-initiated messaging must follow the applicable provider requirements, consent/opt-in requirements, and template rules.

Provider-specific implementation must remain isolated.

43. External Provider Failure

External provider failures must not corrupt core business state.

Examples:

WhatsApp unavailable
Authentication provider unavailable
Storage unavailable

The application should distinguish:

Business state

from:

External delivery state

For example, failure to send a WhatsApp reminder must not change a member's membership state.

44. Export Security

CSV exports may contain significant personal and business information.

Export functionality must:

require authorization
enforce organization scope
limit available datasets by role
avoid unnecessary data
protect generated files
avoid exposing exports publicly
consider expiration/cleanup for temporary files
45. Data Minimization

The application should collect only information necessary for the product.

For example, the initial member model should not collect unrelated personal information simply because it might be useful later.

Every new sensitive field should have a clear product reason.

46. Data Exposure

The system should minimize sensitive data returned by APIs.

An endpoint should return only the fields required for the operation or screen.

Example:

A member-facing endpoint should not return:

internal staff information
unrelated members
private administrative notes
unnecessary organization configuration
47. Browser Storage

Sensitive application information should not be placed into browser storage unnecessarily.

The application should carefully evaluate use of:

localStorage
sessionStorage
IndexedDB
service-worker caches

Authentication/session secrets must follow the chosen authentication architecture's secure practices.

48. PWA Security

PWA caching must not accidentally expose private tenant data.

Private authenticated responses should not be cached in a way that allows another user to access them.

Offline functionality must not bypass:

authentication
authorization
tenant isolation
financial state validation
49. Dependency Security

Dependencies must be:

intentionally selected
kept reasonably current
reviewed for known security vulnerabilities
removed when unnecessary

Automated dependency/security checks may be used where appropriate.

AI-generated dependency additions require review.

50. AI-Assisted Development Security

AI tools must not receive:

production secrets
authentication tokens
database passwords
private API credentials
WhatsApp credentials
private customer information

AI-generated code must be reviewed for:

authorization flaws
tenant isolation issues
unsafe queries
secret exposure
insecure defaults
missing validation
incorrect state transitions

AI output is not considered security-approved merely because it compiles or passes basic tests.

51. Security Testing

Security testing must include at minimum:

Authentication
invalid OTP
expired OTP
excessive OTP attempts
OTP resend abuse
Authorization
unauthorized role
missing organization membership
wrong organization
wrong resource
privilege escalation
Tenant Isolation
cross-tenant member access
cross-tenant payment access
cross-tenant attendance access
cross-tenant announcement access
manipulated organization IDs
Payments
unauthorized confirmation
duplicate confirmation
altered amount
invalid claim state
partial payment correctness
payment/renewal separation
Attendance
duplicate check-in
unauthorized attendance access
cross-tenant attendance
unauthorized correction
Input Security
malformed input
oversized input
injection attempts
unsafe content rendering
52. Security Review Checklist

Before implementing a sensitive feature, ask:

[ ] Who is the user?
[ ] Which organization are they acting in?
[ ] Are they a member of that organization?
[ ] What role do they have?
[ ] What permission is required?
[ ] Does the resource belong to that organization?
[ ] Can the user access this specific resource?
[ ] Is subscription entitlement relevant?
[ ] Can the request be replayed?
[ ] Can concurrent requests cause corruption?
[ ] Is rate limiting required?
[ ] Is sensitive data exposed?
[ ] Is an audit record required?
[ ] Are secrets protected?
[ ] Are errors safe?
[ ] Are tests covering unauthorized behavior?
53. Security Incident Principles

If a security incident is suspected:

Preserve relevant evidence.
Identify affected accounts/organizations.
Restrict or revoke compromised access where appropriate.
Rotate affected credentials/secrets.
Investigate the scope.
Protect affected customer data.
Document the incident.
Apply corrective controls.

A detailed incident-response procedure should be created before production scale requires it.

54. Security vs Convenience

The system should not weaken security merely to make a workflow slightly easier.

Examples:

Do not remove OTP rate limits because they inconvenience users.
Do not trust a QR code as authentication because it simplifies onboarding.
Do not allow members to self-confirm payments because it removes staff work.
Do not trust frontend role checks because backend checks require more code.
Do not expose additional data merely because it simplifies frontend development.

Security-sensitive shortcuts require explicit architectural approval.

55. What We Will Not Do

The initial system will not:

build custom authentication unnecessarily
use QR codes as authentication credentials
trust client-provided roles
trust client-provided payment state
expose OTP values
log secrets
use phone numbers as primary identity keys
allow cross-tenant resource access
store unnecessary sensitive data
use unofficial WhatsApp infrastructure as the production security foundation
implement insecure owner recovery merely for convenience
treat frontend restrictions as authorization
56. Security Evolution

Security requirements should evolve as the product gains:

users
organizations
real payment activity
real notification volume
production traffic
additional integrations

Security changes must be documented when they materially affect architecture or user data.

57. Relationship to Other Documents

This document depends on:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md

Related documents:

07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
58. Document Status

Current status: Initial security definition.

This document establishes the security requirements for the initial product architecture.

Security-sensitive implementation must preserve the requirements defined here.

Where a feature introduces a new security-sensitive capability, its threat model and security requirements must be reviewed before implementation.

No production implementation should proceed when a required security decision remains undefined.
