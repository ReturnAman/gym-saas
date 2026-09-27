# AI Context — Gym SaaS

## 1. Project Identity

Project identifier: `gym-saas`

Parent company: TBD

Product brand: TBD

Domain: TBD

The company and product names have not been finalized. Do not invent or hard-code a brand name.

This repository is private.

---

## 2. What We Are Building

`gym-saas` is a multi-tenant SaaS platform for small and local gyms.

Gym owners are the paying SaaS customers.

Gym members are the primary users of the member-facing experience.

The product helps gyms manage:

- Members
- Memberships
- Payments
- Attendance
- Staff
- Roles and permissions
- Announcements
- Notifications
- Operational information

Members can use the platform for:

- Secure onboarding
- Gym check-in
- Attendance
- Membership status
- Payment status
- Announcements
- Live occupancy
- Future engagement features

The product is intended to become a real commercial SaaS, not only a portfolio project.

---

## 3. Current Product Principles

The following principles are currently established:

1. Multi-tenant from day one.
2. Security and tenant isolation are first-class requirements.
3. Backend authorization is authoritative.
4. PWA-first.
5. Mobile-first member experience.
6. Operationally efficient owner experience.
7. Simple onboarding.
8. Clean, readable code.
9. Avoid unnecessary abstraction.
10. Avoid premature microservices.
11. Build feature-by-feature.
12. Test important business logic.
13. GitHub repository is the persistent source of truth.
14. AI conversations are not the source of truth.
15. Human review is required for important architectural and security changes.

---

## 4. Current Technical Direction

These are the current decisions/directions.

### Frontend

- Next.js
- TypeScript
- PWA
- Responsive UI
- Mobile-first member experience
- Desktop-oriented owner experience

### Database

PostgreSQL is the current database choice.

The product has strongly relational business data including:

- Users
- Organizations
- Organization memberships
- Members
- Memberships
- Charges
- Payment transactions
- Attendance
- Staff
- Roles
- Notifications
- Subscriptions

Initial managed hosting direction:

- Azure Database for PostgreSQL Flexible Server

Do not create infrastructure yet unless explicitly instructed.

### Authentication

A managed authentication provider such as Clerk may be used.

Authentication does not replace application authorization.

The application owns:

- Organization membership
- Roles
- Permissions
- Tenant access rules

### Backend

The application may initially use the Next.js server-side/API layer.

Business logic should remain separated from presentation/UI concerns.

Do not introduce microservices unless a concrete requirement justifies them.

---

## 5. Identity and Authorization Model

The basic identity model is:

User
→ OrganizationMembership
→ Organization

A user may belong to multiple organizations.

Initial roles:

- OWNER
- ADMIN
- TRAINER
- STAFF
- MEMBER

Backend authorization must verify:

- Authenticated user
- Organization
- Organization membership
- Role/permission
- Resource ownership or tenant scope

The frontend must never be treated as the security boundary.

---

## 6. Member Authentication Flow

The intended member onboarding flow is:

Permanent Gym QR
→ Identify gym
→ Enter phone number
→ Backend checks gym association
→ OTP
→ OTP verification
→ Authenticated user
→ Organization membership
→ Authorized access

Important rules:

- Gym QR identifies the gym.
- QR does not authenticate the member.
- Phone number is discovery information.
- OTP proves control of the phone.
- User ID represents identity.
- Organization membership represents authorization.
- Phone number is not the primary identity key.

OTP flows require appropriate abuse protection such as:

- Rate limiting
- Resend cooldown
- Verification attempt limits
- Short expiration
- IP/device/request throttling where appropriate

---

## 7. Owner Onboarding

Initial flow:

Owner phone
→ OTP
→ User account
→ Minimal gym details
→ Organization creation
→ Creator becomes OWNER
→ Trial subscription

Initial trial:

- 7 days
- Initial member limit may be configurable

Trial limits are product entitlements, not database capacity.

Multiple owners must use separate accounts.

Shared credentials are not supported.

---

## 8. Payment Model

### SaaS subscription

Gym owner → SaaS company

V1 does not use a payment gateway.

The owner pays manually through UPI/bank transfer.

Payment is manually verified by the SaaS administrator.

Access/subscription is then enabled or extended.

Do not implement Razorpay for V1 unless this decision is explicitly revisited.

---

### Gym membership payments

Member → Gym owner

The SaaS does not hold or transfer gym membership money.

The gym can configure:

- UPI ID
- UPI QR

Member flow:

1. Member sees amount due.
2. Member pays gym directly.
3. Member clicks "I have paid".
4. System creates a payment claim.
5. Owner/staff receives verification request.
6. Authorized owner/staff confirms the actual amount received.

A payment claim is NOT a confirmed payment.

Partial payments are supported.

Example:

Membership charge: ₹2,000
Confirmed payment: ₹1,200
Outstanding balance: ₹800

The system calculates outstanding balance from confirmed payment records.

Notes are supplementary context and are not the financial source of truth.

Payment and membership renewal are separate operations.

---

## 9. Attendance

Members can use the gym QR to check in.

Attendance should support:

- Check-in
- Duplicate protection
- Attendance history
- Attendance percentage
- Active sessions
- Occupancy
- Check-out where applicable

Live occupancy should be derived from active attendance/session state rather than manually maintained as an unrelated number.

---

## 10. WhatsApp

Long-term production direction:

- Centralized SaaS-controlled WhatsApp sender
- Personalized messages
- Tenant-scoped notification records
- Notification provider abstraction

Messages may include:

- Member name
- Gym name
- Amount
- Membership expiry
- Other relevant information

OpenWA may be used for experimentation/pilot testing but is not the intended production foundation.

Do not use OpenWA for authentication or other security-critical workflows.

Production commercial messaging should use the appropriate official WhatsApp/Meta infrastructure and applicable policies.

---

## 11. V1 Product Scope

### Owner

- Gym profile/settings
- Member management
- Membership plans
- Membership status
- Payment tracking
- Partial payments
- Payment verification
- Attendance
- QR attendance
- Staff
- Roles/permissions
- Dashboard
- Needs Attention
- Announcements
- CSV exports
- Trial/subscription management

### Member

- OTP onboarding
- Home
- Gym check-in
- Attendance history
- Attendance percentage
- Membership status
- Payment status
- Payment claim
- Renewal reminders
- Announcements
- Live occupancy

---

## 12. Later Features

Potential later features include:

- Inactive member detection
- Analytics
- Occupancy history
- Peak-hour analysis
- Attendance streaks
- Badges
- Consistency leaderboard
- Daily challenges
- Goals
- Achievements
- Private progress photos
- Partner offers
- Gym discovery
- Affiliate/commission features
- Optional cloud photo backup

Do not implement these simply because they are listed here.

They require their own requirements and implementation decisions.

---

## 13. Explicit Non-Goals

Do not build the following unless explicitly approved:

- Native mobile apps
- Payment gateway for gym membership payments
- Automatic transfer of gym membership money
- Razorpay integration for V1 SaaS subscriptions
- Microservices
- Full e-commerce platform
- Full social network
- AI-generated workout platform
- Complex AI chatbot
- Premature partner marketplace
- Unnecessary infrastructure
- Large-scale architecture before actual requirements exist

---

## 14. Engineering Rules

When implementing code:

1. Read `AGENTS.md`.
2. Read the relevant feature specification.
3. Read relevant architecture/security documents.
4. Check `docs/20-CURRENT-STATE.md`.
5. Understand existing code before changing it.
6. Do not rewrite unrelated code.
7. Do not introduce dependencies without a reason.
8. Do not change database schema casually.
9. Database changes require migrations.
10. Do not expose secrets.
11. Do not trust client-side authorization.
12. Validate input on the server.
13. Protect tenant boundaries.
14. Handle important business operations atomically where required.
15. Add tests for important business rules.
16. Keep code readable and maintainable.
17. Update documentation when behavior or architecture changes.
18. Update `20-CURRENT-STATE.md` after meaningful feature work.

---

## 15. AI Collaboration Rules

AI is an implementation and reasoning assistant.

AI must not silently make major product or architectural decisions.

For significant changes:

Requirement
→ Analysis
→ Proposed approach
→ Human approval
→ Implementation
→ Tests
→ Review
→ Documentation

If an existing architectural decision conflicts with a proposed implementation, stop and surface the conflict.

Do not silently replace an established decision.

Different AI tools must be able to continue the project using the repository documentation alone.

---

## 16. Current Development Stage

Current stage:

**Project foundation / product definition**

Completed:

- Private GitHub repository
- Initial repository structure
- Project Charter

Current work:

- Establish AI collaboration rules
- Establish engineering rules
- Define product requirements

Not started yet:

- Application implementation
- Database implementation
- Azure infrastructure
- Authentication provider configuration
- Production deployment
- WhatsApp integration
- Payment gateway integration

---

## 17. Source of Truth

Priority of project information:

1. Current approved repository code
2. Approved architecture/decision documents
3. Feature specifications
4. `AI_CONTEXT.md`
5. `AGENTS.md`
6. `20-CURRENT-STATE.md`
7. AI conversation history

If AI conversation history conflicts with repository documentation, do not assume the conversation is correct.

Surface the conflict and follow the repository's current approved state.

---

## 18. Naming

Until branding is finalized:

- Repository identifier: `gym-saas`
- Product name: TBD
- Parent company: TBD
- Domain: TBD

Never invent a permanent brand name.

---

## 19. Important Instruction

Do not build the entire SaaS in one task.

Work on one well-defined feature or engineering task at a time.

Before making a significant change, understand:

- Why it is needed
- Which domain it belongs to
- What data it affects
- What permissions it requires
- What security risks it introduces
- What tests are required
- What documentation must change
