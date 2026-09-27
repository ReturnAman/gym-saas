# DevOps

## Project

- Project: gym-saas
- Document: DevOps Strategy
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

## 1. Purpose

This document defines how gym-saas will be developed, validated, built, deployed, configured, monitored, and maintained across environments.

The goal is to establish a simple and reliable DevOps foundation without introducing unnecessary infrastructure complexity.

The system should be:

- reproducible
- secure
- observable
- testable
- deployable
- recoverable
- easy to maintain

The V1 system should avoid premature infrastructure complexity such as unnecessary microservices, Kubernetes, or complicated deployment platforms.

---

# 2. DevOps Principles

The project follows these principles:

1. Infrastructure should be as simple as practical.
2. Development, testing, and production environments must be separated.
3. Production changes must be deliberate and traceable.
4. Secrets must never be committed to Git.
5. Deployments should be reproducible.
6. Database changes must use controlled migrations.
7. CI should automatically validate important changes.
8. Failed deployments should be recoverable.
9. Logs and application health should be observable.
10. Infrastructure choices should not unnecessarily lock the product to one provider.
11. Use student benefits where they provide real value, not merely because they are available.
12. Do not create infrastructure before the corresponding product/technical requirement exists.

---

# 3. Environments

The initial environment model is:

```text
Local Development
       ↓
CI / Test
       ↓
Staging
       ↓
Production
Not every environment needs identical infrastructure.

However, production must remain isolated from development and testing.

4. Local Development

Developers should be able to run the application locally.

Local development should eventually provide:

application
database
test environment
environment configuration
development tools
seed/test data where appropriate

The local environment must not require production credentials.

5. Development Environment

The development environment is used for active implementation and experimentation.

It may contain:

development application deployment
development database
test integrations
non-production credentials
synthetic data

Development data must not be assumed to be production data.

6. CI Environment

Continuous Integration should automatically validate code changes.

Typical CI stages:

Pull Request
     ↓
Install dependencies
     ↓
Lint
     ↓
Typecheck
     ↓
Unit tests
     ↓
Integration tests
     ↓
Build
     ↓
Additional validation

The exact CI implementation will be finalized based on the selected technology stack.

7. Staging Environment

Staging should represent a production-like environment for important validation.

It may be used for:

release testing
end-to-end testing
integration testing
database migration validation
production-like configuration testing
manual QA
testing external integrations

Staging must use separate:

database
secrets
authentication configuration
external-service configuration

Staging must never accidentally connect to production resources.

8. Production Environment

Production is the live SaaS environment used by real gyms and members.

Production requires stronger controls around:

authentication
authorization
tenant isolation
database access
secrets
deployment
backups
migrations
monitoring
incident response

Production access should be limited to authorized people.

9. Source Control

GitHub is the source of truth for:

application code
documentation
tests
database migrations
CI configuration
configuration templates
engineering decisions

Production code should always be traceable to a Git commit.

10. Branching Strategy

The project should prefer a simple branching model.

Initial approach:

main
  ↑
feature branch

Typical workflow:

Create issue
    ↓
Create focused branch
    ↓
Implement
    ↓
Test
    ↓
Pull Request
    ↓
CI
    ↓
Review
    ↓
Merge

Long-lived branches should be avoided unless there is a clear reason.

11. Pull Requests

Pull requests should be:

focused
reviewable
tested
linked to an issue where appropriate
documented

A PR should not contain unrelated refactoring merely because the developer noticed it.

Large architectural changes require explicit review.

12. Commit Strategy

Commits should represent meaningful changes.

Examples:

feat: add member onboarding flow
fix: prevent duplicate attendance check-in
test: add payment authorization coverage
docs: update payment architecture
refactor: isolate notification provider

Avoid commits such as:

stuff
changes
final
final-final
fix everything

The exact commit convention may evolve later.

13. Continuous Integration

CI should eventually validate every relevant pull request.

Minimum expected checks:

dependency installation
formatting/lint validation
type checking
tests
build
migration validation where appropriate

Security-sensitive changes should receive additional testing.

CI must fail when required validation fails.

14. Continuous Deployment

Automatic production deployment should not be enabled merely because it is technically possible.

The initial deployment model should prioritize:

safety
visibility
rollback capability
simple release process

A possible progression is:

Initial
Manual production deployment

Later
Approved automatic deployment from main

The exact approach depends on the selected hosting provider and maturity of the product.

15. Deployment Pipeline

A production deployment should conceptually follow:

Code
 ↓
Pull Request
 ↓
CI
 ↓
Review
 ↓
Merge
 ↓
Build
 ↓
Deploy
 ↓
Database migration if required
 ↓
Health verification
 ↓
Application available

Database migration behavior must be explicitly considered before deployment.

16. Database Migrations

Database changes must be managed through version-controlled migrations.

Rules:

migrations must be committed to Git
migrations must be reviewed
migrations must be tested
destructive migrations require special review
production schema must not be manually modified
migration order must be deterministic

Before applying a production migration, consider:

existing data
indexes
constraints
nullability
backward compatibility
rollback/recovery strategy
application compatibility
17. Safe Schema Evolution

For important production changes, prefer an incremental approach.

Example:

Add new field
     ↓
Deploy compatible application
     ↓
Backfill data if required
     ↓
Start using field
     ↓
Remove old field later

Avoid changes that require application downtime unless necessary.

18. Environment Variables

Environment-specific configuration should use environment variables or the hosting platform's secure configuration system.

Examples:

DATABASE_URL
AUTH_SECRET
CLERK_SECRET_KEY
WHATSAPP_API_KEY
WHATSAPP_PHONE_NUMBER_ID

The exact variables will depend on the final implementation.

19. Secret Management

Secrets must never be committed to Git.

Never commit:

API keys
database passwords
authentication secrets
WhatsApp credentials
cloud credentials
OAuth secrets
private tokens
production environment files containing secrets

Use:

.env.local

or the hosting provider's secure secret/configuration mechanism.

A safe template may exist as:

.env.example

but it must contain placeholders rather than real secrets.

20. Secret Rotation

If a secret is accidentally exposed:

Assume it is compromised.
Revoke or rotate it.
Remove it from future commits.
Check where it was exposed.
Review related access.
Document the incident if appropriate.

Deleting the secret from the latest file alone does not make an already-exposed secret safe.

21. GitHub Actions

GitHub Actions may be used for CI/CD because GitHub is already the project source of truth.

Potential workflows include:

CI
Deploy Staging
Deploy Production
Database Validation

The exact workflow files will be created after the implementation stack and deployment target are finalized.

22. Dependency Management

Dependencies should be:

intentional
maintained
necessary
reviewed

Do not add a dependency simply because it provides a small convenience.

Before adding a significant dependency, consider:

maintenance
security
license
bundle size
compatibility
vendor lock-in
whether the functionality can reasonably be implemented internally
23. Dependency Updates

Dependencies should be updated deliberately.

Updates should be evaluated for:

breaking changes
security fixes
compatibility
migration requirements

Large dependency upgrades should not be mixed casually with unrelated product work.

24. Application Build

The production application should have a reproducible build.

The build process should:

install locked dependencies
validate code
compile/build the application
fail on build errors
produce the expected deployable artifact

Build behavior should be consistent between local development and CI where practical.

25. Configuration Management

Configuration should be separated from code where appropriate.

Examples:

environment-specific URLs
database connection information
external provider configuration
feature configuration
notification configuration
subscription configuration

Business rules should not be hidden inside deployment configuration.

26. Feature Flags

Feature flags may be introduced when they provide real value.

Potential uses:

gradual rollout
experimental features
premium feature control
emergency disabling
staged release

Feature flags must not replace proper authorization.

A hidden feature is not necessarily a secure feature.

27. Infrastructure Provider Strategy

The initial infrastructure should prioritize simplicity and available student benefits.

Potential resources include:

Azure student benefits
Heroku student credit
GitHub infrastructure
other provider services when justified

The final infrastructure choice belongs in:

13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md

Student credits should not determine architecture by themselves.

28. Azure Usage

Azure may be used where its student benefits provide meaningful value.

Potential benefits include:

compute
managed database
storage
networking
other eligible services

The project should not create Azure resources merely to consume the student benefit.

Infrastructure should be created when the application actually requires it.

29. Database Hosting

PostgreSQL is the selected database technology.

The production database should be:

managed where practical
backed up
access-controlled
isolated from development
monitored
protected from accidental destructive operations

The exact provider will be finalized separately.

30. Application Hosting

The application hosting provider should support:

HTTPS
environment variables/secrets
reliable deployment
logs
health checks where available
reasonable scaling
predictable cost

The first deployment should favor simplicity over advanced infrastructure.

31. Domain and DNS

The production domain should be configured only after:

product branding is finalized
the product is ready for real users
hosting is established
HTTPS is available

Student domain benefits may be used when appropriate.

The exact domain and brand are currently not finalized.

32. HTTPS

Production must use HTTPS.

Authentication, payment-related information, member information, and other sensitive application traffic must not be transmitted over unsecured HTTP.

HTTPS configuration should be handled through the hosting platform or approved infrastructure.

33. Health Checks

The application should eventually expose a safe health-check mechanism.

Health checks may verify:

application availability
database connectivity where appropriate
required internal dependencies

Health endpoints must not expose:

secrets
database credentials
internal sensitive information
unnecessary system details
34. Deployment Verification

After deployment, verify:

application starts
health check passes
authentication works
database connectivity works
critical APIs work
static/PWA assets load
important user flows work

For important releases, perform a small smoke test before considering the deployment complete.

35. Rollback

Every production deployment should have a recovery strategy.

Possible rollback mechanisms:

previous application release
redeploy previous Git commit
hosting-platform rollback
database recovery strategy

Application rollback and database rollback are not always identical.

Database changes must therefore be designed carefully.

36. Backups

Production data must eventually have reliable backups.

Important data includes:

users
organizations
memberships
payments
attendance
subscriptions
announcements
configuration

Backup strategy should define:

frequency
retention
storage
access control
restoration procedure

Backup existence alone is not enough.

Restore procedures should eventually be tested.

37. Disaster Recovery

As the product becomes business-critical, the system should have a recovery plan for:

database failure
accidental data deletion
deployment failure
credential compromise
hosting outage
external service outage

Initial V1 disaster recovery can remain simple.

The strategy should evolve with real business usage.

38. External Service Failure

The application must not assume external services are always available.

Potential failures include:

OTP provider unavailable
WhatsApp provider unavailable
cloud storage unavailable
authentication provider unavailable

Where appropriate:

fail safely
show useful user-facing errors
retry controlled operations
avoid duplicate side effects
log enough information for diagnosis
do not expose provider internals to users
39. WhatsApp Infrastructure

WhatsApp notifications should remain behind the notification provider boundary.

The architecture should support:

Notification System
        ↓
Provider Interface
        ↓
WhatsApp Provider

This allows the provider implementation to change without rewriting the notification domain.

OpenWA should not become the production foundation for the SaaS.

The production WhatsApp implementation should follow the approved provider strategy.

WhatsApp credentials must remain server-side.

40. Payment Infrastructure

V1 SaaS subscription payment is manual.

Therefore production infrastructure does not initially require a payment gateway.

Owner SaaS subscription state is managed through approved administrative processes.

Member-to-gym payment remains direct to the gym.

The application records:

payment claims
confirmed payments
payment methods
amounts
outstanding balance
audit information

A future payment gateway can be introduced behind an appropriate integration boundary.

41. Logging

Application logging should support debugging and operational visibility.

Logs should contain useful contextual information such as:

timestamp
environment
request/correlation identifier
operation
success/failure
safe error information

Logs must not contain:

OTPs
passwords
authentication tokens
API secrets
unnecessary personal information
sensitive payment information

Detailed observability is defined further in:

11-OBSERVABILITY.md
42. Monitoring

Production monitoring should eventually cover:

application availability
errors
failed requests
database health
latency
resource usage
external provider failures

Monitoring should focus on actionable signals rather than generating excessive noise.

43. Error Tracking

An error tracking service such as Sentry may be considered because it is available through the student benefits.

If used, it must be configured carefully to avoid sending sensitive data.

The final tool choice belongs in 14-TECH-DECISIONS.md.

44. Deployment Security

Production deployment access should be restricted.

Consider:

protected main branch
required CI checks
review requirements
restricted deployment permissions
separate production secrets
auditability of production changes

The exact GitHub configuration can evolve as the team grows.

45. Production Database Access

Direct production database access should be limited.

Application access should use controlled credentials.

Manual database access should be:

rare
authorized
documented when significant
performed carefully

Never use production database access as a substitute for proper application functionality.

46. Production Data Rules

Production data must not be casually copied into development.

If production-like data is needed for debugging:

prefer synthetic data
minimize data
remove unnecessary personal information
protect any authorized copy
delete it when no longer required
47. Cost Control

Infrastructure must remain consistent with the product's early-stage budget.

Initial principle:

Customer revenue should eventually fund
production infrastructure.

Avoid unnecessary paid services before there is a business reason for them.

Free/student resources should be used where appropriate without allowing them to dictate poor architecture.

48. Scaling Strategy

V1 should begin with a simple deployment architecture.

Preferred progression:

Single application
        ↓
Managed PostgreSQL
        ↓
External providers
        ↓
Scale individual components when required

Do not introduce:

microservices
Kubernetes
distributed systems
complex queues
multiple databases

without a demonstrated requirement.

49. Background Jobs

Background processing may eventually be required for:

WhatsApp notifications
reminders
scheduled jobs
exports
analytics
cleanup

The initial implementation should remain simple.

A queue should be introduced when asynchronous workload, reliability, or scale justifies it.

50. Scheduled Jobs

Scheduled tasks may eventually include:

membership expiry reminders
payment reminders
inactive-member detection
notification processing
cleanup tasks
analytics aggregation

Scheduled jobs must be:

idempotent where possible
observable
tenant-aware
safe to retry
51. Idempotency

Operations that may be retried must be designed carefully.

Important examples:

payment confirmation
attendance operations
notification delivery
scheduled reminders
subscription activation

A retry must not accidentally create duplicate financial or business state.

52. Production Readiness

Before real gyms use the system, verify:

Application
production build works
HTTPS works
authentication works
authorization works
tenant isolation works
Database
migrations tested
backups configured
database access restricted
Security
secrets configured securely
no secrets in Git
rate limits enabled where required
sensitive logs reviewed
Testing
critical tests pass
critical E2E flows pass
smoke test completed
Operations
logs available
error tracking available where selected
rollback process understood
basic incident procedure exists
53. Incident Response

For a production incident:

Identify the issue.
Determine impact.
Protect users and data.
Stop or roll back unsafe changes if necessary.
Investigate.
Restore normal operation.
Verify correctness.
Document the incident when appropriate.
Add regression protection where applicable.

Security incidents require additional care around credential rotation and access review.

54. DevOps and AI-Assisted Development

AI may help create:

CI workflows
deployment configuration
Docker configuration if required
infrastructure configuration
migration commands
scripts

However, AI must not silently introduce production infrastructure.

Human approval is required before:

production infrastructure changes
database hosting changes
authentication infrastructure changes
security configuration changes
major third-party services
deployment architecture changes
destructive database operations
55. What V1 Should Avoid

Do not introduce prematurely:

Kubernetes
microservices
service mesh
complex infrastructure-as-code systems
multiple production databases
unnecessary message brokers
complicated deployment orchestration
expensive monitoring stacks
unnecessary cloud services

Complexity should be earned by actual requirements.

56. Relationship With Other Documents

This document depends on:

03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md
08-PWA.md
09-TESTING.md

Related future documents:

11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
57. Current V1 DevOps Priorities

Priority order:

GitHub source control
CI validation
Local development environment
Environment separation
Secure environment variables
Database migration workflow
Simple deployment process
HTTPS
Production database backups
Health checks
Logging
Error tracking
Rollback strategy
Basic production monitoring
58. Status

Status: DevOps strategy defined.

This document defines the intended operational principles and deployment direction.

Exact:

hosting provider
database provider
CI workflow
deployment workflow
environment variables
backup configuration
monitoring tools
error tracking provider
infrastructure configuration

will be finalized through:

13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
