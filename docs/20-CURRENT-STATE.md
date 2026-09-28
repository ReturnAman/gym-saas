
# 20 — CURRENT STATE

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Version:** 0.1  
**Status:** Documentation / Architecture Phase  
**Last Updated:** 2026-09-29

---

# 1. Purpose

This document records the current implementation and decision state of the gym-saas project.

It is the operational snapshot of the repository.

AI tools and developers should read this document before starting meaningful work so they understand:

- what has already been decided
- what has been implemented
- what remains open
- what is currently being worked on
- what must not be changed without approval
- what the next engineering step is

This document should remain concise and current.

It is not a replacement for detailed architecture, security, product, database, or API documentation.

---

# 2. Current Project Status

## 2.1 Overall Status

The project is currently in the:

> **Documentation, Architecture, and Engineering Planning Phase**

The core product definition and engineering documentation have been established.

Production implementation has not yet begun unless explicitly recorded in this document.

---

# 3. Documentation Status

| Document | Status |
|---|---|
| `AI_CONTEXT.md` | Complete |
| `AGENTS.md` | Complete |
| `00-PROJECT-CHARTER.md` | Complete |
| `01-PRODUCT-REQUIREMENTS.md` | Complete |
| `02-USER-FLOWS.md` | Complete |
| `03-SYSTEM-ARCHITECTURE.md` | Complete |
| `04-DATABASE-DESIGN.md` | Complete |
| `05-AUTHORIZATION.md` | Complete |
| `06-SECURITY.md` | Complete |
| `07-API-SPECIFICATION.md` | Complete |
| `08-PWA.md` | Complete |
| `09-TESTING.md` | Complete |
| `10-DEVOPS.md` | Complete |
| `11-OBSERVABILITY.md` | Complete |
| `12-SCALABILITY.md` | Complete |
| `13-COST-INFRASTRUCTURE.md` | Complete |
| `14-TECH-DECISIONS.md` | Complete |
| `15-DSA-AND-ENGINEERING.md` | Complete |
| `16-INTERVIEW-MASTER.md` | Complete |
| `20-CURRENT-STATE.md` | Current document |

---

# 4. Product State

## 4.1 Product Direction

The first product is a gym management SaaS for small local gyms.

The primary paying customer is:

> Gym owner / gym operator

The primary daily end user is:

> Gym member

The product is intended to provide useful operational software to gyms while also creating a strong real-world software engineering project.

---

# 5. Core Product Scope

## 5.1 Owner Core

Planned V1 capabilities:

- Gym profile and settings
- Member management
- Membership management
- Payment tracking
- Payment verification
- Partial payments
- Attendance
- QR attendance
- Staff management
- Roles and permissions
- Dashboard
- Needs Attention
- Announcements
- CSV exports
- Basic occupancy information

---

## 5.2 Member Core

Planned V1 capabilities:

- OTP onboarding
- Gym QR-based entry
- Member home
- Check-in
- Attendance history
- Attendance percentage
- Membership status
- Payment status
- Renewal information
- Announcements
- Live occupancy

---

# 6. Future Product Scope

Potential future capabilities include:

- Attendance streaks
- Badges
- Consistency leaderboard
- Daily challenges
- Goals
- Achievement system
- Progress photos
- Gym-controlled challenges
- Partner offers
- Gym discovery
- Affiliate/commission functionality
- Additional engagement features

These are not required for initial implementation.

---

# 7. Architecture State

## 7.1 Application Architecture

Current architectural direction:

> Modular monolith

The initial system should not be split into microservices without a demonstrated need.

Business/domain logic should remain separated from presentation concerns.

---

## 7.2 Multi-Tenancy

Multi-tenancy is a core architectural requirement.

Each gym is represented as an organization/tenant.

The system must enforce tenant isolation on the backend.

Frontend organization checks are not considered a security boundary.

---

# 8. Technology Direction

Current technology direction:

### Frontend

- Next.js
- React
- TypeScript
- PWA

### Backend

- Next.js server-side/API capabilities initially
- Domain/business logic separated from UI

### Database

- PostgreSQL

### Authentication

- Clerk is the selected authentication provider (Accepted 2026-09-29; see `docs/decisions/001-AUTHENTICATION.md`)
- Clerk is responsible for authentication/identity only; authorization, organization membership, roles, and tenant isolation remain application-owned

### Authorization

Application-owned authorization.

Authentication and authorization remain separate concepts.

### ORM

Decided (2026-09-29): Prisma. See `docs/decisions/002-DATABASE-ORM.md` (Accepted).

---

# 9. Identity and Authentication State

## 9.1 User Identity

A user is an application-level identity.

Phone number is not the primary key.

A single user may belong to multiple organizations.

---

## 9.2 Member Authentication

Planned flow:

```text
Permanent Gym QR
        ↓
Identify Gym
        ↓
Enter Phone
        ↓
Check Gym Membership Association
        ↓
Send OTP
        ↓
Verify OTP
        ↓
Create / Link User
        ↓
Create / Confirm Organization Membership
        ↓
Access Gym
````

The QR code identifies the gym.

It does not authenticate the member.

OTP verification proves control of the phone number.

Authorization comes from organization membership and role.

---

## 9.3 Owner Authentication

Planned flow:

```text
Phone
 ↓
OTP
 ↓
User Account
 ↓
Minimal Gym Details
 ↓
Organization
 ↓
OWNER Membership
 ↓
Trial Subscription
```

Phone OTP does not by itself prove legal ownership of a gym.

---

# 10. Authorization State

Initial roles:

* OWNER
* ADMIN
* STAFF
* TRAINER
* MEMBER

Authorization must be enforced server-side.

Every protected operation should consider:

1. Is the user authenticated?
2. Which organization are they acting in?
3. What role do they have?
4. Do they have permission for this action?
5. Does the requested resource belong to the organization?
6. Is the requested state transition valid?

---

# 11. Subscription State

Initial owner trial:

> 7-day free trial

The exact initial member limit may remain configurable.

Trial expiration should not delete organization data.

Subscription state and organization state remain separate.

The planned entitlement model is:

```text
Subscription
     ↓
Plan
     ↓
Entitlements
     ↓
Feature / Action Checks
```

Avoid scattering direct checks such as:

```text
if trial
```

throughout the application.

---

# 12. SaaS Subscription Payment State

For V1:

> No Razorpay integration.

Gym owners pay the SaaS manually through supported payment methods such as:

* UPI
* Bank transfer

Payment is manually verified.

The subscription is then manually enabled or extended.

A future payment gateway can be added later if justified.

---

# 13. Member Payment State

The SaaS does not hold gym membership money.

The member pays the gym directly.

Possible methods:

* UPI
* Cash
* Card
* Other configured methods

The product records the gym's payment state.

---

## 13.1 Payment Claim

Member flow:

```text
View Amount Due
      ↓
View Gym UPI / QR
      ↓
Pay Gym
      ↓
"I Have Paid"
      ↓
Payment Claim
      ↓
Owner / Authorized Staff Verification
      ↓
Confirmed Payment
```

A payment claim is not a confirmed payment.

---

## 13.2 Partial Payments

Partial payments are supported.

Outstanding balance is calculated from actual confirmed payments.

Conceptually:

```text
Outstanding
=
Charge Total
-
Sum(Confirmed Payments)
```

Payment status may include:

* UNPAID
* PARTIALLY_PAID
* PAID
* OVERPAID

Payment and membership renewal remain separate domains.

---

# 14. Attendance State

Attendance is a core V1 feature.

Planned capabilities:

* QR check-in
* Check-in records
* Duplicate protection
* Attendance history
* Attendance percentage
* Active attendance sessions
* Occupancy calculation

---

# 15. Occupancy State

Live occupancy should be derived from active attendance/check-in sessions.

The system should avoid maintaining unnecessary duplicate occupancy state when it can be derived reliably.

Future occupancy analytics may include:

* historical occupancy
* peak hours
* occupancy trends

---

# 16. WhatsApp State

The planned production direction is:

> Centralized SaaS WhatsApp sender

The SaaS should not require every gym owner to manually configure their own WhatsApp infrastructure for the core notification system.

Messages remain personalized.

Example:

```text
Member Name
Gym Name
Amount
Membership Expiry
Reminder Type
```

Notification records must remain tenant-scoped.

---

## 16.1 Notification Architecture

Planned flow:

```text
Event
 ↓
Notification Rule
 ↓
Notification Job
 ↓
Queue
 ↓
Provider
 ↓
Delivery Status
```

The notification provider should be replaceable.

WhatsApp must not be used as the authentication system.

---

## 16.2 OpenWA

OpenWA may be useful for experimentation or controlled pilot testing.

It is not the production foundation for the commercial SaaS.

Production WhatsApp direction should use an appropriate official provider.

---

# 17. PWA State

The member and owner experiences are intended to work primarily as a Progressive Web App.

Initial goals:

* Installable
* Mobile-friendly
* Responsive
* Fast
* Good offline/error behavior
* QR-friendly
* App-like navigation

Native Android/iOS applications are not required for V1.

---

# 18. Security State

Security is a first-class requirement.

Important protected areas include:

* Authentication
* Authorization
* Tenant isolation
* OTP
* Payment state
* Member data
* Staff permissions
* QR flows
* API access
* Secrets
* Logs
* File uploads
* Notification data

The frontend must never be treated as a security boundary.

---

# 19. Database State

Database direction:

> PostgreSQL

Database design must support:

* Multi-tenancy
* Users
* Organization memberships
* Roles
* Members
* Memberships
* Plans
* Charges
* Payments
* Payment claims
* Attendance
* Attendance sessions
* Announcements
* Notifications
* Subscriptions
* Entitlements
* Audit information

Schema changes must use deliberate migrations.

Manual production schema modifications should be avoided.

---

# 20. API State

The API should:

* Authenticate requests
* Authorize requests
* Validate input
* Enforce tenant scope
* Validate resource ownership
* Enforce business rules
* Protect sensitive information
* Return predictable errors

The client must not be trusted to provide authoritative business state.

---

# 21. Testing State

Testing should cover at minimum:

### Authentication

* OTP expiration
* OTP attempts
* OTP cooldown
* OTP abuse protection
* Authentication failures

### Authorization

* Role restrictions
* Tenant isolation
* Resource ownership
* IDOR-style access attempts

### Payments

* Payment claims
* Payment confirmation
* Partial payments
* Outstanding balance
* Unauthorized confirmation
* Invalid payment amounts
* Payment state transitions

### Attendance

* Check-in
* Duplicate check-in
* Tenant isolation
* Attendance history
* Occupancy calculations

### General

* Unit tests
* Integration tests
* API tests
* End-to-end tests where valuable

---

# 22. DevOps State

The repository already has GitHub Actions/CI foundations.

The engineering workflow should use:

```text
Issue
 ↓
Implementation
 ↓
Tests
 ↓
Validation
 ↓
Commit
 ↓
Pull Request
 ↓
Review
 ↓
Merge
```

Production infrastructure should not be created prematurely.

---

# 23. Secrets State

Secrets must never be committed to Git.

Examples include:

* API keys
* Database credentials
* WhatsApp credentials
* Cloud credentials
* OAuth secrets
* Private tokens
* Production environment secrets

Use environment variables and appropriate secret-management mechanisms.

`.env.example` may contain variable names but never real secrets.

---

# 24. Observability State

The system should eventually provide:

* Structured logs
* Error tracking
* Health checks
* Request tracing where useful
* Notification delivery visibility
* Audit information for sensitive actions

Error tracking provider remains an open implementation decision.

---

# 25. Infrastructure State

The GitHub Student Developer Pack provides useful infrastructure benefits.

Potential resources include:

* Azure student credit
* MongoDB Atlas credits
* Heroku credit
* GitHub Pro
* GitHub Copilot
* Codespaces
* Other student benefits

These benefits should be used when they fit the architecture.

They should not drive architecture decisions merely because they are available.

---

# 26. Cost Philosophy

Initial goal:

> Minimize personal spending while building a real product.

Target initial personal infrastructure spend:

> Approximately ₹0–₹1,000/month where practical.

The architecture should allow the product to grow from low-cost development infrastructure toward paid production infrastructure without requiring unnecessary rewrites.

Paying customers should eventually fund production infrastructure.

---

# 27. Domain / Branding State

Final product name:

> TBD

Parent company:

> XYZ

Product brands are intended to be owned by the parent company.

Domain purchase should happen after the product/brand direction is sufficiently validated and before serious external pilot usage.

Do not purchase multiple domains prematurely.

---

# 28. Current Open Decisions

The following decisions remain open unless explicitly changed elsewhere:

* Final product name
* Final domain
* Production hosting
* Production PostgreSQL provider
* Error tracking provider
* Final API conventions
* API versioning strategy
* File storage provider
* Infrastructure-as-code approach
* Production WhatsApp provider
* Final notification provider configuration
* Exact pricing/plans
* Exact trial member limit
* Final entitlement matrix

Open decisions must not be silently finalized by AI tools.

---

# 29. Decisions Requiring Human Approval

Human approval is required before changing:

* Core architecture
* Database technology
* Authentication architecture
* Authorization model
* Tenant isolation model
* Payment architecture
* Payment gateway
* Production infrastructure
* Major third-party services
* Microservice architecture
* Security architecture
* Destructive database changes

AI tools may propose changes but must not silently make these decisions.

---

# 30. Current Engineering Rule

The project should not jump directly into building the entire SaaS.

Implementation should proceed incrementally.

Preferred workflow:

```text
Requirement
    ↓
Security Analysis
    ↓
Architecture / Data Impact
    ↓
Implementation Plan
    ↓
Human Approval if Required
    ↓
Implementation
    ↓
Tests
    ↓
Validation
    ↓
Diff Review
    ↓
Documentation Update
    ↓
Current-State Update
```

---

# 31. Current Development Philosophy

The developer is the engineer and architect.

AI tools are:

* implementation assistants
* reviewers
* debugging assistants
* learning assistants
* documentation assistants
* research assistants

AI must not become the unquestioned source of architectural decisions.

The repository remains the source of truth.

---

# 32. Git Strategy

Prefer small, focused commits.

Examples:

```text
docs: define member onboarding flow
docs: define payment architecture
docs: define authorization model
feat: add organization model
feat: add member creation flow
test: add tenant isolation coverage
fix: prevent duplicate attendance check-in
```

Avoid giant commits such as:

```text
build entire gym SaaS
```

---

# 33. Current Repository State

Expected repository structure:

```text
gym-saas/
├── README.md
├── AI_CONTEXT.md
├── AGENTS.md
├── CHANGELOG.md
│
├── docs/
│   ├── 00-PROJECT-CHARTER.md
│   ├── 01-PRODUCT-REQUIREMENTS.md
│   ├── 02-USER-FLOWS.md
│   ├── 03-SYSTEM-ARCHITECTURE.md
│   ├── 04-DATABASE-DESIGN.md
│   ├── 05-AUTHORIZATION.md
│   ├── 06-SECURITY.md
│   ├── 07-API-SPECIFICATION.md
│   ├── 08-PWA.md
│   ├── 09-TESTING.md
│   ├── 10-DEVOPS.md
│   ├── 11-OBSERVABILITY.md
│   ├── 12-SCALABILITY.md
│   ├── 13-COST-INFRASTRUCTURE.md
│   ├── 14-TECH-DECISIONS.md
│   ├── 15-DSA-AND-ENGINEERING.md
│   ├── 16-INTERVIEW-MASTER.md
│   ├── 20-CURRENT-STATE.md
│   │
│   ├── features/
│   ├── decisions/
│   └── learning/
│
├── design/
├── src/
├── tests/
├── scripts/
│
└── .github/
    ├── workflows/
    ├── ISSUE_TEMPLATE/
    └── pull_request_template.md
```

---

# 34. What Has Not Started Yet

Unless separately recorded:

* Production database
* Production authentication
* Production deployment
* Production WhatsApp integration
* Payment gateway
* Production domain
* Full application implementation
* Production monitoring
* Real customer onboarding

These should be introduced deliberately.

---

# 35. Immediate Next Phase

After the documentation phase, implementation should begin with the smallest meaningful vertical slice rather than attempting to build all features simultaneously.

Recommended initial engineering sequence:

```text
1. Finalize remaining technical decisions
2. Initialize application
3. Establish TypeScript / lint / formatting / testing
4. Establish database and migrations
5. Establish authentication
6. Establish organization / tenant model
7. Establish authorization
8. Build owner onboarding
9. Build member management
10. Build member OTP onboarding
11. Build attendance
12. Build payments
13. Build dashboard
14. Build notifications
15. Harden security
16. Deploy pilot
```

The exact sequence may be adjusted after implementation planning.

---

# 36. First Implementation Principle

Do not begin by building the dashboard UI.

The foundation should establish:

```text
Identity
   ↓
Organization
   ↓
Membership
   ↓
Authorization
   ↓
Domain Data
   ↓
Business Operations
   ↓
UI
```

This reduces the risk of building UI around incorrect authorization or data assumptions.

---

# 37. Current Priority

The immediate priority is:

> Convert the documented architecture into a small, secure, testable working foundation.

The first implementation should establish the application's structural foundations before adding large amounts of feature code.

---

# 38. Update Rules

Update this document when there is a meaningful change to:

* implementation status
* architecture
* major technology decisions
* security model
* production infrastructure
* major product scope
* important open decisions
* current development phase

Do not update it for every tiny code change.

---

# 39. Change Log

| Date       | Change                                 | Owner         |
| ---------- | -------------------------------------- | ------------- |
| YYYY-MM-DD | Initial current-state document created | Project Owner |
| 2026-09-29 | ORM finalized: Prisma (ADR 002 Accepted); stale ORM references updated | Project Owner |
| 2026-09-29 | Authentication provider finalized: Clerk (ADR 001 Accepted; ADR 015 Accepted) | Project Owner |
| 2026-09-29 | Testing stack finalized: Vitest + Playwright (ADR 003 Accepted) | Project Owner |

---

# 40. Final Rule

This document describes the current state.

If the implementation differs from this document, the difference must be investigated.

Do not silently assume that the documentation is wrong.

Do not silently change architecture to match an AI-generated assumption.

Surface the discrepancy, determine the intended state, and update the appropriate source-of-truth document.

---
```
