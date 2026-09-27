# Testing

## Project

- Project: gym-saas
- Document: Testing Strategy
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

## 1. Purpose

This document defines how the gym-saas application will be tested.

The goal is not to maximize the number of tests.

The goal is to ensure that important business behavior, security boundaries, tenant isolation, data integrity, and critical user journeys remain correct as the system changes.

Testing must provide confidence without creating unnecessary complexity.

---

# 2. Testing Principles

The testing strategy follows these principles:

1. Test business-critical behavior first.
2. Security-sensitive behavior must have explicit tests.
3. Tenant isolation must be tested directly.
4. Authentication and authorization must be tested separately.
5. Payment state transitions must be tested carefully.
6. Critical user journeys should have end-to-end coverage.
7. Tests should be deterministic and repeatable.
8. Tests should use isolated test data.
9. External services should not normally be required for ordinary test execution.
10. Tests should be easy to run locally and in CI.
11. Avoid tests that duplicate implementation details unnecessarily.
12. Avoid arbitrary coverage targets that encourage low-value tests.
13. A focused test suite is preferred over a large fragile test suite.
14. Important regressions should result in permanent tests.
15. Test behavior and contracts rather than internal implementation where practical.

---

# 3. Testing Layers

The application should use multiple testing layers.

The main layers are:

1. Unit tests
2. Domain/application service tests
3. Integration tests
4. API tests
5. Authentication and authorization tests
6. Frontend/component tests
7. End-to-end tests
8. Security tests
9. Migration/database tests
10. Accessibility and responsive testing
11. Performance testing when required

No single testing layer is sufficient by itself.

---

# 4. Unit Tests

Unit tests should verify small pieces of deterministic logic.

Examples include:

- attendance percentage calculation
- outstanding balance calculation
- membership status calculation
- payment status calculation
- entitlement checks
- date calculations
- trial expiration calculations
- notification rule evaluation
- leaderboard scoring logic when introduced
- input normalization
- validation rules
- utility functions

Unit tests should avoid unnecessary dependencies on:

- real databases
- real authentication providers
- real WhatsApp providers
- real payment providers
- external network services

Unit tests should be fast enough to run frequently during development.

---

# 5. Domain and Application Service Tests

Business workflows should have tests at the application/domain level.

Examples:

- create organization
- create owner account
- add member
- assign staff role
- authenticate member through OTP
- create membership
- create payment claim
- confirm payment
- record partial payment
- calculate outstanding amount
- renew membership
- check member in
- check member out
- calculate active occupancy
- create announcement
- create notification job
- enforce subscription entitlement

These tests should verify business behavior without depending unnecessarily on UI implementation.

---

# 6. Authentication Testing

Authentication must be tested separately from authorization.

Important authentication scenarios include:

- valid OTP verification
- invalid OTP
- expired OTP
- too many verification attempts
- resend cooldown
- OTP request rate limiting
- repeated OTP requests
- successful authentication
- failed authentication
- invalid session
- expired session
- logout
- account/session handling
- member onboarding through gym QR
- owner onboarding through phone OTP

Tests must verify that OTPs, tokens, and other authentication secrets are not exposed in responses or logs.

---

# 7. Member Onboarding Tests

The member onboarding flow is security-sensitive.

Critical flow:

1. Member scans gym QR.
2. Application identifies organization.
3. Member enters phone number.
4. Backend checks whether the phone is associated with an eligible member.
5. OTP is sent.
6. Member verifies OTP.
7. User account is created or linked.
8. Organization membership is created or linked.
9. Member receives authorized access.

Tests must cover:

- valid member phone
- unknown phone
- wrong phone
- outdated phone
- invalid OTP
- expired OTP
- excessive attempts
- excessive resend requests
- repeated requests
- already registered member
- member belonging to multiple gyms
- member attempting access to another organization
- QR belonging to another gym
- tampered organization identifiers
- enumeration-resistant responses

The QR code must never be treated as authentication.

---

# 8. Owner Onboarding Tests

Owner onboarding should test:

- phone verification
- owner account creation
- organization creation
- creator becoming OWNER
- trial creation
- trial expiration behavior
- duplicate trial eligibility
- multiple organizations for one user
- organization creation limits
- failed onboarding recovery
- repeated onboarding attempts

Tests must verify that phone verification does not silently grant unauthorized access to an existing organization.

---

# 9. Authorization Testing

Authorization is a core security boundary.

Tests must verify both:

- authentication
- authorization

For every protected operation, tests should consider:

- authenticated user
- unauthenticated user
- correct organization
- wrong organization
- correct role
- insufficient role
- resource ownership
- resource belonging to another organization

Examples:

- MEMBER cannot access owner dashboard.
- MEMBER cannot confirm payments.
- TRAINER cannot perform OWNER-only actions.
- STAFF can only perform permitted staff actions.
- ADMIN permissions follow the approved role definition.
- OWNER can manage their organization.
- User belonging to Gym A cannot access Gym B's member data.

Frontend hiding of UI controls is not sufficient.

The backend must reject unauthorized requests.

---

# 10. Multi-Tenant Isolation Tests

Tenant isolation is mandatory.

Tests must attempt to access another organization's data using:

- another organization's ID
- another member ID
- another membership ID
- another payment ID
- another attendance record ID
- another announcement ID
- another staff/user relationship

Expected behavior:

- access must be rejected
- data must not be returned
- no sensitive information should be leaked

Both positive and negative authorization tests are required.

A request should never gain access to another tenant merely because the caller knows or guesses an identifier.

---

# 11. Role Testing

Each role must have explicit permission tests.

Roles:

- OWNER
- ADMIN
- STAFF
- TRAINER
- MEMBER

Testing should cover:

- allowed actions
- denied actions
- organization membership
- role changes
- removed memberships
- multiple organization memberships
- switching organizations

Role definitions must remain consistent with `05-AUTHORIZATION.md`.

---

# 12. Payment Testing

Payment functionality requires strong test coverage because incorrect state can affect money-related records.

Tests must cover:

### Payment claim

- member sees amount due
- member submits "I have paid"
- claim is created
- claim is not treated as confirmed payment
- duplicate claims are handled safely

### Payment confirmation

- authorized owner/staff can confirm
- unauthorized users cannot confirm
- actual received amount is validated
- payment method is recorded
- reference/notes are handled correctly
- audit information is recorded

### Partial payments

Examples:

```text
Charge: ₹1,000
Payment 1: ₹400
Outstanding: ₹600
Tests must verify that:

payment is recorded correctly
outstanding balance is calculated correctly
status becomes PARTIALLY_PAID
Full payment
Charge: ₹1,000
Payment: ₹1,000
Outstanding: ₹0

Expected status:

PAID
Overpayment

If supported:

Charge: ₹1,000
Payments: ₹1,200

Expected state must follow the approved payment rules.

Payment history

Tests must verify:

confirmed payments are not silently mutated
corrections use the approved correction mechanism
unauthorized users cannot alter payment history
duplicate confirmation does not create duplicate financial records
13. Payment and Membership Separation

Payment and membership renewal are separate domains.

Tests must verify:

payment claim does not automatically renew membership
payment confirmation does not silently change membership unless an explicit approved rule exists
partial payment does not automatically imply full renewal
outstanding balance remains correct after renewal
membership state and payment state remain independently correct

Any future automatic renewal rule must receive dedicated tests.

14. Concurrency and Duplicate Operation Tests

Important operations may receive multiple requests at approximately the same time.

Tests should consider:

double payment confirmation
duplicate check-in
duplicate check-out
duplicate membership creation
duplicate notification job
simultaneous updates
repeated form submission

The system should prevent invalid duplicate state.

Where transactions or database constraints are required, tests should verify the resulting behavior rather than relying only on application-level checks.

15. Attendance Testing

Attendance should cover:

Check-in
valid member
active membership
inactive membership
unauthorized user
duplicate check-in
repeated QR scan
invalid organization
invalid member
simultaneous check-in attempts
Check-out
active session
no active session
duplicate checkout
unauthorized checkout
organization isolation
Attendance history

Verify:

correct member
correct organization
correct dates
correct ordering
no cross-tenant records
Attendance percentage

Test:

no attendance history
one visit
multiple visits
different membership periods
date boundaries

Exact calculation rules must remain consistent with the approved product definition.

16. Live Occupancy Testing

Live occupancy is derived from active attendance sessions.

Tests should verify:

member checks in → occupancy increases
member checks out → occupancy decreases
duplicate check-in does not incorrectly increase occupancy
duplicate checkout does not incorrectly decrease occupancy
inactive sessions are handled according to approved rules
organization occupancy cannot include another organization's members

Occupancy must be derived from reliable attendance state rather than independently maintained duplicated state unless explicitly designed otherwise.

17. Membership Testing

Tests should cover:

membership creation
membership update
membership expiration
active membership
expired membership
renewal
plan changes
membership charges
member status
multiple memberships if supported
organization isolation

Date and timezone behavior should receive explicit tests.

18. Subscription and Trial Testing

Owner SaaS subscription behavior should be tested separately from member memberships.

Tests should cover:

trial creation
trial start
trial expiration
active subscription
expired subscription
manual subscription activation
manual subscription extension
entitlement evaluation
member limits
feature restrictions
preserved organization data after expiration

Trial expiration must not accidentally delete organization data.

19. Entitlement Testing

The approved model is:

Subscription
     ↓
Plan
     ↓
Entitlements
     ↓
Feature / Action checks

Tests should verify:

active plan grants expected features
expired subscription removes restricted features
trial entitlements work correctly
plan changes update permissions correctly
restricted features cannot be accessed through direct API calls
frontend restrictions are not treated as the security boundary
20. Notification Testing

Notifications use the conceptual flow:

Event
  ↓
Notification Rule
  ↓
Notification Job
  ↓
Queue
  ↓
Provider
  ↓
Delivery Status

Tests should verify:

correct event creation
correct rule selection
correct recipient
correct organization
correct member
correct notification type
duplicate notification protection where required
provider failure handling
delivery status updates
retry behavior where implemented
disabled notification rules

WhatsApp should not be required for normal unit/integration test execution.

21. WhatsApp Provider Testing

The WhatsApp provider should be isolated behind the notification provider boundary.

Tests should use a fake/mock provider for ordinary testing.

The fake provider should allow tests to verify:

message generated
recipient selected
organization selected
template selected
provider call attempted
provider success
provider failure
retry behavior
delivery status

Tests must never send real production WhatsApp messages during ordinary test execution.

WhatsApp must not be part of authentication testing.

22. API Testing

Protected API endpoints should be tested for:

valid request
invalid request
missing authentication
invalid authentication
insufficient authorization
wrong organization
invalid resource
validation failure
expected success
expected error
safe error response

API tests should verify that business rules cannot be bypassed by calling the API directly.

23. Database Integration Testing

Database-dependent behavior should be tested against a real test database where practical.

Important areas include:

constraints
relationships
indexes
unique rules
transactions
tenant filtering
payment state
attendance state
concurrent operations
migrations

A real PostgreSQL test environment should be preferred for behavior that depends on PostgreSQL-specific semantics.

The exact testing setup will be finalized in 14-TECH-DECISIONS.md.

24. Migration Testing

Database migrations must be treated as application changes.

Tests/process should verify:

migration applies successfully
schema reaches expected state
existing test data remains valid where required
rollback strategy where applicable
constraints are correct
indexes are created correctly
destructive changes are reviewed

Production schema changes must not be performed manually outside the approved migration process.

25. Frontend Testing

Frontend tests should focus on meaningful user behavior.

Examples:

form validation
loading states
error states
empty states
role-based rendering
payment claim UI
payment verification UI
attendance UI
QR flow
organization switching
member dashboard
owner dashboard
responsive behavior

Frontend tests must not be treated as authorization tests.

A hidden button is not proof that an operation is secure.

26. Component Testing

Component tests should be used where they provide meaningful value.

Good candidates include:

forms
tables
payment status displays
membership status displays
attendance components
navigation
dialogs
QR-related UI
error states

Avoid testing every small presentational component merely for coverage.

The exact component testing framework will be finalized in 14-TECH-DECISIONS.md.

27. End-to-End Testing

End-to-end tests should cover the most important complete user journeys.

Initial critical journeys:

Owner
Owner signs up.
Owner verifies phone.
Organization is created.
Owner enters gym settings.
Owner adds member.
Owner creates/configures membership.
Owner views dashboard.
Member
Member scans gym QR.
Member enters phone.
Member receives OTP.
Member verifies OTP.
Member enters member experience.
Member checks in.
Member views attendance.
Member views membership/payment status.
Payment
Member views amount due.
Member pays gym externally.
Member submits payment claim.
Owner/staff receives verification request.
Authorized user confirms payment.
Payment balance updates correctly.
Attendance
Member checks in.
Active occupancy changes.
Member checks out.
Occupancy changes again.
Attendance history is updated.

These flows should remain stable as the product evolves.

28. PWA Testing

PWA behavior should be tested for:

installability
responsive layouts
mobile navigation
QR camera flow
authentication persistence
logout
refresh behavior
network failure
loading states
service worker behavior
update behavior

Private/sensitive data must not be incorrectly exposed through client-side caching.

Offline behavior must follow the restrictions defined in 08-PWA.md.

29. Offline Testing

The application should explicitly test behavior when:

network is unavailable
network becomes unavailable during a request
network returns
API request times out
API returns an error
cached application shell is available
cached application data is stale

The system must not falsely display a successful payment, attendance action, or other state-changing operation merely because the network is unavailable.

30. Security Testing

Security testing should include:

authentication bypass attempts
authorization bypass attempts
tenant isolation attempts
ID enumeration
OTP abuse
rate-limit behavior
replay attempts
malformed input
unexpected input types
oversized input
sensitive-data exposure
unsafe error messages
session handling
access to another organization's resources
unauthorized payment confirmation
unauthorized role changes

Security tests should focus on realistic application threats.

31. Sensitive Data Testing

Tests should verify that sensitive information is not unintentionally exposed through:

API responses
browser storage
logs
error messages
URLs
client-side state
analytics
test fixtures

The application must not log:

OTPs
passwords
session secrets
access tokens
API keys
provider secrets
unnecessary sensitive payment information
32. Test Data

Test data should be:

synthetic
deterministic where possible
isolated
easy to create
easy to reset
representative of real business scenarios

Do not use real customer/member personal data in automated tests.

Test fixtures should cover:

multiple organizations
multiple users
different roles
multiple memberships
different payment states
attendance records
trial/subscription states
notification states

At least two organizations should be present in tenant-isolation test scenarios.

33. Test Factories

Where test data becomes complex, reusable test factories may be introduced.

Examples:

createTestUser
createTestOrganization
createTestMembership
createTestPayment
createTestAttendance
createTestSubscription

Factories should make tests easier to read.

They should not hide important business conditions.

A test should remain understandable without tracing through a large factory system.

34. Mocking and External Services

External services should generally be mocked or replaced with test implementations.

Examples:

OTP provider
WhatsApp provider
email provider if introduced
payment gateway if introduced later
cloud storage
analytics services

External integrations should also have a smaller number of integration tests against the real provider where appropriate.

Real credentials must never be stored in the repository.

35. Deterministic Testing

Tests should avoid unnecessary dependency on:

real time
random values
external networks
real SMS
real WhatsApp
production databases
external payment systems

Time-sensitive behavior should use controllable test time where appropriate.

Examples:

OTP expiration
trial expiration
membership expiration
reminder scheduling
36. Timezone Testing

Date-sensitive features should explicitly test timezone behavior.

Important cases include:

day boundaries
membership expiration
attendance dates
reminder dates
trial expiration
payment timestamps
notification scheduling

The application's timezone strategy must remain consistent with the architecture and product requirements.

37. Accessibility Testing

Important user-facing flows should receive accessibility checks.

Areas include:

keyboard navigation
form labels
focus behavior
readable error messages
button accessibility
semantic structure
sufficient touch target size
screen-reader compatibility where practical

Accessibility should be considered during implementation rather than added only at the end.

38. Responsive and Browser Testing

The initial product is mobile-first but must also support owner/staff desktop workflows.

Testing should cover representative:

mobile viewport
tablet viewport
desktop viewport

Browser coverage should prioritize the browsers realistically used by the target users.

The exact supported browser matrix can evolve with real user data.

39. Performance Testing

Performance testing is not the first development priority.

It becomes important when:

real users exist
meaningful traffic exists
database queries become complex
dashboards become slow
attendance/occupancy volume grows
notification volume grows

Initial performance testing should focus on:

critical API response times
database query behavior
dashboard loading
member search
attendance operations
occupancy calculation

Large-scale load testing should be introduced when justified by actual usage.

40. Coverage Strategy

Code coverage is a measurement, not the goal.

High-priority coverage should include:

authentication
authorization
tenant isolation
payments
payment state transitions
membership state
attendance
occupancy
subscription/entitlements
critical notification logic
important API contracts

Do not create meaningless tests solely to increase a percentage.

A smaller suite with strong business and security coverage is preferable to a large suite with weak assertions.

41. Regression Testing

Whenever a production or development bug is discovered:

Reproduce the bug.
Identify the underlying behavior.
Add a regression test.
Fix the issue.
Run the relevant test suite.
Run broader validation where appropriate.
Document the change if it affects product behavior or architecture.

The regression test should prevent the same class of bug from silently returning.

42. Flaky Tests

Flaky tests must not be ignored.

If a test intermittently fails:

Identify the cause.
Fix the underlying nondeterminism.
Improve isolation or synchronization.
Avoid simply increasing arbitrary timeouts.
If temporarily quarantined, document the reason.
Remove the quarantine as soon as practical.

A test suite that is frequently ignored because of flaky tests loses its value.

43. Continuous Integration

CI should eventually run appropriate checks for pull requests.

Expected categories include:

dependency installation
linting
type checking
unit tests
integration tests
API tests
build validation
relevant frontend tests
relevant end-to-end tests

The exact CI pipeline should be defined in 10-DEVOPS.md.

44. Pull Request Testing Requirements

A meaningful pull request should include:

tests for new business behavior
regression tests for bug fixes
authorization tests for protected behavior
tenant-isolation tests when relevant
payment tests when payment behavior changes
database tests when schema/data behavior changes

The PR description should explain:

what changed
why it changed
tests added
tests run
security considerations
database considerations
known limitations
45. Testing by Feature

Every feature should answer:

Behavior

What behavior must work?

Failure

What can go wrong?

Authorization

Who may perform the operation?

Tenant isolation

Can another organization access it?

Data integrity

What state must remain consistent?

Concurrency

What happens if the operation happens twice or simultaneously?

External dependencies

Does the feature depend on an external provider?

Regression

What existing behavior could this change break?

These questions should be considered before implementation.

46. Minimum Test Requirements for Sensitive Domains

The following areas require stronger-than-average testing:

Authentication
OTP validation
expiration
attempts
rate limiting
session handling
Authorization
role permissions
resource permissions
organization permissions
cross-tenant access denial
Payments
claims
confirmation
partial payments
outstanding balances
duplicate operations
authorization
payment/membership separation
Attendance
check-in
check-out
duplicate operations
occupancy
organization isolation
Subscription
trial
expiration
entitlements
restricted actions
47. Test Environment Separation

Testing environments must be separated from production.

Never run automated tests against the production database.

Never allow automated tests to send real customer-facing WhatsApp messages.

Never use production secrets in local development or ordinary CI tests.

Environment-specific configuration must be explicit.

48. Local Development Testing

Developers should be able to run the important test suites locally.

The exact commands will be defined after the technology choices are finalized.

Example categories:

test
test:unit
test:integration
test:e2e
lint
typecheck
build

These are conceptual command categories only until the final toolchain is selected.

49. Test Execution Before Merge

Before merging a meaningful change:

Relevant tests pass.
Type checking passes.
Linting passes.
Build passes where applicable.
Security-sensitive behavior is reviewed.
Database changes are reviewed.
Tenant isolation is verified when relevant.
Documentation is updated when required.

The exact merge gate will be finalized in the DevOps documentation.

50. What Should Not Be Over-Tested

Avoid unnecessary testing of:

trivial framework behavior
third-party library internals
simple static markup
implementation details with no business value
duplicate tests that provide no additional confidence

Testing effort should follow risk.

51. Testing and AI-Assisted Development

AI-generated code must not be considered correct merely because it compiles.

When AI implements a feature, the workflow should include:

Understand the requirement.
Identify security and authorization implications.
Identify data changes.
Define expected behavior.
Implement.
Write or update tests.
Run tests.
Review failures.
Inspect the final diff.
Confirm that tests actually verify the intended behavior.

AI must not be allowed to remove or weaken tests merely to make CI pass.

52. Testing Documentation

When testing behavior changes significantly, update the relevant documentation.

Examples:

new authorization rule → 05-AUTHORIZATION.md
new security behavior → 06-SECURITY.md
new API behavior → 07-API-SPECIFICATION.md
new PWA behavior → 08-PWA.md
new testing strategy → this document
architecture change → 03-SYSTEM-ARCHITECTURE.md
database change → 04-DATABASE-DESIGN.md
53. Relationship With Other Documents

This document depends on:

00-PROJECT-CHARTER.md
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
08-PWA.md

Testing must remain consistent with those documents.

54. Future Testing Areas

As the product grows, testing may expand to include:

larger-scale performance tests
notification delivery testing
advanced analytics validation
leaderboard calculation testing
challenge/achievement testing
progress-photo privacy testing
partner/affiliate flows
gym discovery
payment gateway integration
backup and restore testing
disaster recovery testing
observability validation

These should be introduced when the corresponding features exist.

55. Current V1 Testing Priorities

Highest priority:

Authentication
Authorization
Multi-tenant isolation
Member onboarding
Owner onboarding
Membership management
Payment claims
Payment confirmation
Partial payments
Outstanding balances
Attendance
Occupancy
Subscription/trial behavior
Critical API behavior
Critical member and owner journeys
56. Status

Status: Testing strategy defined.

This document defines testing principles and coverage expectations.

Exact testing frameworks, commands, CI implementation, test infrastructure, and environment configuration will be finalized in:

10-DEVOPS.md
14-TECH-DECISIONS.md

No implementation should begin solely because this document exists.

The implementation must continue to follow the approved architecture, authorization, security, database, API, and product requirements.
