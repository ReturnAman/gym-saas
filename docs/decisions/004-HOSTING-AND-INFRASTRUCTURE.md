# ADR 004 — Hosting and Infrastructure

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Infrastructure / Architecture / Cost

---

# 1. Context

gym-saas is being developed as a real SaaS product with the following goals:

- Start with minimal personal infrastructure cost
- Use available student benefits where appropriate
- Avoid premature infrastructure complexity
- Keep the application deployable and maintainable
- Support a small production pilot
- Allow infrastructure to scale as paying customers increase
- Avoid unnecessary vendor lock-in
- Protect production data and secrets

The initial product is expected to have relatively low traffic.

The architecture should therefore optimize for:

> Simplicity + reliability + low initial cost

rather than maximum theoretical scale.

---

# 2. Infrastructure Requirements

The initial production system requires:

- Web application hosting
- PostgreSQL
- HTTPS
- Environment/secrets management
- Application logs
- Error monitoring
- Database backups
- CI/CD
- Domain
- Optional background job execution
- WhatsApp provider integration

Additional infrastructure should only be introduced when a real requirement exists.

---

# 3. Initial Architecture

The preferred initial architecture is:

```text
User
  ↓
HTTPS
  ↓
Next.js Application
  ↓
PostgreSQL
Supporting services:

Next.js Application
 ├── Authentication Provider
 ├── WhatsApp Provider
 ├── Error Tracking
 └── Background Job Infrastructure (when required)

The initial system should remain a modular application rather than a collection of independently deployed services.

4. Application Hosting

The application requires a platform capable of running the selected Next.js architecture.

Potential hosting options include:

Azure
Vercel
Heroku
Other suitable managed platforms

The final provider remains open.

The provider should be evaluated based on:

Student benefits
Cost
Next.js compatibility
Deployment simplicity
Environment variable management
Logs
Scaling options
Reliability
Deployment workflow
Vendor lock-in
Production suitability
5. Student Benefits

The project has access to student developer benefits.

Potentially useful resources include:

Azure student credit
Heroku credit
GitHub Pro
GitHub Actions
GitHub Codespaces
Other infrastructure-related student benefits

These benefits should reduce initial cost where appropriate.

However:

A free or discounted service should not be selected if it creates unnecessary architectural complexity.

The architecture should remain understandable even after student benefits expire.

6. Azure

Azure is a potential infrastructure provider.

Potential benefits include:

Student credit
Managed PostgreSQL
Application hosting
Storage
Monitoring
Other cloud services

Azure should be considered if the student benefits materially reduce early infrastructure cost.

However, the project should avoid creating an unnecessarily complicated Azure architecture simply because many services are available.

7. Heroku

Heroku is another potential option for early application hosting.

Potential advantages:

Simple deployment
Straightforward application hosting
Student credit
Low operational complexity

Potential concerns:

Credit expiration
Long-term pricing
Database/provider considerations
Possible migration requirements as the product grows

Heroku should be evaluated as a practical early hosting option rather than automatically selected because a credit exists.

8. Vercel

Vercel is a potential application-hosting option for the Next.js frontend/application layer.

Potential advantages:

Strong Next.js integration
Simple deployments
Preview deployments
Git-based workflow

Potential considerations:

Production pricing
Server-side execution characteristics
Background job requirements
Vendor-specific features
Database still requires a separate provider

If selected, PostgreSQL would normally remain a separate managed service.

9. Database Hosting

The application requires PostgreSQL.

The production database should use a managed PostgreSQL service rather than manually operating a database server initially.

Possible providers include:

Azure Database for PostgreSQL
Other managed PostgreSQL providers
Suitable student-benefit providers if appropriate

The final provider remains open.

10. Database Requirements

Production PostgreSQL should provide:

Automated backups
Encryption in transit
Encryption at rest where available
Access controls
Monitoring
Recovery options
Reasonable storage limits
Connection management
Upgrade path

The application should not depend on manually maintaining a PostgreSQL server during the early stage.

11. Database and Application Separation

The application and database should be logically separated:

Application Hosting
        ↓
Private / Controlled Database Connection
        ↓
Managed PostgreSQL

Database credentials must never be exposed to frontend code.

12. Development Environment

Local development should use:

Developer Machine
       ↓
Local / Development PostgreSQL
       ↓
Next.js Application

Development infrastructure should not use production data.

13. Environments

The project should eventually maintain at least:

Development
Staging
Production

However, a full staging environment does not necessarily need to exist from the first line of code.

For the initial development phase:

Local Development
       ↓
Production Pilot

may be sufficient if appropriate safeguards exist.

A dedicated staging environment should be introduced when deployment complexity or team size makes it valuable.

14. Production Deployment

Production deployments should be automated through GitHub Actions or the selected hosting provider's deployment integration.

Preferred flow:

Pull Request
     ↓
CI
     ↓
Review
     ↓
Merge
     ↓
Production Deployment

Production deployment should not depend on manually copying source files.

15. Deployment Safety

Production deployments should include:

Build validation
Type checking
Tests
Environment validation
Database migration safety
Rollback strategy where practical

Destructive database migrations require additional review.

16. Database Migrations

Database schema changes must be version controlled.

Preferred flow:

Code Change
    ↓
Migration
    ↓
Tests
    ↓
Review
    ↓
Deploy

Production migrations should not be performed manually without a documented reason.

17. Secrets Management

Production secrets must be stored using the hosting provider's secure environment/secret mechanism or an appropriate secret-management service.

Examples:

Database credentials
Authentication secrets
WhatsApp credentials
API keys
Cloud credentials
OAuth secrets
Encryption keys

Never commit production secrets to Git.

18. Domain

The production application will eventually use a proper domain.

The domain should be selected after:

Product branding is finalized
Product direction is sufficiently validated
Initial pilot readiness is established

The project should avoid purchasing multiple domains prematurely.

19. HTTPS

Production traffic must use HTTPS.

The hosting platform should provide or support managed TLS certificates.

HTTP traffic should redirect to HTTPS where appropriate.

20. Database Backups

Production PostgreSQL must have automated backups.

The backup strategy should define:

Backup frequency
Retention
Recovery process
Recovery testing

A backup that has never been restored should not be assumed to be reliable.

Recovery testing should be introduced before the product depends heavily on production data.

21. Data Recovery

Data recovery should be considered for:

Accidental deletion
Application bugs
Failed migrations
Database corruption
Infrastructure failure

Application-level safeguards should complement database backups.

Backups are not a substitute for authorization and data-integrity controls.

22. File Storage

Progress photos and other user-uploaded files are future functionality.

File storage remains an open decision.

The initial product should avoid introducing object storage unless a real file-upload requirement exists.

When file storage is introduced, it should consider:

Private access
Tenant isolation
Signed URLs
File size limits
Content validation
Malware/security considerations
Retention
Deletion
Backup requirements
23. Background Jobs

The initial application may require asynchronous processing for:

WhatsApp notifications
Reminder scheduling
Notification retries
Scheduled membership reminders
Future analytics jobs

A queue/background-job system should not be introduced before it is necessary.

For early development, simple scheduled mechanisms may be sufficient.

As notification volume grows, a proper queue should be introduced.

24. Caching

Caching is not required for the initial architecture.

Initial approach:

Query PostgreSQL directly where appropriate.

Caching should be introduced only after identifying:

Expensive queries
Repeated reads
Performance bottlenecks
High traffic
Appropriate cache invalidation strategy

Avoid introducing Redis merely because it is available.

25. CDN

A CDN may be used through the selected application hosting provider.

It is not an independent architectural requirement for the first implementation.

26. Observability

Production should eventually include:

Application logs
Error tracking
Health checks
Basic metrics
Database monitoring
Notification delivery status

The exact error-tracking provider remains open.

27. Logging

Logs must not contain:

OTPs
Passwords
Authentication tokens
API secrets
Database credentials
Private keys
Unnecessary sensitive payment information

Logs should contain enough context to debug production issues without becoming a source of sensitive-data leakage.

28. Cost Strategy

The initial infrastructure philosophy is:

Student Benefits
       ↓
Low-Cost Infrastructure
       ↓
Pilot Gyms
       ↓
Paying Customers
       ↓
Production Infrastructure Funded by Revenue

The system should not depend on unlimited free-tier resources.

The architecture must remain viable when student benefits expire.

29. Initial Cost Target

The desired initial personal infrastructure spending is approximately:

₹0–₹1,000/month where practical.

This is a target rather than a hard architectural constraint.

Security and reliability requirements take priority over minimizing cost at all costs.

30. Vendor Lock-In

Vendor lock-in should be minimized where it is easy to do so.

Important boundaries include:

Authentication provider
WhatsApp provider
Database hosting
File storage
Error tracking
Background jobs

However, the project should not build elaborate abstraction layers solely to eliminate every form of vendor dependency.

Use clear boundaries where replacement is realistically possible.

31. Initial Infrastructure Recommendation

The preferred initial shape is:

                   ┌─────────────────────┐
                   │     User Browser    │
                   │       PWA           │
                   └──────────┬──────────┘
                              │
                             HTTPS
                              │
                   ┌──────────▼──────────┐
                   │   Next.js App       │
                   │   Modular Monolith  │
                   └──────┬───────┬──────┘
                          │       │
                ┌─────────┘       └──────────────┐
                │                                │
       ┌────────▼────────┐              ┌────────▼────────┐
       │   PostgreSQL    │              │ External APIs   │
       │    Database     │              │ Auth / WhatsApp │
       └─────────────────┘              └─────────────────┘

No microservices are required.

No Kubernetes is required.

No Redis is required initially.

No separate API server is required initially.

No separate worker infrastructure is required until background processing justifies it.

32. Scaling Strategy

The expected scaling path is:

Stage 1
Single application
+
Managed PostgreSQL

        ↓

Stage 2
Application scaling
+
Database optimization

        ↓

Stage 3
Background jobs
+
Queue

        ↓

Stage 4
Caching where justified
+
Read optimization

        ↓

Stage 5
Selective service separation
if actual requirements justify it

The project should scale based on evidence rather than assumptions.

33. What We Will Not Build Initially

The initial architecture should not include:

Kubernetes
Microservices
Service mesh
Dedicated Redis cluster
Dedicated Kafka cluster
Complex event bus
Multi-region deployment
Custom infrastructure orchestration
Self-managed database servers
Complex infrastructure-as-code without need

These may become appropriate later, but not for the initial product.

34. Disaster Recovery

The project should eventually document:

Backup policy
Restore process
Recovery point objective
Recovery time objective
Database recovery procedure
Deployment rollback procedure

Exact RPO/RTO targets should be defined once real production requirements are understood.

35. Infrastructure Ownership

Infrastructure configuration should be version-controlled where practical.

Production access should be limited to authorized people.

Infrastructure credentials should not be shared casually.

The project should maintain clear ownership of:

Domain
Cloud account
Database
Authentication provider
WhatsApp provider
Production secrets
Billing accounts
36. Decision
Current Status

Infrastructure architecture is defined, but final providers remain open.

The initial production architecture will favor:

Managed services
Simple deployment
PostgreSQL
Single modular application
Automated CI/CD
Minimal infrastructure
Low initial cost
Clear provider boundaries
37. Provider Selection Criteria

Before selecting production providers, evaluate:

Current pricing
Student benefits
Free-tier limitations
Production suitability
Data location/options
Backup capabilities
Reliability
Scaling
Deployment experience
Vendor lock-in
Exit/migration difficulty
Security features

Current provider pricing and benefit details should be verified from official provider documentation before final selection.

38. Consequences
Positive
Low initial complexity
Low initial cost
Easier development
Easier debugging
Easier deployment
Clear scaling path
Reduced operational burden
Trade-offs
Some provider dependency
Separate providers may eventually be required
Scaling beyond the initial architecture will require additional work
Free/student infrastructure will not necessarily remain free
39. Future Reassessment

Reassess infrastructure when:

Paying customers increase significantly
Database load increases
Application traffic increases
Notification volume increases
Background processing becomes substantial
Availability requirements increase
Student benefits expire
Current provider pricing becomes unsuitable
Production incidents reveal infrastructure limitations
40. Related Documents
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
06-SECURITY.md
20-CURRENT-STATE.md
41. Approval

Decision Owner: Project Owner

Status: Proposed

Application Host: TBD

PostgreSQL Host: TBD

Error Tracking: TBD

File Storage: TBD

Background Jobs: TBD

Approval Date: N/A
