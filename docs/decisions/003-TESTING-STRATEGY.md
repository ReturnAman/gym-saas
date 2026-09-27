# ADR 003 — Testing Strategy

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Engineering / Quality

---

# 1. Context

gym-saas is a multi-tenant SaaS application handling:

- Authentication
- Authorization
- Organization isolation
- Member data
- Memberships
- Payments
- Partial payments
- Attendance
- Notifications
- Subscription state

Some of these areas are security- and data-integrity-sensitive.

Testing must therefore verify not only whether features work normally, but also whether they fail safely.

---

# 2. Testing Principles

The testing strategy follows these principles:

1. Test business behavior.
2. Test security boundaries.
3. Test tenant isolation.
4. Test important state transitions.
5. Test failure cases.
6. Prefer fast tests for frequently changed logic.
7. Use integration tests where multiple components interact.
8. Use end-to-end tests for critical user journeys.
9. Do not rely exclusively on frontend tests.
10. Every important bug should result in a regression test where practical.

---

# 3. Testing Layers

The project will use multiple testing layers.

```text
Unit Tests
    ↓
Integration Tests
    ↓
API / Backend Tests
    ↓
End-to-End Tests
Each layer has a different purpose.

4. Unit Tests

Unit tests should verify isolated business logic.

Examples:

Attendance percentage calculation
Outstanding payment calculation
Membership status calculation
Trial expiration logic
Entitlement checks
Notification rule evaluation
Validation functions
Date calculations
Leaderboard/consistency calculations when introduced

Example:

Charge = ₹1,000
Confirmed Payment = ₹600

Expected Outstanding = ₹400
Expected Status = PARTIALLY_PAID

Unit tests should avoid unnecessary database/network dependencies.

5. Integration Tests

Integration tests verify multiple components working together.

Examples:

Database + business logic
Organization creation
Member creation
Membership creation
Payment confirmation
Attendance creation
Notification persistence
Authorization queries

These tests are particularly important for data integrity.

6. API / Backend Tests

Protected backend operations should be tested directly.

Tests should verify:

Authentication
Authorization
Tenant isolation
Input validation
Resource ownership
Error handling
State transitions

Example:

Authenticated OWNER
        ↓
Organization A
        ↓
Request Member A
        ↓
Allowed

And:

Authenticated OWNER
        ↓
Organization A
        ↓
Request Member B from Organization B
        ↓
Denied
7. End-to-End Tests

End-to-end tests should represent important real user journeys.

Initial critical journeys:

Owner
Owner
 ↓
OTP
 ↓
Create Gym
 ↓
Organization Created
 ↓
Owner Dashboard
Member
Gym QR
 ↓
Phone
 ↓
OTP
 ↓
Member Authentication
 ↓
Member Home
Attendance
Member
 ↓
Check In
 ↓
Attendance Recorded
 ↓
Occupancy Updated
Payment
Member
 ↓
View Amount Due
 ↓
Pay Gym
 ↓
"I Have Paid"
 ↓
Claim Created
 ↓
Owner Verifies
 ↓
Payment Confirmed
8. Security Testing

Security testing is mandatory for important flows.

Tests should include:

Authentication
Expired OTP
Incorrect OTP
Too many OTP attempts
OTP resend abuse
Unauthorized access
Authorization
Wrong role
Missing membership
Cross-organization access
Resource ID manipulation
Unauthorized payment confirmation
Tenant Isolation

Attempt access to another organization's:

Members
Memberships
Payments
Attendance
Announcements
Notifications

Expected result:

Access denied.

9. Payment Testing

Payments require particularly strong coverage.

Test:

Unpaid state
Partial payment
Full payment
Overpayment
Multiple payments
Duplicate confirmation attempts
Invalid amounts
Unauthorized confirmation
Payment claim vs confirmed payment
Outstanding balance
Concurrent payment operations
Payment correction/reversal when implemented

Example:

Charge: ₹1,000

Payment 1: ₹300
Payment 2: ₹400

Confirmed Total: ₹700
Outstanding: ₹300
Status: PARTIALLY_PAID

The test suite must ensure that payment state is derived from structured payment records rather than arbitrary notes or client-provided status.

10. Attendance Testing

Test:

Valid check-in
Duplicate check-in
Check-in for unauthorized member
Cross-tenant check-in attempt
Invalid QR context
Attendance history
Attendance percentage
Active session
Occupancy calculation
Concurrent check-in requests
11. Database Testing

Database tests should verify:

Foreign keys
Unique constraints
Required fields
Organization relationships
Membership relationships
Payment relationships
Attendance relationships
Important indexes where behavior matters
Migration correctness

Application validation should not replace database constraints where a database invariant is appropriate.

12. Transaction Testing

Important multi-step operations should be tested for atomic behavior.

Example:

Operation:
Create Organization
Create Owner Membership
Create Subscription

If a required operation fails:

Expected:
No partially-created invalid state

Similar testing should be applied to payment and other critical state transitions.

13. Concurrency Testing

Concurrency matters for operations such as:

Attendance
Payments
Membership updates
Notification state changes

Example:

Request A ──┐
            ├── Same Attendance
Request B ──┘

The system must prevent unintended duplicate or conflicting state.

Concurrency behavior should be tested where race conditions could cause incorrect business state.

14. Regression Testing

When a production or development bug is discovered:

Bug
 ↓
Root Cause
 ↓
Fix
 ↓
Regression Test

The goal is to prevent the same class of bug from returning.

15. Test Data

Test data should be deterministic.

Use dedicated test fixtures/factories where appropriate.

Example organizations:

Gym A
Gym B

Example users:

Owner A
Staff A
Member A

Owner B
Member B

This makes tenant-isolation testing explicit.

16. Test Database

Tests involving persistence should use a controlled test database/environment.

Never run destructive tests against production.

Test data should be isolated from development and production data.

17. Mocking

Mock external services when testing application behavior.

Potential external services include:

Authentication provider
WhatsApp provider
Email provider
Payment-related external services if introduced
Cloud storage
Analytics services

However, excessive mocking should be avoided.

The application should still have integration tests that verify important boundaries.

18. External Provider Tests

Provider integrations should have:

Unit-level behavior tests

Verify application behavior around provider responses.

Integration tests

Verify the integration contract where practical.

Sandbox tests

Use provider sandbox/test environments where available.

The production provider should not be used casually for automated tests.

19. Test Naming

Tests should describe behavior rather than implementation details.

Prefer:

allows an owner to confirm a payment for their organization

over:

calls confirmPaymentRepository()

The test should explain what the system guarantees.

20. Test Structure

A useful structure is:

Arrange
Act
Assert

Example:

Arrange:
Create organization
Create member
Create ₹1,000 charge

Act:
Record ₹600 confirmed payment

Assert:
Outstanding = ₹400
Status = PARTIALLY_PAID
21. Coverage

Code coverage is a useful signal but is not the primary quality metric.

High coverage does not automatically mean:

correct authorization
correct tenant isolation
correct business logic
correct concurrency behavior

Critical behavior should receive explicit tests even when coverage numbers are already high.

22. Critical Paths

The following paths require especially strong testing:

Authentication
Authorization
Tenant isolation
Owner onboarding
Member onboarding
Payments
Payment confirmation
Partial payments
Attendance
Subscription state
Notification delivery state
23. CI Testing

Pull requests should run automated checks appropriate to the repository state.

Expected checks will eventually include:

Lint
 ↓
Type Check
 ↓
Unit Tests
 ↓
Integration Tests
 ↓
Build

End-to-end tests may run separately depending on runtime and infrastructure requirements.

24. Local Development

Developers should be able to run the important test suites locally.

The exact commands will be documented in:

README.md

and potentially:

docs/09-TESTING.md
25. Test Framework

The exact test framework remains an implementation decision.

Current candidate direction:

Vitest for unit/integration testing
Playwright for browser end-to-end testing

Final selection should be made before substantial feature implementation.

26. Definition of Done

A feature should generally not be considered complete until:

Expected behavior works
Failure cases are considered
Authorization is tested
Tenant isolation is tested where applicable
Important state transitions are tested
Relevant unit/integration tests exist
Type checking passes
Linting passes
Build passes
Documentation is updated when necessary
27. AI-Assisted Development Testing Rule

AI-generated code must not be trusted merely because it compiles.

For AI-generated changes:

AI Implementation
      ↓
Human Review
      ↓
Tests
      ↓
Type Check
      ↓
Lint
      ↓
Build
      ↓
Behavior Review

AI-generated tests must also be reviewed.

Tests that merely reproduce the implementation rather than verify the requirement provide limited value.

28. Bug Severity

Testing priority should increase with the impact of failure.

High-priority areas include:

Cross-tenant access
Unauthorized actions
Payment corruption
Authentication bypass
Data loss
Duplicate financial records
Incorrect membership state

These should receive stronger regression coverage.

29. Performance Testing

Performance testing is not required for every feature during early development.

It becomes relevant when:

realistic usage patterns are known
production traffic exists
a query becomes a bottleneck
large datasets are introduced
background jobs become significant

Performance optimization should be evidence-driven.

30. Load Testing

Load testing should eventually model realistic gym SaaS behavior.

Examples:

Members checking in around peak hours
Owners viewing dashboards
Multiple gyms operating simultaneously
Payment verification activity
Notification jobs

Load testing should be introduced when the product approaches meaningful pilot/production usage.

31. Decision
Current Status

Testing strategy is defined.

The project will use a layered testing approach:

Unit
 ↓
Integration
 ↓
API / Backend
 ↓
End-to-End

Security, authorization, tenant isolation, payment integrity, and critical state transitions receive explicit testing priority.

32. Consequences
Positive
Safer development
Better regression protection
Stronger tenant isolation
Better payment integrity
Easier refactoring
Better confidence in AI-assisted implementation
Stronger engineering portfolio evidence
Trade-offs
More development time
Test maintenance
CI runtime
Test database management
Additional complexity for integration and E2E testing

The project should avoid testing every implementation detail unnecessarily.

33. Future Reassessment

Reassess the testing strategy when:

Product scale increases
More integrations are introduced
Background processing becomes significant
Mobile/native applications are introduced
Production incidents reveal new failure modes
Performance requirements change
34. Related Documents
09-TESTING.md
06-SECURITY.md
05-AUTHORIZATION.md
04-DATABASE-DESIGN.md
07-API-SPECIFICATION.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
35. Approval

Decision Owner: Project Owner

Status: Proposed

Approved: No

Test Framework: TBD

E2E Framework: TBD

Approval Date: N/A
