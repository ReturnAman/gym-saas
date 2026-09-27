# User Flows

Notation: each flow lists the actor, trigger, steps, and edge cases.

## 1. Member signup & first purchase

**Actor**: prospective member · **Trigger**: lands on gym page

1. Member creates account (email/password or social).
2. Verifies email.
3. Browses plans; selects plan → checkout (provider-hosted payment form).
4. Subscription becomes `active` (or `trialing`); confirmation email + receipt.
5. Prompted to install the PWA.

**Edge cases**: payment fails → stays on checkout with error, no subscription created; duplicate account → merge prompt.

## 2. Member books a class

**Actor**: member · **Trigger**: wants to attend a class

1. Opens PWA → schedule for their gym (defaults to today).
2. Filters by day / class type / trainer.
3. Taps class → sees spots left, cancellation policy → books.
4. Receives confirmation (push + in-app); booking appears under "My bookings".
5. Optional: adds to device calendar.

**Edge cases**: class full → joins waitlist with position shown; booking inside cancellation window of another booking → warning; membership without remaining credits → upsell to plan/credit pack.

## 3. Waitlist promotion

**Trigger**: a booked member cancels

1. System promotes first waitlisted member; booking created automatically.
2. Promoted member notified (push + email) with accept/decline window (e.g. 2 h).
3. Decline or timeout → next person promoted.
4. Class roster updates for trainer view.

## 4. Trainer publishes a class

**Actor**: trainer/manager · **Trigger**: new timetable period

1. Creates class template (type, duration, capacity, room).
2. Sets recurrence (weekly) or one-off date/time; assigns trainer.
3. Publishes → appears on member schedule; trainers see it on their agenda.

**Edge cases**: room double-booking → conflict error; trainer unavailable → warning.

## 5. Check-in at the gym

**Actor**: member/manager · **Trigger**: member arrives

1. Member opens PWA → booking shows QR check-in code.
2. Manager scans (or member self-scans at kiosk) → booking marked `checked_in`.
3. No-show: booking stays `booked` past class start → flagged for reporting.

## 6. Failed payment (dunning)

**Trigger**: renewal charge fails

1. Subscription → `past_due`; member notified with update-payment link.
2. Automatic retries on a schedule (e.g. day 1, 3, 7).
3. Success → `active`; final failure → `cancelled`/`expired` + notification.
4. Grace access policy during `past_due` (configurable per gym).

## 7. Owner views revenue

**Actor**: owner · **Trigger**: weekly review

1. Opens dashboard → selects date range.
2. Sees MRR, new/cancelled/churned members, class utilization, revenue by plan.
3. Drills into a plan or cohort; exports CSV.

Each flow should have acceptance tests mirroring these steps (see `09-TESTING.md`).
