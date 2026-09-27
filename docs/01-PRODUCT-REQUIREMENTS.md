# 01 — PRODUCT REQUIREMENTS

**Project:** `gym-saas`  
**Product Brand:** TBD  
**Parent Company:** TBD  
**Document Version:** 0.1  
**Status:** Product definition  
**Scope:** V1 + planned future direction

---

# 1. Purpose

This document defines the functional requirements and product behavior for the gym SaaS platform.

It translates the Project Charter into concrete product requirements.

This document describes:

- Who uses the system
- What users can do
- Core business rules
- V1 scope
- Future scope
- Important product constraints
- Acceptance expectations

This document does not define the detailed database schema, API implementation, infrastructure, or UI design.

Those will be defined in later documents.

---

# 2. Product Users

The system has two primary user groups.

## 2.1 Gym-side users

### OWNER

The primary customer and highest-level organization role.

The owner can:

- Configure the gym
- Manage members
- Manage memberships
- Manage payments
- Manage attendance
- Manage staff
- Manage roles/permissions
- Configure gym payment information
- View operational information
- Manage announcements
- Manage product settings
- View reports/exports
- Manage gym subscription/trial state where applicable

---

### ADMIN

An organization-level operational role.

The exact permissions will be defined in the authorization design.

An admin may perform many owner-like operational tasks but does not automatically have every owner capability.

---

### STAFF

A gym operational user.

Staff capabilities will depend on assigned permissions.

Typical responsibilities may include:

- Member operations
- Attendance operations
- Payment verification
- Membership operations

Staff must not receive unrestricted owner access by default.

---

### TRAINER

A gym operational user whose permissions are intentionally narrower.

Trainer capabilities will be defined through the permission model.

Trainer must not automatically receive access to financial or administrative operations.

---

## 2.2 MEMBER

The member is the primary end user of the member-facing experience.

Members can:

- Authenticate
- Access their gym
- Check in
- View attendance
- View membership
- View payment status
- Submit payment claims
- View announcements
- View occupancy
- Use future engagement features

---

# 3. Multi-Tenant Requirements

The system must support multiple independent gyms.

Each gym is an independent organization/tenant.

### Requirement

A user must only access data belonging to organizations in which the user has appropriate membership and authorization.

### Example

If a user belongs to:

```text
Gym A
Gym B

the user may access both organizations according to their respective memberships and permissions.

A request associated with Gym A must never accidentally return Gym B data.

Tenant isolation is a mandatory product and security requirement.

4. User Identity

The system must maintain a distinct user identity.

Phone number must not be used as the primary identity key.

A user may potentially belong to multiple gyms.

Therefore:

One User
    ↓
Multiple Organization Memberships
    ↓
Multiple Gyms

This allows the same person to have one identity while maintaining separate relationships with different gyms.

5. Owner Onboarding
5.1 Owner registration

The owner begins registration using a phone number.

The system sends an OTP.

The owner verifies the OTP.

After successful verification:

A user account can be established.
The owner provides minimal gym information.
A gym organization is created.
The creator becomes the initial OWNER.
5.2 Initial gym information

The initial onboarding should collect only information necessary to operate the gym.

Potential information includes:

Gym name
Phone/contact information
Location/address where required
Basic operating information
Payment/UPI configuration where required

The exact fields will be finalized during detailed UX and data design.

6. Owner Trial

The initial product uses a:

7-day free trial

The trial is a product entitlement.

It must not be treated as a technical limitation of the database.

An initial member limit may be applied during the trial.

The exact initial limit may be configurable.

6.1 Trial eligibility

The system should prevent trivial repeated trial abuse.

The initial direction is:

One introductory trial per verified owner account.

Trial eligibility should be treated separately from organization creation.

6.2 Trial expiration

When a trial expires:

Organization data must not automatically be deleted.
Members must not be automatically deleted.
Attendance history must not be automatically deleted.
Payment records must not be automatically deleted.

The organization's subscription/entitlement state changes.

The exact post-expiration access behavior will be defined in subscription/authorization requirements.

7. Owner Organization Management

The owner must be able to manage the gym's basic information.

This includes:

Gym name
Contact information
Gym profile
Gym payment configuration
QR-related configuration
Operational settings
Relevant notification settings

Organization settings must only be accessible to authorized users.

8. Staff Management

The owner/authorized administrator must be able to:

Add staff
Assign roles
Change roles where permitted
Remove/deactivate staff access
Manage permissions according to the authorization model

Staff members should use their own accounts.

Shared credentials are not supported.

9. Member Management

The owner/authorized staff must be able to:

Add a member
Edit member information
Search members
Filter members
View member details
View membership status
View payment status
View attendance information
Deactivate/handle inactive members where supported
9.1 Member creation

The owner can initially create a member using basic information such as:

Name
Phone number
Membership information

The member does not need a separate manually-created username/password.

9.2 Member phone number

The phone number is used for member discovery and authentication.

The system must not treat the phone number as the permanent identity key.

The product must have a recovery/update workflow for cases such as:

Incorrect phone number
Outdated phone number
Lost access to old phone number
10. Member Onboarding

The member onboarding flow is:

Permanent Gym QR
        ↓
Gym identified
        ↓
Member enters phone number
        ↓
Backend checks gym association
        ↓
OTP sent
        ↓
OTP verified
        ↓
User authenticated
        ↓
Organization membership established/linked
        ↓
Member receives authorized access
10.1 QR requirements

The permanent gym QR:

Identifies the gym.
Does not authenticate the member.
Must not by itself grant access to member data.

A QR code must never be treated as proof of member identity.

10.2 OTP requirements

OTP authentication should include:

Short expiration
Verification attempt limits
Resend cooldown
Rate limiting
Abuse protection
Appropriate request throttling

The system should avoid revealing whether a phone number is registered where doing so could enable membership enumeration.

11. Membership Management

The system must support gym membership records.

A membership should allow the gym to track relevant information such as:

Member
Plan
Start date
End date
Status
Amount/charge
Renewal state

Membership status should be represented as structured application state rather than relying only on free-text notes.

12. Membership Plans

The owner should be able to define membership plans.

Potential plan information includes:

Name
Duration
Price
Description
Active/inactive state

The exact plan model will be defined during database design.

13. Membership Charges

A membership charge represents the amount the member owes for a membership-related financial obligation.

The charge must be separate from individual payment transactions.

Example:

Membership Charge
₹2,000

This does not necessarily mean ₹2,000 has already been received.

14. Payment Model

There are two separate payment relationships in the system.

14.1 Gym owner → SaaS

The gym owner pays the SaaS subscription.

For V1:

No payment gateway integration.
Owner pays manually using UPI/bank transfer.
SaaS administrator verifies payment manually.
SaaS access/subscription is manually enabled or extended.

Razorpay is not part of V1.

14.2 Member → Gym

The member pays the gym directly.

The SaaS does not hold or transfer this money.

The gym may configure:

UPI ID
UPI QR
15. Member Payment Flow

The member should be able to see relevant payment information.

Where payment is due:

Amount due
    ↓
Gym UPI / QR
    ↓
Member pays gym
    ↓
Member selects "I have paid"
    ↓
Payment claim created
    ↓
Owner/staff receives verification request
    ↓
Owner/staff verifies actual payment
    ↓
Confirmed payment recorded

A payment claim is not a confirmed payment.

16. Partial Payments

The system must support partial payments.

Example:

Membership charge       ₹2,000
Payment 1               ₹1,200
Outstanding               ₹800

The member may later make another payment:

Payment 1               ₹1,200
Payment 2                 ₹800
Total confirmed         ₹2,000
Outstanding                 ₹0

Multiple confirmed payment transactions may be associated with one charge.

17. Payment Verification

Authorized owner/staff users must be able to verify payment claims.

During verification, the authorized user should be able to record:

Actual amount received
Payment method
Optional reference/transaction ID
Notes where useful
Verification information

The system must record who confirmed the payment and when.

18. Payment Status

The system should be capable of representing payment state such as:

UNPAID
PARTIALLY_PAID
PAID
OVERPAID

The exact state model will be finalized during database and domain design.

19. Outstanding Balance

Outstanding balance must be calculated from financial records.

Conceptually:

Outstanding Balance
=
Charge Amount
-
Sum of Confirmed Payments

Example:

Charge:                  ₹2,000
Confirmed payments:     ₹1,200
Outstanding:               ₹800

Notes must not be the source of truth for outstanding balances.

20. Payment Corrections

Confirmed payment history should not be silently destroyed or overwritten.

If payment correction is required in the future, the preferred direction is to use explicit:

Reversal
Adjustment
Correction

records.

This preserves financial history and auditability.

21. Membership Renewal

Payment and membership renewal are separate operations.

A payment claim must not automatically renew membership.

Even confirmed payment should not automatically imply renewal unless an explicitly defined renewal rule applies.

The owner may eventually have an explicit action such as:

Confirm Payment

or:

Confirm Payment & Renew

The exact renewal workflow will be defined separately.

22. Attendance

Attendance is a core V1 capability.

The system must support gym check-in.

The intended flow is:

Member
   ↓
Gym QR
   ↓
Gym identified
   ↓
Authenticated member
   ↓
Authorization check
   ↓
Attendance recorded
22.1 Attendance requirements

The system should support:

Check-in
Duplicate check-in protection
Attendance history
Attendance percentage
Active session state
Live occupancy
Check-out where applicable
23. Live Occupancy

The system should be capable of showing the approximate number of members currently inside the gym based on active attendance/session state.

Occupancy should be derived from attendance/session information.

It should not rely on a manually maintained independent number.

24. Owner Dashboard

The owner dashboard should act as an operational command center.

It should surface useful information such as:

Total members
Active members
Today's attendance
Current occupancy
Expiring memberships
Outstanding payments
Payment verification requests
Recent activity
Needs Attention items

The exact dashboard layout will be defined during UX/design work.

25. Needs Attention

The system should surface operational items that require owner/staff action.

Examples include:

Payment claims awaiting verification
Memberships nearing expiry
Outstanding payments
Inactive members
Other important operational events

The initial V1 implementation should focus on high-value actionable items rather than attempting to create a complex notification center.

26. Announcements

Authorized gym users should be able to create gym announcements.

Announcements may be visible to members.

Potential examples:

Holiday closure
Gym timing changes
Maintenance
Gym events
Important notices

The announcement system must be tenant-scoped.

27. Member Home

The member home experience should provide a concise overview.

Potential V1 information:

Greeting
Membership status
Membership days remaining
Attendance
Attendance percentage
Payment status
Check-in action
Live occupancy
Announcements

Future engagement elements may include:

Streak
Daily challenge
Achievement
Consistency score

These should not unnecessarily complicate V1.

28. Member Attendance History

Members should be able to view their attendance history.

The system should support:

Date-based records
Attendance totals
Attendance percentage

Future versions may add:

Streaks
Consistency analysis
Goals
Achievements
29. Member Payment Status

Members should be able to understand:

Amount due
Confirmed amount paid
Outstanding amount
Payment verification state

A pending payment claim should clearly be shown as pending rather than confirmed.

30. Notifications

The product should support a notification system.

Initial notification channels may include:

In-app notifications
WhatsApp notifications

Potential notification events include:

Membership expiry
Payment due
Payment verification
Welcome
Announcements
Other operational reminders

Notification delivery architecture will be defined separately.

31. WhatsApp Notifications

The intended production direction is a centralized SaaS-controlled WhatsApp sender.

Messages should remain personalized for each member and gym.

Example:

Hi Rahul,

Your membership at ABC Fitness expires in 3 days.

Amount due: ₹2,000

The system should maintain tenant-scoped notification records.

Owner controls should eventually allow gyms to choose which reminder types are enabled.

32. Notification Automation

The longer-term notification architecture may support:

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

Potential automated reminders:

7 days before expiry
3 days before expiry
Expiry day
Overdue payment
Inactive member
Welcome
Announcements

Exact rules, templates, opt-in behavior, and provider requirements will be defined later.

33. CSV Exports

Authorized owner/staff users should be able to export appropriate operational data.

Potential exports include:

Members
Attendance
Payments
Membership information

Exports must respect:

Tenant isolation
User permissions
Data privacy
Appropriate access controls
34. Member Engagement — Future

The product may later introduce engagement features.

Potential features:

Attendance streak
Badges
Consistency leaderboard
Daily challenges
Goals
Achievements

These are not required for the initial operational V1.

35. Consistency Leaderboard — Future

If implemented, the leaderboard should emphasize consistency rather than simply rewarding members with the largest historical attendance count.

Possible factors may include:

Attendance frequency
Recent consistency
Streak
Goal completion

The exact scoring model must be defined before implementation.

Members should eventually have appropriate privacy/opt-out controls.

36. Daily Challenges — Future

Challenges should initially be simple and curated.

The gym may eventually select challenges from a challenge library.

AI-generated challenges are not required for V1.

37. Progress Photos — Future

Progress photos may eventually be supported.

The preferred initial direction is local-first storage where practical.

Photos should not automatically be uploaded to cloud storage without an explicit product requirement.

Optional cloud backup may be considered later.

38. Future Partner Ecosystem

Potential future features include:

Partner offers
Supplement partnerships
Discounts
Gym discovery
Affiliate/commission relationships

These are outside V1.

39. Subscription and Entitlements

Subscription state must be separate from organization identity.

The system should eventually support a model conceptually similar to:

Subscription
    ↓
Plan
    ↓
Entitlements
    ↓
Feature/action access

Avoid scattering conditions such as:

if trial

throughout the application.

Product access should be determined through a consistent entitlement model.

40. Data Retention

Subscription expiration must not automatically destroy organization data.

Data such as:

Members
Memberships
Attendance
Payments
Announcements

should remain subject to the application's retention policy.

Deletion and archival policies will be defined separately.

41. Security Requirements

Security requirements are part of the product requirements.

The product must protect against:

Cross-tenant access
Unauthorized role actions
Membership enumeration
OTP abuse
Duplicate operations
Invalid payment state changes
Unauthorized payment confirmation
Unauthorized access to exports
Sensitive data exposure

Detailed security requirements will be defined in:

docs/06-SECURITY.md

Authorization requirements will be defined in:

docs/05-AUTHORIZATION.md

42. V1 Priority Classification
MUST HAVE — V1
Owner
Owner signup
OTP authentication
Gym creation
7-day trial
Gym profile/settings
Member management
Membership management
Payment tracking
Partial payments
Payment claims
Payment verification
Attendance
QR attendance
Staff management
Roles/permissions
Dashboard
Needs Attention
Announcements
CSV exports
Member
OTP onboarding
Gym identification through QR
Secure access
Home
Check-in
Attendance history
Attendance percentage
Membership status
Payment status
Payment claim
Announcements
Live occupancy
43. SHOULD HAVE — V1 / V1.5

Potential features:

Inactive member detection
Membership expiry reminders
Better operational analytics
Occupancy history
Peak-hour analysis
Improved reminder controls
More detailed reports
44. FUTURE

Potential features:

Attendance streaks
Badges
Consistency leaderboard
Daily challenges
Goals
Achievement system
Progress photos
Partner offers
Gym discovery
Affiliate systems
Supplement partnerships
Optional cloud photo backup
Advanced campaigns
Advanced analytics
45. OUT OF SCOPE FOR INITIAL V1

The following are intentionally excluded:

Native mobile applications
Gym membership payment gateway
SaaS payment gateway
Razorpay integration
SaaS holding gym membership funds
Full e-commerce platform
Full social network
AI workout platform
AI chatbot as a core product
Microservices
Large-scale infrastructure before actual need
Complex marketplace
Cloud photo storage by default
46. Product Success Criteria

The first meaningful product milestone is:

A real local gym can use the platform for its core daily operations without requiring the founder to manually operate the software.

V1 should allow a gym to:

Create its organization.
Configure basic gym information.
Add members.
Manage memberships.
Track membership charges.
Receive payment claims.
Verify partial/full payments.
Calculate outstanding balances.
Track attendance.
Use QR check-in.
Manage staff permissions.
Communicate announcements.
Give members secure access.
Allow members to view their relevant information.
Maintain tenant isolation.
Produce useful operational exports.
47. Product Quality Requirements

The product should be:

Simple

Gym owners and staff should not require technical knowledge.

Reliable

Core operational data must be trustworthy.

Secure

Users must only access authorized information.

Fast

Common daily workflows should require minimal interaction.

Mobile-friendly

Members should be able to use the product comfortably from a phone.

Maintainable

The implementation should remain understandable as features grow.

48. Requirements Evolution

This document will evolve as the product is validated with real gyms.

New requirements should not be inserted casually.

A significant requirement change should:

Identify the reason for the change.
Determine affected workflows.
Determine architectural/data impact.
Determine security impact.
Update this document.
Update relevant user-flow/architecture documents.
Record significant decisions in docs/decisions/.

The product should evolve based on real customer needs rather than uncontrolled feature accumulation.

49. Current Status

Status:

Product requirements — initial V1 definition

Next documents:

02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
04-DATABASE-DESIGN.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md

No production application implementation should begin until the required architecture and security decisions have been documented sufficiently for the feature being implemented.
