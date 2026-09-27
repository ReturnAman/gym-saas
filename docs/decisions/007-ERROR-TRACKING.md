# ADR 007 — Error Tracking

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Observability / Reliability / Security

---

# 1. Context

gym-saas will eventually run as a production SaaS application.

Production failures may occur in:

- Authentication
- Authorization
- Database operations
- Payments
- Attendance
- Notifications
- Background jobs
- External provider integrations
- Frontend code
- Deployment/runtime infrastructure

Normal application logs are useful for debugging, but they may not provide enough structured information to investigate production errors efficiently.

The project therefore needs an error-tracking strategy.

---

# 2. Requirements

The error-tracking system should provide:

- Exception/error capture
- Stack traces
- Error grouping
- Environment identification
- Release/version identification
- Useful request context
- Error frequency
- First/last occurrence
- Search and filtering
- Alerts where appropriate
- Integration with deployment/version information

The system must not become a source of sensitive-data leakage.

---

# 3. Security Requirements

Error tracking must never intentionally capture:

- Passwords
- OTP values
- Authentication tokens
- Session tokens
- API keys
- Database credentials
- Private keys
- Full payment credentials
- Unnecessary sensitive personal information

Sensitive request headers should be filtered or removed.

Sensitive request bodies should not be captured indiscriminately.

---

# 4. Candidate Provider

A leading candidate is:

> Sentry

Sentry is being considered because it provides:

- Error tracking
- Stack traces
- Error grouping
- Performance/monitoring capabilities
- Release tracking
- Framework integrations
- Student/developer benefits

The final provider decision remains subject to implementation requirements and current pricing/benefits.

---

# 5. Application Error Handling

Error tracking does not replace application error handling.

The application must still:

- Validate input
- Handle expected failures
- Return safe errors
- Avoid leaking internal details
- Log useful operational information
- Maintain correct business state

Conceptually:

```text
Application Error
       ↓
Is it expected?
   ┌───┴────┐
  Yes       No
   ↓         ↓
Safe        Error
Response    Tracking

Expected user errors should not necessarily create noisy production error events.

6. Expected vs Unexpected Errors

Examples of expected errors:

Invalid OTP
Expired OTP
Unauthorized action
Invalid input
Membership not found
Payment claim already processed

These should generally be handled as normal application behavior.

Examples of unexpected errors:

Unhandled exception
Database connection failure
Unexpected provider response
Runtime crash
Unexpected state transition
Infrastructure failure

These should be candidates for error tracking.

7. Error Severity

Errors should be classified appropriately.

Potential levels:

Debug
Info
Warning
Error
Critical

Not every error should generate an alert.

For example:

Invalid OTP
→ Expected application event

Database unavailable
→ Error / potentially critical alert
8. Environment Separation

Error tracking must distinguish environments.

At minimum:

Development
Production

A staging environment may be added later.

Development errors should not pollute production monitoring.

9. Release Tracking

Production errors should ideally be associated with an application version/release.

Conceptually:

Release
   ↓
Deployment
   ↓
Error
   ↓
Affected Version

This helps determine whether an error was introduced by a particular deployment.

10. Source Maps

If frontend source maps are used for debugging production JavaScript errors, they must be handled securely.

Production source maps should not automatically be exposed publicly if they contain information that should remain private.

The deployment process should upload source-map information to the error-tracking provider through an appropriate secure mechanism where supported.

11. Context

Useful context may include:

Environment
Release/version
Route
Request type
Operation
Error type
Relevant internal identifier
Organization identifier where safe
User identifier where safe

Context must follow the principle:

Enough information to debug, without unnecessary sensitive information.

12. Tenant Context

Because gym-saas is multi-tenant, tenant context can be useful during debugging.

However, tenant information must be handled carefully.

A production error may include a safe internal organization identifier.

Avoid attaching unnecessary member data or personally identifiable information.

13. User Context

Authenticated user context may be useful for debugging.

If included, prefer internal identifiers rather than sensitive personal information.

Do not attach:

Passwords
OTPs
Authentication tokens
Full payment information
Unnecessary phone numbers
14. Payment Errors

Payment-related errors require additional caution.

Error tracking may record:

Payment operation failed
Organization ID
Payment ID
Operation
Error category
Release
Timestamp

It must not record unnecessary financial or authentication secrets.

The payment domain remains the source of truth.

Error tracking must never be used as the payment ledger.

15. Authentication Errors

Authentication failures should be handled carefully.

Never capture:

OTP values
Session tokens
Passwords
Authentication provider secrets

Useful debugging information may include:

Error category
Operation
Environment
Release
Internal request identifier
16. Authorization Errors

Authorization failures may be expected application behavior.

For example:

Member attempts owner-only operation

This may be an expected 403 response rather than an application crash.

However, unusual patterns may later be useful for security monitoring.

The system should distinguish normal authorization failures from unexpected authorization errors.

17. Tenant Isolation Errors

Unexpected cross-tenant access attempts are security-sensitive.

The application should:

Deny access
Avoid leaking resource existence
Record appropriate security/audit information
Avoid exposing sensitive data in error tracking

Detailed security-event handling may be defined separately.

18. Logging vs Error Tracking

Error tracking and application logs have different purposes.

Logs

Useful for:

Operational events
Debugging sequences
Application behavior
Structured system information
Error Tracking

Useful for:

Exceptions
Stack traces
Error grouping
Release correlation
Error trends
Alerting

They should complement each other.

19. Correlation IDs

The application should eventually support request/correlation identifiers.

Conceptually:

Request
   ↓
Request ID
   ├── Application Logs
   └── Error Event

This allows an engineer to connect an error event with relevant logs.

The exact implementation can be introduced with the observability layer.

20. Alerting

Alerts should focus on actionable failures.

Potential alerts:

Production application crash
Repeated database failures
Large increase in error rate
Authentication infrastructure failure
Notification provider failure
Payment processing failure
Background worker failure

Avoid alerting on every normal user mistake.

21. Alert Fatigue

Too many alerts reduce their value.

The system should avoid:

Every invalid OTP
→ Alert engineer

Instead:

Unexpected authentication infrastructure failure
→ Alert engineer

Alert thresholds should be based on actual production behavior.

22. Privacy

Error tracking introduces another external data processor/service.

Before production use, the project should review:

What data is collected
Where data is stored
Data retention
Access controls
Provider security
Applicable privacy requirements
Whether personal data is transmitted unnecessarily

The application should minimize transmitted data regardless of provider.

23. Data Scrubbing

The integration should explicitly configure filtering/scrubbing for sensitive data.

Potentially sensitive fields include:

authorization
cookie
set-cookie
password
otp
token
secret
apiKey
databaseUrl

The exact implementation should be tested rather than assumed.

24. Development Behavior

During local development:

Errors may be visible directly
Error tracking may be disabled or separated
Debug logging may be more verbose

Development configuration must not accidentally use production credentials.

25. Production Behavior

In production:

User-facing errors should remain safe
Internal stack traces should not be exposed to users
Unexpected errors should be captured
Sensitive information should be filtered
Alerts should be configured for important failures
26. Testing

The error-tracking integration should be tested for:

Error capture
Environment tagging
Release tagging
Sensitive-data scrubbing
Authentication error handling
Payment error handling
Database error handling
Provider failures
Frontend errors
Backend errors

Testing should ensure that secrets do not appear in captured events.

27. Provider Abstraction

A large generic abstraction around error tracking is not required.

The integration can remain isolated in the observability layer.

Application business logic should not depend heavily on provider-specific APIs.

28. Decision
Current Status

Sentry is the leading error-tracking candidate.

The final provider selection remains open until:

Current student benefits are verified
Current pricing is evaluated
Data/privacy requirements are reviewed
Integration requirements are tested

Regardless of provider:

Sensitive data must be scrubbed
Production errors should be tracked
Expected user errors should not create excessive noise
Error tracking does not replace application logging
Error tracking does not replace audit logging
29. Consequences
Positive
Faster production debugging
Better visibility into failures
Release correlation
Error grouping
Useful alerts
Better reliability
Trade-offs
Additional external service
Potential cost
Additional privacy considerations
Configuration complexity
Risk of accidentally capturing sensitive data
30. Future Reassessment

Reassess error tracking when:

Production traffic increases
Error volume changes
Privacy requirements change
Current provider pricing changes
A different observability platform becomes more appropriate
More advanced performance monitoring becomes necessary
31. Related Documents
06-SECURITY.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
32. Approval

Decision Owner: Project Owner

Status: Proposed

Error Tracking Provider: TBD

Leading Candidate: Sentry

Production Enabled: No

Approval Date: N/A

Notes:

Current provider pricing, student benefits, privacy/data-processing terms, and technical capabilities should be verified before production adoption.
