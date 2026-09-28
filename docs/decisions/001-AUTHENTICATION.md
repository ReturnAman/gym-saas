# ADR 001 — Authentication Architecture

**Project:** gym-saas  
**Status:** Accepted  
**Date:** 2026-09-29  
**Decision Type:** Security / Architecture

---

# 1. Context

gym-saas requires authentication for multiple user types:

- OWNER
- ADMIN
- STAFF
- TRAINER
- MEMBER

The application uses phone-based onboarding and OTP verification.

Authentication must be separated from authorization.

Authentication answers:

> Who is this user?

Authorization answers:

> What is this user allowed to do in this organization?

The application must remain responsible for authorization even if an external authentication provider is used.

---

# 2. Requirements

The authentication system must support:

- Phone-based authentication
- OTP verification
- Owner onboarding
- Member onboarding
- Multiple organizations per user
- Secure sessions
- Logout
- Session expiration/revocation
- Rate limiting
- OTP expiration
- OTP attempt limits
- OTP resend cooldown
- Abuse protection
- Generic responses where enumeration is possible
- Secure server-side authentication checks
- Integration with organization membership and roles

Phone number must not be treated as the application's primary identity key.

---

# 3. Architectural Separation

The system uses two distinct layers.

## Authentication

Responsible for:

- User identity
- Login
- OTP verification
- Sessions
- Session lifecycle

## Authorization

Responsible for:

- Organization membership
- Roles
- Permissions
- Resource ownership
- Tenant isolation
- Action authorization

Conceptually:

```text
Authentication
      ↓
Authenticated User
      ↓
Organization Membership
      ↓
Role
      ↓
Permission
      ↓
Resource Access
4. Selected Authentication Provider

The selected authentication provider is:

Clerk

Status: Accepted (2026-09-29)

Reasons for selection:

Student benefit availability
Managed authentication infrastructure
Reduced implementation burden
Session management
User management
Integration with modern web applications

Responsibility boundary:

Clerk is responsible for authentication and identity: who the user is,
credentials, and sessions.

The application remains responsible for authorization, organization
membership, roles, tenant isolation, and business permissions.

Business authorization must not be moved into Clerk.

5. Provider Boundary

The application should avoid coupling business logic directly to provider-specific user representations.

The application should maintain its own application-level identity model.

Conceptually:

Authentication Provider
        ↓
Authenticated Identity
        ↓
Application User
        ↓
Organization Membership
        ↓
Authorization

The provider should authenticate the person.

The application's database should determine the person's relationship with gyms.

6. Phone Number Rules

Phone numbers are authentication/discovery attributes.

They are not the primary key for:

users
organizations
memberships
payments
attendance
other domain entities

A user may change their phone number.

A user may belong to multiple organizations.

Therefore:

User ID

is the application's stable identity.

7. Member Authentication Flow

The intended member flow is:

Permanent Gym QR
        ↓
Identify Organization
        ↓
Member Enters Phone
        ↓
Server Checks Membership Association
        ↓
OTP Request
        ↓
OTP Verification
        ↓
Authenticated User
        ↓
Organization Membership
        ↓
Member Access

Important:

The QR code identifies the gym but does not authenticate the member.

OTP verification proves control of the phone number.

The backend then determines whether the authenticated user has access to the organization.

8. Owner Authentication Flow

The intended owner flow is:

Phone
 ↓
OTP
 ↓
Authenticated User
 ↓
Gym Information
 ↓
Organization Creation
 ↓
OWNER Organization Membership
 ↓
Trial Subscription

OTP verification proves control of the phone number.

It does not independently prove legal ownership of the gym.

9. Multiple Organizations

A single authenticated user may belong to multiple organizations.

Example:

User
 ├── Organization A → OWNER
 ├── Organization B → OWNER
 └── Organization C → TRAINER

Authorization must always operate within an organization context.

The currently selected organization must never override server-side authorization checks.

10. Session Security

Sessions must be handled securely.

The application should:

validate authentication server-side
avoid trusting client-provided identity information
use secure session mechanisms
protect session credentials
handle expiration
support logout/revocation where applicable
avoid exposing authentication tokens unnecessarily
never log session tokens
11. OTP Security

OTP flows must include:

Short expiration time
Maximum verification attempts
Resend cooldown
Request rate limiting
IP/device/request throttling where appropriate
Abuse detection
Generic responses where necessary
No OTP logging

Example:

OTP Requested
     ↓
Cooldown
     ↓
OTP Sent
     ↓
Limited Attempts
     ↓
Short Expiration
     ↓
Verified / Failed / Expired

Exact numeric limits should be defined during implementation/security review rather than hard-coded in this ADR.

12. Account Enumeration Protection

Authentication-related responses should avoid unnecessarily revealing whether:

a phone number exists
a member exists
a user belongs to a gym
an account exists

Where appropriate, responses should be intentionally generic.

The server may internally determine the correct state while exposing a safe response externally.

13. Authentication vs Membership

Authentication does not automatically grant gym access.

Example:

Phone verified
      ↓
User authenticated
      ↓
Does user have OrganizationMembership?
      ↓
YES → continue authorization
NO  → deny organization access

This distinction is mandatory.

14. Authentication vs Role

Authentication does not determine the user's role.

Role comes from organization membership.

Example:

User
  ↓
OrganizationMembership
  ↓
Role = STAFF

The frontend must never be trusted to determine this role.

15. Server-Side Enforcement

Protected backend operations must validate:

Authenticated user
Organization context
Organization membership
Role/permission
Resource ownership
Business rules

Example:

Request
  ↓
Authenticate
  ↓
Resolve User
  ↓
Resolve Organization
  ↓
Check Membership
  ↓
Check Permission
  ↓
Check Resource Tenant
  ↓
Execute Operation
16. Provider Failure Considerations

The application should avoid unnecessary dependency on authentication-provider-specific business logic.

If the authentication provider becomes unavailable:

existing authentication behavior depends on provider availability
application data must remain intact
organization and membership data must remain intact
provider replacement should be possible without redesigning the domain model

The application should not store unnecessary provider-specific assumptions throughout the codebase.

17. Account Recovery

Initial account recovery should use the authentication provider's supported recovery mechanisms where appropriate.

If a user loses access to their registered phone number, recovery may require a manual support/security workflow.

Recovery must not allow a person to bypass normal authorization.

18. Authentication Data

The application should store only the authentication-related data required by the product.

Domain data should remain in the application's database.

Examples:

Application Database

User
Organization
OrganizationMembership
Role
Member
Membership
Payment
Attendance
...

Authentication-provider data should not become the application's domain database.

19. Security Requirements

Authentication implementation must not:

trust client-provided user IDs
trust client-provided roles
trust client-provided organization IDs without authorization checks
log OTPs
log authentication tokens
use phone numbers as primary keys
bypass membership checks
allow frontend-only authorization
expose sensitive authentication state unnecessarily
20. Decision

**Decision: Clerk is the selected authentication provider for gym-saas.**

- Status: Accepted
- Date: 2026-09-29

Regardless of this selection, the following remain true:

authentication and authorization remain separate
application users remain distinct from provider users
organization membership remains application-owned
roles remain application-owned
tenant isolation remains application-enforced
phone number is not the primary key
21. Consequences
Positive
Reduced authentication implementation complexity
Less security-sensitive infrastructure to build ourselves
Faster initial development
Clear separation between authentication and authorization
Easier future provider replacement
Negative
External provider dependency
Provider-specific integration work
Potential future migration cost
Authentication functionality may depend on provider availability
Provider pricing/limits may affect future scale
22. Future Reassessment

Reassess the authentication provider if:

pricing becomes unsuitable
product requirements change
phone authentication requirements change
provider limitations become significant
compliance requirements change
scale introduces architectural constraints
provider lock-in becomes materially harmful
23. Related Documents
AI_CONTEXT.md
AGENTS.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
24. Approval

Decision Owner: Project Owner

Status: Accepted

Approved: Yes

Approval Date: 2026-09-29
