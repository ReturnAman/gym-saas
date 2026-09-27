# PWA Architecture

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** PWA Definition  
**Scope:** V1 and planned evolution

---

# 1. Purpose

This document defines the Progressive Web App architecture and frontend behavior for gym-saas.

The initial product will use a web-first, mobile-first approach rather than separate native iOS and Android applications.

The PWA should provide:

- mobile-friendly access
- installability
- responsive layouts
- fast navigation
- reliable authentication
- secure access to private tenant data
- appropriate offline behavior
- QR-based gym entry
- owner and member experiences

This document does not define detailed visual design.

Visual design belongs in the `design/` directory and the relevant product/design specifications.

---

# 2. PWA Principles

The PWA should prioritize:

1. Mobile usability
2. Security
3. Fast perceived performance
4. Reliable navigation
5. Simple installation
6. Appropriate offline behavior
7. Tenant isolation
8. Minimal client-side complexity
9. Clear loading and error states
10. Accessibility

---

# 3. PWA Technology

The application will use:

- Next.js
- React
- TypeScript
- Web App Manifest
- Service Worker capabilities where appropriate
- Responsive web design

The application should remain usable through a normal mobile browser even if the user does not install the PWA.

---

# 4. Mobile-First Strategy

The member experience is expected to be primarily used on mobile devices.

The interface should therefore prioritize:

- touch interaction
- readable typography
- clear primary actions
- simple navigation
- minimal typing
- fast access to check-in
- fast access to membership/payment status
- usable QR flows

Owner and staff interfaces should also be responsive, but may require more information density than the member experience.

---

# 5. User Experiences

The application contains two primary experiences.

## 5.1 Owner/Staff Experience

Focused on:

- dashboard
- members
- memberships
- payments
- attendance
- staff
- announcements
- settings
- exports
- operational tasks

## 5.2 Member Experience

Focused on:

- home
- check-in
- attendance
- membership
- payment status
- payment claim
- announcements
- occupancy
- future engagement features

The same application may serve both experiences while navigation and available functionality are determined by authorization.

---

# 6. Public and Authenticated Areas

The application should distinguish between:

```text
Public / Entry
    ↓
Authentication
    ↓
Authenticated Application

Public or semi-public functionality may include:

landing/product information
gym QR entry
login/onboarding entry points

Authenticated functionality includes private organization and member data.

7. QR Entry Flow

The member QR code identifies the gym organization.

Conceptually:

Scan QR
   ↓
Open PWA
   ↓
Organization identified
   ↓
Phone entry
   ↓
OTP authentication
   ↓
Member authorization
   ↓
Member experience

The QR code must not authenticate the user.

8. QR URL Design

The QR should resolve to a stable application route.

Conceptually:

/g/{organizationIdentifier}

The exact URL structure will be finalized during implementation.

The identifier must not itself grant privileged access.

The route should only establish organization context.

9. Authentication Screens

The application should provide clear authentication states.

Possible states include:

Enter phone
    ↓
OTP requested
    ↓
Enter OTP
    ↓
Verifying
    ↓
Authenticated

The interface should provide:

OTP resend behavior
cooldown indication
useful validation messages
loading state
failure state
recovery path

Security-sensitive details must not be exposed through UI messages.

10. Member Onboarding UX

The intended member flow is:

Gym QR
   ↓
Gym identified
   ↓
Phone number
   ↓
OTP
   ↓
Account linking/creation
   ↓
Member Home

The experience should minimize unnecessary steps.

The member should not be required to create a complex profile before accessing the core experience.

11. Owner Onboarding UX

The owner flow is:

Phone
   ↓
OTP
   ↓
Basic gym information
   ↓
Organization created
   ↓
Trial activated
   ↓
Owner Dashboard

The onboarding experience should collect only the minimum information necessary to begin using the product.

Additional configuration can be completed later.

12. Navigation

Navigation should be role-aware.

Member

Primary navigation may include:

Home
Attendance
Membership
Payments
Announcements
Profile

The exact final navigation may change during design.

Owner/Staff

Primary navigation may include:

Dashboard
Members
Attendance
Payments
Memberships
Staff
Announcements
Settings

Only features authorized for the current user should be available.

13. Role-Based UI

The frontend may use application permissions to determine:

which navigation items appear
which buttons appear
which pages are accessible
which actions are enabled

However:

Hidden UI ≠ Authorization

Every protected operation must still be enforced by the backend.

14. Member Home

The member home is intended to be the primary daily screen.

Potential content includes:

greeting
attendance streak
recent visits
attendance percentage
current occupancy
daily challenge
membership days remaining
payment status
announcements

Features not included in V1 should not be implemented merely because the UI has placeholders for them.

15. Check-In UX

Check-in should be one of the fastest member actions.

Conceptually:

Member Home
    ↓
Check In
    ↓
Authentication / membership validation
    ↓
Attendance recorded
    ↓
Success confirmation

The interface should clearly indicate:

checking in
success
already checked in
membership/access restriction
temporary failure

The client must not determine whether the check-in actually succeeded.

The backend response is authoritative.

16. Check-Out UX

Where check-out is supported:

Active Session
    ↓
Check Out
    ↓
Session completed
    ↓
Confirmation

The UI should clearly indicate the current attendance state.

If the application supports automatic session expiration, the UI should reflect the resulting state appropriately.

17. Live Occupancy UX

Members may see current gym occupancy.

Conceptually:

Current occupancy
18 people

The displayed value should come from the backend.

The frontend must not maintain an independent authoritative occupancy count.

If the data is temporarily unavailable, the UI should communicate that the value may be unavailable or stale rather than inventing a number.

18. Payment UX

The member payment screen may display:

amount due
membership/payment context
gym UPI ID
gym UPI QR
payment instructions
I have paid action
verification status
outstanding amount

The member should clearly understand:

I have paid submits a payment claim. It does not automatically confirm payment.

19. Payment Claim UX

Conceptually:

Amount Due
    ↓
Pay Gym
    ↓
I Have Paid
    ↓
Verification Pending
    ↓
Gym verifies
    ↓
Payment Status Updated

After submitting a claim, the member should see a clear pending state.

The UI must not display a confirmed-payment state until the backend reports a confirmed payment.

20. Owner Payment Verification UX

Authorized staff should have a payment verification queue.

Potential information:

member
claimed amount
payment method
reference
claim time
related charge
current outstanding amount

The staff member can:

verify payment
enter actual amount received
reject claim where appropriate

The final financial state comes from the backend.

21. Partial Payment UX

If a member owes:

₹1,000

and the gym receives:

₹600

the application should show:

Confirmed: ₹600
Outstanding: ₹400

The UI must derive these values from authoritative backend financial state.

22. Membership UX

Members should be able to see:

current plan
membership status
start date
expiry date
days remaining
payment status where relevant

Owners/staff should be able to manage membership information according to their permissions.

23. Attendance History UX

Members should be able to see:

recent visits
attendance history
attendance percentage
future streak information when implemented

Owners/staff should have appropriate member-level attendance views according to their permissions.

24. Announcements UX

Members should be able to view gym announcements.

Authorized staff should be able to create announcements.

Announcements must remain organization-scoped.

The frontend must never combine announcements from unrelated organizations.

25. Needs Attention UX

Owner/staff dashboards may include a focused section for items requiring action.

Examples:

payment verification
expiring memberships
expired memberships
outstanding payments
inactive members

The section should link to the appropriate operational action.

26. Loading States

Every data-dependent screen should define appropriate loading behavior.

Examples:

dashboard loading
member list loading
payment queue loading
attendance loading
member home loading

Loading states should prevent accidental duplicate actions where appropriate.

27. Error States

The UI should handle:

authentication failure
authorization failure
validation errors
network failure
server errors
external provider failures
stale data
unavailable occupancy
payment verification errors
duplicate actions

Errors should be understandable without exposing internal system details.

28. Empty States

The application should provide useful empty states.

Examples:

No members yet
No attendance records
No pending payment claims
No announcements
No outstanding payments

Empty states should guide the user toward the appropriate next action where relevant.

29. Offline Strategy

The application should not attempt to make every feature fully offline in V1.

Offline support should be limited to experiences where correctness can be maintained.

Possible offline-friendly behavior may include:

application shell loading
previously available non-sensitive static resources
basic navigation

Sensitive business operations should require appropriate backend connectivity.

30. Offline Restrictions

The following operations should not silently succeed while offline:

payment confirmation
payment claims
membership renewal
role changes
staff access changes
attendance operations unless a specifically designed offline synchronization system exists

The user should receive a clear indication when connectivity is required.

31. Service Worker

A service worker may be used for:

application shell caching
static asset caching
appropriate performance improvements

The service worker must not create a path to unauthorized private data.

Caching strategy must be reviewed for authenticated/tenant-scoped responses.

32. Private Data Caching

Private organization/member data must not be cached in a way that allows:

User A
   ↓
logs out
   ↓
User B opens same device
   ↓
User B sees User A's private data

Authenticated data caching must consider:

user identity
organization context
session state
logout behavior
cache invalidation
33. Logout

Logout must:

terminate the appropriate authenticated session
clear application-specific sensitive state
prevent unauthorized reuse of cached private data
return the user to an appropriate public/authentication state

The exact session behavior depends on the selected authentication provider.

34. Multi-Organization UX

If a user belongs to multiple organizations:

Login
  ↓
Organization Selection
  ↓
Selected Organization
  ↓
Organization Experience

The UI should make the active organization clear.

Changing the selected organization must not expose data from the previous organization incorrectly.

Backend authorization remains authoritative.

35. Organization Switching

When switching organizations, the frontend should:

update active organization context
invalidate/reload tenant-specific data
avoid showing stale data from the previous organization
verify the backend accepts the new organization context

The client must not assume that because organization A was authorized, organization B is also authorized.

36. Browser Navigation

Protected routes should handle:

direct URL entry
browser refresh
back navigation
forward navigation
expired sessions
changed organization membership

A user navigating directly to a protected URL must still pass backend authorization.

37. Responsive Design

The application should support:

mobile
tablet
desktop

The design should not require a separate mobile application for V1.

Owner dashboards may use wider layouts on desktop while remaining usable on mobile.

38. Accessibility

The application should follow practical accessibility principles including:

semantic HTML
keyboard navigation
readable text
appropriate labels
sufficient interactive target size
meaningful error messages
visible focus states
accessible forms
appropriate contrast
screen-reader-friendly structure

Accessibility should be considered during component implementation rather than treated as a final cleanup task.

39. Performance

The PWA should prioritize:

fast initial load
efficient navigation
limited unnecessary JavaScript
optimized images/assets
appropriate caching
efficient API usage
pagination for large datasets

Performance optimization should not weaken security or data correctness.

40. QR Camera Experience

The application may use the device camera through supported browser capabilities for QR scanning.

The application should also support normal QR links opened by the operating system/camera application.

Camera access must be requested only when needed.

The application should provide a fallback if camera scanning is unavailable.

41. Installability

The PWA should provide:

valid web app manifest
application name
icons
appropriate display mode
appropriate theme metadata
secure HTTPS deployment
installable behavior supported by the target browser/platform

The application should remain usable without installation.

42. PWA Updates

The application should handle new application versions safely.

Updates must not leave the user running an incompatible mixture of:

old frontend
new API
stale cached assets

Cache invalidation and deployment strategy should be designed to minimize version mismatch.

43. Security Rules for Client State

The client may maintain UI state such as:

selected tab
selected organization
filters
temporary form state

The client must not be treated as authoritative for:

role
permission
payment status
membership status
attendance confirmation
organization access
subscription entitlement

The backend remains authoritative.

44. Sensitive Data in URLs

Sensitive information should not be unnecessarily placed into URLs.

Avoid placing:

OTPs
authentication tokens
payment secrets
private personal information

into query parameters or paths unless explicitly required and reviewed.

45. Frontend API Access

The frontend should use a consistent API/data-access layer.

Components should not independently implement authentication, authorization, and tenant logic.

Security decisions belong to the backend.

Frontend data access should remain predictable and testable.

46. Design Source of Truth

Visual design should be maintained separately from architecture.

The intended workflow is:

Product Requirement
      ↓
User Flow
      ↓
Approved Design
      ↓
Frontend Implementation

Figma or another approved design tool may be used as the visual source of truth.

AI-generated UI should implement approved design rather than inventing product behavior.

47. PWA Testing

Testing should cover:

Authentication
login
OTP states
logout
expired session
Organization
organization selection
organization switching
unauthorized organization access
Member
onboarding
check-in
attendance
membership
payment claim
Owner/Staff
dashboard
member management
payment verification
attendance management
staff management
PWA
installability
responsive layouts
service-worker behavior
cache behavior
offline states
update behavior
Security
private cache isolation
cross-tenant access
direct protected URL access
unauthorized frontend actions
stale session behavior
48. What We Will Not Build Initially

The V1 PWA will not require:

native iOS application
native Android application
full offline business operations
offline payment processing
offline membership renewal
offline role management
complex background synchronization
unnecessary client-side state infrastructure
automatic cloud backup of progress photos

These can be reconsidered based on real product requirements.

49. Future PWA Capabilities

Future versions may introduce:

richer offline behavior
push notifications
install prompts
advanced member engagement
progress photos
goals
streaks
challenges
badges
leaderboard
enhanced analytics

Each feature requires its own product and security review.

50. Relationship to Other Documents

This document depends on:

01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
05-AUTHORIZATION.md
06-SECURITY.md
07-API-SPECIFICATION.md

Related documents:

09-TESTING.md
10-DEVOPS.md
11-OBSERVABILITY.md
12-SCALABILITY.md
13-COST-INFRASTRUCTURE.md
14-TECH-DECISIONS.md
51. Document Status

Current status: Initial PWA definition.

This document establishes the V1 web/PWA behavior.

Detailed component design, visual specifications, caching implementation, service-worker configuration, and frontend architecture should be documented or reviewed before implementation.

No production frontend implementation should begin until the relevant design, API, authorization, and security requirements are sufficiently defined.


Then save and commit:

```text
docs: define pwa architecture
