# Cost & Infrastructure

## Project

- Project: gym-saas
- Document: Cost and Infrastructure Strategy
- Version: 0.1
- Status: Engineering Definition
- Scope: V1 and future evolution

---

## 1. Purpose

This document defines the initial infrastructure and cost strategy for gym-saas.

The primary goals are:

- minimize unnecessary personal spending
- use available student benefits responsibly
- keep infrastructure simple
- avoid premature paid services
- preserve the ability to scale later
- make production costs understandable
- allow customer revenue to fund future infrastructure

The product is intended to become a real SaaS business, not merely a portfolio project.

---

# 2. Cost Principles

The project follows these principles:

1. Prefer free resources when they are technically appropriate.
2. Use student benefits where they provide genuine value.
3. Do not choose technology solely because it is free.
4. Do not create cloud resources before they are required.
5. Avoid unnecessary recurring costs during development.
6. Production reliability takes priority over saving a very small amount of money.
7. Customer revenue should increasingly fund production infrastructure.
8. Every recurring paid service should have a clear purpose.
9. Avoid vendor lock-in where practical.
10. Infrastructure complexity should remain proportional to business size.

---

# 3. Initial Budget Philosophy

The early target is approximately:

```text
Development:
₹0 – ₹1,000/month where practical

Early production:
As close to ₹0 as reasonably possible

Later production:
Funded increasingly by customer revenue
These are planning targets, not guarantees.

Actual costs depend on:

traffic
database usage
storage
WhatsApp volume
hosting provider
authentication usage
monitoring
domain
external provider pricing
4. Student Benefits

The GitHub Student Developer Pack should be treated as a resource pool rather than a reason to consume every available benefit.

Potentially useful benefits include:

GitHub Pro
GitHub Copilot Student
GitHub Codespaces
Azure student benefits
MongoDB Atlas credits
Heroku credit
Clerk student benefits
Appwrite Education
Sentry student plan
domain benefits
Notion Education
Microsoft 365
JetBrains
other eligible development tools

Only benefits that fit the architecture should be used.

5. GitHub

GitHub is the primary source of truth for the project.

GitHub may provide:

private repository hosting
GitHub Pro
GitHub Actions
Copilot Student
Codespaces
issue tracking
pull requests
project documentation

GitHub should remain central to:

source control
CI
documentation
engineering workflow
AI-assisted development
6. Development Tooling

Development should initially prioritize tools already available through:

GitHub Student Developer Pack
existing local machine
open-source software

Potential tools include:

Cursor
GitHub Copilot Student
GitHub Codespaces
VS Code-compatible tooling
PostgreSQL
Node.js
TypeScript
open-source testing tools

Paid developer tooling should only be added when its value is clear.

7. Domain Strategy

The product and brand names are currently not finalized.

Therefore:

Do not buy the final production domain yet.

The domain should be acquired when:

product direction is sufficiently validated
brand/product name is finalized
the product is approaching real pilot users

Available student domain benefits may then be evaluated.

Potential student benefits include:

Namecheap .me
Name.com select student domains
.TECH

The exact domain should be chosen based on the final product brand.

8. Domain Cost

The target initial domain cost is:

₹0

if a suitable student benefit is available.

Future renewal cost should be considered before selecting a domain.

A domain that is free for the first year but unusually expensive later should not be selected blindly.

9. Frontend and Application Hosting

The application should initially use a simple hosting model.

Requirements:

HTTPS
environment variables
reliable deployments
logs
reasonable performance
predictable cost
easy rollback

Potential providers include student-benefit-supported or low-cost platforms.

The final provider will be selected in:

14-TECH-DECISIONS.md
10. Backend Hosting

The backend should initially remain part of the main application rather than becoming a separate service.

Preferred conceptual architecture:

PWA
  ↓
Application
  ↓
PostgreSQL

Do not create a separate backend server merely because the product is a SaaS.

A separate service should only be introduced when a demonstrated requirement exists.

11. PostgreSQL

PostgreSQL is the selected database technology.

The database should be:

managed where practical
secure
backed up
isolated by environment
migration-controlled

The database should remain the primary source of truth for core business data.

12. Azure Student Benefits

Azure may provide useful student resources for this project.

The available student benefit may include:

Azure credit
selected free services
database resources
compute resources
other eligible services

The project should use Azure only where it provides a good technical and economic fit.

Do not create Azure resources simply to consume the credit.

13. Azure Database Consideration

Azure Database for PostgreSQL may be considered for production or staging if its student benefit and pricing fit the project.

The decision should consider:

free/credit duration
compute limits
storage
backup
performance
expected traffic
post-credit pricing

The database should not be created before the implementation phase requires it.

14. Heroku

Heroku student credit may be useful for application hosting or experimentation if it fits the deployment requirements.

The project should compare:

cost after student credit
deployment simplicity
database strategy
performance
operational control
migration difficulty

Heroku should not automatically become the production platform merely because credit exists.

15. MongoDB Atlas

MongoDB Atlas student credits are available but PostgreSQL is the selected database architecture.

Therefore:

Do not add MongoDB merely to consume the Atlas credit.

The Atlas benefit may be useful for another project or future experimentation.

The gym SaaS should maintain a single primary database strategy unless a real requirement appears.

16. Authentication

Clerk is a candidate authentication provider because the student benefit may provide a useful free/student plan.

Potential benefits:

phone authentication
OTP handling
session management
account management

However:

Authentication provider ≠ authorization system

The application remains responsible for:

organization membership
roles
permissions
tenant isolation
resource authorization

The final authentication provider decision belongs in 14-TECH-DECISIONS.md.

17. Authentication Cost

The target during development is:

₹0

where the student plan/free tier supports the required usage.

Before production launch, evaluate:

user limits
phone/SMS costs
monthly active users
pricing changes
fallback strategy

Authentication can become a meaningful cost as member count grows.

18. OTP Costs

OTP delivery can become one of the earliest variable costs.

Potential costs include:

SMS
authentication provider charges
WhatsApp authentication messaging if later used

The architecture should therefore:

avoid unnecessary OTP requests
enforce resend cooldowns
enforce rate limits
prevent abuse
avoid sending OTPs repeatedly

Security controls also help control cost.

19. WhatsApp Cost Strategy

WhatsApp messaging is expected to become a variable production cost.

The architecture should use:

Notification Engine
       ↓
Provider Interface
       ↓
WhatsApp Provider

The SaaS should not assume WhatsApp messaging is permanently free.

Actual Meta/provider pricing and messaging rules must be verified before commercial implementation.

20. WhatsApp V1 Strategy

For V1:

use centralized SaaS sending architecture
keep notification logic provider-independent
avoid unnecessary message volume
support owner-controlled reminder types
respect user opt-in and provider requirements
track delivery status where supported

Do not build the entire product around an unofficial WhatsApp gateway.

OpenWA may be useful for experimentation, but it should not be the production foundation.

21. Payment Infrastructure

V1 does not require a payment gateway for SaaS subscription billing.

Owner SaaS payment:

Owner
  ↓
UPI / Bank
  ↓
Manual verification
  ↓
Subscription enabled

Member gym payment:

Member
  ↓
Gym UPI / QR
  ↓
Direct payment to gym
  ↓
"I have paid"
  ↓
Owner/staff verification

The SaaS does not initially hold or transfer member membership funds.

This significantly reduces initial payment infrastructure cost and complexity.

22. Payment Gateway Future Cost

A payment gateway may be introduced later if manual SaaS subscription collection becomes operationally inefficient.

Before introducing one, evaluate:

transaction fees
recurring payment support
settlement
refunds
reconciliation
webhook reliability
engineering complexity

The gateway should integrate with the existing subscription/payment architecture rather than replace it.

23. Storage

V1 should minimize storage requirements.

Primary data:

PostgreSQL records
application configuration
logs
audit records

Large media storage should not be introduced unnecessarily.

Progress photos are a future feature and should remain local-first where practical.

24. File Storage

If cloud-backed files become necessary later:

use object storage
restrict access
use signed/private access where appropriate
avoid storing large files directly in PostgreSQL
enforce tenant/user authorization

Potential use cases:

progress photos
exports
documents
gym assets
25. Monitoring and Error Tracking

Sentry is a potential candidate because of the student benefit.

Potential use cases:

application errors
frontend errors
API failures
performance visibility

The system must be configured to avoid unnecessary personal or sensitive data collection.

26. Database Backups

Production database backups are required once real customer data exists.

Backup strategy should consider:

automatic backups
retention
restore capability
storage cost
access control

A backup is useful only if restoration is possible.

27. Development Database

During early development, the database should preferably be:

local
disposable
easy to reset

A local PostgreSQL instance or containerized PostgreSQL environment may be used.

There is no reason to pay for a production-grade database before the product requires one.

28. Staging Database

A staging database should be introduced when staging becomes useful.

It must remain separate from production.

It should contain:

synthetic data
test accounts
non-production configuration

It must not contain real member/customer data unless there is a specific approved process for doing so.

29. Infrastructure Environments

Expected environment structure:

Local
  ↓
CI/Test
  ↓
Staging
  ↓
Production

Each environment should have separate:

database
secrets
authentication configuration
external provider configuration
30. Production Infrastructure

The initial production architecture should remain approximately:

Users
  ↓
HTTPS
  ↓
Application
  ↓
PostgreSQL
  ↓
External Providers

Optional supporting infrastructure should be added only when required.

31. Infrastructure Components Not Required for V1

Do not automatically deploy:

Redis
Kubernetes
message broker
microservices
Elasticsearch
separate API server
separate worker cluster
CDN
multiple databases

These may become useful later, but are not default V1 requirements.

32. Redis Cost Strategy

Redis is not required initially.

It may become useful later for:

caching
distributed rate limiting
queues
temporary state

If PostgreSQL can safely handle the requirement, prefer PostgreSQL rather than adding another service.

33. Queue Cost Strategy

A queue should be introduced when asynchronous workloads justify it.

Potential triggers:

large WhatsApp volume
slow exports
scheduled jobs
retries
long-running processing

Until then, use the simplest reliable implementation.

34. CDN Strategy

A CDN is not a mandatory V1 component.

It may become useful when:

static asset traffic grows
global users increase
application performance requires it

For an early local-India-focused SaaS, infrastructure should not be complicated solely for hypothetical global traffic.

35. Email Infrastructure

Email is not a core V1 dependency.

If email is introduced later, evaluate:

transactional email provider
free tier
deliverability
domain verification
pricing

Do not add email infrastructure merely because every SaaS commonly has email.

36. Analytics

Product analytics should initially remain lightweight.

Potential tools from the student benefits may be considered later.

Analytics must not:

expose sensitive member data
become a required production dependency
add unnecessary cost

Business-critical data should remain in the application's own database.

37. Infrastructure Security

Production infrastructure must use:

HTTPS
secure secrets
least-privilege credentials
restricted database access
environment separation
controlled deployment access
backups
monitoring

Security requirements remain defined in 06-SECURITY.md.

38. Cost Monitoring

Infrastructure costs should be reviewed periodically.

Track:

hosting
database
authentication/OTP
WhatsApp
storage
monitoring
domain
other external services

The objective is not to minimize every individual cost.

The objective is to understand where money is being spent and whether the cost supports the business.

39. Cost Per Gym

As real customers arrive, track approximate infrastructure cost per gym.

Conceptually:

Total infrastructure cost
÷
Number of active paying gyms
=
Approximate infrastructure cost per gym

This is a business metric, not an exact accounting measure.

It can help evaluate pricing sustainability.

40. Cost Per Member

Some costs scale with members rather than gyms.

Examples:

OTP
WhatsApp
storage
usage
notifications

Track these separately where useful.

Conceptually:

Member-related variable cost
÷
Active members
=
Approximate cost per active member
41. Revenue-Funded Infrastructure

The long-term goal is:

Paying gyms
      ↓
SaaS revenue
      ↓
Infrastructure + services
      ↓
Remaining margin
      ↓
Business growth

Infrastructure should increasingly be funded by product revenue rather than personal spending.

42. Free Tier Strategy

Free resources are useful during development and early validation.

However:

Free ≠ permanent

Before depending on a free tier for a critical production component, evaluate:

limits
pricing after limits
pricing after student status
migration difficulty
reliability
43. Student Status Expiration

The project must not assume student benefits will remain available indefinitely.

Before student benefits expire, review:

domain renewal
GitHub Pro
Copilot
authentication
hosting
database
monitoring
other paid services

The application should remain operational even after student benefits end, subject to the chosen business economics.

44. Vendor Lock-In

Avoid unnecessary dependency on one provider.

Important boundaries include:

Authentication
Notification Provider
Cloud Infrastructure
Storage
Monitoring
Payment Provider

The goal is not to make everything interchangeable.

The goal is to avoid embedding provider-specific assumptions throughout the entire codebase.

45. Infrastructure Decisions

Every major infrastructure decision should document:

requirement
alternatives
expected cost
benefits
risks
migration implications
student-benefit implications

The final decision belongs in:

14-TECH-DECISIONS.md
46. Infrastructure Provisioning

Infrastructure should be created only when required.

Recommended progression:

Documentation
    ↓
Implementation
    ↓
Local development
    ↓
Testing
    ↓
Staging requirement
    ↓
Production requirement
    ↓
Infrastructure provisioning

Do not create production cloud resources merely because the project documentation is complete.

47. V1 Infrastructure Target

The preferred V1 target is approximately:

GitHub
  +
Application Hosting
  +
PostgreSQL
  +
Authentication Provider
  +
WhatsApp Provider
  +
Error Tracking

Only required components should be enabled.

48. Example Cost Categories

The infrastructure budget should be evaluated by category:

Category	Early Target
Source control	₹0
Development tooling	₹0 where student benefits apply
Domain	₹0 if student benefit applies
Database	₹0 where practical during development
Application hosting	₹0–low cost initially
Authentication	₹0 where student/free plan supports usage
WhatsApp	Variable
Monitoring	₹0 where student/free plan supports usage
Storage	₹0–low cost initially
Payment gateway	₹0 in V1
Redis/queue	₹0 in V1 by avoiding unnecessary infrastructure

These are planning targets, not guaranteed prices.

49. Cost Escalation Strategy

When a free tier becomes insufficient:

Measure actual usage.
Identify what caused the increase.
Determine whether optimization can solve it.
Compare paid options.
Estimate customer revenue impact.
Choose the simplest sustainable option.
Document the decision.

Do not migrate infrastructure solely because a free limit was reached without understanding the workload.

50. Infrastructure Before First Paying Customer

Before the first real gym becomes dependent on the system, verify:

production database exists
backups exist
deployment is reproducible
HTTPS works
authentication works
tenant isolation works
monitoring exists
errors are visible
secrets are secure
rollback/recovery process is understood

Production infrastructure should be reliable enough for the data and responsibilities being accepted.

51. AI-Assisted Infrastructure Work

AI may help:

compare hosting options
estimate resource requirements
generate CI configuration
generate deployment configuration
inspect cloud errors
analyze infrastructure costs

AI must not silently:

create expensive cloud resources
expose secrets
change production infrastructure
change database architecture
enable paid services
alter security controls

Human approval is required for major infrastructure changes.

52. V1 Cost Priorities

Priority order:

Keep development close to ₹0
Use existing student benefits
Avoid unnecessary services
Establish reliable production hosting when needed
Establish reliable PostgreSQL
Control OTP costs
Control WhatsApp costs
Monitor infrastructure spending
Transition production costs to customer revenue
Optimize only where real usage justifies it
53. What V1 Should Avoid

Avoid spending money on:

unnecessary cloud services
premium monitoring before needed
unused databases
multiple hosting platforms
unnecessary domains
paid queues
unnecessary Redis
paid analytics without a clear purpose
premature CDN infrastructure
enterprise infrastructure for a tiny user base
54. Relationship With Other Documents

This document depends on:

03-SYSTEM-ARCHITECTURE.md
06-SECURITY.md
09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md

Related document:

14-TECH-DECISIONS.md
55. Status

Status: Cost and infrastructure strategy defined.

This document defines the initial economic and infrastructure direction.

Exact:

hosting provider
database provider
authentication provider
WhatsApp provider
monitoring provider
domain
production architecture
environment configuration
recurring infrastructure budget

will be finalized in 14-TECH-DECISIONS.md after the technical trade-offs are reviewed.

No paid production infrastructure should be created solely because this document exists.
