# ADR 005 — WhatsApp Provider

**Project:** gym-saas  
**Status:** Proposed  
**Date:** YYYY-MM-DD  
**Decision Type:** Integration / Notifications / Architecture

---

# 1. Context

gym-saas needs WhatsApp notifications for important member and gym communication.

Potential notification types include:

- Welcome messages
- Membership reminders
- Payment reminders
- Payment-related updates
- Membership expiry reminders
- Inactivity reminders
- Announcements
- Other operational notifications

The product should avoid requiring each gym owner to configure their own WhatsApp infrastructure during the initial product experience.

The preferred architecture is:

> Centralized SaaS WhatsApp sender

The SaaS owns and operates the sending infrastructure.

---

# 2. Product Requirement

The system should be capable of sending personalized WhatsApp messages to members of different gyms.

A single sender number does not mean messages are generic.

For example:

```text
Member: Rahul
Gym: ABC Fitness
Amount Due: ₹1,500
Expiry: 12 October

→ Personalized message
Another gym may receive:

Member: Priya
Gym: XYZ Fitness
Amount Due: ₹2,000
Expiry: 18 October

→ Personalized message

The sender identity remains centralized while message content remains tenant-specific.

3. Architectural Requirement

WhatsApp must be treated as a notification channel.

It must not become the source of truth for:

Users
Memberships
Payments
Attendance
Subscription state

The application database remains the source of truth.

4. Notification Architecture

The intended architecture is:

Application Event
       ↓
Notification Rule
       ↓
Notification Job
       ↓
Queue / Background Processing
       ↓
WhatsApp Provider
       ↓
WhatsApp
       ↓
Delivery Status
       ↓
Application Database

The notification provider is an external delivery mechanism.

5. Provider Boundary

Application code should not directly depend on WhatsApp-provider-specific APIs throughout the codebase.

Use a clear provider boundary.

Conceptually:

Notification Service
        ↓
WhatsApp Provider Interface
        ↓
Selected Provider

This allows the provider to be replaced without redesigning the notification domain.

6. Provider Candidate

The production direction is:

Official Meta WhatsApp Business Platform / Cloud API or an official provider built on the supported Meta platform.

The final commercial provider configuration remains subject to current Meta requirements, availability, pricing, and product needs.

7. Why Official Infrastructure

The production SaaS should prioritize:

Official platform support
Commercial suitability
Policy compliance
Stable APIs
Predictable delivery
Account management
Webhooks
Delivery status
Long-term maintainability

The project should avoid building its production notification foundation around unofficial WhatsApp clients.

8. OpenWA

OpenWA may be useful for:

Local experimentation
Controlled prototypes
Learning
Early non-critical testing

It should not be the production foundation for the commercial SaaS.

The production notification architecture must remain independent of OpenWA.

9. WhatsApp Is Not Authentication

WhatsApp must never be used as the application's primary authentication mechanism.

Authentication remains a separate concern.

The member authentication architecture is:

Phone
 ↓
OTP
 ↓
Authentication Provider
 ↓
Application User

WhatsApp notifications are downstream communication.

10. Tenant Isolation

Every notification must be associated with its tenant.

A notification record should conceptually contain information such as:

organizationId
memberId
messageType
templateId
recipientPhone
status
providerMessageId
createdAt

The exact database schema is defined separately.

The system must never accidentally send one gym's data to another gym's member.

11. Message Personalization

Messages should be generated from trusted application data.

Potential variables include:

Member name
Gym name
Amount due
Membership expiry date
Payment status
Renewal information
Announcement content

The client should not be trusted to provide authoritative financial or membership information.

12. Message Templates

Business-initiated WhatsApp messages may require approved templates or other provider/platform-specific mechanisms depending on the type and timing of communication.

The implementation must follow the current WhatsApp Business Platform rules applicable to the message.

Do not assume that any arbitrary text can always be sent programmatically.

13. User Consent / Opt-In

The product must respect applicable WhatsApp messaging requirements and user consent/opt-in requirements.

The system should maintain enough information to determine whether a member is eligible to receive a particular notification.

Potential fields may include:

whatsappOptIn
optInSource
optInAt
optOutAt

The exact data model should be finalized during database implementation.

14. Opt-Out

Members should be able to opt out of non-essential WhatsApp communications where applicable.

Opt-out handling should prevent future eligible notifications from being queued/sent.

Mandatory or transactional communications must be handled according to the applicable platform rules.

15. Notification Types

Initial notification categories may include:

Membership
Upcoming expiry
Expiry day
Overdue membership
Payments
Payment reminder
Payment claim acknowledgement
Payment confirmation
Outstanding balance reminder
Engagement
Inactivity reminder
Challenge notification
Announcement
Onboarding
Welcome
Account/setup information

The final V1 notification set should be deliberately limited.

16. Owner Controls

Gym owners should eventually be able to control applicable notification rules.

Examples:

7-day expiry reminder
3-day expiry reminder
Expiry-day reminder
Payment reminder
Inactive-member reminder

The owner should not need to manually send every reminder.

17. Notification Rules

Notification rules should be represented separately from message delivery.

Conceptually:

Membership expires in 7 days
        ↓
Rule matches
        ↓
Create Notification Job
        ↓
Send through WhatsApp Provider

This allows the notification system to evolve without embedding scheduling logic inside every feature.

18. Notification Status

A notification should have a lifecycle.

Conceptually:

CREATED
   ↓
QUEUED
   ↓
SENDING
   ↓
SENT
   ↓
DELIVERED

Failure states may include:

FAILED
RETRYING
CANCELLED

The exact state machine should be finalized during implementation.

19. Provider Message ID

When the provider returns a message identifier, the application should store it.

This allows:

Delivery tracking
Debugging
Webhook correlation
Provider-side troubleshooting

Provider-specific identifiers must not become the application's primary notification identity.

20. Webhooks

The production provider should support webhook/event mechanisms appropriate for:

Delivery status
Failure status
Other relevant message events

Webhook processing must:

Authenticate/verify the provider request where supported
Validate payloads
Handle duplicate events safely
Avoid trusting arbitrary client requests
Update notification state safely
21. Idempotency

Notification sending must consider duplicate requests.

Examples:

Scheduled job runs
      ↓
Retry
      ↓
Worker restart
      ↓
Same notification attempted again

The system should avoid unintentionally sending duplicate messages.

The exact idempotency strategy will be defined during implementation.

22. Retry Strategy

Transient provider failures may be retried.

Retries must use bounded behavior.

The system should avoid infinite retries.

Conceptually:

Attempt 1
   ↓
Temporary Failure
   ↓
Retry
   ↓
Temporary Failure
   ↓
Retry
   ↓
Maximum Attempts
   ↓
FAILED

Permanent failures should not be retried indefinitely.

23. Rate Limiting

The notification system should respect:

Provider limits
Application limits
Per-recipient limits where appropriate
Campaign limits
Retry limits

The system must not attempt uncontrolled bulk sending.

24. Sensitive Information

WhatsApp messages should contain only information appropriate for the communication.

Avoid exposing unnecessary sensitive information.

Particular care should be taken with:

Payment information
Personal information
Membership details
Internal gym information
Administrative information
25. Payment Notifications

Payment messages must use confirmed application state.

For example:

Payment Claim

must not automatically become:

Payment Confirmed

A payment-confirmation message may only be sent after the payment is actually confirmed in the application's payment domain.

26. Membership Notifications

Membership expiry messages should use the application's membership state.

They must not rely on:

Client-provided dates
WhatsApp state
Manually constructed external data

The database remains authoritative.

27. Centralized Sender

The SaaS will use a centralized sending identity for the initial product architecture.

This reduces onboarding friction for gyms.

The message itself should clearly identify the relevant gym where necessary.

Conceptually:

SaaS WhatsApp Number
        ↓
"ABC Fitness"
        ↓
"Hi Rahul..."
28. Per-Gym WhatsApp Numbers

Allowing every gym to connect its own WhatsApp number is not part of the initial architecture.

This may be considered later.

If introduced, it should be treated as a separate provider/account-management capability.

29. Manual WhatsApp Fallback

Manual communication may remain available as a fallback.

For example, an owner may manually contact a member when:

automated messaging is unavailable
the message is unusual
the member has opted out of automated communication
the owner needs to communicate personally

Manual communication should not be confused with automated delivery state.

30. Provider Configuration

Provider credentials must be stored securely.

They must never be:

committed to Git
embedded in frontend code
logged
exposed through API responses

Production secrets must use secure environment/secret-management mechanisms.

31. Development and Testing

Development should not casually send messages to real members.

Use:

Mock provider
Test numbers
Sandbox/test environments where available
Controlled development recipients

Automated tests should not depend on sending real WhatsApp messages.

32. Testing Requirements

Test:

Message generation
Tenant isolation
Recipient selection
Template selection
Opt-in/opt-out behavior
Payment-state correctness
Membership-state correctness
Duplicate prevention
Retry behavior
Webhook processing
Provider failures
Delivery state transitions
33. Cost

WhatsApp provider costs and Meta platform pricing may change.

The project must verify current official pricing and messaging rules before enabling commercial production messaging.

Pricing should not be hard-coded into architecture assumptions.

The notification system should track usage sufficiently to support future cost analysis.

34. Provider Abstraction

The system should conceptually support:

Notification Provider
       │
       ├── Meta / Official WhatsApp Provider
       ├── Test Provider
       └── Future Provider

Only the provider-specific implementation should understand provider-specific API details.

35. Decision
Current Status

Production direction: official Meta WhatsApp Business Platform / supported official provider.

The architecture will use:

Centralized sender
Provider abstraction
Tenant-scoped notifications
Template-aware messaging
Opt-in/opt-out handling
Webhooks
Delivery status
Idempotency
Bounded retries

OpenWA is not the production foundation.

36. Consequences
Positive
Better long-term production suitability
Lower dependency on unofficial protocols
Clear notification architecture
Provider replaceability
Centralized operational model
Lower onboarding friction for gyms
Trade-offs
Provider setup complexity
Platform policies
Template requirements
Messaging costs
Operational responsibility
Potential approval/onboarding requirements
37. Future Reassessment

Reassess the provider strategy when:

WhatsApp volume becomes significant
Pricing changes materially
Provider limitations appear
Per-gym numbers become a product requirement
Additional messaging channels are introduced
Notification requirements become more complex
38. Related Documents
01-PRODUCT-REQUIREMENTS.md
02-USER-FLOWS.md
03-SYSTEM-ARCHITECTURE.md
06-SECURITY.md
07-API-SPECIFICATION.md
09-TESTING.md
11-OBSERVABILITY.md
14-TECH-DECISIONS.md
20-CURRENT-STATE.md
39. Approval

Decision Owner: Project Owner

Status: Proposed

Provider: Official Meta WhatsApp Business Platform / Supported Official Provider

Centralized Sender: Yes

OpenWA Production Use: No

Approval Date: N/A
