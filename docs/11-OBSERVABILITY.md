# Observability

## Project

- Project: gym-saas
- Document: Observability Strategy
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

## 1. Purpose

This document defines how gym-saas will understand what is happening inside the system after deployment.

Observability should help answer:

- Is the application working?
- Are users experiencing failures?
- Which operation failed?
- Where did the failure occur?
- Is a dependency failing?
- Is the database healthy?
- Are important business operations completing correctly?
- Is a security-sensitive event occurring?
- Can an incident be investigated without exposing sensitive data?

Observability should remain proportional to the size and maturity of the product.

---

# 2. Observability Principles

The project follows these principles:

1. Production behavior should be observable.
2. Logs should be useful and structured.
3. Errors should be traceable.
4. Sensitive information must not be logged.
5. Observability must respect tenant and user privacy.
6. Security events should be auditable.
7. Business-critical operations should have appropriate visibility.
8. Monitoring should produce actionable signals.
9. Avoid excessive logging.
10. Observability tools must not become a security boundary.
11. External provider failures should be distinguishable from application failures.
12. Observability should evolve with actual system usage.

---

# 3. Three Observability Areas

The initial observability model consists of:

```text
Logs
Metrics
Errors / Traces
These answer different questions.

Logs

What happened?

Metrics

How often and how much?

Errors / Traces

Where did something fail or become slow?

Not every V1 component requires full distributed tracing.

4. Structured Logging

Application logs should eventually use structured records rather than arbitrary text where practical.

Conceptual structure:

timestamp
environment
level
event
requestId
operation
organizationId
actorId
result
errorCode
duration

Only safe information should be included.

5. Log Levels

A simple log-level model should be used.

DEBUG

Detailed development information.

Normally disabled or minimized in production.

INFO

Important normal application events.

Examples:

application startup
successful job completion
deployment-related application events
WARN

Unexpected but recoverable conditions.

Examples:

external provider temporarily unavailable
retry scheduled
unusual request pattern
ERROR

A meaningful failure requiring investigation.

Examples:

database operation failure
unexpected application exception
failed critical background job
CRITICAL

Reserved for severe failures affecting production availability or important security/data behavior.

The exact logging framework and configuration will be finalized in 14-TECH-DECISIONS.md.

6. Sensitive Information

The following must never be logged:

OTP values
passwords
authentication tokens
session secrets
API keys
database passwords
cloud credentials
WhatsApp credentials
private provider tokens

Avoid logging unnecessary:

phone numbers
personal information
payment information
member information

If a value is not needed for debugging, do not log it.

7. Phone Numbers

Phone numbers are sensitive user information.

Logs should not contain full phone numbers unless there is a specifically justified operational requirement.

Where correlation is necessary, use a safe internal identifier or appropriately protected representation.

8. Payment Logging

Payment-related logs must not expose unnecessary financial or personal information.

Useful operational information may include:

payment operation
organization identifier
payment record identifier
actor identifier
result
error code
timestamp

Avoid logging:

payment credentials
authentication secrets
unnecessary member information
sensitive payment details
9. Tenant-Aware Logging

Logs must preserve enough context to investigate tenant-specific problems.

Where appropriate, logs may contain:

organizationId
actorId
resourceId
requestId

However, tenant identifiers must not become a reason to expose customer data unnecessarily.

Logs themselves must be access-controlled.

10. Request Correlation

Important requests should have a request/correlation identifier.

Conceptually:

Client Request
      ↓
Request ID
      ↓
API
      ↓
Business Logic
      ↓
Database / Provider

This allows related logs to be connected during investigation.

A request identifier must not contain sensitive information.

11. Error Tracking

An error tracking system may be used to capture unexpected application failures.

A candidate is Sentry because it is available through the student benefits.

The final provider will be decided in:

14-TECH-DECISIONS.md

Error tracking must be configured carefully to avoid collecting sensitive data.

12. Error Categories

Application errors should be distinguishable where practical.

Examples:

AUTHENTICATION_ERROR
AUTHORIZATION_ERROR
VALIDATION_ERROR
TENANT_ACCESS_ERROR
RESOURCE_NOT_FOUND
CONFLICT
RATE_LIMITED
DATABASE_ERROR
EXTERNAL_PROVIDER_ERROR
INTERNAL_ERROR

The exact error taxonomy belongs in the API implementation.

13. User-Facing Errors

Users should receive useful but safe errors.

Good:

Something went wrong. Please try again.

or:

Your payment is already being processed.

Avoid exposing:

database errors
stack traces
internal file paths
provider credentials
SQL details
internal architecture
sensitive identifiers
14. Authentication Observability

Authentication-related events should be observable without logging authentication secrets.

Potential events:

OTP requested
OTP verification succeeded
OTP verification failed
OTP expired
rate limit triggered
session created
session ended

The actual OTP value must never be logged.

15. Authorization Observability

Security-sensitive authorization failures should be observable.

Examples:

unauthorized role attempt
cross-tenant access attempt
access to unavailable resource
forbidden payment confirmation
unauthorized staff-role change

Logs should record enough information for investigation without exposing unnecessary data.

16. Security Events

Security-relevant events should be auditable.

Examples:

repeated failed OTP attempts
excessive OTP requests
suspicious access attempts
role changes
organization membership changes
sensitive configuration changes
payment confirmation
subscription changes

Security logging should not itself create a sensitive-data leak.

17. Audit Logs

Some business operations require an audit trail.

Important candidates include:

role assignment
role removal
member status changes
payment confirmation
payment reversal/adjustment
subscription activation
subscription extension
organization configuration changes
important permission changes

Audit records should identify:

actor
organization
action
target/resource
timestamp
relevant safe metadata

The exact audit schema belongs in the database implementation.

18. Audit Logs vs Application Logs

These are different concepts.

Application logs

Used primarily for debugging and operational investigation.

Audit logs

Used to establish that an important business/security action occurred.

An audit record should not depend solely on ordinary application log retention.

Important audit information should have appropriate persistence.

19. Metrics

Metrics should answer operational questions such as:

How many requests are occurring?
How many are failing?
How long do requests take?
Are background jobs succeeding?
Are external providers failing?
Is the database becoming a bottleneck?

Metrics should remain focused on actionable information.

20. Initial Application Metrics

Potential V1 metrics:

request_count
request_error_count
request_latency
authentication_success_count
authentication_failure_count
authorization_failure_count
attendance_checkin_count
attendance_checkout_count
payment_claim_count
payment_confirmation_count
notification_job_count
notification_failure_count

The exact metric implementation will be finalized later.

21. Business Metrics

Operational observability should not be confused with product analytics.

However, some business events are useful operational signals.

Examples:

member check-ins
payment confirmations
active organizations
notification failures
trial expiration events

Product analytics should be designed separately from infrastructure monitoring.

22. Database Observability

The database should eventually be monitored for:

availability
connection problems
query latency
connection saturation
storage usage
failed transactions
unusual resource consumption

Slow or problematic queries should be investigated before introducing architectural complexity.

23. Database Error Logging

Database errors should be captured safely.

Logs should not expose:

credentials
connection strings
unnecessary query parameters
sensitive user data

Development environments may expose more debugging information than production, but production logs must remain safe.

24. External Provider Observability

External providers include:

authentication/OTP provider
WhatsApp provider
cloud services
future payment providers
future storage providers

Provider operations should expose enough information to determine:

Application problem
vs
Provider problem

Example:

Notification job failed
        ↓
Provider request failed
        ↓
Provider error recorded
        ↓
Retry / failure handling

Provider secrets must never be logged.

25. WhatsApp Observability

WhatsApp notification records should allow the system to determine:

notification created
queued
provider request attempted
provider accepted/rejected
delivery status where available
failure
retry state

Useful metadata may include:

organizationId
memberId
messageType
templateId
providerMessageId
status
createdAt
updatedAt

The actual message content should not be unnecessarily duplicated in operational logs.

26. Background Job Observability

Future background jobs should expose:

job type
job identifier
organization context where appropriate
creation time
execution time
success/failure
retry count
final status

Examples:

WhatsApp notification
reminder
export
cleanup
analytics job

Jobs should be traceable without logging sensitive payloads.

27. Scheduled Job Monitoring

Scheduled jobs should be monitored for:

missed execution
repeated failure
excessive runtime
duplicate execution
unexpected volume

Important scheduled operations should be designed to tolerate retries.

28. Alerting

Alerts should be reserved for conditions that require action.

Potential alerts:

production unavailable
unusually high application error rate
database unavailable
repeated background-job failures
external provider outage
severe resource exhaustion
important security event

Avoid creating alerts for every minor error.

Alert fatigue reduces operational effectiveness.

29. Alert Severity

A simple severity model may be used:

Informational

Useful operational information.

No immediate action required.

Warning

Potential issue requiring investigation.

Critical

Significant production impact or security/data risk.

Requires immediate attention.

The exact alerting implementation will evolve with production usage.

30. Health Checks

The application should eventually expose safe health information.

Possible checks:

Application
Database
Critical internal dependency

Health endpoints must not expose secrets or detailed internal diagnostics to unauthorized users.

31. Readiness and Liveness

If the hosting environment benefits from them, distinguish:

Liveness

Is the application process functioning?

Readiness

Can the application currently serve requests safely?

These concepts should only be introduced when the deployment environment actually benefits from them.

32. Performance Observability

Important performance signals include:

API latency
database latency
page load performance
server processing time
background-job duration
external provider latency

Performance monitoring should focus on user-impacting operations.

33. Critical User Journey Monitoring

As the product matures, critical journeys may receive synthetic monitoring.

Examples:

owner login
member onboarding
member check-in
payment claim
owner payment confirmation

Synthetic monitoring should use dedicated test accounts and must never modify real customer data.

34. PWA Observability

The PWA should provide visibility into important client-side failures.

Potential signals:

JavaScript errors
failed API requests
service-worker failures
installation problems
authentication/session errors

Client-side telemetry must respect privacy and should not capture unnecessary sensitive information.

35. Privacy

Observability data can itself contain sensitive information.

Therefore:

restrict access
minimize collected data
define retention
avoid unnecessary PII
protect logs
protect audit records
review third-party telemetry settings

Observability must not become an uncontrolled copy of production data.

36. Retention

Retention periods should be defined according to:

operational usefulness
security requirements
privacy requirements
cost

Not every log needs long-term retention.

Audit records may require different retention from ordinary application logs.

Exact retention periods will be determined later.

37. Development vs Production Logging

Development may use more verbose logging.

Production should prioritize:

actionable information
safe information
structured events
controlled volume

Debug logs should not accidentally become production data leaks.

38. Observability During Incidents

During an incident, investigate in this order where practical:

User impact
    ↓
Application health
    ↓
Recent deployments
    ↓
Error rates
    ↓
Database
    ↓
External providers
    ↓
Infrastructure

The actual investigation order depends on the incident.

39. Incident Correlation

Useful correlation information may include:

requestId
organizationId
actorId
resourceId
jobId
providerMessageId

Identifiers should be used carefully and should not expose sensitive information.

40. Deployment Observability

After deployment, verify:

application starts
error rates remain normal
database connection works
critical APIs respond
background jobs run
external integrations behave correctly

A deployment should not be considered successful solely because the deployment command completed.

41. Observability for Payments

Payment-related observability should distinguish:

Payment claim created
        ↓
Payment reviewed
        ↓
Payment confirmed
        ↓
Balance recalculated

Important failures should be visible.

However, observability must not expose unnecessary payment or member information.

42. Observability for Attendance

Attendance operations should be observable at an operational level.

Examples:

check-in success/failure
check-out success/failure
duplicate operation
authorization failure
database failure

The system should make it possible to investigate reports such as:

"Members cannot check in."

without exposing member information unnecessarily.

43. Observability for Multi-Tenancy

When investigating tenant-specific issues, the system should allow authorized operators to identify:

organization
request
actor
resource
operation
result

Cross-tenant access attempts should be distinguishable from ordinary application errors.

44. Cost Control

Observability services may generate significant costs as usage grows.

Avoid:

logging every database query in production
collecting unnecessary request bodies
storing duplicate telemetry
excessive high-cardinality metrics
unnecessary long-term log retention

Observability must remain proportional to the product's scale.

45. AI-Assisted Development

AI may help:

interpret error logs
identify likely failure points
create dashboards
improve instrumentation
write monitoring configuration
analyze recurring errors

AI must not:

expose secrets
copy sensitive production data into prompts unnecessarily
disable security logging
remove monitoring merely to silence failures
hide errors without understanding the underlying issue
46. V1 Observability Priorities

Priority order:

Safe structured application logging
Error tracking
Request correlation
Authentication/security event visibility
Database error visibility
Critical business-operation visibility
Basic health checks
Basic application metrics
Background-job visibility
External-provider failure visibility
Basic alerting

Advanced distributed tracing is not a V1 requirement.

47. What V1 Should Avoid

Do not introduce prematurely:

complex distributed tracing
large observability platforms
excessive custom metrics
expensive log pipelines
unnecessary telemetry
duplicate monitoring systems

Observability should grow with system complexity.

48. Relationship With Other Documents

This document depends on:

03-SYSTEM-ARCHITECTURE.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
10-DEVOPS.md

Related future documents:

12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
49. Status

Status: Observability strategy defined.

This document defines the observability direction.

Exact:

logging library
error tracking provider
metrics system
alerting system
dashboards
retention periods
tracing implementation

will be finalized through 14-TECH-DECISIONS.md and the implementation phase.
