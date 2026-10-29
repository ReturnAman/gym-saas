# Authorization

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** Authorization Definition  
**Scope:** V1 and planned evolution

---

# 1. Purpose

This document defines the authorization model for gym-saas.

Authorization determines what an authenticated user is allowed to do within an organization.

Authentication establishes identity.

Authorization establishes access.

The system must never assume:

> Authenticated = Authorized.

This document defines:

- organization membership
- roles
- permissions
- resource access
- tenant isolation
- backend authorization rules
- sensitive actions
- role changes
- multi-organization access

---

# 2. Authorization Principles

The authorization system must prioritize:

1. Tenant isolation
2. Least privilege
3. Explicit permissions
4. Backend enforcement
5. Clear role boundaries
6. Auditable sensitive actions
7. Predictable behavior
8. Simple maintainable implementation

---

# 3. Authentication vs Authorization

The system separates:

```text
Authentication
      ↓
Who is the user?
      ↓
Application User
      ↓
Organization Membership
      ↓
Role / Permission
      ↓
What may the user do?
Authentication may be provided by an external authentication provider.

Authorization is owned by the application.

4. Organization Membership

A user gains organization access through an OrganizationMembership.

Conceptually:

User
  │
  ├── OrganizationMembership
  │         │
  │         ├── Organization
  │         └── Role
  │
  └── OrganizationMembership
            │
            ├── Organization
            └── Role

A user may belong to multiple organizations.

Membership in one organization does not grant access to another organization.

5. Supported Roles

The initial role model contains:

OWNER
ADMIN
STAFF
TRAINER
MEMBER

Roles are organization-specific.

A user may have different roles in different organizations.

Example:

User
 ├── Gym A → OWNER
 └── Gym B → STAFF
6. Role Definitions
6.1 OWNER

The OWNER represents the highest level of organization administration.

The OWNER may generally:

manage gym settings
manage staff access
assign organization roles
manage members
manage memberships
manage plans
manage payments
confirm payments
manage attendance
manage announcements
view dashboards
perform exports
manage organization-level product settings
manage subscription-related organization actions where applicable

The exact permission list remains defined by the permission matrix below.

6.2 ADMIN

ADMIN supports operational and administrative management.

ADMIN may generally:

manage members
manage memberships
manage plans where permitted
manage attendance
manage payment verification where permitted
manage announcements
view dashboards
perform permitted exports
manage operational staff functions where explicitly allowed

ADMIN must not automatically inherit every OWNER capability.

Sensitive organization-level actions must be explicitly authorized.

6.3 STAFF

STAFF is intended for day-to-day gym operations.

STAFF may generally:

view members
create members
edit permitted member information
manage memberships where permitted
manage attendance
view payment information where permitted
submit or verify payments where explicitly authorized
view announcements

STAFF must not receive organization-administration capabilities by default.

6.4 TRAINER

TRAINER is intended primarily for training-related gym operations.

TRAINER may generally:

view permitted member information
view attendance information where permitted
perform trainer-specific operational actions
interact with future training/engagement features where explicitly authorized

TRAINER does not automatically receive:

payment verification
staff management
organization settings
subscription management
unrestricted member administration
6.5 MEMBER

MEMBER represents the gym customer.

MEMBER may access only their permitted member experience.

A MEMBER may generally:

view their membership
view their attendance
check in
check out where supported
view their payment status
submit payment claims
view announcements
view permitted occupancy information
use approved member engagement features

A MEMBER cannot manage the organization.

A MEMBER cannot access another member's private information.

7. Permission Model

Authorization should be based on explicit permissions rather than relying only on role-name checks throughout the codebase.

Conceptually:

Role
  ↓
Permissions
  ↓
Resource + Action

Examples:

members.view
members.create
members.update

memberships.view
memberships.create
memberships.update

payments.view
payments.claim
payments.confirm

attendance.view
attendance.create
attendance.correct

staff.view
staff.create
staff.update
staff.remove

settings.view
settings.update

announcements.view
announcements.create
announcements.update

exports.create

subscription.view
subscription.manage

Exact permission identifiers should remain stable and descriptive.

8. V1 Permission Matrix

The following is the initial permission model.

Capability	OWNER	ADMIN	STAFF	TRAINER	MEMBER
View dashboard	Yes	Yes	Yes	Limited	Member only
View own profile	Yes	Yes	Yes	Yes	Yes
Manage gym settings	Yes	Limited	No	No	No
View members	Yes	Yes	Yes	Limited	Own only
Create members	Yes	Yes	Yes	No	No
Edit members	Yes	Yes	Yes	Limited	No
Manage membership plans	Yes	Yes	Limited	No	No
Create/update memberships	Yes	Yes	Yes	Limited	No
View attendance	Yes	Yes	Yes	Yes	Own only
Record attendance	Yes	Yes	Yes	Yes	Own only
Correct attendance	Yes	Yes	Limited	Limited	No
View payment information	Yes	Yes	Yes	No by default	Own only
Submit payment claim	No	No	No	No	Yes
Confirm payments	Yes	Yes	Configurable	No by default	No
Correct payment records	Yes	Yes	Restricted	No	No
Manage staff	Yes	Limited	No	No	No
Change staff roles	Yes	Limited	No	No	No
Remove staff access	Yes	Limited	No	No	No
Create announcements	Yes	Yes	Yes	No by default	No
View announcements	Yes	Yes	Yes	Yes	Yes
Export organization data	Yes	Yes	Limited	No	No
View subscription	Yes	Yes	No	No	No
Manage subscription	Yes	Restricted	No	No	No
Manage organization roles	Yes	Restricted	No	No	No

This matrix is the initial product definition.

Specific permissions may later be made configurable for selected roles without weakening backend tenant isolation.

9. Backend Authorization Rule

Every protected backend operation must conceptually perform:

1. Authenticate user
2. Identify organization context
3. Verify organization membership
4. Determine role/permissions
5. Verify requested action
6. Verify resource belongs to organization
7. Verify resource-level access where required
8. Perform operation
9. Record audit event where appropriate

The exact implementation may vary.

The security properties must remain.

10. Tenant Isolation

Tenant isolation is mandatory.

For an organization-scoped resource:

Authenticated User
        ↓
Organization Membership
        ↓
Organization ID
        ↓
Resource Organization ID
        ↓
Authorization

A user must not be able to access another organization's resource by changing an ID in a request.

Example:

GET /members/member-123

must not be authorized solely because the user is authenticated.

The backend must verify that member-123 belongs to an organization the user is authorized to access.

11. Resource-Level Authorization

Role permission alone may not be sufficient.

The system may also need to verify ownership or relationship to a resource.

Example:

A MEMBER may have:

members.view

in a conceptual sense, but that does not mean they can view every member.

They may only access their own member record.

Therefore authorization may depend on:

User
+
Organization
+
Role
+
Permission
+
Resource
+
Relationship to Resource
12. Member Self-Access

A MEMBER may access their own permitted information.

Examples:

Own membership
Own attendance
Own payment information
Own payment claims
Own profile

A MEMBER must not access:

Another member's attendance
Another member's payment information
Another member's membership
Another member's private profile information
Staff information not intended for members
Organization administration
13. Payment Authorization

Payment operations are sensitive.

The system must distinguish:

View Payment
Submit Payment Claim
Confirm Payment
Correct Payment

These are separate permissions.

13.1 Payment Claim

A MEMBER may submit a claim indicating:

I have paid.

The MEMBER cannot directly create a confirmed payment state.

13.2 Payment Confirmation

Only authorized organization users may confirm a payment.

Initial intended access:

OWNER → Yes
ADMIN → Yes
STAFF → Configurable
TRAINER → No by default
MEMBER → No

The backend must verify permission before confirmation.

13.3 Payment Correction

Payment corrections are more sensitive than ordinary payment confirmation.

Only explicitly authorized roles may perform them.

Corrections should preserve financial history.

14. Membership Authorization

Membership operations include:

view membership
create membership
update membership
renew membership
change membership state

Members may view their own membership.

Authorized staff may manage memberships for their organization.

Membership changes must remain tenant-scoped.

15. Attendance Authorization

Attendance operations include:

view attendance
create check-in
complete check-out
correct attendance
view attendance history

A MEMBER may create/view their own attendance.

Authorized staff may manage attendance for their organization.

Attendance correction should be more restricted than ordinary attendance viewing.

16. Staff Authorization

Staff management is organization administration.

Operations include:

view staff
add staff
assign role
change role
disable access
remove access

OWNER has full staff-management authority.

ADMIN may receive selected staff-management permissions.

STAFF and TRAINER do not receive staff-management permissions by default.

17. Role Change Authorization

Changing a user's organization role is a sensitive action.

The backend must:

Authenticate the acting user.
Verify organization membership.
Verify permission to change roles.
Validate the target membership.
Validate the requested role.
Apply the change.
Record an audit event.

The frontend must not be trusted to enforce these rules.

18. Owner Protection

The system must prevent ordinary staff actions from accidentally removing or changing the organization's owner access.

Owner transfer or removal should be treated as a specialized operation.

A future owner-transfer workflow may require additional confirmation and security controls.

No destructive owner-management workflow should be implemented casually.

19. Organization Settings Authorization

Organization settings may include:

gym name
contact information
address
payment configuration
notification settings
operational settings

Access must be permission-controlled.

Sensitive settings should require stronger permissions than ordinary profile editing.

20. Announcement Authorization

Creating or modifying announcements requires organization permission.

Members may view announcements intended for them.

Announcements must always remain organization-scoped.

21. Export Authorization

Exports can contain large amounts of sensitive organization/member information.

Export permission must therefore be explicit.

The backend must verify:

authenticated user
organization membership
export permission
requested dataset
tenant scope

Exports must never contain records from another organization.

22. Subscription Authorization

Subscription information belongs to the organization.

Organization users may have different levels of access.

The initial model is:

OWNER → manage
ADMIN → restricted/view depending on operation
STAFF → no subscription management
TRAINER → no
MEMBER → no

SaaS administrative verification is separate from ordinary organization-member authorization.

23. SaaS Administrator

The SaaS itself may have administrative users who operate outside individual gym organizations.

These users are different from gym OWNER/ADMIN users.

Their permissions must be modeled separately from tenant roles.

Examples of SaaS administrative actions may include:

verifying owner subscription payments
activating subscriptions
reviewing operational issues
handling account recovery
investigating abuse
supporting organizations

SaaS administrator access must not be implemented as a hidden gym role.

24. Multi-Organization Users

A user may belong to multiple organizations.

Example:

User X

Organization A → OWNER
Organization B → TRAINER
Organization C → STAFF

When operating within an organization, the backend must evaluate authorization using the membership for that organization.

Permissions from one organization must never leak into another organization.

25. Organization Context

The active organization may be selected by the frontend.

However:

Selecting an organization does not grant authorization.

The backend must independently verify:

Authenticated User
+
Requested Organization
+
Active Organization Membership

before processing tenant-scoped operations.

26. IDOR Protection

The system must defend against insecure direct object references.

Example attack:

User belongs to Gym A.

User changes:

memberId=123

to:

memberId=456

If member 456 belongs to Gym B, the request must be rejected.

Resource lookup and authorization must be designed together.

27. API Authorization Pattern

Conceptually:

Request
  ↓
Authentication
  ↓
Input Validation
  ↓
Organization Resolution
  ↓
Membership Check
  ↓
Permission Check
  ↓
Resource Scope Check
  ↓
Business Rule Check
  ↓
Database Operation

The exact order may vary when necessary, but no sensitive authorization step should be skipped.

28. Authorization Failure Behavior

When authorization fails:

operation must not occur
sensitive information must not be exposed
error response should be appropriate to the situation
security-relevant failures may be logged

The system should avoid revealing unnecessary information about whether a protected resource exists.

29. Frontend Authorization

The frontend may use permissions to:

hide unavailable actions
disable unavailable controls
simplify navigation
improve UX

However:

Hidden button ≠ Security

A malicious client can bypass frontend restrictions.

Every protected action must be enforced by the backend.

30. Authorization and Database Queries

Authorization and tenant filtering must be considered together.

Unsafe conceptual pattern:

findById(resourceId)

followed by a late authorization decision.

Safer conceptual approach:

find resource
where resource.id = resourceId
and resource.organizationId = authorizedOrganizationId

The exact implementation will depend on the data-access layer.

31. Sensitive Operations

The following should receive particular authorization attention:

role changes
staff removal
owner management
payment confirmation
payment correction
membership correction
attendance correction
subscription management
data exports
account recovery
organization settings
notification configuration
32. Audit Requirements

The following actions should be considered for audit logging:

Staff role changed
Staff access removed
Payment confirmed
Payment corrected
Membership manually changed
Attendance corrected
Subscription activated
Sensitive settings changed
Account recovery performed

Audit requirements may expand as the system evolves.

33. Least Privilege

Users should receive only the permissions required for their role and responsibilities.

The system should not grant broad access merely because it is convenient during implementation.

For example:

A TRAINER who needs attendance access should not automatically receive payment-management permissions.

34. Role vs Permission

Roles are a convenient grouping of permissions.

Permissions represent the actual allowed actions.

Conceptually:

OWNER
  ↓
Many Permissions

ADMIN
  ↓
Selected Permissions

STAFF
  ↓
Operational Permissions

TRAINER
  ↓
Training/Attendance Permissions

MEMBER
  ↓
Self-Service Permissions

Application code should avoid scattering role-specific checks everywhere when a permission-based check is more appropriate.

35. Configurable Permissions

Some permissions may eventually be configurable.

Examples:

STAFF payment confirmation
STAFF attendance correction
ADMIN staff management
TRAINER access to selected member information

However, configurability should not be introduced until the requirements justify it.

V1 should prefer a small, explicit permission model.

36. Authorization Testing

Authorization tests must verify:

Tenant Isolation
User cannot access another organization's data.
User cannot modify another organization's data.
Organization IDs cannot be manipulated to bypass authorization.
Role Isolation
MEMBER cannot perform staff actions.
TRAINER cannot confirm payments by default.
STAFF cannot manage organization settings without permission.
ADMIN cannot automatically perform OWNER-only actions.
Resource Isolation
Member can access only their own member resources.
Staff can access only permitted organization resources.
Sensitive Operations
Unauthorized payment confirmation fails.
Unauthorized role changes fail.
Unauthorized exports fail.
Unauthorized membership changes fail.
Multi-Organization
Same user can have different roles in different organizations.
Permissions from one organization do not apply to another.
37. Authorization and Authentication Provider

The authentication provider may provide:

authenticated identity
authentication session
phone verification

The provider must not become the source of truth for:

organization roles
tenant permissions
payment authorization
member access
organization-specific business rules

Those belong to the application.

38. Authorization and Subscription Entitlements

Role permissions and subscription entitlements are separate concepts.

A user may have permission to perform an action, while the organization's plan may not include that feature.

Conceptually:

User Authorization
        +
Organization Entitlement
        ↓
Allowed Feature/Action

Example:

OWNER
+
Organization has WhatsApp entitlement
        ↓
May configure/use WhatsApp reminders

If the organization does not have the relevant entitlement, the feature should remain unavailable even if the user otherwise has the role permission.

39. Authorization Decision Order

A protected operation should conceptually evaluate:

1. Is the user authenticated?
2. Does the user belong to this organization?
3. Does the user have the required permission?
4. Does the requested resource belong to this organization?
5. Does the user have access to this specific resource?
6. Does the organization have the required entitlement?
7. Is the requested state transition valid?
8. Perform the operation.

Not every operation requires every step, but sensitive operations must evaluate all relevant boundaries.

40. Future Authorization Extensions

Future features may introduce permissions for:

challenges
goals
leaderboards
progress photos
partner offers
gym discovery
affiliate management
advanced analytics
campaigns

These should be added only when the corresponding product features are defined.

41. What We Will Not Do

The authorization system will not:

trust frontend role checks
use phone number as authorization identity
treat QR possession as authentication
allow organization selection to grant access
rely only on role names without considering resource scope
allow payment claims to become confirmed payments without authorization
grant all administrative permissions to every staff user
use authentication-provider roles as the sole source of application authorization
allow cross-tenant access through predictable IDs
introduce an unnecessarily complex policy engine in V1
42. Relationship to Other Documents

This document depends on:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md

Related documents:

06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
11-OBSERVABILITY.md
14-TECH-DECISIONS.md
43. Document Status

Current status: Initial authorization definition.

This document establishes the initial authorization model for V1.

Detailed implementation must preserve the tenant isolation, role, permission, resource-scope, and entitlement boundaries defined here.

No authorization-sensitive production implementation should begin until the relevant security decisions have been sufficiently documented and reviewed.

# 4. SaaS trial/subscription authorization (implemented, branch `feature/saas-trial-subscriptions`)

See `docs/features/saas-trial-subscriptions.md` for the full record.

- **Entitlement is a server-side authorization layer, not UI hiding.**
  `src/lib/server/subscriptions.ts` resolves the effective state
  (`SUSPENDED` overrides a live trial/paid period, then `ACTIVE`,
  `TRIAL_ACTIVE`, `EXPIRED`, else `PENDING_PAYMENT`) from the
  subscription row and the request clock at request time; expiry
  needs no scheduled job. Owner/staff pages use
  `requireEntitledOrganizationContext`, member pages use
  `requireEntitledMemberContext`, and mutation services assert
  entitlement before and inside their transactions. Restricted gyms
  keep sign-in and the subscription recovery screen only.
- **Platform administration is a separate identity, not a gym role.**
  `PLATFORM_ADMIN_CLERK_USER_IDS` (server-side, comma-separated
  stable Clerk IDs) is the sole allowlist for `/platform-admin`
  pages and actions; a missing, empty, or invalid value admits
  nobody, and `OWNER`/`ADMIN`/`STAFF` membership grants nothing.
  Every admin mutation is validated, runs in one transaction with
  its audit event, and is scoped to an explicitly validated
  organization ID.
- **Trial eligibility is a database constraint, not a check.**
  One introductory trial per stable Clerk owner identity and per
  canonical verified phone number is enforced by unique constraints
  on `saas_trial_claims` plus advisory-lock serialization and a
  transactional claim during organization creation. Verified phones
  come only from Clerk's Backend API; browser-supplied numbers and
  `verified` flags are never trusted, and full phone numbers never
  appear in logs or audit metadata.
