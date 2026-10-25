# AGENTS.md

## 1. Purpose

This file defines the engineering rules and working conventions that every AI coding agent must follow when working on this repository.

The repository is a real SaaS project, not a throwaway prototype.

AI agents must prioritize:

- Correctness
- Security
- Maintainability
- Simplicity
- Testability
- Tenant isolation
- Clear code
- Minimal unnecessary changes

The repository documentation is the persistent source of truth.

---

# 2. Before Doing Any Work

Before modifying code, an AI agent must:

1. Read `AI_CONTEXT.md`.
2. Read the relevant section of `docs/00-PROJECT-CHARTER.md`.
3. Read `docs/20-CURRENT-STATE.md` when it contains relevant information.
4. Read the relevant feature specification under `docs/features/`.
5. Read relevant architecture, database, authorization, and security documents.
6. Inspect the existing implementation before proposing changes.
7. Identify dependencies between the requested change and existing functionality.

Do not immediately start coding based only on the user's last sentence.

First understand the existing project state.

---

# 3. Source of Truth

Use the following priority order:

1. Current approved code
2. Approved architecture/decision documents
3. Feature specifications
4. `AI_CONTEXT.md`
5. `AGENTS.md`
6. `docs/20-CURRENT-STATE.md`
7. Conversation history

If two sources conflict:

- Do not silently choose one.
- Identify the conflict.
- Explain the impact.
- Ask for clarification when the conflict affects architecture, security, data, or business rules.

Do not assume an AI conversation is more authoritative than the repository.

---

# 4. Scope Control

Work on one clearly defined task at a time.

An AI agent must not:

- Build unrelated features.
- Refactor unrelated code.
- Rename unrelated files.
- Change architecture without a reason.
- Replace working libraries merely because another library is preferred.
- Rewrite large portions of the application unnecessarily.
- "Clean up" unrelated code while implementing a feature.

Keep the diff focused.

If a broader change is genuinely required, explain why before making it.

---

# 5. Product Decisions

The following decisions are currently established and must not be casually changed.

## Architecture

- Multi-tenant from day one.
- PostgreSQL is the current database direction.
- PWA-first.
- Backend authorization is authoritative.
- Avoid premature microservices.
- Prefer simple, maintainable architecture.
- Provider-specific infrastructure should be replaceable where practical.

## Identity

- Phone number is not the primary identity key.
- OTP proves control of the phone.
- User identity is represented by the user account.
- Organization membership determines organizational access.

## Authorization

The frontend is never the final security boundary.

Backend operations must verify appropriate:

- Authentication
- Organization membership
- Role/permission
- Tenant scope
- Resource ownership

## Payments

- SaaS subscription payment is manual in V1.
- Do not add Razorpay to V1 unless explicitly approved.
- Gym membership payments are between the member and gym.
- The SaaS does not hold gym membership money.
- A member payment claim is not a confirmed payment.
- Partial payments are supported.
- Confirmed payments must be represented as actual payment records.
- Outstanding balances are system-calculated.
- Payment and membership renewal are separate operations.

## WhatsApp

- Production direction is a centralized SaaS-controlled sender.
- Notification records must remain tenant-scoped.
- WhatsApp is not the authentication foundation.
- OpenWA is not the intended production foundation.
- Provider-specific implementation must not leak unnecessarily throughout the application.

---

# 6. Security Rules

Security must be considered for every backend feature.

For every protected operation, consider:

- Who is authenticated?
- Which organization are they acting within?
- What role/permission do they have?
- Which resource are they accessing?
- Does that resource belong to the organization?
- Can a user manipulate an ID to access another tenant's data?
- Can the operation be replayed?
- Can concurrent requests create inconsistent state?
- Is sensitive information exposed?
- Is rate limiting required?
- Is an audit record required?

Never rely on:

- Hidden UI elements
- Disabled buttons
- Client-side role checks
- Client-provided organization IDs
- Client-provided ownership claims

as the sole security mechanism.

---

# 7. Multi-Tenancy

Tenant isolation is mandatory.

A user belonging to Organization A must never be able to access Organization B's data unless explicitly authorized by the application's membership model.

Every tenant-owned query and mutation must correctly enforce organization scope.

Do not assume that passing `organizationId` from the client is sufficient authorization.

The server must determine or verify the organization context.

Be especially careful with:

- Member IDs
- Membership IDs
- Payment IDs
- Attendance IDs
- Staff IDs
- Announcement IDs
- Notification IDs
- Export requests
- File/object references

Never trust an identifier simply because it exists.

---

# 8. Authentication

Authentication and authorization are separate concerns.

Authentication establishes:

> Who is this user?

Authorization establishes:

> What may this user do in this organization?

Do not implement authorization by assuming that successful authentication grants access to all application resources.

OTP-based flows must consider:

- Expiration
- Attempt limits
- Resend cooldowns
- Rate limiting
- Abuse prevention
- Generic responses where enumeration could occur

Do not log OTP values, authentication secrets, or sensitive tokens.

---

# 9. Database Rules

Database changes must be deliberate.

When modifying the schema:

1. Understand existing relationships.
2. Consider existing production data.
3. Define the migration.
4. Consider constraints and indexes.
5. Consider tenant isolation.
6. Consider nullability and defaults.
7. Consider rollback/recovery implications.
8. Update relevant documentation.
9. Add or update tests where appropriate.

Never manually modify production database structure as a substitute for a proper migration.

Do not delete or rename data structures casually.

Do not introduce duplicate sources of truth for important business state.

---

# 10. Data Integrity

Important business state must have a clear source of truth.

For example:

Payment status must not be determined solely from a text note.

Outstanding balance must be calculated from the charge and confirmed payment records.

A payment claim must not automatically become a confirmed payment.

Important state transitions should be protected against:

- Duplicate requests
- Race conditions
- Partial failures
- Invalid transitions

Use appropriate database transactions or other consistency mechanisms when required.

---

# 11. API and Backend Rules

Backend endpoints/services must:

- Validate input.
- Authenticate requests.
- Authorize requests.
- Enforce tenant scope.
- Return appropriate errors.
- Avoid leaking sensitive information.
- Avoid trusting client-calculated business state.

Do not put important business rules only in frontend code.

Business rules should live in an appropriate backend/domain layer.

---

# 12. Frontend Rules

Frontend code should:

- Provide good user experience.
- Validate obvious input for usability.
- Handle loading states.
- Handle error states.
- Avoid exposing sensitive information.
- Never be treated as the authorization boundary.

Do not duplicate complex business logic unnecessarily between frontend and backend.

The backend remains authoritative.

---


## 12.1 Locked UI design system — non-negotiable

Gym SaaS has an approved visual direction. Do not redesign or change it when adding product features, new routes, forms, dashboards, empty states, modals, settings, member pages, or onboarding steps. Before any UI change, read `docs/ui-design-system.md`, `docs/reference-ui-spec.md`, and the relevant existing CSS modules/components.

Required shared visual language:
- Near-black canvas (`#050505`), near-black panels (`#0B0B0B`), quiet 1px dark borders (`#262626`), white headings (`#F5F5F5`), muted gray supporting text (`#A4A4A4`), and lime accent (`#B8F175`).
- Primary actions use lime with dark text; secondary actions use charcoal/transparent surfaces and subtle borders.
- Reuse the established rounded-pill navigation, white active workspace tab, restrained metric panels, compact status pills, typography, spacing, radius, and focus treatment. Preserve responsive behavior and reduced-motion support.
- Marketing pages may use the already-established white rounded navbar. Authenticated application screens use the dark workspace visual system. Do not turn member/owner experiences into separate unrelated brands.
- Gym imagery is illustrative context for a multi-tenant software platform; never imply Gym SaaS is a single gym or that depicted people/facilities are customers, employees, or owned locations.
- New screens must reuse existing components and tokens where practical. Extend the existing system; do not introduce another palette, a new design language, random gradients, or ad-hoc component styling.
- Keep product logic changes separate from styling whenever possible. If a requested feature appears to require changing the locked visual direction, stop and request approval before doing so.
- Preserve the design system for loading, success, validation errors, empty states, access-denied screens, and expired-session flows too.

# 13. Code Quality

Prefer:

- Clear names
- Small focused functions
- Explicit behavior
- Strong typing
- Simple control flow
- Reusable logic where repetition is meaningful
- Domain-oriented organization
- Clear error handling

Avoid:

- Clever code
- Deep unnecessary abstractions
- Giant functions
- Giant files
- Copy-pasted business logic
- Magic values
- Hidden side effects
- Premature optimization
- Premature generalization

Code should be understandable by another engineer who did not write it.

---

# 14. Abstraction Rules

Do not create an abstraction merely because something could theoretically be replaced someday.

Create an abstraction when:

- There is a real boundary.
- Multiple implementations are actually required.
- The abstraction protects an important architectural boundary.
- It materially improves testing or maintainability.

Known areas where provider boundaries may be useful include:

- Authentication
- Notifications/WhatsApp
- Infrastructure integrations

Do not create unnecessary interfaces for every class or function.

---

# 15. Dependencies

Before adding a dependency:

1. Determine whether the functionality can reasonably be implemented with existing tools.
2. Check whether the dependency is actually required.
3. Consider maintenance and security.
4. Consider bundle/runtime impact where applicable.
5. Consider licensing.
6. Explain why the dependency is being introduced.

Do not add libraries simply because an AI agent prefers them.

---

# 16. Secrets and Configuration

Never commit:

- API keys
- Database passwords
- OAuth secrets
- Authentication secrets
- WhatsApp credentials
- Cloud credentials
- Private tokens
- Production environment variables
- `.env` files containing secrets

Use environment variables and appropriate secret-management mechanisms.

Keep `.env.example` free of real secrets.

If a secret is accidentally exposed, treat it as compromised and recommend rotation.

---

# 17. Testing

Important business rules must have automated tests.

Prioritize tests around:

- Authentication
- Authorization
- Tenant isolation
- Membership rules
- Payment calculations
- Partial payments
- Payment confirmation
- Attendance
- Role permissions
- Important state transitions

Do not claim a feature is complete merely because the application starts.

Before declaring a task complete, run the project's applicable:

- Tests
- Type checks
- Lint checks
- Build checks

Report failures honestly.

Never hide or ignore a failing test simply to make the task appear complete.

---

# 18. Error Handling

Errors should be:

- Meaningful
- Safe
- Actionable where appropriate

Do not expose:

- Stack traces to end users
- Database internals
- Secrets
- Internal infrastructure details
- Sensitive tenant information

Do not use broad silent error swallowing.

If an error is intentionally handled, the behavior should be explicit.

---

# 19. Logging and Observability

Logs must help diagnose production problems without exposing sensitive data.

Do not log:

- Passwords
- OTPs
- Authentication tokens
- API secrets
- Full sensitive payment information
- Unnecessary personal data

Important business events may require structured logging and/or audit records.

---

# 20. Payment-Specific Rules

Payment-related code requires extra care.

Never:

- Treat a member's "I have paid" claim as confirmed payment.
- Calculate outstanding balance from notes.
- Automatically modify confirmed payment history without an audit trail.
- Let unauthorized roles confirm payments.
- Trust an amount supplied by an untrusted client without server validation.
- Automatically renew a membership merely because a payment claim exists.

Payment records should preserve financial history.

If a correction mechanism is later required, prefer explicit reversal/adjustment records rather than silently destroying historical records.

---

# 21. AI Implementation Workflow

For a meaningful feature, follow this process:

1. Understand the requirement.
2. Read relevant documentation.
3. Identify affected domains.
4. Identify security implications.
5. Identify database impact.
6. Propose an implementation plan.
7. Get human approval when the change is architectural or security-sensitive.
8. Implement the smallest appropriate change.
9. Write/update tests.
10. Run validation.
11. Review the diff.
12. Update documentation.
13. Update `docs/20-CURRENT-STATE.md` when appropriate.

Do not skip directly from requirement to large-scale code generation.

---

# 22. Human Approval Required

Ask for explicit human approval before:

- Changing core architecture
- Changing the database technology
- Changing authentication strategy
- Changing authorization model
- Changing tenant isolation strategy
- Changing payment architecture
- Adding a payment gateway
- Changing production infrastructure
- Adding major third-party services
- Introducing microservices
- Making security-sensitive changes
- Removing important security controls
- Performing destructive database operations

---

# 23. Git Rules

Keep commits focused.

Prefer commits such as:

```text
feat: add organization membership model
feat: add owner onboarding flow
fix: prevent cross-tenant member access
test: add payment balance coverage
docs: update authorization model
refactor: simplify attendance service

Avoid vague commits such as:

update
changes
stuff
fix
ai changes

Do not rewrite Git history unless explicitly requested.

24. Pull Requests

A meaningful change should explain:

What changed
Why it changed
What was tested
Security considerations
Database/migration changes
Any known limitations

Keep pull requests focused.

Do not bundle unrelated features into one pull request.

25. Documentation Rules

If implementation changes an established behavior or architecture:

Update the relevant documentation.

Examples:

Architecture change → 03-SYSTEM-ARCHITECTURE.md
Database change → 04-DATABASE-DESIGN.md
Authorization change → 05-AUTHORIZATION.md
Security behavior → 06-SECURITY.md
API behavior → 07-API-SPECIFICATION.md
Product behavior → 01-PRODUCT-REQUIREMENTS.md
Major decision → docs/decisions/
Current implementation state → 20-CURRENT-STATE.md

Documentation should describe the actual implementation, not an imagined future state.

26. Current State

Before starting significant work, check:

docs/20-CURRENT-STATE.md

After completing a meaningful feature or architectural change, update it.

The current-state document should make it possible for another developer or AI agent to understand:

What is completed
What is in progress
What is next
Known issues
Recent decisions
Important implementation details
27. When Requirements Are Ambiguous

Do not invent important business rules.

If ambiguity affects:

Money
Authorization
Security
Data ownership
Tenant isolation
User identity
Membership state
Payment state
Production infrastructure

stop and ask for clarification.

For low-risk implementation details, choose the simplest reasonable approach and document the assumption if necessary.

28. No Whole-SaaS Generation

Never attempt to generate the entire SaaS application in one task.

Work incrementally.

A feature should be small enough that:

Its requirements are understood.
Its security implications can be reviewed.
Its tests can be written.
Its diff can be reviewed.
Its documentation can be updated.
29. AI Tool Independence

The project must not depend on any single AI tool.

Any coding AI should be able to continue work by reading the repository.

Do not store important architectural decisions only in:

ChatGPT conversations
Cursor conversations
Copilot conversations
Claude conversations
Temporary AI context

Persist important decisions in the repository.

30. Final Rule

When uncertain, prefer:

clarity over cleverness,

security over convenience,

correctness over speed,

small changes over large rewrites,

documented decisions over assumptions,

and

human approval over silent architectural changes.

### After pasting

Commit it as:

```text
docs: define AI engineering rules

Then we will have:

AI_CONTEXT.md
        ↓
"What is this project?"

AGENTS.md
        ↓
"How must an AI work on it?"

00-PROJECT-CHARTER.md
        ↓
"Why are we building it and what is the product?"
