# Authorization

## Model: RBAC + tenant scoping

Two axes on every request: **who** (role within a gym) and **which gym**
(tenant). Authentication proves identity; `gym_memberships` resolves
`(user, gym) → role`. All data access is filtered by `gym_id` first, then by
role permissions.

## Roles

| Role | Description |
| --- | --- |
| `superadmin` | Platform operator. Cross-gym read; gym provisioning. No member PII beyond support needs. |
| `owner` | Full control of their gym: billing config, staff, plans, reports. |
| `manager` | Day-to-day ops: members, bookings, check-in, refunds. Cannot change plans/billing config. |
| `trainer` | Own classes, rosters, availability. Read-only on member contact details. |
| `member` | Own bookings, subscription, profile. |

A user may hold different roles at different gyms.

## Permission matrix (v1)

| Capability | member | trainer | manager | owner | superadmin |
| --- | --- | --- | --- | --- | --- |
| Book / cancel own class | ✓ | · | · | · | · |
| View own bookings & invoices | ✓ | · | · | · | · |
| Manage own availability/classes | · | ✓ | ✓ | ✓ | · |
| View class rosters | · | ✓ (own) | ✓ | ✓ | · |
| Check in members | · | · | ✓ | ✓ | · |
| Manage members (CRUD) | · | · | ✓ | ✓ | · |
| Issue refunds / credits | · | · | ✓ | ✓ | · |
| Manage plans & pricing | · | · | · | ✓ | · |
| Manage staff & roles | · | · | · | ✓ | · |
| View revenue reports | · | · | limited | ✓ | aggregated |
| Provision / suspend gyms | · | · | · | · | ✓ |

## Enforcement

- Middleware resolves `gym_id` + role into request context; route handlers declare required permissions.
- Service layer re-checks ownership (e.g. a member can only cancel *their own* booking).
- Tests: cross-tenant access and privilege escalation cases for every endpoint (see `09-TESTING.md`).

## Special cases

- **Public gym pages** (plans, schedule preview): unauthenticated read, tenant resolved from subdomain/slug.
- **Webhooks**: provider-signature verification, not user auth.
- **Support impersonation**: superadmin "view as" with full audit logging; disabled by default per gym.
