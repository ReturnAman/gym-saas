# ADR 016: Notification Architecture

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Notifications / Background Processing / External Providers
- Related:
  - `01-PRODUCT-REQUIREMENTS.md`
  - `06-SECURITY.md`
  - `07-API-SPECIFICATION.md`
  - `09-TESTING.md`
  - `decisions/005-WHATSAPP-PROVIDER.md`
  - `decisions/009-BACKGROUND-JOBS.md`
  - `decisions/013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md`
  - `decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md`

---

## 1. Context

The gym SaaS needs to communicate with members and gym staff.

Potential notification types include:

- membership expiry reminders
- payment reminders
- payment verification updates
- welcome messages
- announcements
- inactive-member reminders
- renewal reminders
- operational notifications
- future campaigns

The system may eventually support multiple channels:

- in-app
- WhatsApp
- email
- SMS
- push notifications

The product should not become tightly coupled to one notification provider.

The system also needs to support:

- tenant isolation
- personalized messages
- retries
- delivery status
- provider failures
- user preferences
- owner-controlled reminder settings
- centralized WhatsApp sending

---

# 2. Decision

The notification system will use a centralized notification architecture.

The conceptual flow is:

```text
Business Event
      ↓
Notification Rule
      ↓
Notification Job
      ↓
Background Processing
      ↓
Notification Provider
      ↓
Delivery Status

Notifications will be:

tenant-scoped
recipient-specific
generated from business context
processed asynchronously when appropriate
provider-independent at the application boundary
auditable
retry-aware
protected against duplicate processing where necessary
3. Centralized WhatsApp Sender

The SaaS will use a centralized WhatsApp sender rather than requiring every gym owner to connect and manually operate their own WhatsApp account.

Conceptually:

XYZ SaaS WhatsApp Business Number
              ↓
        Notification Engine
              ↓
     ┌────────┼────────┐
     ↓        ↓        ↓
   Gym A    Gym B    Gym C
   Member   Member   Member

The sender is centralized.

The message content is still personalized.

4. Personalized Messages

A centralized sender does not mean generic messages.

Example:

Hi Rahul,

Your membership at ABC Fitness expires in 3 days.

Renewal amount: ₹2,000.

Please contact ABC Fitness for renewal.

The notification engine should generate the message using the correct:

member name
gym name
amount
date
membership information
relevant action

The message must clearly identify the member's gym.

5. Tenant Isolation

Every notification must have a clear organization context where the notification is gym-specific.

Conceptually:

Notification
├── organization_id
├── member_id
├── type
├── channel
├── recipient
└── status

The system must never accidentally send:

Gym A information

to:

Gym B member

Tenant scope must be validated before notification creation and delivery.

6. Notification Domain

A notification represents an intended communication.

Possible fields:

id
organization_id
member_id
type
channel
recipient
template_id
status
provider_message_id
created_at
sent_at
delivered_at
failed_at

The exact schema is defined during database implementation.

7. Notification Types

Initial notification types may include:

WELCOME
MEMBERSHIP_EXPIRING
MEMBERSHIP_EXPIRED
PAYMENT_DUE
PAYMENT_VERIFICATION_PENDING
PAYMENT_CONFIRMED
ANNOUNCEMENT
INACTIVE_MEMBER
RENEWAL_REMINDER

Only types required by the current product should be implemented.

Future notification types can be added without redesigning the entire architecture.

8. Channels

Initial channels:

IN_APP
WHATSAPP

Future channels may include:

EMAIL
SMS
PUSH

A notification type and delivery channel are separate concepts.

For example:

MEMBERSHIP_EXPIRING

could eventually be delivered through:

IN_APP
WHATSAPP
EMAIL

without creating separate business logic for every channel.

9. Provider Abstraction

The application should not embed WhatsApp-specific implementation throughout the business domain.

Conceptually:

Notification Service
        ↓
Notification Provider Interface
        ↓
    ┌───────────────┐
    ↓               ↓
Meta WhatsApp    Future Provider

The business logic should know:

send notification

rather than:

call Meta endpoint with this exact payload
10. Provider Boundary

Provider-specific code should remain isolated.

Examples of provider-specific concerns:

API authentication
access tokens
provider message IDs
webhook verification
provider-specific error codes
template IDs
rate limits
delivery statuses

These should not leak unnecessarily into core domain logic.

11. Official WhatsApp Provider

Production WhatsApp messaging should use the official Meta WhatsApp Business Platform or an approved official provider path.

OpenWA is not the production foundation for commercial messaging.

OpenWA may be useful for experimentation or controlled pilot testing, but the architecture must not depend on it.

12. WhatsApp Is Not Authentication

WhatsApp notifications must never be used as the application's authentication mechanism.

Authentication remains a separate system.

The notification provider must not become the source of:

user identity
organization membership
authorization
13. Opt-In

Business-initiated WhatsApp communication must respect applicable WhatsApp/Meta requirements and user consent/opt-in rules.

The application should maintain appropriate notification preference state.

The system must not assume:

Member exists
    =
Member automatically agrees to every WhatsApp message.

The exact opt-in UX and policy requirements must be finalized against the provider's current rules before production launch.

14. WhatsApp Templates

Business-initiated WhatsApp notifications may require approved templates depending on the conversation context and current provider rules.

The application should therefore treat templates as first-class notification configuration.

Conceptually:

Notification Type
        ↓
Template
        ↓
Personalized Parameters
        ↓
Provider

Example:

MEMBERSHIP_EXPIRING
        ↓
membership_expiring_template
        ↓
memberName
gymName
expiryDate
amount
        ↓
WhatsApp
15. Template IDs

Provider-specific template identifiers should not become the application's business identifiers.

Example:

template_id
provider_template_id

may be separated where useful.

The application should be able to refer to:

MEMBERSHIP_EXPIRING

without hardcoding a provider-specific identifier throughout business logic.

16. Notification Rules

Notification rules determine when a notification should be generated.

Examples:

Membership expires in 7 days
Membership expires in 3 days
Membership expires today
Payment is overdue
Member inactive for X days
Payment verification completed

The rule should be represented separately from the actual notification delivery record.

17. Owner-Controlled Rules

Gym owners should be able to control applicable reminder types where the product supports it.

Example:

Membership expiry reminders:
    Enabled

Inactive member reminders:
    Disabled

Payment reminders:
    Enabled

The exact configuration model should remain simple in V1.

Do not build a full marketing automation platform.

18. Notification Preferences

Preferences may exist at different levels:

Organization
Member
Notification Type
Channel

The system should only introduce preference levels that the product actually needs.

For example, V1 may simply allow:

Organization controls automated WhatsApp reminders.

Later, members may receive more granular channel preferences if required.

19. Notification Job

A notification job represents work that must be processed.

Conceptually:

Notification Job
├── notification_id
├── scheduled_at
├── status
├── attempt_count
├── last_attempt_at
└── next_attempt_at

The exact schema depends on the background-job implementation.

20. Asynchronous Processing

Notifications should generally be sent asynchronously.

Example:

Owner confirms payment
        ↓
database transaction
        ↓
notification intent created
        ↓
HTTP response
        ↓
background worker
        ↓
WhatsApp provider

The user-facing operation should not normally wait for WhatsApp delivery.

21. Critical vs Non-Critical Notifications

Notifications are generally non-critical side effects.

For example:

Payment confirmed

must remain successful even if:

WhatsApp provider is temporarily unavailable.

The payment confirmation itself should not depend on successful WhatsApp delivery.

22. Notification Failure Must Not Roll Back Business State

Bad:

Payment confirmation
        ↓
WhatsApp send
        ↓
WhatsApp fails
        ↓
ROLLBACK PAYMENT

Preferred:

Payment confirmation
        ↓
commit payment state
        ↓
notification job
        ↓
WhatsApp attempt
        ↓
retry/fail independently

This follows the transaction strategy in ADR 013.

23. Notification Status

Notifications may use states such as:

PENDING
PROCESSING
SENT
DELIVERED
FAILED
CANCELLED

The exact provider-independent state model should be finalized during implementation.

Provider delivery states may be mapped into these application-level states.

24. Delivery Status

Where supported, provider webhooks can update delivery status.

Example:

PENDING
   ↓
SENT
   ↓
DELIVERED

or:

PENDING
   ↓
FAILED

The system should not assume that:

API request accepted
=
message delivered
25. Provider Message ID

When a provider returns a message identifier, store it separately.

Example:

provider_message_id

This can support:

delivery webhooks
troubleshooting
status reconciliation
duplicate detection

The provider ID is not the application's notification ID.

26. Webhook Handling

Provider delivery webhooks must be:

authenticated
validated
tenant-safe
idempotent
logged safely

The system must assume that webhook events may be delivered more than once.

See:

013-DATABASE-TRANSACTIONS-AND-CONCURRENCY.md

for concurrency and idempotency principles.

27. Notification Idempotency

The same logical notification should not accidentally be sent multiple times because of:

worker retry
duplicate job creation
duplicate webhook
scheduler overlap
application retry

The exact idempotency mechanism should depend on the notification type.

Possible mechanisms:

business event ID
notification unique key
provider message ID
idempotency key
database uniqueness constraint
28. Notification Deduplication

For scheduled reminders, the system should define a logical uniqueness key.

Example:

organization_id
member_id
notification_type
reference_date

This can prevent:

Membership expires in 3 days

from being generated twice for the same membership and reminder period.

The exact key depends on the event model.

29. Reminder Example

Suppose:

Membership end date = June 30

The system may generate:

June 23 → 7-day reminder
June 27 → 3-day reminder
June 30 → expiry-day reminder

The system must prevent duplicate generation of the same reminder for the same membership.

30. State Revalidation Before Sending

Background jobs must not blindly trust old state.

Example:

Membership expires tomorrow
        ↓
Reminder job scheduled
        ↓
Owner renews membership
        ↓
Job executes

Before sending, the worker should re-check current membership state.

If the member has already renewed:

do not send stale expiry reminder

where the product rule requires this behavior.

31. Payment Notification Example

Payment flow:

Member claims payment
        ↓
Payment Claim = PENDING
        ↓
Owner verifies
        ↓
Payment = CONFIRMED
        ↓
Notification job created
        ↓
Member notified

The notification must not imply payment confirmation before the owner actually confirms it.

32. Payment Claim Notifications

A member may receive:

Payment verification pending

after submitting a claim.

They must not receive:

Payment received successfully

until the gym confirms the payment.

Notification content must reflect authoritative business state.

33. Membership Renewal Notifications

Payment and membership renewal are separate.

If a member pays but the owner does not renew the membership, the system must not automatically send:

Your membership has been renewed.

unless the renewal actually occurred.

34. Inactive Member Notifications

The system may later detect members who have not attended for a configurable period.

Example:

No attendance for 14 days

The owner may choose to receive:

Member inactive

or send a member reminder if the product supports it.

The initial implementation should avoid building complex behavioral automation.

35. Announcements

Announcements are a product feature and may trigger notifications.

Conceptually:

Owner creates announcement
        ↓
Announcement published
        ↓
Notification generated
        ↓
Selected members/channels

The announcement content remains the source of truth.

Notification delivery is a separate concern.

36. Announcement Audience

Possible audiences may include:

ALL_MEMBERS
ACTIVE_MEMBERS
EXPIRED_MEMBERS
SELECTED_MEMBERS

Only audiences required by the product should be implemented initially.

The backend must calculate the audience using organization-scoped queries.

37. Bulk Notifications

Bulk sending should not mean:

one giant synchronous HTTP request

Instead:

Audience
   ↓
notification jobs
   ↓
worker
   ↓
provider

This allows:

retries
rate limiting
partial failure handling
delivery tracking
38. Bulk Sending Safety

Bulk notification operations must be protected against:

accidental cross-tenant selection
unintended audience expansion
duplicate sends
provider rate limits
excessive job creation
unauthorized campaign use

V1 should keep bulk messaging limited and controlled.

39. Rate Limits

Notification workers must respect provider rate limits.

The system should avoid sending thousands of messages simultaneously without regard to provider limits.

The worker system should support controlled processing.

The exact throughput depends on:

provider limits
pricing
gym size
product plan
infrastructure
40. Retry Strategy

Transient provider failures may be retried.

Examples:

network timeout
temporary provider outage
temporary HTTP 5xx

Permanent failures should not be retried indefinitely.

Examples:

invalid recipient
invalid template
invalid provider configuration

Retry limits must be bounded.

41. Exponential Backoff

Retries should use controlled backoff.

Conceptually:

Attempt 1
   ↓
short delay
Attempt 2
   ↓
longer delay
Attempt 3
   ↓
final attempt

The exact retry schedule should be finalized during worker implementation.

42. Failed Notifications

After retry exhaustion:

status = FAILED

The system should retain enough information for operational troubleshooting.

The failure record must not expose sensitive provider credentials.

43. Notification Logs

Notification records may be used for:

delivery status
support troubleshooting
audit context
retry handling
usage reporting

However, notification logs should not become a permanent copy of unnecessary personal information.

Store only what is needed.

44. Message Content Storage

The system should decide carefully whether to store rendered message bodies.

Potential approaches:

Store template + parameters
template_id
parameters
Store rendered body
message_body
Store both

This decision depends on:

debugging needs
privacy
provider requirements
audit requirements
storage cost

The initial implementation should minimize unnecessary sensitive data storage.

45. Sensitive Notification Data

Notification payloads may contain:

member name
membership expiry
payment amount
gym name
phone number

The system should treat these as sensitive personal/business data.

Do not log full message payloads indiscriminately.

46. Phone Numbers in Notifications

Phone numbers may be necessary for delivery.

They should not be:

unnecessarily logged
exposed in frontend notification history
included in analytics where not needed

Internal records may store recipient information according to the notification requirements.

47. Notification Preferences and Opt-Out

If the product supports member-level notification preferences, the system must honor them.

Example:

WhatsApp reminders = OFF

The notification engine should not create/send a WhatsApp reminder unless the message is required by an applicable policy/legal requirement and the product/provider rules permit it.

The exact preference model remains a future implementation decision.

48. Owner Configuration

The owner may configure supported reminder categories.

Example:

Membership expiry reminder
    7 days before → ON
    3 days before → ON
    expiry day → OFF

Payment reminder
    ON

V1 should use predefined options rather than a fully customizable workflow engine.

49. No AI-Generated Notifications in V1

The notification system should use curated templates.

AI should not automatically generate arbitrary customer messages in production without a defined safety and review model.

For example:

Membership Expiry Reminder

should use an approved template.

AI may assist developers during implementation but should not silently generate uncontrolled customer communications.

50. Notification Content Ownership

Product/business rules should determine:

what messages exist
when they are sent
who receives them
which channels are allowed

The provider determines:

transport
delivery status
provider-specific formatting
provider-specific constraints

This separation should remain clear.

51. Notification Provider Interface

Conceptually:

interface NotificationProvider {
  send(message: NotificationMessage): Promise<NotificationResult>
}

The exact interface should be designed during implementation.

It should remain small.

Avoid exposing provider-specific concepts in the common interface unless they are genuinely shared.

52. Provider Result

The application-level provider result may contain:

success
provider_message_id
provider_status
error_code
retryable

The application should map provider-specific failures into a stable internal model.

53. Manual Notification Fallback

Manual communication may remain available where appropriate.

For example:

Owner sees member payment due
        ↓
Owner can manually contact member

The SaaS should not assume every notification must succeed automatically.

However, V1 should avoid forcing owners to manually send every routine reminder.

54. OpenWA Position

OpenWA may be used for:

experimentation
local testing
controlled pilot work
learning the notification workflow

It should not become the production messaging foundation.

The production architecture must be able to use the official WhatsApp path without rewriting business logic.

55. In-App Notifications

In-app notifications can use the same notification domain but do not require an external provider.

Example:

Owner confirms payment
        ↓
in-app notification
        ↓
member sees:
"Payment confirmed."

The application may store/read notification status directly.

56. Notification Read State

If in-app notifications are implemented, they may have:

read_at

rather than only:

is_read

This provides a useful timestamp.

The exact implementation depends on the UI requirements.

57. Push Notifications

Push notifications are not required for the first implementation.

The architecture should not depend on push.

They can be added later if member engagement data demonstrates value.

58. Email and SMS

Email and SMS are not required as primary V1 channels.

If added later, they should implement the same provider boundary:

Notification Service
        ↓
Provider

rather than adding provider-specific logic throughout the product.

59. Notification Security

Before sending any notification, verify:

 organization scope
 recipient relationship
 notification permission/preference
 business state
 correct template
 correct recipient
 provider configuration
 rate limits
 duplicate prevention
60. Notification Testing

Tests should cover:

Correct recipient
Gym A notification
→ Gym A member
Wrong tenant
Gym A event
→ Gym B member

Expected:

Rejected / impossible
Duplicate job
same logical notification
processed twice

Expected:

No unintended duplicate send
State change
Membership renewed
before reminder job executes

Expected:

stale reminder not sent
Provider failure
WhatsApp provider unavailable

Expected:

Business transaction remains successful.
Notification retries/fails independently.
61. Operational Monitoring

Notification monitoring should track useful metrics such as:

notifications_created
notifications_sent
notifications_delivered
notifications_failed
notification_retry_count
provider_latency
provider_error_rate

Metrics should be aggregated without exposing unnecessary personal data.

62. Cost Monitoring

WhatsApp messaging may create variable costs.

The system should eventually track:

organization
notification_type
channel
provider usage

where required for billing/plan enforcement.

The initial implementation should not build complex billing analytics unless needed.

63. Subscription Plan Integration

Future plans may define:

Basic:
manual/in-app reminders

Pro:
automated WhatsApp reminders

Higher tier:
campaigns/analytics

This should be implemented through the entitlement system rather than scattered plan-name checks.

64. Notification Architecture Summary

The intended architecture is:

                     BUSINESS EVENT
                           ↓
                  NOTIFICATION RULE
                           ↓
                 NOTIFICATION RECORD
                           ↓
                    BACKGROUND JOB
                           ↓
                NOTIFICATION SERVICE
                           ↓
               PROVIDER ABSTRACTION
                    ↙           ↘
               IN-APP        WHATSAPP
                                  ↓
                             META/OFFICIAL
                                  ↓
                         DELIVERY WEBHOOK
                                  ↓
                         STATUS UPDATE
65. What This Decision Does Not Finalize

This ADR does not finalize:

exact Meta Cloud API implementation
exact WhatsApp pricing
exact template catalog
exact opt-in UX
exact notification table schema
exact queue technology
exact worker runtime
exact retry delays
email provider
SMS provider
push provider
member notification preference UI
campaign/marketing automation

These should be finalized when the relevant implementation requirements are concrete and current provider rules have been verified.

66. Consequences
Positive
Centralized notification architecture
Personalized messages for each member
Reduced owner manual work
Provider replaceability
Better tenant isolation
Retry support
Delivery tracking
Clear separation between business state and communication
Supports future channels
Compatible with background processing
Negative
Requires background processing
Requires provider integration
Requires webhook handling
Requires template management
Requires opt-in/compliance work
Automated WhatsApp messaging can create variable operating costs
Delivery is eventually consistent rather than synchronous

These costs are accepted because automated communication is an important product capability, while provider coupling and notification failures must not compromise core business state.

67. Final Rule

Business logic decides:

What should be communicated?
When?
To whom?
Why?

The notification system decides:

How should it be delivered?

The provider decides:

How is the message transported and tracked?

Never allow notification delivery failure to corrupt core business state.

Never trust notification delivery as proof of a business event.

Never use WhatsApp as an authentication mechanism.

Never send tenant-specific information to a recipient without verifying the organization and recipient relationship.

Keep notification providers replaceable and keep customer-facing communication controlled, auditable, and secure.
