# ADR 018: Configuration and Environment Strategy

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Infrastructure / Security / Operations
- Related:
  - `03-SYSTEM-ARCHITECTURE.md`
  - `06-SECURITY.md`
  - `10-DEVOPS.md`
  - `13-COST-INFRASTRUCTURE.md`
  - `14-TECH-DECISIONS.md`
  - `decisions/004-HOSTING-AND-INFRASTRUCTURE.md`
  - `decisions/007-ERROR-TRACKING.md`
  - `decisions/015-AUTHENTICATION-AND-AUTHORIZATION-IMPLEMENTATION.md`
  - `decisions/016-NOTIFICATION-ARCHITECTURE.md`
  - `decisions/017-AUDIT-LOGGING-STRATEGY.md`

---

## 1. Context

The SaaS will run in multiple environments over time.

Expected environments include:

```text
local development
test/CI
staging
production

Different environments require different:

database connections
authentication configuration
API keys
notification providers
application URLs
logging settings
feature configuration
external service configuration

Configuration must therefore be separated from application code.

The system must also prevent secrets from entering:

Git
source code
client bundles
logs
documentation
AI prompts
pull requests
2. Decision

The application will use environment-based configuration for environment-specific values.

Configuration will be divided into:

non-secret configuration
secret configuration
application defaults
environment-specific overrides

Secrets will be injected through the deployment/runtime environment or an appropriate secret-management mechanism.

The repository will contain a safe .env.example describing required variables without real secrets.

3. Configuration Categories

Configuration should be classified before being added.

Application configuration

Examples:

NODE_ENV
APP_URL
Database configuration

Example:

DATABASE_URL
Authentication configuration

Examples:

CLERK_SECRET_KEY
CLERK_PUBLISHABLE_KEY
Notification configuration

Examples:

WHATSAPP_PROVIDER
WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID
Observability

Examples:

SENTRY_DSN
Feature configuration

Examples:

ENABLE_WHATSAPP
ENABLE_ANALYTICS

The exact variable names are implementation-specific.

4. Secrets vs Non-Secrets

Not every environment variable is a secret.

For example:

APP_URL=https://example.com

may not be secret.

But:

DATABASE_URL=...

may contain credentials and must be treated as sensitive.

Similarly:

CLERK_SECRET_KEY
WHATSAPP_ACCESS_TOKEN

are secrets.

Each configuration value should be classified appropriately.

5. Never Commit Real Secrets

The repository must never contain:

API keys
database passwords
OAuth client secrets
WhatsApp tokens
cloud credentials
private signing keys
session secrets
production credentials

This applies to:

source files
.env files
documentation
tests
fixtures
screenshots
example configuration
commit messages
6. .env.example

The repository should contain:

.env.example

It should document required variables.

Example:

NODE_ENV=development

APP_URL=http://localhost:3000

DATABASE_URL=

CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

SENTRY_DSN=

WHATSAPP_PROVIDER=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

The file must contain placeholders only.

Never place working credentials into .env.example.

7. Local Environment

Developers may use:

.env.local

or the framework's appropriate local environment mechanism.

Local secret files must be ignored by Git.

Example:

.env
.env.local
.env.*.local

The exact ignore rules should match the chosen framework.

8. Environment Separation

Development and production must not share credentials by default.

Example:

Development DB
        ≠
Production DB

and:

Development WhatsApp credentials
        ≠
Production WhatsApp credentials

This reduces the risk of accidental production changes during development.

9. Database Environment Separation

The application must never silently connect local development to the production database.

The environment must explicitly determine:

DATABASE_URL

Production credentials should only exist in production infrastructure.

Development tooling should not require production credentials.

10. Authentication Environment Separation

Authentication configuration should also be environment-specific.

Development and production should use their respective configuration where supported.

The application must never accidentally expose server-only authentication secrets to the browser.

11. Server-Only Secrets

Secrets required by backend operations must remain server-side.

Examples:

database credentials
Clerk secret key
WhatsApp access token
Sentry server credentials

These must never be included in client-side JavaScript.

12. Public Configuration

Some configuration may intentionally be exposed to the browser.

Examples may include:

application public URL
Clerk publishable key
public feature configuration

Only values explicitly classified as public may be exposed.

A variable should not become client-visible merely because the frontend needs some related configuration.

13. Configuration Validation

Application startup should validate required configuration.

Example:

Production starts
    ↓
Load environment variables
    ↓
Validate required configuration
    ↓
Valid → start application
Invalid → fail clearly

The application should fail fast rather than start with invalid security-critical configuration.

14. Missing Required Configuration

Example:

Production
DATABASE_URL missing

The application should fail during startup/configuration validation.

Avoid silently using:

localhost
default password
empty token
development database

as fallback values.

15. Development Defaults

Safe development defaults may be used where appropriate.

Example:

APP_URL=http://localhost:3000

However, defaults must never weaken production security.

Do not use:

production secret fallback

or:

disabled authentication fallback
16. Configuration Schema

Configuration should be parsed and validated in one clear location.

Conceptually:

Environment Variables
        ↓
Configuration Validation
        ↓
Typed Application Config
        ↓
Application

Business code should avoid repeatedly reading raw environment variables throughout the codebase.

17. Avoid Scattered process.env

Avoid code such as:

process.env.X
process.env.Y
process.env.Z

throughout unrelated business modules.

Instead, centralize configuration access.

Example conceptual structure:

src/
└── config/
    └── env

The exact implementation will depend on the selected framework.

18. Typed Configuration

Where practical, configuration should have explicit types.

Example conceptual model:

AppConfig
├── appUrl
├── databaseUrl
├── auth
├── notifications
└── observability

This reduces configuration mistakes.

19. Boolean Configuration

Boolean environment variables require careful parsing.

Environment variables are strings.

Therefore:

ENABLE_WHATSAPP=false

must not accidentally be interpreted as:

Boolean("false") === true

Configuration parsing must explicitly convert values.

20. Numeric Configuration

The same applies to numeric settings.

Example:

OTP_EXPIRATION_SECONDS=300

must be parsed as a number.

Invalid values should fail configuration validation where the setting is required.

21. URLs

URLs should be validated where possible.

Example:

APP_URL

should have an expected URL format.

Production should not accidentally use:

http://localhost:3000

for public application configuration.

22. Environment Names

The application should have a clear environment model.

At minimum:

development
test
production

A staging environment may be added when needed.

Do not create many environments without a real operational purpose.

23. Staging

A staging environment may eventually provide:

production-like application
separate database
separate credentials
safe test data

Staging should not automatically receive production customer data.

The need for staging depends on product maturity and deployment risk.

24. Test Environment

Automated tests should use controlled test configuration.

The test environment should not depend on:

production credentials
production database
production WhatsApp number

Tests must be safe to run repeatedly.

25. External Services in Tests

Tests should avoid making real external API calls unless the test specifically validates an integration.

Examples:

real WhatsApp message
real production payment
real production authentication operation

should not happen during normal unit/integration test execution.

Use mocks, fakes, or dedicated test integrations where appropriate.

26. WhatsApp Configuration

WhatsApp provider configuration must remain server-side.

Example:

WHATSAPP_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID

must never be exposed to the client.

Provider-specific configuration should remain isolated behind the notification provider boundary defined in ADR 016.

27. OpenWA Configuration

If OpenWA is used during experimentation or pilot work, its credentials/configuration must also be treated as sensitive.

OpenWA remains:

experimental/pilot provider

and not the production notification foundation.

Production configuration should use the approved official provider.

28. Feature Flags

Feature flags may be used when there is a genuine need to control functionality independently of deployment.

Examples:

ENABLE_WHATSAPP
ENABLE_ANALYTICS

However, environment variables should not become a replacement for a full feature-management system.

Do not introduce a feature flag platform without a concrete requirement.

29. Product Entitlements vs Environment Flags

Environment configuration and customer entitlements are different concepts.

For example:

ENABLE_WHATSAPP=true

means:

The application supports WhatsApp functionality.

It does not mean:

Every organization is entitled to automated WhatsApp.

Customer entitlement should be determined by:

Subscription
    ↓
Plan
    ↓
Entitlements

as defined by the product architecture.

30. Configuration Does Not Replace Authorization

A configuration flag must never be treated as a user permission.

For example:

ENABLE_ADMIN_FEATURE=true

does not mean every authenticated user may access the feature.

Authorization must still verify:

user
organization
role
resource
permission

on the backend.

31. Secrets in Logs

Configuration values must never be logged blindly.

Avoid:

console.log(process.env)

or equivalent configuration dumps.

Do not log:

DATABASE_URL
ACCESS_TOKEN
SECRET_KEY

even during debugging.

32. Error Messages

Configuration errors should identify the missing configuration name without exposing its secret value.

Good:

WHATSAPP_ACCESS_TOKEN is not configured.

Bad:

WHATSAPP_ACCESS_TOKEN=actual-secret-value
33. Configuration in CI

CI workflows may need configuration.

Secrets required by CI should use the CI platform's secret-management mechanism.

Do not hardcode them in:

.github/workflows/*.yml
34. Pull Requests

Pull requests must never contain real credentials.

Before opening a PR, check for:

.env
API keys
tokens
passwords
private credentials

Secret scanning should be enabled where practical.

35. Git History

Deleting a secret from the current working tree does not remove it from Git history.

If a secret is accidentally committed:

revoke/rotate the secret immediately
investigate exposure
remove the secret from the repository/history where appropriate
replace it with a new secret
verify that dependent services use the replacement

Do not assume that deleting the file is sufficient.

36. AI Tools

AI coding tools may inspect repository files.

Therefore, secrets must not be placed in files that AI tools can read unnecessarily.

Do not provide AI tools with:

production credentials
private keys
database passwords
WhatsApp tokens

unless there is an explicitly approved and secure reason.

The project should prefer:

.env.example

for AI-readable configuration documentation.

37. Documentation

Documentation should describe:

what configuration exists
why it exists
which environment requires it
whether it is secret

Documentation should never contain the actual secret value.

38. Local Developer Onboarding

A new developer should be able to understand required configuration from:

README.md
.env.example
project documentation

without needing access to production secrets.

The setup process should clearly state which services are required locally.

39. Secret Management Evolution

Initial development may use environment variables supplied by the deployment platform.

As the system grows, a dedicated secret-management solution may be introduced.

Possible future mechanisms include:

cloud secret manager
managed deployment secrets
dedicated secret vault

The application should avoid tightly coupling business logic to one secret-management vendor.

40. Infrastructure Provider Independence

The project may use student benefits and cloud credits from providers such as:

Azure
Heroku
MongoDB Atlas

where appropriate.

However, application code should not assume that a particular hosting provider is permanent.

Provider-specific configuration should remain infrastructure-specific.

41. Local Database

Local development may use:

local PostgreSQL

or another explicitly approved development setup.

The local database must never share production credentials.

42. Database Migrations

Database migration commands must use the intended environment configuration.

Destructive commands must require deliberate execution.

The application must not automatically run destructive production database operations during normal startup.

43. Production Configuration Changes

Production configuration changes should be deliberate and traceable.

Examples:

WhatsApp credentials
database credentials
authentication settings
application URLs
feature configuration

Changes should follow the project's deployment/change-management process.

44. Configuration and Deployment

A deployment should be reproducible from:

source code
approved configuration
database migrations
deployment configuration

Configuration should not require undocumented manual edits inside application files.

45. Configuration Drift

Production configuration can drift from documented expectations.

Important configuration should therefore be documented and reviewed.

Where possible, deployment systems should make configuration visible as:

variable exists
variable missing
configuration version

without exposing secret values.

46. Secret Rotation

Services should support credential rotation without requiring application code changes.

Examples:

rotate database password
rotate WhatsApp token
rotate authentication secret

The application should obtain credentials from configuration rather than hardcoding them.

47. Credential Rotation Procedure

When a secret is rotated:

Create new credential
        ↓
Update runtime configuration
        ↓
Deploy/restart if required
        ↓
Verify service
        ↓
Revoke old credential

The exact order depends on the external provider.

48. Public vs Private Environment Variables

Framework-specific public-variable conventions must be followed carefully.

For example, variables intended for browser exposure should use the framework's explicit public naming convention.

A server secret must never be prefixed/configured as public merely to make frontend code compile.

49. Configuration Access in Frontend

Frontend code should receive only the configuration it actually needs.

Example:

Server configuration
    ↓
safe public subset
    ↓
browser

Never send the entire configuration object to the client.

50. Configuration and Multi-Tenancy

Environment configuration is generally application-wide.

Organization-specific configuration belongs in the database/domain model when it represents customer data or tenant settings.

For example:

WHATSAPP_ACCESS_TOKEN

is infrastructure/provider configuration.

But:

organization.payment_upi_id

is tenant/business data.

Do not confuse the two.

51. Configuration and Secrets per Organization

If a future feature requires organization-specific credentials, those credentials must not simply be stored as ordinary plaintext organization fields.

Such a requirement would require a separate security decision covering:

encryption
key management
access control
rotation
auditing
secret retrieval

This is outside V1.

52. Configuration Validation Tests

Automated tests should cover:

required configuration present
invalid configuration rejected
boolean values parsed correctly
numeric values parsed correctly
URLs validated
production configuration cannot silently use development defaults
secrets are not included in client configuration
53. Build-Time vs Runtime Configuration

The project should distinguish configuration that must be known at build time from configuration that can be supplied at runtime.

Do not accidentally bake production secrets into static frontend assets.

Where possible, server-side secrets should remain runtime configuration.

54. Configuration Failure Behavior

Configuration failures should be:

explicit
early
understandable
safe

Avoid partially starting a production system with missing security-critical configuration.

55. What This Decision Does Not Finalize

This ADR does not finalize:

exact hosting secret manager
exact CI secret store
exact environment variable names
exact staging infrastructure
exact feature-flag provider
exact deployment platform
organization-specific encrypted credential storage
automatic secret rotation tooling

Those decisions can be made when implementation requires them.

56. Consequences
Positive
Secrets remain outside source code
Environments remain isolated
Configuration becomes explicit
Easier deployment
Easier credential rotation
Safer AI-assisted development
Lower risk of accidental production access
Better reproducibility
Negative
Additional configuration management
Developers must configure local environments
Deployment requires correct secret setup
Configuration validation adds startup complexity
Multiple environments create operational overhead

These costs are accepted because configuration and secret isolation are fundamental production requirements.

57. Final Rule

Application code should contain behavior.

Environment configuration should contain environment-specific values.

Secrets must remain outside Git and client-side code.

Customer/organization settings belong to the product's domain/database, not blindly in environment variables.

Configuration must be validated before security-critical production behavior is allowed to run.

Never solve configuration problems by hardcoding secrets.
