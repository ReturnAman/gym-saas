# ADR 017: Audit Logging Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Security / Observability / Data Integrity
- Related:
  - `05-AUTHORIZATION.md`
  - `06-SECURITY.md`
  - `09-TESTING.md`
  - `11-OBSERVABILITY.md`
  - `decisions/007-ERROR-TRACKING.md`
  - `decisions/010-DOMAIN-MODELING.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/015-AUTHENTICATION-AND-AUTHORIZATION-IMPLEMENTATION.md`
  - `decisions/016-NOTIFICATION-ARCHITECTURE.md`

---

## 1. Context

The gym SaaS contains security-sensitive and financially important operations.

Examples include:

- member creation
- member updates
- member linking
- role changes
- owner changes
- payment confirmation
- payment claim rejection
- membership renewal
- subscription changes
- organization setting changes
- notification configuration
- important administrative actions

Normal application logs are useful for debugging technical failures.

They are not sufficient as a durable record of important business/security actions.

The system therefore needs a separate audit mechanism.

---

# 2. Decision

The application will maintain an application-level audit log for important security, authorization, financial, and administrative actions.

Audit records will be:

- organization-scoped where applicable
- actor-aware
- action-specific
- associated with the affected entity where possible
- timestamped
- append-oriented
- protected from casual modification
- free of secrets
- separate from ordinary technical logs

Audit logging will focus on meaningful events rather than recording every database query or UI interaction.

---

# 3. Audit Log vs Application Log

These are different systems.

### Application/technical log

Used for:

- debugging
- exceptions
- performance
- infrastructure
- request tracing
- operational diagnostics

Example:

```text
Database connection timeout
Audit log

Used for:

who changed something
what changed
which organization it affected
which business entity was affected
when the action occurred
security/accountability history

Example:

USER 123 confirmed PAYMENT 456

The two systems should not be treated as interchangeable.

4. Audit Record Concept

The conceptual audit record is:

AuditLog
├── id
├── organization_id
├── actor_user_id
├── action
├── entity_type
├── entity_id
├── metadata
└── created_at

The exact schema will be finalized during database implementation.

System-level events may not have an organization.

5. Actor

Every user-triggered audit event should identify the actor where possible.

Example:

actor_user_id

This answers:

Which authenticated application user performed this action?

The system should not rely on:

phone number
display name
IP address

as the primary actor identity.

6. Actor vs Target

The audit model should distinguish:

Actor

from:

Target

Example:

Owner A
    ↓
changes
    ↓
Staff B's role

Audit record:

actor_user_id = Owner A
entity_type = OrganizationMembership
entity_id = Staff B membership
action = ROLE_CHANGED

This provides accountability.

7. Organization Scope

For organization-specific actions, the audit record should include:

organization_id

This makes it possible to:

retrieve an organization's audit history
enforce tenant isolation
investigate activity
filter logs efficiently

Example:

Organization A
    ↓
Payment confirmed
    ↓
Audit record belongs to Organization A
8. System-Level Events

Some actions may occur without a human organization actor.

Examples:

subscription expiry job
notification worker
system migration
automated cleanup

These may use:

actor_user_id = null

with an explicit actor/source field if required.

The system should distinguish:

human actor

from:

system actor

when that distinction matters.

9. Action Naming

Audit actions should use stable, descriptive domain-level names.

Examples:

MEMBER_CREATED
MEMBER_UPDATED
MEMBER_ARCHIVED

MEMBER_LINKED
MEMBER_UNLINKED

ROLE_CHANGED
OWNER_ADDED
OWNER_REMOVED

PAYMENT_CLAIM_CREATED
PAYMENT_CLAIM_APPROVED
PAYMENT_CLAIM_REJECTED
PAYMENT_CONFIRMED

MEMBERSHIP_CREATED
MEMBERSHIP_RENEWED
MEMBERSHIP_CANCELLED

ANNOUNCEMENT_CREATED
ANNOUNCEMENT_PUBLISHED

SUBSCRIPTION_UPDATED

The exact catalog will evolve with the product.

10. Avoid Technical Action Names

Audit actions should describe business meaning.

Avoid:

UPDATE_ROW
POST_REQUEST
SQL_UPDATE
PRISMA_UPDATE
BUTTON_CLICKED

Prefer:

PAYMENT_CONFIRMED
ROLE_CHANGED
MEMBERSHIP_RENEWED

The audit log should remain useful even if the underlying implementation changes.

11. High-Priority Audit Events

The following actions should be treated as especially important:

Authentication/security
ACCOUNT_RECOVERY_REQUESTED
MEMBER_LINKED
MEMBER_UNLINKED
Authorization
ROLE_CHANGED
OWNER_ADDED
OWNER_REMOVED
Payments
PAYMENT_CLAIM_APPROVED
PAYMENT_CLAIM_REJECTED
PAYMENT_CONFIRMED
Membership
MEMBERSHIP_CREATED
MEMBERSHIP_RENEWED
MEMBERSHIP_CANCELLED
SaaS subscription
SUBSCRIPTION_UPDATED
Organization
ORGANIZATION_SETTINGS_UPDATED

The final list should reflect actual product behavior.

12. Member Changes

Important member changes should be auditable.

Examples:

MEMBER_CREATED
MEMBER_UPDATED
MEMBER_ARCHIVED
MEMBER_LINKED
MEMBER_UNLINKED

The audit record should not necessarily contain a full copy of the member's personal data.

Record only the information needed to understand the action.

13. Role Changes

Role changes are security-sensitive.

Example:

OWNER
  ↓
ADMIN

Audit record:

ROLE_CHANGED
actor_user_id = ...
target membership = ...
previous_role = OWNER
new_role = ADMIN

The exact metadata structure should be finalized during implementation.

14. Owner Changes

Adding or removing owners requires especially strong auditing.

Example:

OWNER_ADDED

should identify:

actor
organization
target user/membership
timestamp

Likewise:

OWNER_REMOVED

should preserve the historical action.

15. Payment Auditing

Payment operations require strong auditability.

At minimum, record important transitions such as:

PAYMENT_CLAIM_APPROVED
PAYMENT_CLAIM_REJECTED
PAYMENT_CONFIRMED

The audit record should identify:

actor
organization
payment/claim
timestamp
action

This helps answer:

Who confirmed this payment?

16. Payment Amounts

Payment audit metadata may include an amount when necessary for accountability.

However, avoid storing unnecessary duplicate financial data.

The authoritative payment amount remains in the payment record.

The audit log records the event.

Example:

Payment
    amount = ₹2,000

Audit
    action = PAYMENT_CONFIRMED
    entity = Payment

Do not make the audit record a second payment ledger.

17. Payment History Must Remain Authoritative

The audit log must not become a replacement for the payment ledger.

The payment domain remains the source of truth for:

payment amount
payment status
payment method
payment relationships

The audit log explains historical actions.

18. Membership Auditing

Membership lifecycle actions should be auditable.

Examples:

MEMBERSHIP_CREATED
MEMBERSHIP_RENEWED
MEMBERSHIP_CANCELLED

This can help determine:

who performed a renewal
when it happened
which membership was affected
19. Subscription Auditing

Gym SaaS subscription changes should be auditable.

Examples:

SUBSCRIPTION_ACTIVATED
SUBSCRIPTION_EXTENDED
SUBSCRIPTION_SUSPENDED
SUBSCRIPTION_EXPIRED

For manually verified SaaS payments, audit information may include:

verified_by
verified_at

The subscription record remains the source of truth for current subscription state.

20. Organization Settings

Important organization setting changes may be audited.

Examples:

ORGANIZATION_SETTINGS_UPDATED
PAYMENT_SETTINGS_UPDATED
NOTIFICATION_SETTINGS_UPDATED

Not every cosmetic setting requires an audit record.

Focus on settings that affect:

security
payments
notifications
organization behavior
member-facing behavior
21. Notification Configuration

Changes to automated notification settings may be audited.

Example:

NOTIFICATION_RULE_ENABLED
NOTIFICATION_RULE_DISABLED

This can help explain why a message was or was not expected to be sent.

22. Audit Metadata

Audit metadata should contain structured information relevant to the event.

Example:

{
  "previousRole": "STAFF",
  "newRole": "ADMIN"
}

Another example:

{
  "paymentMethod": "UPI",
  "confirmedAmount": 2000
}

Metadata must remain:

minimal
safe
structured
relevant
23. Do Not Store Secrets

Audit metadata must never contain:

OTPs
passwords
access tokens
refresh tokens
API keys
webhook secrets
private credentials
session cookies

This rule applies even if storing the value appears convenient for debugging.

24. Personal Data Minimization

Audit records should follow data minimization principles.

Avoid storing unnecessary:

phone numbers
addresses
full message contents
personal notes
identity documents
private photos

If the affected entity can be referenced by:

entity_type
entity_id

that may be sufficient.

25. Audit Immutability

Audit records should be append-oriented.

Normal application functionality should not allow users to:

edit audit record
delete audit record
change actor
change timestamp
rewrite historical action

This protects historical accountability.

26. Corrections

If an audit record is wrong due to an implementation bug, the system should not silently rewrite historical records.

Instead, where correction is necessary:

new corrective event

may be created.

The exact operational correction procedure can be defined later.

27. Audit Transactions

Important audit records should normally be created in the same database transaction as the business mutation they describe.

Example:

BEGIN

confirm payment
create audit record

COMMIT

This prevents:

payment confirmed
+
audit missing

when the audit record is considered mandatory for that operation.

28. Audit Failure

If an audit event is required for a security/financial operation, failure to create the audit record should cause the business transaction to fail.

Example:

PAYMENT_CONFIRMED
+
required audit record

If audit insertion fails:

ROLLBACK

This requirement applies only to actions designated as audit-critical.

Non-critical diagnostic logging should not block normal business operations.

29. Technical Logging Failure

A normal application log failure should generally not cause a payment transaction to fail.

For example:

payment confirmed
technical log unavailable

The business operation may still succeed if the audit requirements are satisfied.

Audit storage and technical observability should remain conceptually separate.

30. Audit Retrieval

Authorized users may eventually be able to view audit history.

Possible audience:

OWNER
ADMIN

The exact access policy must be defined.

Members should not automatically receive access to organization-wide audit history.

31. Audit API

If audit history is exposed through an API, it must be:

organization-scoped
role-protected
paginated
filtered safely
read-only

Example:

GET /api/audit-logs

The backend must verify the actor's permission before returning results.

32. Audit Pagination

Audit logs can grow over time.

Therefore, audit APIs should use pagination.

Avoid:

GET /api/audit-logs
→ return every audit record ever

Use:

page
cursor
limit

according to the API convention.

Cursor pagination may become preferable at larger volumes.

33. Audit Filtering

Useful filters may include:

action
actor
entity type
entity ID
date range

All filtering must remain tenant-scoped.

Example:

organization_id = current authorized organization
AND
action = PAYMENT_CONFIRMED
34. Audit Search

Audit search should not expose records outside the actor's authorized organization.

Search parameters are selectors, not authorization.

Example:

entity_id = abc

does not mean:

user may view entity abc

The server must independently verify access.

35. Audit Retention

The initial product should retain audit records for a reasonable operational period.

The exact retention duration is not finalized by this ADR.

Retention may eventually depend on:

product requirements
legal requirements
customer plan
storage cost
security requirements

Do not implement automatic deletion until the retention policy is defined.

36. Audit Storage Growth

Audit records are append-oriented and therefore grow continuously.

The system should monitor:

audit record count
database storage
query performance
index size

If the product reaches significant scale, archival strategies can be introduced.

Do not prematurely create a separate audit database.

37. Indexing Audit Logs

Useful indexes may include:

organization_id
organization_id + created_at
organization_id + action
organization_id + actor_user_id
organization_id + entity_type + entity_id

The exact indexes should be based on actual query patterns.

Do not index every metadata field.

38. Audit Ordering

Audit records should include a reliable timestamp.

Where exact ordering matters within a transaction, the system should avoid assuming that timestamps alone always establish a perfect sequence.

If a future requirement needs strict ordering, a database sequence or another ordering mechanism can be introduced.

V1 does not require a distributed event-ordering system.

39. Request ID

Audit records may include a request/correlation ID where useful.

Example:

request_id

This allows an operator to connect:

API request
    ↓
business mutation
    ↓
audit event
    ↓
technical logs

The request ID must not contain sensitive information.

40. Source

An audit record may identify the source of the action.

Examples:

WEB
MOBILE
API
SYSTEM
WORKER

This can help distinguish:

human dashboard action

from:

automated background job

The exact source field is optional and should be introduced if useful.

41. Actor IP Address

IP addresses are sensitive personal/technical information.

The initial audit model should not automatically store IP addresses for every event.

If security investigations later require them, the project should define:

purpose
retention
access control
privacy handling

before adding them.

42. User-Agent

Similarly, full user-agent strings should not automatically be stored in audit records.

Technical request logs may handle them separately where operationally useful.

Audit records should remain focused on business/security history.

43. Audit and Error Tracking

Error tracking and audit logging serve different purposes.

Error tracking answers:

What failed technically?

Audit logging answers:

What important action happened?

A payment confirmation error may appear in error tracking.

A successful payment confirmation should appear in the audit log.

Both systems may reference the same request ID.

44. Audit and Notifications

Sending a notification is generally not itself an audit event unless the action has security/business significance.

For example:

PAYMENT_CONFIRMED

should be audited.

The resulting:

WhatsApp message sent

is primarily a notification/delivery record.

The notification system should maintain its own delivery status.

45. Audit and Attendance

Attendance records themselves are the authoritative attendance history.

Creating an attendance record does not necessarily require a separate audit entry for every normal member check-in.

However, administrative modifications to attendance may be audit-worthy.

Example:

ATTENDANCE_MANUALLY_ADDED
ATTENDANCE_CORRECTED
ATTENDANCE_REMOVED

The exact list depends on product requirements.

46. Audit and Data Export

Exports can contain sensitive data.

Important export actions may be audited.

Example:

MEMBER_DATA_EXPORTED
PAYMENT_REPORT_EXPORTED
ATTENDANCE_REPORT_EXPORTED

This can provide accountability for sensitive administrative operations.

The exact export audit policy should be finalized when export functionality is implemented.

47. Audit and Role-Based Access

Audit history itself is sensitive.

A user should only see records they are authorized to see.

For example:

Owner:
organization audit history

Admin:
organization audit history according to permission

Trainer:
only if explicitly granted

Member:
normally no organization-wide audit access

The final role matrix remains defined by authorization requirements.

48. Audit Event Creation API

Business services should create audit records through a small application-level mechanism.

Conceptually:

auditLog.record({
  organizationId,
  actorUserId,
  action,
  entityType,
  entityId,
  metadata
})

The exact API is implementation-specific.

The mechanism should be easy to use without hiding transaction behavior.

49. Avoid Automatic Audit of Everything

Do not create audit records automatically for:

every SELECT
every API request
every UI click
every database query
every page view

That belongs to:

request logs
analytics
observability

Audit logs should remain meaningful.

50. Audit Event Naming Stability

Once an action is used operationally, its meaning should remain stable.

For example:

PAYMENT_CONFIRMED

should continue to mean:

A payment was confirmed as actually received by an authorized gym-side actor.

Do not later reuse it to mean:

member claimed payment

Those are different business events.

51. Payment Claim Audit Example

Correct sequence:

Member
  ↓
PAYMENT_CLAIM_CREATED
  ↓
Owner reviews
  ↓
PAYMENT_CLAIM_APPROVED
  ↓
PAYMENT_CONFIRMED

A claim must not generate:

PAYMENT_CONFIRMED

before actual confirmation.

52. Membership Renewal Audit Example

If an owner performs:

Confirm & Renew

the system may produce:

PAYMENT_CONFIRMED
MEMBERSHIP_RENEWED

These are separate business events.

The audit history should preserve both.

53. Role Change Audit Example

Example:

Owner A
    ↓
changes
    ↓
Staff B
    ↓
STAFF → ADMIN

Audit:

action = ROLE_CHANGED
actor = Owner A
target = Staff B
previousRole = STAFF
newRole = ADMIN
organization = Gym X

This provides a clear security history.

54. Member Linking Audit Example

When a member completes onboarding:

member
    ↓
linked to user

Audit:

MEMBER_LINKED

The event should identify:

organization
member
actor/system source where applicable
timestamp

Do not store OTP values.

55. Owner Recovery Audit

If a manual account recovery process changes an owner's phone number or identity mapping, the action should be auditable.

Possible event:

OWNER_ACCOUNT_RECOVERED

The exact recovery workflow is separate.

The audit event should not contain the old/new authentication secrets.

56. Audit Integrity

The system should make unauthorized audit modification difficult.

Application roles should not expose normal CRUD operations such as:

UPDATE audit_logs
DELETE audit_logs

Audit records should generally be insert-only from the application's business layer.

Database access should also be restricted.

57. Administrative Database Access

Production database access should be limited to authorized infrastructure/admin personnel.

Direct database modifications to audit records should not be part of normal operations.

If emergency correction is ever required, it should follow a documented operational procedure.

58. Audit Tests

Automated tests should verify:

Actor
Correct actor is recorded.
Organization
Correct organization is recorded.
Action
Correct domain action is recorded.
Entity
Correct target entity is recorded.
Transaction
Business mutation fails
→ required audit event is not committed.
Security
Unauthorized actor cannot create privileged audit history through public APIs.
Sensitive data
OTP/token/password is never stored in audit metadata.
59. Audit Test Example: Payment

Scenario:

Staff confirms payment

Expected:

Payment status = CONFIRMED
+
Audit action = PAYMENT_CONFIRMED
+
actor_user_id = Staff
+
organization_id = Gym

If payment confirmation fails:

Payment remains unconfirmed
+
No committed PAYMENT_CONFIRMED audit event
60. Audit Test Example: Role Change

Scenario:

Owner changes STAFF → ADMIN

Expected:

Role updated
+
ROLE_CHANGED audit record

If the role update fails:

Role remains unchanged
+
No committed ROLE_CHANGED audit record
61. Audit Test Example: Cross-Tenant Access

Scenario:

Organization A actor
tries to modify Organization B

Expected:

Authorization rejected
+
No Organization B mutation
+
No false Organization B audit event

The failed request may be recorded in technical/security logs if appropriate, but it must not create a misleading successful business audit event.

62. Audit Monitoring

Useful operational metrics may include:

audit_events_created
audit_write_failures
audit_query_latency
audit_storage_size

Audit write failures are particularly important for audit-critical operations.

63. Audit Alerting

The project may later alert on unusual patterns such as:

many owner changes
many payment confirmations
large export activity
repeated failed authorization

This is future security monitoring.

Do not build a complex SIEM system in V1.

64. Audit Privacy

Audit logs can contain personal and financial context.

Access should therefore be restricted.

The system should follow data-minimization principles and avoid exposing audit history to users who do not need it.

65. Audit Retention and Deletion

Audit deletion must not be implemented casually.

Before deleting audit history, define:

business requirements
legal requirements
customer expectations
security implications
retention duration
archival strategy

Until defined, the application should not provide ordinary user-facing audit deletion.

66. What This Decision Does Not Finalize

This ADR does not finalize:

exact audit table schema
exact action catalog
exact retention period
exact audit UI
exact export auditing policy
exact IP-address policy
exact archival strategy
dedicated audit storage
external SIEM integration
tamper-evident cryptographic audit chains

These can be decided later when actual requirements justify them.

67. Consequences
Positive
Stronger accountability
Better financial traceability
Better security investigation capability
Clear role-change history
Better support/debugging
Tenant-scoped historical records
Separation between business history and technical logs
Negative
Additional database writes
Additional storage
Requires careful privacy handling
Requires maintaining an action catalog
Some critical operations must fail if mandatory audit recording fails
Audit access itself requires authorization

These costs are accepted because financial, authorization, and security actions require reliable historical accountability.

68. Final Rule

Audit logs answer:

Who did what, to which business entity, in which organization, and when?

They are not:

application logs
analytics
payment records
notification delivery records
authentication credentials

Important business/security actions should be auditable.

Audit records should be append-oriented, tenant-scoped where applicable, minimal, secure, and created consistently with the transaction they describe.

Never store secrets in audit records.

Never allow ordinary users to rewrite historical audit events.

Never treat the audit log as a substitute for the authoritative business record.
