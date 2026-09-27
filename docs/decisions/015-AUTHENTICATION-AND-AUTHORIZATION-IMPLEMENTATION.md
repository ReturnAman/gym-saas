# ADR 015: Authentication and Authorization Implementation

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Security / Identity / Authorization
- Related:
  - `05-AUTHORIZATION.md`
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `decisions/001-AUTHENTICATION.md`
  - `decisions/008-API-CONVENTIONS.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md`

---

## 1. Context

The gym SaaS has multiple types of users and multiple levels of access.

The system must support:

- gym owners
- administrators
- trainers
- staff
- members
- users belonging to multiple organizations
- members onboarding through gym QR codes
- phone-based OTP authentication
- organization-scoped permissions
- resource-level authorization
- secure backend enforcement

Authentication and authorization are related but separate problems.

Authentication answers:

> Who is this user?

Authorization answers:

> What is this user allowed to do here?

The system must not treat successful authentication as permission to access every organization or every resource.

---

# 2. Decision

The application will use the following security model:

```text
Authentication
    ↓
Application User
    ↓
Organization Membership
    ↓
Role
    ↓
Permission
    ↓
Resource / Action Authorization

The application will own authorization decisions even if an external authentication provider is used.

Authentication-provider identity will not replace the application's domain identity.

3. Authentication Provider

The current leading authentication candidate is Clerk, based on the project requirements and student benefits.

However:

Clerk is not considered permanently coupled to the domain model.

The application must maintain its own user and organization relationships.

Conceptually:

Authentication Provider
        ↓
authenticated identity
        ↓
application User
        ↓
organization memberships
        ↓
permissions

The final provider decision remains subject to the authentication ADR and implementation validation.

4. Authentication vs Authorization

These concepts must remain separate.

Example:

User successfully authenticates
        ↓
User identity established

This does not mean:

User can access every gym.

The backend must determine organization membership and permissions separately.

5. Application User

The application should maintain a User entity representing the application's identity.

Conceptually:

User
├── id
├── phone
├── phone_verified_at
├── auth_provider_id
├── created_at
└── updated_at

The exact schema follows the database design.

The application user ID is the internal identity used throughout the domain.

6. Phone Number

Phone number is used for authentication/discovery according to the approved onboarding flows.

Phone number is not:

the primary key
the authorization key
the organization membership key

Phone numbers may change.

The application identity should remain stable when a phone number changes through an approved recovery/update flow.

7. OTP Authentication

The application supports phone OTP authentication where required.

OTP security requirements include:

short expiration
limited verification attempts
resend cooldown
request rate limiting
verification rate limiting
abuse protection
generic responses where enumeration is possible
no OTP logging
no OTP persistence beyond what is necessary
secure provider handling

The exact OTP mechanism depends on the selected authentication provider.

8. OTP Is Identity Proof

Successful OTP verification establishes control of the verified phone number.

It does not independently establish:

gym ownership
organization membership
staff authorization
payment authorization
access to another user's data

These must be determined separately.

9. Owner Onboarding

Initial owner onboarding follows the conceptual flow:

Phone
  ↓
OTP
  ↓
Authenticated User
  ↓
Minimal Gym Details
  ↓
Organization Creation
  ↓
Organization Membership
  ↓
OWNER Role
  ↓
Trial Subscription

The phone OTP proves control of the phone.

It does not prove legal ownership of the gym.

10. Organization Creation

Creating an organization is a privileged operation.

The backend must validate:

authenticated user
trial eligibility
organization creation limits
required gym information
abuse controls

The frontend must never be trusted to establish ownership.

11. Owner Role

The initial creator of an organization receives:

OWNER

through an organization membership relationship.

Conceptually:

organization_memberships

user_id
organization_id
role = OWNER

The organization should not depend on a single:

organizations.owner_id

because the product supports multiple owners.

12. Multiple Owners

Multiple users may have the OWNER role within the same organization if the product allows it.

Each owner should have:

their own account
their own authentication
their own organization membership
their own audit identity

Shared owner credentials are prohibited.

13. Multiple Organizations

A single user may belong to multiple organizations.

Example:

User
 ├── Organization A → OWNER
 ├── Organization B → OWNER
 └── Organization C → TRAINER

Authorization must therefore always include organization context.

A role in Organization A does not automatically grant the same role in Organization B.

14. Organization Membership

OrganizationMembership is the authorization relationship between:

User
+
Organization

It should contain information such as:

id
user_id
organization_id
role
status
created_at
updated_at

The exact schema follows the database design.

15. Roles

Initial roles:

OWNER
ADMIN
TRAINER
STAFF
MEMBER

Roles are organization-scoped.

A user can have different roles in different organizations.

16. Roles Are Not the Entire Authorization Model

The application should not scatter logic like:

if role === "OWNER"

throughout the codebase.

Role checks should map to explicit permissions or authorization policies where practical.

Conceptually:

Role
  ↓
Permissions
  ↓
Action

For simple V1 operations, a direct role-to-permission mapping may be sufficient.

17. Permission Examples

Potential permissions include:

organization.view
organization.update

members.view
members.create
members.update
members.archive

membership.view
membership.create
membership.renew

payments.view
payments.create
payments.confirm
payments.reject

attendance.view
attendance.create

staff.view
staff.manage

announcements.create
announcements.update

reports.export

The exact permission catalog must be finalized during implementation.

Do not create permissions for every possible UI button.

Permissions should represent meaningful business actions.

18. Backend Authorization

Every protected backend operation must verify authorization.

The minimum conceptual check is:

authenticated user
        ↓
organization membership
        ↓
role/permission
        ↓
resource organization
        ↓
requested action

All relevant checks must occur server-side.

19. Frontend Is Not a Security Boundary

The frontend may hide:

buttons
navigation items
screens
actions

based on permissions.

But this is only a UX optimization.

An attacker can bypass the frontend and call the API directly.

Therefore:

Frontend permission check
≠
Security

Backend authorization remains mandatory.

20. Tenant Isolation

Every organization-owned resource must be scoped to the authenticated organization.

Example:

GET /api/members/:memberId

The backend must verify that:

member.organization_id
=
authorized organization

A valid member ID is not enough.

21. Cross-Tenant Access

Example:

Organization A
    Member ID = X

Organization B user
    requests Member X

The request must not expose Organization A's member data.

The backend must reject the operation according to the endpoint's authorization/error strategy.

22. Resource-Level Authorization

Organization membership alone may not be enough.

Example:

Trainer
    ↓
Organization A
    ↓
tries to modify payment

The trainer may belong to the organization but still lack payment-management permission.

Authorization must consider:

Who?
Which organization?
Which role?
Which resource?
Which action?
23. Member Authorization

Members should only access their own member-specific data unless a product feature explicitly allows broader access.

Examples:

Member A
    ↓
own attendance
own membership
own payment status
own announcements

Member A must not access:

Member B's attendance
Member B's payment
Member B's personal information
24. Member and User Separation

The system distinguishes:

User

from:

Member

A member may exist before they have an application user account.

Example:

Owner creates member
        ↓
Member record exists
        ↓
No linked user yet
        ↓
Member completes QR + OTP onboarding
        ↓
User linked to member

The database must support this lifecycle.

25. Member Linking

When a member completes onboarding, the backend must verify:

authenticated identity
verified phone
target organization
matching eligible member
existing link state
whether the link is allowed

The system must not simply trust:

memberId

provided by the client.

26. QR Codes

The gym QR code identifies the organization.

It does not authenticate the user.

The flow is:

Scan QR
    ↓
identify organization
    ↓
enter phone
    ↓
OTP verification
    ↓
find eligible member
    ↓
link/access member account

The QR must not itself grant access to private gym data.

27. QR Security

QR identifiers should not contain unnecessary sensitive information.

The system must not assume:

Anyone who scans the QR is a gym member.

The QR is an organization discovery mechanism.

Authorization occurs after identity and membership checks.

28. Generic Membership Responses

Member onboarding should avoid revealing whether an arbitrary phone number belongs to a gym.

For example, a public onboarding endpoint may respond generically:

If eligible:
    OTP process continues.

If not eligible:
    outward response remains appropriately generic.

This reduces membership enumeration risk.

29. Member Access After Authentication

After OTP verification:

authenticated user
        ↓
find organization memberships
        ↓
find member relationship
        ↓
authorize requested organization
        ↓
allow member features

The frontend should not be able to select an arbitrary organization and gain access.

30. Multiple Gym Memberships

A user may belong to multiple gyms.

After authentication, the application may need to allow gym selection.

Example:

User
 ├── Gym A
 └── Gym B

The selected organization must still be verified against the authenticated user's organization memberships.

31. Role Assignment

Role changes are privileged actions.

Only authorized roles should be able to:

add staff
remove staff
change roles
grant owner/admin access

The backend must validate both:

actor permission

and:

target organization
32. Owner Protection

Owner-level operations require especially strong authorization.

Examples:

adding another owner
removing an owner
changing subscription settings
changing critical organization settings
transferring ownership, if implemented

The application should not allow a lower-privileged role to invoke these operations through direct API calls.

33. Last-Owner Protection

If the product requires at least one owner per organization, the backend must prevent removal/demotion of the last owner.

This is a business invariant.

The implementation may use:

transaction
+
current owner count
+
state transition

to prevent concurrent operations from leaving the organization without an owner.

The exact rule must be confirmed before implementation.

34. Authorization During Concurrent Changes

Authorization can change while a request is being processed.

Example:

Staff member starts payment confirmation
        ↓
Admin removes payment permission

The implementation must define the expected behavior.

Sensitive state-changing operations should evaluate authorization against current server-side state.

The exact transaction boundary depends on the operation.

35. Subscription and Authorization

Subscription state and authorization are related but separate.

Example:

Organization
    ↓
Subscription
    ↓
Entitlements
    ↓
Feature access

A user's role answers:

"Is this person allowed to perform this action?"

Subscription entitlement answers:

"Does this organization have access to this feature?"

Both may need to be checked.

36. Authorization Decision Model

A protected operation can conceptually require:

Authentication
AND
Organization Membership
AND
Role/Permission
AND
Resource Ownership/Tenant Match
AND
Feature Entitlement

Not every endpoint requires every condition.

The policy must be defined according to the operation.

37. Example: Confirm Payment

A payment confirmation endpoint might require:

Authenticated user
        AND
Organization membership
        AND
Payment-confirmation permission
        AND
Payment belongs to organization
        AND
Payment claim is processable
        AND
Feature entitlement if applicable

Only then should the payment confirmation transaction execute.

38. Example: Member Attendance

A member attendance endpoint might require:

Authenticated user
        AND
Member belongs to selected organization
        AND
User is linked to that member
        AND
Membership/check-in rules permit attendance

Owner/staff attendance operations may use a different permission policy.

39. Example: Member List

Owner/admin/staff may be allowed to list members.

A member should not automatically receive:

GET /api/members

just because they are authenticated.

The endpoint requires an appropriate organization-scoped permission.

40. Authorization Helpers

Small reusable authorization functions/services should be used to avoid repeated mistakes.

Conceptually:

requireAuthenticatedUser()
requireOrganizationMembership()
requirePermission()
requireResourceInOrganization()
requireFeatureEntitlement()

The implementation should remain explicit enough to understand the authorization path.

41. Avoid Client-Supplied Role

The client must never be able to establish authorization through fields such as:

{
  "role": "OWNER"
}

A request may contain a target role when an authorized administrator is assigning one, but the backend must independently verify that the actor is allowed to assign it.

42. Avoid Client-Supplied Organization Trust

Similarly, this is not sufficient:

{
  "organizationId": "..."
}

The server must verify that the authenticated user has access to that organization.

Client-provided organization IDs are selectors, not authorization proof.

43. Organization Context

The API may determine organization context from:

authenticated membership
URL/resource
selected organization identifier
request context

Regardless of how it is supplied, the backend must validate it.

Example:

Request organizationId
        ↓
lookup membership
        ↓
authorize
        ↓
use verified organization ID internally
44. Resource Ownership Checks

For organization-owned resources:

resource.organization_id

must match the authorized organization.

For member-owned resources:

resource.member_id

must match the authenticated member where required.

For user-owned resources:

resource.user_id

must match the authenticated user where required.

45. Authorization and Query Design

Authorization should be reflected in database queries where practical.

Prefer:

SELECT *
FROM payments
WHERE id = :paymentId
  AND organization_id = :organizationId;

over:

SELECT *
FROM payments
WHERE id = :paymentId;

followed by an easily-forgotten separate tenant check.

This reduces accidental cross-tenant access.

46. Authorization Middleware

Authentication middleware may establish:

authenticated user

But middleware alone should not automatically decide every resource permission.

Resource-specific authorization belongs close enough to the operation to understand:

organization
role
resource
action
state
47. Authorization Policy Layer

A policy layer may be introduced for repeated authorization rules.

Example:

canConfirmPayment(actor, payment)
canManageMember(actor, member)
canManageStaff(actor, organization)
canViewAttendance(actor, member)

Policies should be:

deterministic
testable
server-side
independent of UI presentation
48. Authorization and Business Rules

Authorization and business validation are different.

Example:

Staff has permission to confirm payment

does not mean:

Payment claim is still pending

Both must be checked.

Conceptually:

Authorization
+
Business State
=
Allowed Operation
49. Authorization and Database Constraints

Database constraints provide structural integrity.

They do not replace authorization.

For example:

Foreign key ensures payment belongs to a member.

It does not prove:

the current user is allowed to view that payment.

Both layers are required.

50. Permission Changes

Permission changes should take effect according to the application's current authorization state.

The system should avoid long-lived authorization caches in V1 unless necessary.

If caching is introduced later, invalidation becomes a security concern.

51. Session and Token Handling

Authentication/session tokens must be handled by the selected authentication mechanism.

Application code must not:

log tokens
expose tokens in URLs
store them in unsafe application state
return them unnecessarily
persist them in plaintext where not required

The exact session implementation depends on the selected authentication provider.

52. Logout

Logout should invalidate the relevant authenticated session according to the authentication provider's model.

Application-level authorization state should not assume that logout is equivalent to deleting the application user.

The user's organization memberships and historical data remain unless explicitly changed.

53. Account Recovery

Account recovery is security-sensitive.

If a user loses access to their phone, the application must not provide a weak recovery path such as:

"Tell support your name and we will change the phone."

The initial product should use a controlled manual recovery process.

The exact verification workflow should be documented separately.

54. Owner Recovery

Owner recovery is particularly sensitive because an owner can access:

member data
payments
staff
organization settings
subscription information

Therefore, lost-owner-phone recovery must use a stronger support/security workflow than normal member onboarding.

55. Authentication Provider Failure

If the authentication provider is unavailable:

new authentication

may fail.

The application should not invent an insecure bypass.

Existing authenticated sessions may continue according to the provider's session behavior.

The application must not create its own emergency authentication mechanism without a documented security design.

56. Rate Limiting

Authentication and authorization-sensitive operations should have rate limits.

Especially:

OTP request
OTP verification
member discovery
login
organization creation
sensitive mutation endpoints

Rate limiting is an additional abuse control.

It is not a replacement for authorization.

57. Audit Logging

Security-sensitive authorization changes should be auditable.

Examples:

OWNER_ADDED
OWNER_REMOVED
ROLE_CHANGED
MEMBER_LINKED
MEMBER_UNLINKED
PAYMENT_CONFIRMED
SUBSCRIPTION_UPDATED

Audit records should identify the actor and organization where applicable.

58. Authorization Test Strategy

Every protected feature should have authorization tests.

At minimum:

Correct role
authorized actor
→ succeeds
Wrong role
authenticated but unauthorized actor
→ rejected
Wrong organization
valid user from Organization B
requests Organization A resource
→ rejected
Wrong member
Member A requests Member B resource
→ rejected
Unauthenticated
no valid session
→ rejected
59. Authorization Test Matrix

For important operations, tests should cover:

Actor	Organization	Permission	Expected
Owner	Correct	Yes	Allow
Admin	Correct	Yes	Allow
Staff	Correct	Depending on permission	Allow/Reject
Trainer	Correct	Depending on permission	Allow/Reject
Member	Correct	Member-only action	Allow
Member	Correct	Owner action	Reject
User	Wrong	Any	Reject
Unauthenticated	None	Any	Reject

The exact permissions should come from the final authorization matrix.

60. Security Review Checklist

Before approving a protected endpoint:

 Authentication is required.
 Organization context is verified.
 Role/permission is verified.
 Resource organization is verified.
 Member ownership is verified where applicable.
 Subscription entitlement is checked where required.
 Client-supplied role is not trusted.
 Client-supplied organization ID is not trusted.
 Client-supplied member ID is not trusted.
 Cross-tenant access is tested.
 Enumeration risk is considered.
 Rate limiting is considered.
 Sensitive actions are audited.
 Errors do not leak protected data.
61. What This Decision Does Not Finalize

This ADR does not finalize:

exact Clerk implementation
exact OTP provider configuration
final permission catalog
final role matrix
exact middleware structure
exact account recovery procedure
exact session duration
exact rate-limit infrastructure
future enterprise SSO
future organization-level policy engine

These should be finalized when implementation requirements are concrete.

62. Consequences
Positive
Clear separation of authentication and authorization
Stronger tenant isolation
Safer multi-organization access
Explicit backend security
Easier testing
Reduced accidental privilege escalation
Easier provider replacement
Better support for multiple owners
Clearer member onboarding
Negative
More authorization checks
More security-sensitive code
Requires a permission model
Requires comprehensive authorization testing
Recovery workflows require operational processes
Some endpoints require more database queries or joins

These costs are accepted because authorization is one of the highest-risk parts of a multi-tenant SaaS.

63. Final Rule

Authentication establishes identity.

Authorization establishes permission.

Organization membership establishes tenant access.

Roles and permissions establish allowed actions.

Resource checks establish ownership/scope.

Entitlements establish feature access.

The frontend may improve UX, but it never establishes security.

For every protected operation, ask:

Who is the user?
Which organization are they acting in?
What role/permission do they have?
Which resource are they accessing?
Does that resource belong to the authorized scope?
Is the requested action allowed?
Does the organization have the required entitlement?

If any required condition fails, the backend must reject the operation safely.
