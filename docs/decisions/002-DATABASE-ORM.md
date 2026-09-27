# ADR 002 — Database ORM

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Data / Architecture

---

# 1. Context

gym-saas requires a relational database for core business data.

The current database decision is:

> PostgreSQL

The application contains strongly related entities including:

- Users
- Organizations
- Organization memberships
- Roles
- Members
- Membership plans
- Memberships
- Charges
- Payments
- Payment claims
- Attendance
- Attendance sessions
- Announcements
- Notifications
- Subscriptions
- Entitlements
- Audit information

The application therefore needs an ORM or database-access layer that supports:

- PostgreSQL
- TypeScript
- Strong typing
- Relationships
- Transactions
- Migrations
- Constraints
- Indexes
- Maintainable queries
- Testing
- Clear database ownership

Two leading candidates are:

- Prisma
- Drizzle ORM

---

# 2. Requirements

The database access layer should provide:

- Strong TypeScript integration
- PostgreSQL support
- Explicit schema management
- Database migrations
- Transactions
- Relational queries
- Good developer experience
- Testability
- Predictable production behavior
- Reasonable performance
- Maintainability for a small engineering team
- Ability to write SQL when necessary
- Minimal unnecessary abstraction

The ORM must not hide important database behavior.

---

# 3. Database as Source of Truth

PostgreSQL is the source of truth for persistent application data.

The ORM is an application-layer tool.

Conceptually:

```text
Application
     ↓
ORM / Database Access Layer
     ↓
PostgreSQL
The ORM must not become a replacement for understanding the underlying relational model.

Database constraints remain important even when application-level validation exists.

4. Important Database Requirements

The selected solution must support deliberate handling of:

Tenant Isolation

Queries must always respect organization boundaries.

Organization
    ↓
Tenant-Owned Resource

Tenant isolation cannot depend only on frontend filtering.

Constraints

Important business invariants should be enforced at the database level where appropriate.

Examples include:

Required relationships
Unique constraints
Foreign keys
Valid references
Appropriate nullability
Duplicate prevention
Indexes

Indexes should be created based on actual access patterns.

Likely important query dimensions include:

organization ID
user ID
phone-related lookup
member ID
membership status
payment status
attendance dates
active attendance sessions
notification status

Indexes should not be created blindly.

5. Transactions

The database layer must support transactions for operations where multiple writes must succeed or fail together.

Examples:

Owner onboarding
Create User
    ↓
Create Organization
    ↓
Create Organization Membership
    ↓
Create Subscription

If the operation requires atomicity, the relevant changes should occur within an appropriate transaction.

Payment confirmation
Validate Claim
    ↓
Confirm Payment
    ↓
Update Relevant State
    ↓
Create Audit Information

The exact transaction boundary should be determined during implementation.

Attendance

Attendance operations must protect against duplicate or conflicting writes where required.

6. Migration Requirements

Database schema changes must use version-controlled migrations.

Preferred workflow:

Schema Change
      ↓
Migration
      ↓
Review
      ↓
Test
      ↓
Apply

Do not rely on manually editing production tables.

Destructive migrations require additional review.

7. Prisma
Strengths

Potential advantages:

Mature TypeScript developer experience
Strong generated types
Familiar schema-driven workflow
Good relational modeling
Transaction support
Migration tooling
Large ecosystem
Widely used in TypeScript applications
Considerations

Potential concerns:

Generated client abstraction
Prisma-specific schema layer
ORM abstraction may hide some SQL details
Need to understand generated query behavior
Additional tooling/build considerations
8. Drizzle ORM
Strengths

Potential advantages:

TypeScript-first approach
SQL-oriented design
Relatively thin abstraction
Strong type inference
Explicit query construction
PostgreSQL support
Ability to remain close to SQL
Considerations

Potential concerns:

Different developer experience from Prisma
Query patterns may require more database knowledge
Some abstractions and workflows may be less familiar to developers accustomed to traditional ORMs
Team familiarity matters
9. Decision Criteria

The selection should be based on:

Criterion	Importance
PostgreSQL support	High
TypeScript integration	High
Migrations	High
Transactions	High
Relational modeling	High
Query clarity	High
Database transparency	High
Testing	High
Maintainability	High
Developer experience	High
Performance	Medium
Ecosystem	Medium
Learning value	Medium

The project should prioritize correctness and maintainability over choosing a tool because it is currently popular.

10. Application Architecture

The application should avoid spreading ORM-specific implementation details throughout unrelated business logic.

Prefer a structure where domain/application code can clearly express business operations while database access remains understandable.

Conceptually:

Route / Server Action
        ↓
Application / Domain Logic
        ↓
Database Access
        ↓
ORM
        ↓
PostgreSQL

The exact folder structure will be defined during implementation.

11. Repository Independence

The application should not create unnecessary abstractions solely to make ORM replacement possible.

For example, avoid creating a large generic repository framework such as:

GenericRepository<T>

unless a real problem requires it.

The goal is:

Keep the database boundary clear without creating an abstraction layer that provides no current value.

12. SQL Escape Hatch

The selected ORM must allow direct SQL or SQL-like database operations when required.

Some queries may benefit from explicit SQL because of:

complex reporting
aggregation
performance-sensitive queries
PostgreSQL-specific functionality
advanced indexing
locking
concurrency control

Using SQL where appropriate is not considered an architectural failure.

13. Payment Data Requirements

The database layer must correctly represent payment state.

The system must not use free-form notes as the source of truth for payment status.

Payment state should be derived from structured records.

Conceptually:

Charge
   +
Confirmed Payments
   ↓
Outstanding Balance

Payment claims and confirmed payments must remain distinguishable.

14. Concurrency

Database operations involving shared state must consider concurrent requests.

Important examples:

Two payment confirmations
Duplicate attendance requests
Concurrent membership updates
Simultaneous balance updates
Notification state transitions

The database layer must provide appropriate transaction and consistency mechanisms.

Do not assume that frontend controls prevent race conditions.

15. Testing

Database-related tests should verify:

Migrations
Relationships
Constraints
Tenant isolation
Authorization-related query boundaries
Payment calculations
Partial payments
Duplicate prevention
Important transactions
State transitions

Tests should use a controlled test database/environment where appropriate.

16. Development Database

Development should use a local or dedicated development PostgreSQL database.

Production data must never be used casually for local development.

Seed data should be clearly separated from production data.

17. Production Database

The production database provider remains a separate infrastructure decision.

The ORM decision does not determine the hosting provider.

Conceptually:

ORM
 ↓
PostgreSQL
 ↓
Chosen Hosting Provider

The application should avoid unnecessary provider-specific database assumptions.

18. Decision
Current Status

ORM selection remains open.

The two primary candidates are:

Prisma
Drizzle ORM

No production implementation should assume one of these is permanently selected until the decision is approved.

19. Preliminary Direction

For the current project, the preferred evaluation direction is:

Compare Prisma and Drizzle using the actual gym-saas schema and access patterns.

The final decision should be based on the project's needs rather than generic popularity.

A small proof-of-concept should be sufficient.

The proof-of-concept should model a small portion of the real domain:

User
Organization
OrganizationMembership
Member
Membership
Payment
Attendance

It should test:

schema definition
migrations
relationships
transactions
tenant-scoped queries
TypeScript typing
representative joins
aggregation
testing workflow
20. Consequences
If Prisma Is Selected

Potential benefits:

Strong developer experience
Mature ecosystem
Straightforward relational modeling
Strong generated types

Potential trade-offs:

More ORM abstraction
Prisma-specific schema/client workflow
If Drizzle Is Selected

Potential benefits:

SQL-oriented development
Thin abstraction
Strong TypeScript integration
More direct visibility into queries

Potential trade-offs:

Requires comfort with SQL/database concepts
Different workflow and ecosystem from Prisma
21. What This Decision Does Not Decide

This ADR does not decide:

PostgreSQL hosting provider
Production hosting
Authentication provider
API framework
Caching
Background job infrastructure
File storage
WhatsApp provider
Infrastructure-as-code

Those remain separate decisions.

22. Approval

Decision Owner: Project Owner

Status: Proposed

Approved: No

Selected ORM: TBD

Approval Date: N/A
