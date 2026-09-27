# ADR 013: Database Transactions and Concurrency

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Database / Data Integrity / Backend
- Related:
  - `04-DATABASE-DESIGN.md`
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `09-TESTING.md`
  - `decisions/009-BACKGROUND-JOBS.md`
  - `decisions/010-DOMAIN-MODELING.md`
  - `decisions/011-DATABASE-SCHEMA-IMPLEMENTATION.md`
  - `decisions/012-DATABASE-NAMING-AND-ID-STRATEGY.md`

---

## 1. Context

The gym SaaS performs operations where multiple database changes must remain consistent.

Examples include:

- confirming a payment
- recording a payment against a charge
- renewing a membership
- creating attendance records
- processing notifications
- handling webhook events
- changing organization roles
- linking a member to a user
- processing retried background jobs

These operations can be triggered concurrently.

For example:

```text
Staff A confirms payment
        +
Staff B confirms the same payment claim
        ↓
Potential duplicate financial state
Or:

Notification job executes
        +
Same job is retried
        ↓
Potential duplicate message

The system therefore needs explicit rules for:

transaction boundaries
atomicity
concurrency
idempotency
retries
locking
unique constraints
failure handling
2. Decision

The application will use database transactions when multiple related changes must succeed or fail together.

The system will:

keep transaction boundaries around business operations
avoid unnecessarily long transactions
use database constraints as part of concurrency protection
use idempotency for retryable operations where appropriate
use row-level locking only where required
avoid assuming frontend checks prevent races
make financial state transitions atomic
make background processing retry-safe
test important race conditions
prefer simple concurrency controls before introducing distributed infrastructure

The initial architecture will not introduce Redis or a distributed locking system solely to solve concurrency.

3. Atomicity Principle

If a business operation requires multiple database writes to remain consistent, those writes should occur inside one transaction.

Example:

Payment Confirmation

BEGIN
    validate payment claim
    create confirmed payment
    update payment claim status
    record audit event
COMMIT

If any required operation fails:

ROLLBACK

The system should not leave a partially completed business operation.

4. Transaction Boundaries

A transaction should represent a meaningful business operation rather than an arbitrary collection of queries.

Good:

Confirm Payment
    ↓
transaction
    ↓
validate state
create payment
update claim
create audit record
commit

Bad:

BEGIN

perform unrelated member lookup
perform external API call
send WhatsApp message
wait for provider
perform database updates

COMMIT

Transactions should generally be short.

External network operations should normally not occur inside database transactions.

5. External Services and Transactions

Do not hold a database transaction open while waiting for:

WhatsApp API
payment provider
email provider
authentication provider
external HTTP API

Example of what should be avoided:

BEGIN
    update payment
    call WhatsApp
    wait 3 seconds
    commit

Instead:

BEGIN
    update payment
    create notification job/outbox record
COMMIT

worker
    ↓
send WhatsApp message

This keeps database transactions short and reduces lock duration.

6. Payment Confirmation

Payment confirmation is one of the most concurrency-sensitive operations.

Example:

Payment Claim = ₹2,000

Two authorized staff members attempt confirmation simultaneously.

The system must not accidentally create:

Payment A = ₹2,000
Payment B = ₹2,000

unless two genuine payments actually occurred.

7. Payment Confirmation Transaction

Conceptually:

BEGIN

lock/revalidate payment claim

verify:
    claim exists
    claim belongs to organization
    actor is authorized
    claim is still pending
    claimed amount is valid

create payment

mark claim as approved

create audit record

COMMIT

The exact locking strategy may depend on the ORM and PostgreSQL implementation.

The important invariant is:

One payment claim cannot be confirmed twice by concurrent requests.

8. Payment Claim State Transition

The claim should move through explicit states.

Example:

PENDING
   ↓
APPROVED

or:

PENDING
   ↓
REJECTED

Once a claim reaches a terminal state, another request must not process it as pending.

The backend must enforce this.

Frontend button state is insufficient.

9. Database Constraints and Concurrency

Application checks alone are not enough.

This pattern is unsafe:

SELECT claim WHERE status = 'PENDING'

if pending:
    create payment
    update claim

Two requests can both observe:

PENDING

before either updates the record.

The implementation must use an appropriate combination of:

transaction
row locking
atomic conditional update
unique constraint
state revalidation

depending on the operation.

10. Conditional Updates

Some state transitions can be protected through conditional updates.

Conceptually:

UPDATE payment_claims
SET status = 'APPROVED'
WHERE id = :claimId
  AND status = 'PENDING';

The application then verifies that exactly one row was updated.

If zero rows were updated, the claim may already have been processed.

This can be safer than:

read
then
write

without concurrency protection.

11. Row-Level Locking

Row-level locking should be used when concurrent operations need to serialize access to the same database record.

Example:

Payment Claim

If two requests attempt to process the same claim, the system may lock the claim row during the transaction.

The exact SQL/ORM mechanism will be determined during implementation.

Do not introduce locking everywhere.

Locks increase complexity and can reduce throughput if used unnecessarily.

12. Deadlocks

Transactions must avoid unnecessary lock ordering differences.

Potential problem:

Transaction A:
lock Member
then lock Membership

Transaction B:
lock Membership
then lock Member

This can produce a deadlock.

When multiple records must be locked, the application should use a consistent ordering.

For example:

Organization
→ Member
→ Membership
→ Charge
→ Payment

The exact ordering depends on the operation.

13. Transaction Isolation

The application should use PostgreSQL's normal transaction isolation behavior unless a specific operation requires stronger isolation.

Do not automatically use the strongest isolation level everywhere.

Higher isolation can increase:

locking
contention
transaction failures
retry requirements
performance cost

Isolation should be chosen based on the actual consistency requirement.

14. Serializable Transactions

Serializable transactions may be appropriate for specific high-contention operations if simpler mechanisms are insufficient.

They should not be the default for the entire application.

If serializable transactions are introduced, the application must handle serialization failures safely.

Conceptually:

transaction attempt
        ↓
serialization failure?
        ↓
retry safely

Retries must themselves be bounded and idempotent.

15. Membership Renewal

Membership renewal may involve multiple changes.

For example:

Confirm payment
+
create/update membership
+
create audit event

If these changes are defined as one atomic business operation, they should occur in one database transaction.

Example:

BEGIN

validate membership
validate payment
create/update membership
create payment record
create audit event

COMMIT

However, payment confirmation and membership renewal remain conceptually separate domains.

A payment should not automatically renew a membership unless the approved product workflow explicitly performs that action.

16. Payment and Renewal Separation

The system must preserve:

Payment

and:

Membership Renewal

as distinct concepts.

A member may:

pay partially

without:

renewing membership

Therefore:

Payment confirmation
≠
automatic membership renewal

If the owner explicitly chooses:

Confirm & Renew

then the combined operation may be transactional.

17. Partial Payments

Partial payments must be concurrency-safe.

Example:

Charge = ₹2,000

Two staff members record:

₹1,000
+
₹1,000

The resulting confirmed total should be:

₹2,000

not:

₹1,000

or:

₹3,000

due to stale calculations.

The source of truth remains:

confirmed payment records

The application should calculate outstanding amount from those records.

18. Outstanding Amount Calculation

Conceptually:

Outstanding
=
Charge Amount
-
SUM(Confirmed Payments)

When financial state is read, the calculation must reflect committed database state.

If a cached/materialized balance is introduced later, updates to it must be protected by appropriate transactions and concurrency rules.

The initial implementation should prefer correctness and simplicity over premature balance caching.

19. Attendance Concurrency

Attendance can be triggered rapidly.

Example:

Member scans QR
Member immediately scans QR again

Two requests may arrive almost simultaneously.

The product must define what constitutes a duplicate check-in.

Possible rule:

Only one check-in for a member within a defined time window.

The exact business rule must be finalized before implementation.

Once defined, the database/application should enforce it using appropriate:

query conditions
unique constraints
transaction logic
timestamps
20. Attendance Idempotency

If a client retries the same request because of:

network failure
timeout
browser retry
PWA retry

the system should avoid creating unintended duplicate attendance.

Where appropriate, an idempotency key may be used.

Example:

idempotency_key

The exact strategy depends on the attendance API design.

Do not add idempotency keys to every endpoint without a reason.

21. Member Onboarding Concurrency

Member onboarding can also have races.

Example:

Member scans QR
+
same member/device retries OTP flow

Potential duplicate operations include:

creating multiple user links
creating duplicate organization memberships
creating duplicate member associations

The database should use appropriate uniqueness constraints and transactions.

For example:

one member
+
one linked user

must not accidentally become:

one member
+
two linked users

if the domain model permits only one application identity per member.

22. Role Changes

Role changes are security-sensitive.

Example:

OWNER changes STAFF → ADMIN

The role update should be atomic.

Authorization for the operation must be evaluated before allowing the update.

If the operation also creates an audit record:

BEGIN

authorize actor
update role
create audit record

COMMIT

The audit record should not exist if the role change did not commit.

23. Organization Membership Changes

Adding or removing a user from an organization should be transactionally safe when multiple related records are affected.

Examples:

create organization membership
+
create audit record

or:

remove organization membership
+
revoke related organization-level access state
+
create audit record

The exact workflow depends on the authorization model.

24. Unique Constraints as Concurrency Protection

Unique constraints should be used when the business rule is uniqueness.

Example:

UNIQUE (
    organization_id,
    member_number
)

This protects against two concurrent requests assigning the same member number.

Application-level checks alone are insufficient.

Two requests can both execute:

"Is member number 1001 available?"

and both receive:

YES

The database constraint remains the final protection.

25. Race Conditions

The team must explicitly consider time-of-check/time-of-use problems.

Unsafe pattern:

CHECK
    ↓
assume unchanged
    ↓
WRITE

Safer approaches include:

atomic update

or:

transaction + appropriate lock

or:

database constraint

The correct approach depends on the business rule.

26. Idempotency

Idempotency means repeating the same logical operation does not produce unintended additional effects.

It is particularly important for:

payment confirmation
webhook processing
notification jobs
external API callbacks
membership renewal commands
other retryable operations

Example:

same webhook
received twice
        ↓
process once
27. Idempotency Keys

For APIs where clients may safely retry requests, an idempotency key may be accepted.

Conceptually:

POST /api/payments/confirm

Idempotency-Key: <opaque-key>

The server can associate the key with the operation result.

The exact implementation should be introduced only for endpoints where retries can cause duplicate side effects.

28. Idempotency Storage

If idempotency keys are stored, the system should record enough information to safely determine whether a request is a duplicate.

Possible information:

idempotency_key
organization_id
user_id
operation
request_hash
status
response/result reference
created_at
expires_at

The exact schema is implementation-specific.

Sensitive request data should not be stored unnecessarily.

29. Idempotency Key Scope

An idempotency key should not accidentally be globally reusable across unrelated users or organizations.

Depending on the endpoint, the effective uniqueness may need to include:

organization_id
actor/user_id
operation
idempotency_key

The exact scope must match the API's authorization and retry semantics.

30. Webhook Processing

External webhooks can be delivered more than once.

The application should assume:

at-least-once delivery

unless the provider explicitly guarantees otherwise.

Webhook processing should therefore be idempotent.

Conceptually:

Receive event
    ↓
validate authenticity
    ↓
check provider event ID
    ↓
already processed?
    ├── yes → return success
    └── no
          ↓
       process
          ↓
       record event

The provider's webhook signature must be validated before processing.

31. Webhook Transaction

Where webhook processing changes database state, the relevant state transition and processed-event record should be designed so that retries cannot duplicate the effect.

Example:

BEGIN

check event
apply state change
record processed event

COMMIT

If the transaction fails:

ROLLBACK

The provider can retry.

32. Notification Jobs

Notification jobs may be retried.

Example:

Send payment reminder

A worker crashes after sending the message but before recording success.

The job may execute again.

Therefore, notification delivery needs an idempotency strategy where duplicate delivery would be harmful.

The exact guarantees depend on the provider.

33. External Side Effects

Database transactions cannot roll back external side effects.

For example:

Database update succeeds
WhatsApp message fails

or:

WhatsApp message succeeds
Database update fails

These cannot be solved by simply wrapping both operations in one database transaction.

The architecture should use an asynchronous/outbox-style approach where appropriate.

34. Outbox Pattern

If reliable delivery becomes important, the system may use an outbox record.

Conceptually:

BEGIN

change business state
create notification/outbox record

COMMIT

Then:

worker
    ↓
read outbox
    ↓
send external notification
    ↓
record delivery status

This ensures that the intention to send the notification is committed together with the business change.

The initial implementation should remain as simple as practical.

A full distributed messaging system is not required for V1.

35. Background Job Retry

Background jobs should distinguish between:

retryable failure

and:

permanent failure

Examples of potentially retryable failures:

temporary network failure
provider timeout
temporary database connectivity issue

Examples of potentially permanent failures:

invalid recipient
invalid provider credentials
invalid message payload
unsupported operation

Retry policies should be bounded.

Do not retry forever.

36. Retry Backoff

Retryable background jobs should use controlled backoff.

Conceptually:

attempt 1
   ↓
short delay
   ↓
attempt 2
   ↓
longer delay
   ↓
attempt 3

The exact retry schedule depends on the implementation.

Avoid aggressive retry loops that can overload the database or external provider.

37. Failed Job Handling

After the retry limit is reached, the system should preserve enough information to diagnose the failure.

Possible states:

PENDING
PROCESSING
COMPLETED
FAILED

A dead-letter mechanism may be introduced later if operational volume requires it.

The initial system can use a simpler failed-job record/retry workflow.

38. Database Connection Failures

Application code must not assume that a transaction always succeeds.

Possible failures include:

connection loss
serialization failure
deadlock
constraint violation
timeout

The application should:

safely abort/rollback
classify the failure
retry only when safe
return an appropriate error otherwise
log useful diagnostics without sensitive data
39. Retry Safety

Never blindly retry an operation with side effects.

Before retrying, determine:

Was the transaction committed?
Was the external side effect completed?
Is the operation idempotent?
Can the operation safely execute again?

Retries must be designed around operation semantics.

40. Transaction Error Handling

Transaction code should clearly distinguish:

expected business failure

from:

unexpected infrastructure/database failure

Example:

Payment claim already approved

is a business-state conflict.

It should not be represented as an unexplained database error.

41. User-Facing Concurrency Errors

If a resource was changed by another actor, the API should return a safe, understandable response.

Example:

This payment claim has already been processed.

rather than:

UPDATE affected 0 rows

Internal logs may retain technical details.

42. Optimistic Concurrency

Optimistic concurrency may be appropriate for some records where conflicting updates are possible but rare.

A version field may be used:

version

Conceptually:

UPDATE members
SET ...
    version = version + 1
WHERE id = :id
  AND version = :expectedVersion

If no row is updated, the record changed since it was read.

This should be introduced only where it solves a real problem.

43. Optimistic vs Pessimistic Concurrency

Use optimistic approaches when:

conflicts are uncommon
operations are short
retry is safe

Use row locking/pessimistic approaches when:

the same record is frequently contested
the operation must serialize
duplicate side effects are unacceptable

Do not choose one mechanism globally.

Use the simplest correct mechanism for each domain operation.

44. Concurrency in Trial/Subscription State

Subscription activation or trial changes may also race.

Example:

Admin activates subscription
+
another admin extends subscription

Updates to subscription state must not accidentally overwrite one another.

The application should define whether operations are:

replace state

or:

append/extend state

before implementation.

Subscription history should not be silently destroyed.

45. Membership Expiry and Background Processing

A scheduled job may detect:

membership expired

while an owner is simultaneously renewing the membership.

The system must avoid:

Owner renews membership
        +
background job overwrites it as expired

The job should re-check current state before performing a state transition.

Background jobs must never assume that data remains unchanged after scheduling.

46. Notification Race Example

Suppose:

Membership expires tomorrow.

A reminder job is scheduled.

The owner renews the membership before the job executes.

The worker should check current membership state before sending an expiry reminder.

It should not blindly trust the state captured when the job was created.

47. Attendance and Membership Race

A member may check in at nearly the same time that staff deactivates/updates their membership.

The backend must define the expected business behavior.

Possible policy:

Check-in is allowed if membership is valid at check-in time.

The implementation must evaluate that rule consistently.

The frontend must not decide whether the check-in is valid.

48. Time-Based State

Jobs that depend on dates/times must use server/database time consistently.

Do not rely on:

browser clock

for authoritative business state.

Examples:

membership expiry
trial expiry
payment due date
notification timing
attendance timestamp

The server should determine authoritative timestamps.

49. Testing Concurrent Operations

Concurrency-sensitive features require tests beyond normal happy-path tests.

Important tests include:

Payment
Two confirmations for one claim

Expected:

One confirmed payment.
Unique member number
Two concurrent creations using same number

Expected:

One succeeds.
One fails safely.
Attendance
Repeated concurrent check-in

Expected:

Behavior follows the defined duplicate-check-in rule.
Webhook
Same event processed twice

Expected:

One business effect.
50. Load Testing

Concurrency correctness should not depend solely on unit tests.

Before production, important operations may be tested with concurrent requests.

Examples:

50 simultaneous attendance requests
20 simultaneous payment requests
duplicate webhook delivery

The exact load-testing scale should reflect expected usage.

The project does not need large-scale distributed load infrastructure during early development.

51. Database-Level Protection

Whenever a business invariant can be represented as a database constraint, prefer using the database as a final protection layer.

Examples:

unique membership number
unique provider event ID
foreign-key relationship
required amount
valid state relationship where supported

Application validation remains necessary for user-friendly errors and business rules.

Database constraints provide an additional correctness boundary.

52. Transaction Scope and Authorization

Authorization should be evaluated before sensitive state changes.

For operations where authorization and mutation must remain consistent, authorization-related state and the mutation should be handled carefully within the transaction.

Example:

BEGIN

verify current organization membership/role
perform sensitive mutation
create audit record

COMMIT

The exact placement depends on the operation and authorization model.

53. Audit Records and Transactions

For important mutations, the audit record should normally be committed together with the state change.

Example:

BEGIN

payment confirmed
audit record created

COMMIT

Avoid:

payment confirmed
COMMIT

audit logging fails

if the audit record is required for compliance/security visibility.

The exact audit requirements remain defined by the security documentation.

54. Transaction Size

Keep transactions small enough to minimize:

lock duration
contention
connection occupancy
deadlock risk
rollback cost

Do not place:

file uploads
long computations
external API calls
user interaction
large unrelated queries

inside business transactions.

55. No Global Locking

The application should not use a global lock for ordinary operations.

Avoid designs such as:

lock entire gym
while confirming one payment

unless a specific requirement genuinely demands it.

Concurrency should be isolated to the smallest relevant resource.

56. No Distributed Locking in V1

The initial architecture will not introduce:

Redis distributed locks
ZooKeeper
etcd
distributed mutex services

solely to solve normal application concurrency.

PostgreSQL transactions, constraints, and row-level locks should be sufficient for the initial modular monolith.

If scale later demonstrates a real need, the architecture can evolve.

57. Transaction Helper Abstractions

A small transaction helper may be introduced if it improves consistency.

However, do not hide transaction boundaries so deeply that developers cannot understand where atomicity begins and ends.

Good:

confirmPayment()
    → transaction(...)

Bad:

magicRepository.executeEverythingAtomically(...)

where the actual transaction scope is difficult to reason about.

58. Business Operations Should Define Atomicity

For every new feature, ask:

What must succeed together?
What may happen asynchronously?
What can be retried?
What must happen only once?
What can safely happen more than once?

These questions should be answered before implementation of state-changing features.

59. Concurrency Review Checklist

Before approving a state-changing feature:

 Can two requests execute simultaneously?
 Can the same request be retried?
 Can the frontend submit twice?
 Can a background job overlap with a user action?
 Can a webhook be delivered twice?
 What must be atomic?
 Is a database transaction required?
 Is a unique constraint required?
 Is row locking required?
 Would optimistic concurrency be sufficient?
 Are external side effects outside the transaction?
 Is the operation idempotent where necessary?
 Are retries bounded?
 Are race conditions tested?
 Are user-facing conflict errors safe and understandable?
60. Implementation Priority

Concurrency controls should be implemented in order of business risk.

Highest priority
Payment confirmation
Payment state
Tenant-sensitive mutations
Authorization changes
Webhook processing
High priority
Membership renewal
Member linking
Attendance creation
Notification jobs
Later
Analytics aggregation
Occupancy history
Leaderboard calculations
Non-critical background processing

The project should not spend significant complexity solving theoretical concurrency problems before real contention exists.

61. What This Decision Does Not Finalize

This ADR does not finalize:

exact PostgreSQL isolation level for every operation
exact ORM transaction API
exact idempotency table schema
exact outbox implementation
exact queue technology
exact attendance duplicate window
exact retry delays
exact webhook provider behavior
distributed locking architecture

Those decisions should be made when implementation requirements are concrete.

62. Consequences
Positive
Better financial correctness
Safer concurrent operations
Reduced duplicate side effects
Clear transaction boundaries
Safer background retries
Better webhook handling
Stronger tenant/data integrity
No premature distributed infrastructure
Easier reasoning about state transitions
Negative
More complex implementation for critical workflows
Requires transaction knowledge
Concurrency bugs can be difficult to reproduce
Some operations require database-specific behavior
Retry/idempotency logic adds code
Testing requires concurrent scenarios

These costs are accepted because payment, membership, authorization, and tenant isolation are correctness-critical.

63. Final Rule

Transactions protect atomic business operations.

Constraints protect database invariants.

Authorization protects access.

Idempotency protects retries.

Locks protect genuinely contested state.

None of these replaces the others.

The system should prefer the smallest, simplest concurrency mechanism that correctly protects the business invariant.

Do not solve normal PostgreSQL concurrency with distributed infrastructure prematurely.

When a new feature changes shared state, explicitly identify:

atomicity
+
concurrency
+
idempotency
+
retry behavior
+
external side effects

before implementation.
