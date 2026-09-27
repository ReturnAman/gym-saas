# API Specification

> The OpenAPI document is the contract; this file states conventions and the
> endpoint inventory. Generate the spec from code annotations where possible.

## Conventions

- Base path `/api/v1`; version in URL. Breaking changes → new version.
- JSON everywhere; UTF-8. Timestamps ISO-8601 UTC. Money in minor units + currency.
- Auth: cookie session (dashboard) / bearer access token (PWA). Tenant via subdomain or `X-Gym-Id` claim context.
- Pagination: cursor-based (`?cursor=&limit=`); envelope `{ data, page: { next_cursor } }`.
- Errors: RFC 9457 problem details — `{ type, title, status, detail, trace_id }`.
- Idempotency: `Idempotency-Key` header on POST mutations (bookings, payments).
- Rate limits communicated via `RateLimit-*` headers; `429` with `Retry-After`.
- Webhooks (outbound): signed payloads, at-least-once delivery, exponential backoff.

## Endpoint inventory (v1)

### Auth & users

| Method & path | Description |
| --- | --- |
| `POST /auth/signup` | Create account |
| `POST /auth/login` / `POST /auth/logout` | Session lifecycle |
| `POST /auth/refresh` | Rotate PWA tokens |
| `GET /me` · `PATCH /me` | Current user profile |
| `GET /me/gyms` | Gyms + roles for user |

### Gyms & staff

| Method & path | Description |
| --- | --- |
| `GET/PATCH /gyms/{id}` | Gym profile & settings (owner) |
| `GET/POST /gyms/{id}/staff` | Invite/list staff |
| `PATCH /gyms/{id}/staff/{userId}` | Change role; `DELETE` removes |

### Plans & subscriptions

| Method & path | Description |
| --- | --- |
| `GET /plans` · `POST /plans` | List / create plans |
| `POST /subscriptions` | Purchase (starts checkout) |
| `GET /subscriptions/{id}` | Subscription detail |
| `POST /subscriptions/{id}/freeze` / `/cancel` / `/resume` | Lifecycle |
| `GET /invoices` | Member invoices |

### Classes & bookings

| Method & path | Description |
| --- | --- |
| `GET /classes?from=&to=` | Schedule |
| `POST /classes` | Create class (staff) |
| `POST /classes/{id}/bookings` | Book (idempotent) |
| `DELETE /bookings/{id}` | Cancel (policy-checked) |
| `GET /classes/{id}/waitlist` · `POST /classes/{id}/waitlist` | Waitlist |
| `POST /bookings/{id}/check-in` | Check-in |

### Webhooks (inbound)

| Path | Source |
| --- | --- |
| `POST /webhooks/billing` | Payment provider (signature-verified) |

Full request/response schemas live in the OpenAPI spec (`src/` or `docs/` once generated).
