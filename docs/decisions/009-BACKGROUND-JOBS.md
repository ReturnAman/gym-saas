# ADR 009 — Background Jobs

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Backend / Notifications / Infrastructure

---

# 1. Context

gym-saas will eventually perform work that should not block a normal HTTP request.

Examples include:

- WhatsApp notifications
- Membership reminders
- Payment reminders
- Inactivity detection
- Scheduled announcements
- Notification retries
- Delivery-status processing
- Future analytics jobs

Not all of this work is required for the first implementation.

The project should therefore introduce background processing incrementally.

---

# 2. Goals

The background-job architecture should provide:

- Reliable asynchronous processing
- Retry capability
- Failure visibility
- Idempotency
- Scheduled work
- Controlled concurrency
- Clear job ownership
- Tenant-aware processing
- Minimal initial infrastructure

The architecture should avoid introducing a queue system before a real requirement exists.

---

# 3. Initial Principle

The initial application should remain a modular monolith.

Do not immediately create:

- Dedicated worker services
- Kafka
- RabbitMQ
- Kubernetes
- Distributed event systems
- Multiple application deployments

unless actual requirements justify them.

---

# 4. Synchronous vs Asynchronous Work

A useful rule is:

> Keep short, user-facing operations synchronous. Move slow, retryable, scheduled, or non-critical work to background processing.

---

# 5. Synchronous Operations

Examples that should normally complete during the request:

- Validate member input
- Create a member
- Read member profile
- Record a normal database update
- Return dashboard data
- Validate a payment claim
- Perform authorization checks

The user should receive the result directly.

---

# 6. Background Operations

Potential background work includes:

- Sending WhatsApp notifications
- Retrying failed notifications
- Processing delivery webhooks
- Scheduled membership reminders
- Inactivity detection
- Large exports
- Future analytics calculations

---

# 7. Notification Architecture

The notification system is the primary expected background-job consumer.

Conceptually:

```text id="a5c9zv"
Business Event
      ↓
Notification Rule
      ↓
Notification Job
      ↓
Background Worker
      ↓
WhatsApp Provider
      ↓
Delivery Status
8. Job Definition

A background job should contain enough information for the worker to perform its task safely.

Conceptually:

Job
├── jobId
├── jobType
├── organizationId
├── entityId
├── attemptCount
├── status
├── scheduledAt
├── createdAt
└── metadata

The exact schema will be defined during implementation.

9. Tenant Context

Background jobs must preserve tenant context.

A worker processing:

organizationId = Gym A

must not accidentally operate on:

Gym B

The worker must use server-side database authorization/business rules just as request handlers do.

10. Do Not Trust Job Payloads

Job data should not be treated as trusted business state.

For example, a job should not blindly trust:

amount = ₹5,000
membershipStatus = ACTIVE

if the authoritative values can be read from the database.

Where appropriate, the worker should retrieve current state from the database.

11. Idempotency

Background jobs may be retried.

Therefore:

A job must be safe to execute more than once, or must have a mechanism preventing duplicate business effects.

Example:

Send reminder
    ↓
Provider timeout
    ↓
Worker retries
    ↓
Potential duplicate

The system must consider whether the notification was actually accepted before retrying.

12. Job States

A job may conceptually move through:

CREATED
   ↓
QUEUED
   ↓
PROCESSING
   ↓
COMPLETED

Failure states may include:

FAILED
RETRYING
CANCELLED

The exact state machine should be defined during implementation.

13. Retry Strategy

Retries should be bounded.

Example:

Attempt 1
   ↓
Failure
   ↓
Retry
   ↓
Failure
   ↓
Retry
   ↓
Maximum Attempts
   ↓
FAILED

Potential retryable failures:

Temporary network error
Provider timeout
Temporary database connectivity issue
Rate-limit response

Potential non-retryable failures:

Invalid recipient
Invalid configuration
Permanently rejected message
Invalid business state

Exact retry classification should be provider- and operation-specific.

14. Backoff

Retries should avoid immediately repeating a failed request.

A future worker system may use:

Exponential Backoff
+
Maximum Delay
+
Maximum Attempts

Exact values should be determined from real provider and application requirements.

15. Dead-Letter Handling

Jobs that repeatedly fail should not remain in an endless retry loop.

A future queue system may provide a dead-letter state or equivalent.

Conceptually:

Job
 ↓
Retry
 ↓
Retry
 ↓
Retry Limit
 ↓
Dead Letter / Failed

Failed jobs should remain observable.

16. Scheduled Jobs

Some product behavior is time-based.

Examples:

Membership expires in 7 days
Membership expires in 3 days
Membership expires today
Member inactive for N days
Subscription expires

These can be implemented using scheduled background execution.

The exact scheduler remains open.

17. Scheduling Principle

Do not create one permanent scheduled job per member unless necessary.

For example, avoid an architecture where:

Member A → individual cron job
Member B → individual cron job
Member C → individual cron job
...

This becomes difficult to manage at scale.

Prefer periodic processing that evaluates relevant records.

Example:

Scheduled Worker
      ↓
Find members needing reminders
      ↓
Create notification jobs
      ↓
Process jobs
18. Duplicate Reminder Prevention

Scheduled jobs may run more than once.

The system must prevent duplicate reminders.

Possible mechanisms include:

Unique notification keys
Idempotency keys
Notification history
State transitions
Database constraints

The exact approach will be selected during notification implementation.

19. Notification Jobs

A notification job should represent a specific intended communication.

Example:

Organization: Gym A
Member: Rahul
Type: MEMBERSHIP_EXPIRY_7_DAYS
Date: 2026-10-10

The system should avoid creating the same logical notification repeatedly.

20. WhatsApp Provider Interaction

Workers should communicate with the provider through the notification provider boundary.

Conceptually:

Background Worker
       ↓
Notification Service
       ↓
WhatsApp Provider Interface
       ↓
Official Provider

The worker should not contain provider-specific business logic everywhere.

21. Webhook Processing

Provider webhooks may also be handled asynchronously.

Example:

WhatsApp Provider
       ↓
Webhook
       ↓
Validate Event
       ↓
Create / Process Job
       ↓
Update Notification State

Webhook processing must be idempotent because providers may retry events.

22. Large Exports

CSV exports are another potential background-job candidate.

For small exports:

Request
 ↓
Generate CSV
 ↓
Return

may be sufficient.

For large exports:

Request
 ↓
Create Export Job
 ↓
Generate File
 ↓
Store Temporarily
 ↓
Notify User

may be more appropriate.

The system should not introduce asynchronous exports until actual dataset sizes justify them.

23. Background Jobs and Payments

Payment confirmation should normally remain synchronous because the owner needs an immediate result.

Example:

Owner Confirms Payment
       ↓
Server Validation
       ↓
Transaction
       ↓
Confirmed Payment
       ↓
Immediate Response

Optional notifications after confirmation can be asynchronous.

24. Background Jobs and Attendance

Attendance recording should normally remain synchronous.

The member needs immediate confirmation.

Secondary effects such as:

Analytics
Notifications
Future achievement calculations

may become asynchronous.

25. Background Jobs and Membership Renewal

Membership renewal is a business operation and should normally be completed synchronously.

After renewal, optional secondary work may become asynchronous.

For example:

Renew Membership
      ↓
Database Transaction
      ↓
Success Response
      ↓
Notification Job
26. Queue Selection

The exact queue technology remains open.

Potential future choices include:

Provider-managed job system
Redis-backed queue
Database-backed jobs
Cloud queue service
Other managed queue infrastructure

The choice should depend on actual requirements.

27. Database-Backed Jobs

A database-backed job mechanism may be appropriate for early-stage workloads.

Potential advantages:

Minimal infrastructure
Existing PostgreSQL dependency
Simple operational model

Potential concerns:

Database load
Concurrency handling
Locking
Scheduling complexity
Scaling limitations

A database-backed approach should only be used if it can meet reliability requirements.

28. Redis

Redis may eventually be useful for:

Queueing
Rate limiting
Caching
Distributed coordination

However:

Redis is not required for V1 simply because background jobs exist.

It should be introduced when a concrete requirement justifies it.

29. Queue Infrastructure

A dedicated queue becomes more useful when:

Notification volume grows
Retry requirements become significant
Worker concurrency needs increase
Scheduled processing becomes substantial
Application requests must remain isolated from background workloads
30. Worker Architecture

The first worker implementation may run within the same overall application/deployment environment if the chosen platform supports reliable background execution.

Later it may become:

Web Application
      │
      ├── PostgreSQL
      │
      └── Queue
             ↓
          Worker

A separate worker service should only be introduced when needed.

31. Concurrency

Workers must handle concurrent processing safely.

Potential race conditions include:

Two workers processing the same job
Two reminder schedulers creating the same notification
Retry overlapping with original execution
Multiple webhook events

Appropriate locking, idempotency, or uniqueness constraints should be used.

32. Time and Time Zones

Scheduled notifications must handle dates and time zones deliberately.

The application should define a consistent strategy for:

Database timestamps
Organization timezone
Member communication time
Scheduled reminders

The product should not assume all gyms operate in the same timezone forever.

The exact timezone model should be finalized during implementation.

33. Failure Visibility

Failed jobs should be observable.

Useful information includes:

Job type
Job ID
Organization ID
Entity ID
Attempt count
Failure category
Last attempt
Next retry
Final failure state

Do not expose sensitive job payloads unnecessarily.

34. Logging

Worker logs should include enough context to diagnose failures.

Avoid logging:

OTPs
Authentication tokens
API secrets
Full payment data
Unnecessary member information

Use internal IDs where practical.

35. Monitoring

Background processing should eventually expose:

Queue depth
Processing latency
Success rate
Failure rate
Retry rate
Dead-letter count
Provider failures

Monitoring requirements should increase as background processing becomes more important.

36. Testing

Background-job tests should cover:

Job creation
Job processing
Successful completion
Retry behavior
Permanent failure
Idempotency
Duplicate prevention
Tenant isolation
Provider failures
Webhook processing
Scheduling behavior

Tests should not require real WhatsApp messages.

37. Local Development

Local development should allow background jobs to be tested without requiring the full production infrastructure.

Possible approaches include:

Local worker process
Test provider
Development queue
Simplified scheduler

The exact developer workflow will be defined during implementation.

38. Initial Implementation Strategy

The initial implementation should avoid overengineering.

A reasonable progression is:

Phase 1
Synchronous application
        ↓
Phase 2
Simple scheduled processing
        ↓
Phase 3
Background notification jobs
        ↓
Phase 4
Reliable queue + worker
        ↓
Phase 5
Scaling / dedicated workers if needed

The exact phase boundaries depend on product requirements.

39. Decision
Current Status

Background processing is required eventually but should be introduced incrementally.

Initial principles:

Keep critical user-facing operations synchronous
Use background jobs for slow/retryable/scheduled work
Make jobs idempotent
Preserve tenant context
Bound retries
Avoid duplicate notifications
Do not introduce Redis/queues prematurely
Keep provider-specific logic behind boundaries
40. Consequences
Positive
Lower initial infrastructure complexity
Easier development
Clear path toward reliable notifications
Better scalability later
Reduced request latency for asynchronous work
Trade-offs
Background processing introduces operational complexity
Retry behavior must be designed carefully
Idempotency becomes important
Scheduling introduces time-related edge cases
Additional monitoring is eventually required
41. Future Reassessment

Reassess background-job infrastructure when:

WhatsApp automation is implemented
Reminder volume increases
Retry requirements become significant
Scheduled processing becomes substantial
Large exports are introduced
Queue latency becomes measurable
Production workload justifies dedicated workers
42. Related Documents
01-PRODUCT-REQUIREMENTS.md
03-SYSTEM-ARCHITECTURE.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
14-TECH-DECISIONS.md
005-WHATSAPP-PROVIDER.md
20-CURRENT-STATE.md
43. Approval

Decision Owner: Project Owner

Status: Proposed

Queue: TBD

Worker: TBD

Scheduler: TBD

Redis: Not required initially

Approval Date: N/A
