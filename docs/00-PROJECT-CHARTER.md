# 00 — PROJECT CHARTER

**Project Identifier:** `gym-saas`
**Parent Company:** TBD
**Product Brand:** TBD
**Domain:** TBD
**Status:** Pre-development / Product definition
**Document Version:** 0.1

---

## 1. Project Overview

`gym-saas` is a multi-tenant SaaS platform designed for small and local gyms.

The product helps gym owners manage their day-to-day operations while giving gym members a simple mobile-first experience for attendance, membership information, payments, announcements, and engagement.

The business model is:

> **Gym owners are the paying SaaS customers. Gym members are the primary end users of the member experience.**

The product is intended to start as a practical solution for local gyms and evolve into a larger gym-management and member-engagement platform based on real customer usage.

The project will initially be built and operated by the founder as a serious commercial product and as a long-term software-engineering project.

---

# 2. Problem

Many small gyms rely on a combination of:

* spreadsheets
* paper records
* messaging apps
* manual attendance tracking
* manually maintained payment records
* informal membership tracking
* separate tools with poor integration

This creates operational friction for gym owners and staff.

Members also often lack a dedicated, simple way to:

* check their membership status
* see attendance history
* understand payment status
* check into the gym
* receive important gym announcements
* see useful engagement information

The product aims to bring these workflows into one system without making the gym owner’s daily operation unnecessarily complicated.

---

# 3. Target Customers

### Primary customer

Small and local gyms that need practical management software without the complexity of large enterprise gym-management systems.

### Primary paying user

The gym owner.

### Operational users

Depending on permissions:

* Owner
* Admin
* Staff
* Trainer

### Member user

Gym members use the member-facing experience but generally do not pay the SaaS directly.

Their gym relationship remains with the gym owner.

---

# 4. Core Product Model

The system is multi-tenant.

Each gym is represented as an independent organization/tenant.

A simplified relationship is:

```text
User
  │
  ├── OrganizationMembership
  │
  ▼
Organization / Gym
  │
  ├── Members
  ├── Staff
  ├── Memberships
  ├── Charges
  ├── Payments
  ├── Attendance
  ├── Announcements
  └── Settings
```

A user may belong to multiple organizations.

For example, the same person could eventually be a member of multiple gyms without creating multiple unrelated user identities.

Every tenant-owned business record must be correctly scoped to its organization.

---

# 5. Owner Experience

The owner experience is primarily an operational command center.

Core capabilities include:

### Gym management

* Gym profile
* Gym settings
* Gym UPI/payment configuration
* Gym QR configuration
* Subscription status

### Member management

* Add member
* Edit member
* Search members
* Filter members
* Membership status
* Membership expiry
* Member details

### Membership management

* Membership plans
* Membership duration
* Membership charges
* Membership status
* Expiry tracking
* Renewal workflow

### Payments

The V1 system will **not integrate a payment gateway**.

For the SaaS subscription:

> Gym owner → SaaS company

The owner will initially pay manually through UPI/bank transfer.

Payment will be manually verified by the SaaS administrator, after which the gym's subscription/access will be enabled or extended.

For gym membership payments:

> Member → Gym owner

The SaaS does not hold or transfer the gym membership money.

The gym can configure its own UPI ID and/or QR.

A member can:

1. See the amount due.
2. Pay the gym directly.
3. Click **"I have paid."**
4. Create a payment claim.
5. Wait for owner/staff verification.

The owner/staff then confirms the actual amount received.

Partial payments are supported.

Example:

```text
Membership charge:     ₹2,000
Payment received:      ₹1,200
Outstanding balance:     ₹800
```

The system calculates the outstanding amount from confirmed payment records.

Human notes are supplementary context and are not the financial source of truth.

Payment and membership renewal remain separate domains.

---

# 6. Attendance

Attendance is a core product capability.

Members can use the gym's QR code to check in.

The QR code identifies the gym but does not authenticate the member.

The member identity flow is:

```text
Permanent Gym QR
      ↓
Identify Gym
      ↓
Member enters phone number
      ↓
Backend checks gym association
      ↓
OTP
      ↓
OTP verification
      ↓
Authenticated User
      ↓
Organization Membership
      ↓
Attendance action
```

The backend remains authoritative for authorization.

Attendance should support:

* Check-in
* Duplicate-check protection
* Attendance history
* Attendance percentage
* Active sessions
* Check-out where applicable
* Live occupancy derived from active sessions

---

# 7. Member Experience

The member experience is mobile-first and will initially be delivered as a PWA.

The member should be able to access:

* Home
* Check-in
* Attendance history
* Attendance percentage
* Membership status
* Membership expiry
* Payment status
* Payment claims
* Announcements
* Live occupancy
* Profile

The longer-term member experience may include:

* Attendance streaks
* Badges
* Consistency leaderboard
* Daily challenges
* Achievements
* Goals
* Private progress photos
* Partner offers

These features should not complicate the initial product unnecessarily.

---

# 8. Member Onboarding

The gym owner does not need to manually create a separate login account for every member.

The owner adds the member with basic information such as:

* Name
* Phone number
* Membership information

The member later scans the permanent gym QR and authenticates using the registered phone number and OTP.

Important security principles:

* QR identifies the gym.
* Phone number is used for discovery.
* OTP proves control of the phone.
* User ID represents identity.
* Organization membership represents authorization.
* Backend authorization determines access.

Phone numbers must never be treated as the primary identity key.

---

# 9. Owner Onboarding

The initial owner onboarding flow is:

```text
Owner enters phone
       ↓
OTP verification
       ↓
User account
       ↓
Minimal gym information
       ↓
Organization created
       ↓
Creator becomes OWNER
       ↓
Trial subscription created
```

The initial product will use a **7-day free trial**.

The initial member limit may be configurable, for example 10–20 members.

This is a product/trial entitlement and must not be treated as a technical database limitation.

Multiple owners should use separate accounts.

Shared owner credentials are not supported.

---

# 10. Roles and Authorization

Initial roles:

```text
OWNER
ADMIN
TRAINER
STAFF
MEMBER
```

Roles are implemented through organization membership and backend authorization.

The frontend must never be the final authority for permission checks.

Every protected backend operation must consider:

* authenticated user
* organization
* organization membership
* role
* specific permission
* resource ownership/tenant scope

---

# 11. WhatsApp Notifications

The long-term production architecture uses a centralized SaaS-controlled WhatsApp sender rather than requiring every gym owner to operate their own WhatsApp integration.

Messages remain personalized.

For example:

```text
Hi Rahul,

Your membership at ABC Fitness expires in 3 days.

Amount due: ₹2,000

Please contact ABC Fitness for renewal.
```

Internally, every notification must remain tenant-scoped.

Relevant information includes:

* organization ID
* member ID
* message type
* template
* recipient
* delivery status
* provider message ID

The notification architecture should use a provider abstraction so that the messaging provider can be changed without redesigning the application.

Production commercial messaging should use the appropriate official WhatsApp/Meta infrastructure and comply with applicable messaging rules.

OpenWA may be useful for experimentation or pilot testing but is not the intended production foundation.

WhatsApp must not be used as the OTP/authentication foundation.

---

# 12. Security Principles

Security is a first-class product requirement.

The project must prioritize:

### Tenant isolation

A user from Gym A must never be able to access Gym B's data.

### Backend authorization

Frontend checks are UX controls, not security boundaries.

### Identity separation

Authentication and authorization are separate concerns.

### Payment integrity

A member's claim that they paid is not equivalent to a confirmed payment.

### Auditability

Important operations should identify who performed them and when.

### Secrets

Credentials, API keys, tokens, and private configuration must never be committed to Git.

### Abuse prevention

Authentication flows should include appropriate:

* OTP rate limiting
* resend cooldowns
* verification attempt limits
* IP/device throttling
* short OTP expiration
* audit/monitoring

### Data minimization

The system should not collect sensitive information without a concrete product reason.

---

# 13. Technical Philosophy

The project should be built as production-quality software rather than as an AI-generated prototype.

Core principles:

1. Clean, readable code.
2. Simple architecture where possible.
3. Strong boundaries between domains.
4. Explicit authorization.
5. Multi-tenancy from day one.
6. Database integrity.
7. Automated tests for important business logic.
8. Observable production behavior.
9. Secure defaults.
10. Minimal unnecessary abstraction.
11. No premature microservices.
12. No unnecessary infrastructure complexity.
13. Infrastructure/provider choices should remain replaceable where practical.

The initial architecture should be capable of growing without requiring the entire system to be rewritten.

---

# 14. Initial Technical Direction

The current technical direction is:

### Frontend

* Next.js
* TypeScript
* PWA
* Mobile-first member experience
* Responsive owner experience

### Backend

The application may initially use the Next.js server-side/API layer while keeping business logic clearly separated from presentation.

The architecture should allow extraction of services later if real scale or organizational needs justify it.

### Database

PostgreSQL is the preferred database because the product contains strongly related business entities and transactional workflows.

Expected relationships include:

```text
User
Organization
OrganizationMembership
Member
MembershipPlan
Membership
Charge
PaymentTransaction
PaymentClaim
Attendance
ActiveSession
Announcement
Notification
Subscription
```

The exact schema will be designed separately before implementation.

### Authentication

A managed authentication provider such as Clerk may be used initially.

Authentication does not replace application authorization.

The application owns its organization membership, roles, permissions, and tenant access rules.

---

# 15. PWA Strategy

The product will be PWA-first.

A native Android/iOS application is not required for the initial product.

This reduces:

* development time
* maintenance burden
* distribution complexity
* duplicated frontend work

The member experience should be optimized for mobile.

The owner experience should primarily optimize operational efficiency on desktop while remaining usable on mobile.

---

# 16. Product Scope — V1

The initial product should focus on the workflows that directly solve gym operations.

### Owner

* Gym profile/settings
* Member management
* Membership plans
* Membership status
* Payment tracking
* Partial payments
* Payment verification
* Attendance
* QR attendance
* Staff
* Roles/permissions
* Dashboard
* Needs Attention
* Announcements
* CSV exports
* Subscription/trial management

### Member

* OTP onboarding
* Home
* Gym check-in
* Attendance history
* Attendance percentage
* Membership status
* Payment status
* Payment claim
* Renewal reminders
* Announcements
* Live occupancy

---

# 17. V1.5 / Later

Potential features:

* Inactive member detection
* Better analytics
* Occupancy history
* Peak-hour analysis
* Better reminders
* Attendance streaks
* Badges
* Consistency leaderboard
* Daily challenges
* Goals
* Private progress photos
* Achievement system

These features should be added based on actual product usage and customer feedback.

---

# 18. Future Product Direction

Potential longer-term capabilities include:

* Partner offers
* Supplement partnerships
* Gym/member discounts
* Gym discovery
* Affiliate/commission systems
* Additional ecosystem capabilities
* Optional cloud backup for member progress photos
* More advanced analytics
* Campaigns and communication tools

These are future possibilities, not V1 commitments.

---

# 19. Explicit Non-Goals for Initial Development

The project will deliberately avoid unnecessary complexity.

Initially we will NOT:

* Build native mobile apps.
* Build a payment gateway for gym membership payments.
* Automatically transfer or hold gym membership money.
* Use Razorpay for V1 SaaS subscription payments.
* Build microservices.
* Build a complete e-commerce system.
* Build a full social network.
* Build AI-generated workout programs as a core product.
* Build a complex AI chatbot.
* Build every future feature before validating the core product.
* Treat WhatsApp as the authentication system.
* Depend permanently on a temporary student-only infrastructure provider.
* Allow AI to redesign the architecture casually.
* Build the entire SaaS in one AI prompt.

---

# 20. AI-Assisted Development Philosophy

AI is a development tool, not the project's source of truth.

The source of truth is the Git repository and its documentation.

The project must be understandable by different AI coding tools.

A coding AI should be able to join the project by reading:

```text
AI_CONTEXT.md
AGENTS.md
docs/20-CURRENT-STATE.md
relevant feature specification
relevant architecture/decision documents
```

Development should happen feature-by-feature.

The preferred workflow is:

```text
Requirement
    ↓
Feature specification
    ↓
Security analysis
    ↓
Architecture/data impact
    ↓
Implementation plan
    ↓
Human approval
    ↓
AI implementation
    ↓
Tests
    ↓
Lint/typecheck/build
    ↓
Security review
    ↓
Human diff review
    ↓
Pull request
    ↓
Merge
    ↓
Documentation update
    ↓
CURRENT-STATE update
```

No AI should modify unrelated parts of the system while implementing a feature unless explicitly required.

---

# 21. GitHub as the Source of Truth

GitHub will contain:

* source code
* documentation
* architecture decisions
* feature specifications
* tests
* CI/CD configuration
* development rules
* current project state
* changelog
* learning documentation

AI conversations are temporary.

The repository is persistent.

This allows the project to continue even when:

* switching AI tools
* changing development machines
* stopping for weeks
* onboarding another developer
* reviewing the project later
* preparing for interviews

---

# 22. Learning and Engineering Goal

This project is not only intended to become a business.

It is also intended to develop genuine software-engineering ability.

The founder should understand the important systems rather than simply accepting generated code.

For major features, documentation should capture relevant engineering concepts such as:

* database indexing
* transactions
* concurrency
* queues
* caching
* authentication
* authorization
* tenant isolation
* API design
* validation
* error handling
* observability
* testing
* security
* scalability
* appropriate DSA usage

DSA should be used where it solves a real problem rather than being artificially inserted into production code.

---

# 23. Business Philosophy

The product should be built around actual gym operations rather than hypothetical scale.

Initial development should prioritize:

1. Real gym owner problems.
2. Simple onboarding.
3. Low operational friction.
4. Reliable core workflows.
5. Data correctness.
6. Security.
7. Member usability.
8. Measurable customer value.

Infrastructure spending should remain low during the validation stage.

The product should take advantage of legitimate student benefits and free/low-cost infrastructure where appropriate, while avoiding architectural dependence on any temporary student benefit.

As paying customers generate revenue, infrastructure and third-party services can be upgraded according to actual needs.

---

# 24. Naming and Branding Status

The company and product names have **not yet been decided**.

Therefore:

* Do not invent a permanent company name.
* Do not invent a permanent product name.
* Do not purchase a domain yet.
* Do not hard-code a brand name into architecture.
* Use `gym-saas` as the internal project identifier.
* Use `TBD` for company/product branding.

Naming and domain selection will be treated as a separate future decision.

---

# 25. Initial Success Criteria

The first meaningful milestone is not "having lots of features."

The first milestone is:

> A real local gym can use the system for its core daily operations without requiring the founder to manually operate the software.

The initial success criteria are:

* Owner can create/manage a gym.
* Owner can add members.
* Members can securely authenticate.
* Members can check in.
* Attendance is correctly recorded.
* Membership status is accurate.
* Payment claims work.
* Partial payments are correctly represented.
* Owners/staff can verify payments.
* Outstanding balances are system-calculated.
* Tenant isolation works.
* Roles and permissions work.
* Core workflows are tested.
* Errors are observable.
* The application can be deployed.
* The system can be handed to another developer/AI without explaining the entire project verbally.

---

# 26. Guiding Principle

The project should follow one central principle:

> **Build a simple, secure, maintainable product that solves real gym problems first, while creating an engineering foundation capable of growing into a larger SaaS platform.**

The goal is not to build everything immediately.

The goal is to build the **right foundation**, then continuously add validated capabilities without destroying that foundation.
