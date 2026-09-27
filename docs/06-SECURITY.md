# Security

Baseline: OWASP ASVS Level 2. This doc states controls; implementation details
live in `docs/features/` and code.

## Authentication & sessions

- Passwords: Argon2id hashing; minimum 12 chars; breach-list screening on signup.
- MFA: TOTP for staff roles (owner/manager); optional for members.
- Sessions: HttpOnly, Secure, SameSite cookies; rotation on privilege change; idle + absolute timeouts.
- PWA tokens: short-lived access + rotating refresh tokens; revoke on logout/password change.

## Tenant isolation

- `gym_id` scoping enforced at the data-access layer; defense in depth via DB row-level policies.
- Automated tests attempt cross-tenant reads/writes on every new endpoint.
- Subdomain-per-gym option to strengthen cookie isolation (ADR).

## Payments (PCI)

- Card data never touches our servers — provider-hosted fields/tokens only (SAQ-A posture).
- Webhook signatures verified; amounts reconciled server-side (never trust client totals).

## Data protection

- PII inventory per feature; minimization by default.
- Encryption at rest (managed DB) and in transit (TLS 1.2+).
- Field-level encryption for high-sensitivity fields (e.g. government IDs if collected).
- Right to export/delete: hard-delete PII on verified request; retain financial records per legal holds.

## Application controls

- Input validation (allowlist) on every boundary; parameterized queries / ORM only.
- CSRF tokens on cookie-authenticated mutations; strict CORS allowlist.
- Rate limiting: auth endpoints (strict), booking endpoints (per-member), webhooks (per-provider).
- File uploads: type allowlist, size caps, virus scan, served from separate domain.
- Secrets: env vars via secret manager; never in repo, logs, or error responses.

## Operational security

- Dependency scanning in CI; patch SLA by severity.
- Audit log for sensitive actions: refunds, role changes, plan changes, support access.
- Incident runbook in `docs/learning/`; postmortems blameless and filed as learning notes.
- Annual pen test before handling production payment volume; bug bounty considered post-launch.

## Compliance notes

- Regional privacy law mapping (GDPR-style rights) to be completed before EU pilot gyms.
- Accessibility (WCAG 2.2 AA) tracked as a security-adjacent quality gate in CI.
