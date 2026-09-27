# Scalability

## Project

- Project: gym-saas
- Document: Scalability Strategy
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

## 1. Purpose

This document defines how gym-saas should handle increasing usage without introducing unnecessary architectural complexity.

The goal is not to design for millions of users on day one.

The goal is to create a simple foundation that can grow when real usage creates a measurable need.

---

# 2. Scalability Principles

The project follows these principles:

1. Scale based on real requirements.
2. Keep V1 simple.
3. Prefer vertical scaling before unnecessary distributed architecture.
4. Maintain strict tenant isolation while scaling.
5. Database performance is a major scalability concern.
6. Avoid premature microservices.
7. Optimize measured bottlenecks rather than hypothetical ones.
8. Preserve correctness while increasing throughput.
9. Background work should not unnecessarily block user requests.
10. External providers must not become hidden scalability bottlenecks.
11. Caching should be introduced only where useful.
12. Scalability changes must remain observable and testable.

---

# 3. Initial Architecture

The expected V1 architecture is intentionally simple:

```text
Users
  ↓
PWA / Web Application
  ↓
Application Backend
  ↓
PostgreSQL
  ↓
External Providers
The system should initially operate as a modular application rather than a collection of microservices.

4. Initial Scaling Strategy

The first scaling strategy should generally be:

Improve application code
        ↓
Optimize database queries
        ↓
Add appropriate indexes
        ↓
Increase application resources
        ↓
Increase database resources
        ↓
Introduce caching/background processing
        ↓
Split components only when justified

The exact order may change depending on the bottleneck.

5. Vertical Scaling

Vertical scaling means increasing the resources available to an existing service.

Examples:

more CPU
more memory
better database tier
faster storage

This should generally be considered before introducing distributed infrastructure.

For an early SaaS with relatively small traffic, vertical scaling is often simpler to operate.

6. Horizontal Scaling

Horizontal scaling means running multiple application instances.

Conceptually:

                 ┌─ Application Instance 1
Users → Router ──┼─ Application Instance 2
                 └─ Application Instance 3
                         ↓
                    PostgreSQL

The application should avoid unnecessary reliance on local instance state so that horizontal scaling remains possible later.

7. Stateless Application Design

Application instances should remain as stateless as practical.

Avoid relying on local server memory for important persistent business state.

Important state belongs in appropriate persistent systems such as:

PostgreSQL
approved external storage
approved job/queue infrastructure

This makes multiple application instances easier to operate.

8. Authentication and Scaling

Authentication should remain compatible with multiple application instances.

The application should not depend on a specific server instance remembering a user's session.

Authentication/session state should follow the selected authentication architecture.

Authorization must continue to be enforced server-side regardless of the number of application instances.

9. Multi-Tenant Scaling

Every organization shares the same application infrastructure while remaining logically isolated.

Conceptually:

Organization A ─┐
Organization B ─┼→ Application → PostgreSQL
Organization C ─┘

Tenant isolation must remain enforced as the system scales.

Scaling must never introduce shortcuts such as:

trusting organization IDs from the client
skipping authorization
querying without tenant scope
exposing shared caches without tenant keys
10. Database as a Core Scaling Concern

PostgreSQL is likely to become one of the most important scalability components.

Potential bottlenecks include:

inefficient queries
missing indexes
excessive joins
large attendance history
large payment history
member search
dashboard queries
notification records

Database optimization should be measured rather than speculative.

11. Indexing Strategy

Indexes should be created based on:

common queries
filtering
sorting
relationships
uniqueness requirements
tenant-scoped access patterns

Potential examples include fields used for:

organization membership
member lookup
phone association
attendance history
payment history
membership expiration
notification status

The final indexes belong in the database implementation.

Do not add indexes blindly.

12. Tenant-Scoped Queries

Most application queries should naturally operate within an organization context.

Conceptually:

organizationId
     ↓
resource lookup
     ↓
authorization
     ↓
resource returned

Tenant scope must remain part of the query design.

Avoid:

find resource by ID only

when organization ownership is required.

13. Large Data Sets

As gyms accumulate data, tables such as:

attendance
payments
notifications
audit records

may grow substantially.

Potential future strategies include:

better indexes
pagination
archival
partitioning
retention policies
aggregation

These should be introduced only when actual data volume justifies them.

14. Pagination

Large result sets should not be returned in a single request.

Examples:

member lists
attendance history
payment history
audit logs
notification history

Pagination should be introduced from the beginning for data that can realistically become large.

The exact pagination strategy will be finalized during API implementation.

15. Search

Member search should remain efficient as organizations grow.

Initial search may use PostgreSQL capabilities.

Potential future improvements:

optimized indexes
full-text search
specialized search service

A separate search engine should not be introduced unless PostgreSQL becomes insufficient.

16. Dashboard Scaling

Owner dashboards can become expensive because they may combine:

member counts
active memberships
payment balances
attendance
occupancy
expiring memberships
notifications

Initial approach:

efficient database queries
appropriate indexes
pagination
limited result sets

Later approaches may include:

precomputed aggregates
caching
background aggregation
17. Attendance Scaling

Attendance may become one of the highest-volume domains.

A gym may generate many attendance records every day.

The design should therefore:

use efficient indexes
avoid unnecessary duplicate records
protect against duplicate check-ins
use appropriate date filtering
paginate historical data

Historical attendance should not be loaded unnecessarily on every dashboard request.

18. Live Occupancy Scaling

Live occupancy should be derived from active attendance state.

For V1, calculating active sessions directly from the database may be sufficient.

If usage grows substantially, possible optimizations include:

indexed active-session queries
cached occupancy
event-driven updates
short-lived cache

The system must preserve correctness.

A stale occupancy number may be worse than a slightly slower accurate query.

19. Payment Scaling

Payment records are generally lower volume than attendance but require stronger correctness guarantees.

Scaling must not compromise:

payment history
confirmed amounts
outstanding balance
tenant isolation
authorization
duplicate protection

Financial correctness has higher priority than marginal performance gains.

20. Notification Scaling

WhatsApp and other notifications may generate asynchronous workloads.

Potential architecture:

Business Event
      ↓
Notification Job
      ↓
Queue
      ↓
Worker
      ↓
Provider

V1 may use a simpler implementation if notification volume is small.

A queue should be introduced when:

requests become slow because of notification work
retry requirements increase
notification volume increases
scheduled jobs become substantial
21. Background Processing

Long-running or retryable work should eventually move out of the user request path.

Examples:

WhatsApp messages
CSV exports
scheduled reminders
analytics aggregation
cleanup

A user request should not remain open unnecessarily while a slow external provider is contacted.

22. Queue Strategy

A queue may eventually be introduced for:

notification jobs
scheduled tasks
exports
retryable background work

The queue should provide:

reliable job handling
retry support
visibility
idempotency

Do not introduce a message broker simply because the architecture diagram looks more advanced.

23. Idempotent Jobs

Background jobs should be safe to retry where possible.

For example:

Notification Job
      ↓
Provider request
      ↓
Temporary failure
      ↓
Retry

The retry must not unintentionally send duplicate messages when the provider already accepted the first request.

The exact idempotency strategy depends on the provider.

24. Caching

Caching should be introduced only when there is evidence that repeated reads are expensive.

Potential cache candidates:

gym settings
stable configuration
entitlement information
frequently accessed dashboard data
short-lived occupancy data

Do not cache sensitive or frequently changing data without understanding invalidation.

25. Cache Invalidation

If caching is introduced, define:

cache key
TTL
invalidation event
tenant scope
stale-data tolerance

Example:

organizationId + resource

must generally be part of a tenant-specific cache key where relevant.

Never allow one organization's cached data to be returned to another organization.

26. Redis

Redis may eventually be useful for:

caching
rate limiting
distributed locks
queues
temporary state

However, Redis should not be introduced merely because it is a common SaaS technology.

PostgreSQL should remain the primary source of truth for core business data.

27. Rate Limiting at Scale

Rate limiting should continue to protect:

OTP requests
OTP verification
authentication endpoints
public endpoints
expensive APIs
notification operations

As multiple application instances are introduced, rate limiting may need shared infrastructure.

The exact implementation will depend on the deployment architecture.

28. Concurrency

Scaling increases the probability of concurrent operations.

Important examples:

two staff members confirming the same payment
duplicate check-ins
simultaneous membership updates
notification retries
multiple owners editing configuration

The system should use appropriate:

database constraints
transactions
locking where required
idempotency

Do not rely only on frontend prevention.

29. Database Connection Management

When multiple application instances are introduced, database connections can increase significantly.

The system should monitor:

connection count
connection pool usage
query latency
database resource usage

Connection pooling should be configured according to the chosen hosting architecture.

30. Read Replicas

Read replicas are not a V1 requirement.

They may become useful if:

read traffic becomes substantially larger than write traffic
database resources are exhausted
dashboards/search/history create significant load

Introducing read replicas requires careful handling of replication lag.

31. Database Partitioning

Partitioning should not be introduced prematurely.

Potential future candidates:

attendance
notification records
audit records

Only consider partitioning when table size and query behavior demonstrate a real need.

32. Data Archival

Historical data may eventually become expensive to query.

Possible strategy:

Active Data
     ↓
Older Data
     ↓
Archive

Any archival strategy must preserve:

required business records
reporting requirements
legal/operational requirements
auditability

The exact retention strategy belongs in future product and infrastructure decisions.

33. File and Photo Storage

Future progress-photo functionality may create significant storage requirements.

The initial preference is local-first/private storage where practical.

If cloud backup is introduced later, object storage should be considered rather than storing large binary files directly in PostgreSQL.

Access must remain tenant- and user-authorized.

34. API Scalability

API endpoints should avoid:

unnecessary database queries
unbounded result sets
synchronous external calls when unnecessary
repeated duplicate calculations
expensive work on every request

API behavior should be measured before optimizing.

35. N+1 Query Prevention

When loading related data, avoid accidentally executing a separate database query for every record.

Example:

100 members
+
100 individual membership queries
=
101 database queries

Prefer appropriate query strategies that retrieve required data efficiently.

Do not blindly load every relation either.

36. API Rate Limits

Rate limits should protect expensive and sensitive endpoints.

Higher-risk examples:

OTP request
OTP verification
public onboarding
exports
notification operations
search endpoints

Limits should be designed around legitimate usage rather than arbitrary restrictions.

37. Exports

CSV exports can become expensive for large datasets.

Initial approach:

limit export scope
validate authorization
generate safely
avoid blocking normal requests unnecessarily

Future large exports may become background jobs.

38. Multi-Gym Users

A user may belong to multiple organizations.

Scaling must preserve correct organization context.

Every request should have an explicit authorized organization context.

Switching organizations must not accidentally retain permissions or cached data from the previous organization.

39. External Provider Scaling

External services may impose:

rate limits
quotas
message limits
API latency
temporary outages

The notification system should handle these without blocking core application workflows unnecessarily.

Provider limits should be monitored before increasing sending volume.

40. WhatsApp Scaling

Centralized WhatsApp sending means the SaaS may eventually send messages for many gyms through one provider integration.

Scaling concerns include:

provider limits
approved templates
sending rate
retries
delivery status
message volume
cost
tenant attribution

The notification system should remain tenant-aware even though the provider account is centralized.

41. Authentication Provider Scaling

Authentication remains delegated to the selected authentication architecture.

Application authorization must continue to be enforced independently.

If authentication provider limits or pricing become a concern, the impact should be evaluated before making architectural changes.

42. Observability During Scaling

Every scalability change should preserve observability.

Before and after an optimization, measure where practical:

latency
error rate
throughput
database load
memory
CPU
queue depth
provider failures

Do not assume an optimization worked simply because the code looks faster.

43. Load Testing

Load testing should be introduced when real traffic or deployment scale justifies it.

Potential scenarios:

member check-in
member search
dashboard loading
attendance history
payment verification
notification creation

Load tests should use synthetic data.

They must not affect production users or production financial records.

44. Capacity Planning

As real usage grows, track:

number of organizations
members per organization
daily check-ins
monthly payment records
notification volume
database size
API requests
storage usage

These measurements provide a basis for capacity decisions.

45. Scaling Triggers

Scaling decisions should be based on observable evidence.

Possible triggers:

sustained high CPU
sustained high memory usage
database resource exhaustion
increasing API latency
high queue depth
provider rate limits
storage growth
unacceptable dashboard latency

Exact thresholds should be established from real workload rather than invented prematurely.

46. Failure During Scaling

Scaling changes can introduce new failure modes.

Examples:

cache inconsistency
race conditions
connection exhaustion
duplicate jobs
stale replicas
distributed rate-limit problems

Every major scalability change should include:

tests
observability
rollback/recovery plan
documentation
47. Microservices

Microservices are not part of the V1 architecture.

A service should only be separated when there is a demonstrated reason such as:

independent scaling requirement
strong domain boundary
independent deployment requirement
operational isolation
team ownership boundary

Splitting services only to make the architecture appear advanced is explicitly discouraged.

48. Modular Monolith

The preferred initial architecture is a modular application.

Potential domain boundaries include:

Authentication
Organizations
Members
Memberships
Attendance
Payments
Subscriptions
Notifications
Announcements

These boundaries should exist in code without requiring separate deployments.

This keeps the system simple while preserving future flexibility.

49. Scalability and Security

Scaling must never weaken:

authentication
authorization
tenant isolation
payment integrity
auditability
secret management

Any optimization that bypasses a security check is unacceptable.

50. Scalability and Cost

Every scaling mechanism has operational cost.

Examples:

More application instances → higher compute cost
More database resources → higher database cost
Redis → additional infrastructure
Queue → additional infrastructure
Read replica → additional database cost
Search service → additional operational cost

The simplest solution that satisfies actual requirements should be preferred.

51. AI-Assisted Scalability Work

AI may help:

analyze slow queries
identify bottlenecks
propose indexes
inspect performance data
design load tests
suggest optimizations

AI must not introduce:

microservices
Redis
queues
replicas
caching
partitioning

without evidence that the added complexity is justified.

52. V1 Scalability Priorities

Priority order:

Efficient PostgreSQL queries
Correct indexes
Pagination
Tenant-scoped queries
Stateless application behavior
Safe concurrency
Efficient attendance operations
Efficient dashboard queries
Controlled background work
Basic observability
Vertical scaling when required
53. Future Scalability Priorities

When real usage requires them:

Background job queue
Caching
Horizontal application scaling
Advanced rate limiting
Database optimization
Read replicas
Data archival
Object storage
Advanced monitoring
Specialized services only when justified
54. What V1 Should Avoid

Do not introduce prematurely:

Kubernetes
microservices
service mesh
distributed databases
database sharding
complex event-driven architecture
multiple caching layers
search infrastructure
read replicas
partitioning
complicated distributed locks

These are future tools, not default requirements.

55. Relationship With Other Documents

This document depends on:

03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md

Related future documents:

13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
56. Status

Status: Scalability strategy defined.

This document defines how the application should evolve as usage increases.

Actual scaling decisions must be based on:

measured workload
production metrics
user requirements
reliability requirements
cost
engineering complexity

No scaling infrastructure should be introduced solely because this document exists.
