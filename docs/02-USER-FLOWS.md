# User Flows

**Project:** gym-saas  
**Product:** TBD  
**Parent Company:** XYZ  
**Document Version:** 0.1  
**Status:** Product Definition  
**Scope:** V1 and future flows

---

## 1. Purpose

This document defines the primary user journeys and important edge cases for gym-saas.

It translates the product requirements into concrete user interactions and system behavior.

This document focuses on:

- user journeys
- system responses
- authentication and authorization boundaries
- important states
- success and failure paths
- edge cases

This document does not define detailed API contracts, database schemas, infrastructure, or UI implementation.

Those details belong in the appropriate architecture, database, security, API, and frontend documents.

---

# 2. User Roles

The product supports the following roles:

- OWNER
- ADMIN
- STAFF
- TRAINER
- MEMBER

A user account and an organization membership are separate concepts.

A single user may belong to multiple organizations.

Authorization is determined by the user's membership in the relevant organization.

---

# 3. Owner Onboarding Flow

## 3.1 Goal

Allow a gym owner to create an organization and begin a trial without requiring manual administrative setup.

## 3.2 Primary Flow

1. User opens the owner signup flow.
2. User enters their phone number.
3. System validates the phone number format.
4. System sends an OTP.
5. User enters the OTP.
6. System verifies the OTP.
7. System creates or identifies the user account.
8. User provides minimum gym information.
9. System creates the organization.
10. System creates an organization membership for the user with the `OWNER` role.
11. System creates the organization's trial subscription.
12. User enters the owner dashboard.

## 3.3 Important Rules

- OTP proves control of the phone number.
- OTP does not independently prove legal ownership of a gym.
- The owner receives an organization membership with the `OWNER` role.
- The organization and user identity are separate entities.
- One user may own or belong to multiple organizations.
- The user's phone number is not the primary identity key for application data.

## 3.4 Failure Cases

### Invalid Phone Number

The system rejects the request and asks the user to enter a valid phone number.

### Incorrect OTP

The system rejects the verification attempt.

The user may retry within the allowed verification limits.

### Expired OTP

The system asks the user to request a new OTP.

### Too Many OTP Attempts

The system temporarily blocks further verification attempts according to the security policy.

### OTP Abuse / Excessive Requests

The system applies request throttling and cooldown rules.

### Organization Creation Failure

The system must not leave the user in an ambiguous partially-created state.

The operation should be handled transactionally where appropriate.

---

# 4. Owner Trial Flow

## 4.1 Goal

Allow a newly registered owner to evaluate the product before subscribing.

## 4.2 Primary Flow

1. Owner completes onboarding.
2. System creates the trial subscription.
3. Trial starts according to the subscription rules.
4. Owner can use the allowed V1 functionality.
5. System tracks the trial period.
6. Trial approaches expiration.
7. System informs the owner that the trial is ending.
8. Trial expires if no subscription is activated.
9. Organization data remains preserved.

## 4.3 Trial Rules

- Initial trial duration: 7 days.
- Initial member limit may be enforced.
- The member limit is a product entitlement, not a database capacity limitation.
- One introductory trial is allowed per verified owner account initially.
- Trial eligibility must be tracked separately from organization creation.
- Trial expiration must not delete organization or member data.

## 4.4 Trial Expiration

When the trial expires:

- organization data remains preserved
- member data remains preserved
- attendance history remains preserved
- payment records remain preserved
- subscription status changes according to subscription rules
- access may become restricted or read-only according to the subscription policy

The exact post-expiration access policy will be defined in the subscription/entitlement design.

---

# 5. Owner Subscription Activation Flow

## 5.1 V1 Payment Method

The owner pays the SaaS subscription manually using the supported UPI or bank-payment process.

No payment gateway is required for V1.

## 5.2 Primary Flow

1. Owner views subscription information.
2. System displays the payment instructions.
3. Owner makes payment manually.
4. Owner provides the required payment information or confirmation.
5. SaaS administrator verifies the payment manually.
6. Administrator activates or extends the organization's subscription.
7. Organization access is restored or extended according to the subscription state.

## 5.3 Important Rules

- Subscription activation is controlled by backend subscription state.
- Client-side payment confirmation is not sufficient to activate a subscription.
- Subscription verification must be performed by an authorized administrator.
- Subscription changes should be auditable.
- Organization data remains separate from subscription state.

---

# 6. Gym Profile and Settings Flow

## 6.1 Goal

Allow authorized gym staff to configure the organization's basic information.

## 6.2 Primary Flow

1. Authorized user opens gym settings.
2. System verifies the user's organization membership and role.
3. User views current gym settings.
4. User edits permitted information.
5. System validates the changes.
6. System saves the changes.
7. Updated information becomes available to permitted users.

## 6.3 Authorization

Only roles with the required organization permission may modify a setting.

Frontend visibility is not considered a security boundary.

Backend authorization is mandatory.

---

# 7. Staff Management Flow

## 7.1 Goal

Allow an owner or authorized administrator to manage staff access.

## 7.2 Add Staff

1. Owner/Admin opens staff management.
2. User selects add staff.
3. User provides required staff information.
4. System creates or identifies the user account.
5. Organization membership is created.
6. Appropriate role is assigned.
7. Staff member can authenticate.
8. Staff member receives access according to the assigned role.

## 7.3 Change Staff Role

1. Authorized user opens staff member details.
2. System verifies permission to modify staff access.
3. User selects a new role.
4. System validates the role transition.
5. Organization membership is updated.
6. New permissions take effect.

## 7.4 Remove Staff Access

1. Authorized user selects a staff member.
2. System verifies authorization.
3. User removes or disables organization access.
4. Organization membership becomes inactive or is otherwise handled according to the authorization model.
5. Staff member can no longer access protected organization resources.

Historical records should remain associated with the relevant user where required for auditability.

---

# 8. Member Creation Flow

## 8.1 Goal

Allow gym staff to add members without requiring the member to create an account first.

## 8.2 Primary Flow

1. Authorized staff opens member management.
2. Staff selects add member.
3. Staff enters:
   - member name
   - phone number
   - membership information
4. System validates the information.
5. System creates the member record.
6. Membership information is associated with the member.
7. Member becomes eligible for member onboarding.

## 8.3 Important Rule

Creating a member record does not necessarily mean that the member has created an application user account.

The member account can be created or linked during OTP onboarding.

---

# 9. Member QR + OTP Onboarding Flow

## 9.1 Goal

Allow an existing gym member to securely access their gym account without requiring a manual invite link.

## 9.2 QR Responsibility

The permanent gym QR code identifies the organization.

The QR code does not authenticate the member.

Possession of the QR code must never be treated as proof of identity.

## 9.3 Primary Flow

1. Member scans the gym QR code.
2. Application identifies the organization.
3. Member enters their phone number.
4. Backend checks whether the phone number is associated with an eligible member in that organization.
5. If eligible, system sends an OTP.
6. Member enters the OTP.
7. Backend verifies the OTP.
8. System creates or links the user account.
9. System creates or links the organization membership.
10. Member enters the member experience for that organization.

## 9.4 Security Rules

- QR identifies the organization only.
- Phone number is used for discovery.
- OTP is used as identity proof.
- Authenticated user identity is used for subsequent access.
- Organization membership determines authorization.
- Backend authorization is mandatory for protected resources.

## 9.5 Membership Enumeration Protection

The system should avoid revealing whether an arbitrary phone number is registered with a particular gym.

Responses should be sufficiently generic to reduce membership enumeration.

## 9.6 OTP Security

The system must support:

- OTP expiration
- verification attempt limits
- resend cooldown
- request rate limiting
- abuse protection
- appropriate logging and monitoring
- no logging of OTP values

## 9.7 Wrong or Outdated Phone Number

If the member's phone number is incorrect or outdated:

1. Member cannot complete normal OTP verification.
2. Gym staff may verify the member's identity through an appropriate manual process.
3. Staff may update the member's phone number if authorized.
4. Member retries the normal OTP onboarding flow.

The exact recovery procedure will be defined in the security and authorization design.

---

# 10. Multiple Gym Membership Flow

## 10.1 Goal

Allow one user to belong to multiple organizations.

## 10.2 Primary Flow

1. User authenticates successfully.
2. System identifies the organizations associated with the user.
3. If only one organization is relevant, the user enters that organization.
4. If multiple organizations are available, the user selects the intended organization.
5. Backend validates organization membership.
6. User receives access only to the selected organization's permitted resources.

## 10.3 Security Rule

Selecting an organization in the frontend does not grant access.

Every protected backend request must verify the authenticated user's organization membership.

---

# 11. Member Home Flow

## 11.1 Goal

Provide the member with a simple overview of their gym activity.

The member home may display:

- greeting
- attendance streak
- recent visits
- attendance percentage
- current occupancy
- daily challenge
- membership days remaining
- payment status
- announcements

Some engagement features may be introduced after the initial V1.

## 11.2 Access

1. Member authenticates.
2. System identifies the active organization context.
3. Backend verifies membership.
4. System loads permitted member information.
5. Member home is displayed.

---

# 12. Member Check-In Flow

## 12.1 Goal

Allow a member to record attendance at the gym.

## 12.2 Primary Flow

1. Member opens the check-in experience.
2. System authenticates the member.
3. Backend verifies active organization membership.
4. System verifies that the member is allowed to check in.
5. System records the attendance event.
6. System creates or updates the active attendance session.
7. Member receives confirmation.

## 12.3 Duplicate Check-In

The system should prevent unintended duplicate check-ins.

Repeated requests should not create multiple attendance records for the same intended check-in.

The exact idempotency and concurrency behavior will be defined in the architecture/database design.

## 12.4 Failed Check-In

Possible reasons include:

- unauthenticated user
- invalid organization context
- inactive membership
- unauthorized access
- duplicate active session
- temporary system failure

The system should provide a useful user-facing error without exposing sensitive internal details.

---

# 13. Member Check-Out Flow

## 13.1 Goal

Allow the system to determine active gym occupancy.

## 13.2 Primary Flow

1. Member has an active attendance session.
2. Member checks out or the session is closed according to the configured attendance behavior.
3. System records the end time.
4. Active occupancy is recalculated.
5. Member receives confirmation.

## 13.3 Missing Check-Out

The system must define behavior for sessions where the member does not explicitly check out.

Possible mechanisms may include:

- automatic session expiration
- staff correction
- configurable maximum session duration

The exact rule will be documented during architecture and product refinement.

---

# 14. Live Occupancy Flow

## 14.1 Goal

Show an approximate current number of members inside the gym.

## 14.2 Primary Flow

1. Member checks in.
2. System creates an active attendance session.
3. Active sessions are counted.
4. Occupancy is displayed to authorized users.
5. Member checks out or session expires.
6. Active session is closed.
7. Occupancy count decreases.

## 14.3 Important Rule

Live occupancy should be derived from attendance/session state rather than maintained as an independent manually editable number.

This avoids multiple sources of truth.

---

# 15. Attendance History Flow

## 15.1 Member

1. Member opens attendance history.
2. Backend verifies organization membership.
3. System retrieves the member's attendance records.
4. Member sees permitted attendance history.
5. System may calculate attendance percentage from the relevant attendance data.

## 15.2 Owner/Staff

1. Authorized staff opens attendance management.
2. Backend verifies organization and role permissions.
3. Staff searches or filters members.
4. System displays permitted attendance information.
5. Staff may perform authorized attendance corrections if such permissions are defined.

## 15.3 Tenant Isolation

A member must never be able to retrieve another organization's attendance information.

An authorized user must also only access attendance records belonging to organizations for which they have the required permission.

---

# 16. Membership Creation and Renewal Flow

## 16.1 New Membership

1. Authorized staff creates or updates a member's membership.
2. System records membership details.
3. System determines the applicable charge.
4. Member sees the relevant membership/payment status.

## 16.2 Renewal

1. Membership approaches expiration.
2. Member sees renewal information.
3. Member makes payment directly to the gym.
4. Member submits a payment claim.
5. Authorized staff verifies the payment.
6. Staff records or confirms the received payment.
7. Staff performs the membership renewal as a separate action.
8. Membership dates/status are updated.

## 16.3 Important Rule

Payment confirmation and membership renewal are separate domain actions.

A payment claim must not automatically renew a membership.

A confirmed payment must not silently change membership dates unless an explicitly approved renewal rule exists.

---

# 17. Member Payment Flow

## 17.1 Goal

Allow members to pay the gym directly while allowing the SaaS to track payment status.

## 17.2 Primary Flow

1. Member opens payment/renewal information.
2. System displays the amount due.
3. System displays the gym's configured UPI ID and/or QR code.
4. Member pays the gym directly.
5. Member selects `I have paid`.
6. System creates a payment claim.
7. Claim enters a verification-pending state.
8. Authorized gym staff receives the verification request.
9. Staff verifies the actual payment.
10. Staff records the confirmed payment.
11. Payment balance is recalculated.
12. Member sees the updated payment status.

## 17.3 Important Rule

The SaaS does not hold or transfer the gym membership payment.

The payment is made directly from the member to the gym.

---

# 18. Partial Payment Flow

## 18.1 Primary Flow

1. Member has an outstanding charge.
2. Member makes a partial payment to the gym.
3. Member submits a payment claim.
4. Authorized staff reviews the claim.
5. Staff enters the actual amount received.
6. System confirms the payment.
7. System calculates the remaining outstanding balance.
8. Membership renewal remains a separate action.

## 18.2 Payment Status

The system may represent payment state as:

- `UNPAID`
- `PARTIALLY_PAID`
- `PAID`
- `OVERPAID`

The exact state-transition rules will be defined in the database/domain design.

## 18.3 Outstanding Amount

Outstanding amount is calculated from:

`Charge Total - Sum of Confirmed Payments`

The payment balance must not be stored only as an editable note or manually maintained field.

---

# 19. Payment Verification Flow

## 19.1 Authorized Roles

Only roles with payment-verification permission may confirm member payments.

The exact role mapping will be defined in the authorization design.

## 19.2 Primary Flow

1. Staff opens the payment verification queue.
2. System displays pending claims for the relevant organization.
3. Staff reviews the claim.
4. Staff verifies the actual payment.
5. Staff records the actual amount received.
6. System validates the amount.
7. System creates/confirms the payment record.
8. System records which staff member performed the verification.
9. System recalculates the outstanding balance.
10. Member sees the updated status.

## 19.3 Unauthorized Verification

If a user does not have the required permission:

- backend rejects the action
- no payment state changes
- no sensitive payment information is unnecessarily exposed

## 19.4 Duplicate Verification

The system must prevent the same payment claim from being confirmed multiple times accidentally.

Concurrency and idempotency behavior will be defined in the architecture/database design.

---

# 20. Payment Correction Flow

## 20.1 Goal

Preserve payment history and auditability.

## 20.2 Rule

Confirmed payment records should not normally be silently edited or deleted.

If a correction is required, the system should use an explicit reversal, adjustment, or other auditable mechanism.

The exact correction model will be defined in the payment/domain design.

---

# 21. Payment History Flow

## 21.1 Member

A member can view their permitted payment status and payment history.

The member must only see their own relevant payment information.

## 21.2 Owner/Staff

Authorized users can view payment records belonging to their organization according to their role permissions.

## 21.3 Tenant Isolation

Payment records must always be scoped to the organization and appropriate member.

Cross-organization payment access is prohibited.

---

# 22. Membership Expiry Flow

## 22.1 Upcoming Expiry

When a membership approaches its expiry date:

- owner/staff can see the member as needing attention
- member can see the remaining membership period
- configured reminders may be generated

## 22.2 Expired Membership

When membership expires:

- membership status changes according to the membership rules
- member identity remains preserved
- historical attendance remains preserved
- historical payment information remains preserved
- future access to member-only actions is controlled by authorization/business rules

Expired membership must not automatically delete the member account.

---

# 23. Needs Attention Flow

## 23.1 Goal

Give gym staff a focused list of items requiring action.

Possible items include:

- memberships nearing expiry
- expired memberships
- outstanding payments
- payment verification requests
- inactive members
- other operational issues

## 23.2 Primary Flow

1. Owner/staff opens the dashboard.
2. System calculates or retrieves relevant attention items.
3. Items are grouped or prioritized according to defined business rules.
4. User selects an item.
5. System navigates to the relevant action.
6. User performs the authorized action.

The exact prioritization rules will be defined separately.

---

# 24. Announcements Flow

## 24.1 Owner/Staff

1. Authorized user creates an announcement.
2. System validates the announcement.
3. Announcement is associated with the organization.
4. Announcement becomes visible to permitted members.
5. Announcement remains tenant-scoped.

## 24.2 Member

1. Member opens the member experience.
2. System retrieves announcements for the active organization.
3. Member sees relevant announcements.

A member must never receive announcements belonging to another organization.

---

# 25. WhatsApp Notification Flow

## 25.1 Architecture Intent

The SaaS should use a centralized WhatsApp sender rather than requiring each gym owner to manually send every reminder.

Messages remain personalized for the individual member and gym.

## 25.2 Example Flow

1. A relevant business event occurs.
2. System identifies the applicable notification rule.
3. System creates a notification job.
4. Notification job enters the delivery queue.
5. Notification provider sends the message.
6. Provider returns a delivery status.
7. System records the relevant delivery information.

## 25.3 Tenant Context

Every notification should remain associated with the relevant:

- organization
- member
- message type
- template
- recipient
- delivery state

## 25.4 Important Rule

WhatsApp notifications are not an authentication mechanism.

Authentication and authorization remain separate from notification delivery.

## 25.5 Provider Boundary

WhatsApp provider-specific implementation should remain isolated so that the provider can be changed without redesigning the notification domain.

---

# 26. CSV Export Flow

## 26.1 Owner/Staff

1. Authorized user selects an export.
2. System verifies organization and permission.
3. System gathers only permitted organization data.
4. System generates the export.
5. User receives the generated file or download.
6. Export does not include data belonging to another organization.

## 26.2 Security

Exports may contain sensitive business/member information and must therefore be protected appropriately.

---

# 27. Role-Based Access Flow

## 27.1 General Rule

Every protected action follows this conceptual sequence:

1. Authenticate the user.
2. Identify the organization context.
3. Verify organization membership.
4. Verify required role/permission.
5. Verify resource ownership/tenant scope.
6. Perform the action.
7. Record an audit event where required.

## 27.2 Frontend Rule

Frontend checks may improve user experience but must never be the only authorization mechanism.

The backend is the security boundary.

---

# 28. Organization Isolation Flow

## 28.1 General Rule

Every organization is treated as an independent tenant.

## 28.2 Protected Request

For a tenant-scoped request:

1. User authenticates.
2. Backend determines the authenticated user.
3. Backend determines the requested organization context.
4. Backend verifies organization membership.
5. Backend verifies authorization.
6. Backend queries only permitted tenant-scoped resources.
7. Backend returns the result.

## 28.3 Cross-Tenant Access

If a user attempts to access a resource belonging to another organization:

- access must be denied
- no sensitive information should be revealed
- the event may be logged according to security/audit requirements

---

# 29. Account and Authentication Edge Cases

The system must account for:

- expired OTP
- incorrect OTP
- too many OTP attempts
- excessive OTP requests
- resend cooldown
- changed phone number
- duplicate phone number scenarios
- user belonging to multiple organizations
- inactive organization membership
- expired membership
- expired subscription
- lost access to owner phone
- unauthorized organization access

The exact handling of these cases will be defined in the authentication, authorization, and security documents.

---

# 30. Data and State Integrity Rules

The following principles apply across flows:

- Payment claims are not confirmed payments.
- Confirmed payments are not membership renewals.
- Outstanding balances are derived from charges and confirmed payments.
- Organization membership determines tenant access.
- Phone numbers are not primary identity keys.
- QR codes identify organizations but do not authenticate users.
- Frontend state is not trusted for security-sensitive decisions.
- Confirmed financial history should remain auditable.
- Duplicate requests must not unintentionally create duplicate business records.
- Important state transitions must be validated on the backend.
- Data belonging to one organization must not become accessible to another organization.

---

# 31. V1 Primary Journeys

The following journeys are considered the core V1 flows:

### Owner

1. Owner signup
2. OTP verification
3. Gym creation
4. Trial activation
5. Dashboard
6. Member creation
7. Membership management
8. Payment tracking
9. Payment verification
10. Attendance management
11. Staff management
12. Announcements

### Member

1. Gym QR scan
2. Phone entry
3. OTP verification
4. Member account creation/linking
5. Member home
6. Check-in
7. Attendance history
8. Membership status
9. Payment status
10. Payment claim
11. Announcement viewing

---

# 32. Future Engagement Journeys

These flows are not required for the initial V1 implementation but are part of the future product direction:

- attendance streak
- badges
- consistency leaderboard
- daily challenges
- goals
- achievements
- progress photos
- gym-controlled challenges
- partner offers
- gym discovery
- affiliate/commission flows

These should not be implemented before their requirements and security implications are sufficiently defined.

---

# 33. Flow-to-Architecture Rule

User flows define expected product behavior.

They do not by themselves define:

- database schema
- API implementation
- infrastructure
- framework implementation
- exact UI design
- third-party provider implementation

Those decisions belong in later technical documents.

No production application implementation should begin until the required architecture and security decisions have been documented sufficiently for the feature being implemented.

---

# 34. Document Status

**Current status:** Initial user-flow definition.

**Next documents:**

1. `03-SYSTEM-ARCHITECTURE.md`
2. `04-DATABASE-DESIGN.md`
3. `05-AUTHORIZATION.md`
4. `06-SECURITY.md`
5. `07-API-SPECIFICATION.md`

This document should evolve when approved product requirements or architecture decisions change.
