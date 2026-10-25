# Stage 0 Deployment Runbook — Railway

**Scope:** first hosted staging environment, synthetic data only. This document
does not provision resources, set secrets, migrate a hosted database, or
authorize a public launch.

## Current release posture

Use a **fresh Railway project** only after the code changes are reviewed and
GitHub CI is green. Earlier Railway web-service attempts did not complete a
successful build. The observed service had no application variables and no
database service; Railway suggested a missing `DATABASE_URL` as a possible
cause, but the failure logs did not prove the exact root cause.

The application intentionally fails fast when required configuration is
missing. In particular, `prisma.config.ts` reads `DATABASE_URL` when
`npm run build` runs `prisma generate`. The database URL must therefore be
available to the **build as well as runtime**.

## Runtime and commands

- **Node.js:** `>=22.12.0 <23` (Node 22.12.x or later within major version
  22). This matches the current Vitest/Prisma dependency engine requirements.
- **Build command:** `npm run build`
- **Start command:** `npm start`
- **Pre-deploy command:** `npx prisma migrate deploy`
- **Health check:** `/api/ready`, with a 300-second timeout
- **Replicas:** start with one replica
- **Region:** place the web service and PostgreSQL in the same region; Singapore
  is the preferred Stage 0 region if available in the account.

`/api/health` remains a shallow liveness endpoint. `/api/ready` performs a
small PostgreSQL query, returns `200` only when that query succeeds, and
returns a safe `503` without database details when it fails.

## Required application variables

Set these on the Railway **web service** through its environment Variables
panel. Never put their values in source code, docs, issues, or chat.

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | Required. Reference the PostgreSQL service's private `DATABASE_URL` in the same Railway environment. Do not use localhost, a public TCP proxy, or a placeholder. It must exist before the build starts. |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Required. Use the dedicated **Clerk development/test instance** for Stage 0, not production keys. |
| `CLERK_SECRET_KEY` | Required. Use the matching development/test instance secret; enter it directly in Railway Variables. |
| `APP_URL` | Set to the HTTPS URL assigned to the web service after its domain is generated. The QR-poster flow uses it. |
| `DB_POOL_MAX`, `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS` | Optional. Leave unset initially so the application defaults apply (pool max 8). |
| `TWOFACTOR_API_KEY` | Leave unset until the provider/compliance decision is complete and a live OTP round-trip is explicitly approved. Member OTP remains unverified/unavailable when unconfigured. |
| `SENTRY_DSN` | Optional; no error-tracking provider has been selected. |

Railway supplies its own port/runtime metadata. Do not hard-code a local port,
database password, Clerk secret, or production key in the repository.

## Fresh-project sequence

1. Confirm the reviewed commit is on the branch selected for deployment and all
   required GitHub CI jobs have passed.
2. Create a new Railway Stage 0 project. Add one managed PostgreSQL service and
   one web service sourced from `ReturnAman/gym-saas`. Keep the two services in
   the same region and use one web replica.
3. Configure the required variables above before triggering the web build.
   Reference the PostgreSQL service's **private** database URL, not a public
   connection endpoint.
4. Configure the web build/start/pre-deploy commands and `/api/ready`
   health check as listed above. The migration command must fail the deployment
   if any migration fails.
5. Deploy the reviewed commit. Inspect build logs and the pre-deploy migration
   result. Confirm `GET /api/health` returns `200` and `GET /api/ready`
   returns `200` only after the database is reachable.
6. Use only synthetic test accounts and records. Verify owner sign-in using
   Clerk development keys, basic navigation, a safe database-backed request,
   and runtime logs. Do not test real member OTP until the provider is approved
   and configured.

This repository deliberately does not add `railway.json` / `railway.toml`:
Railway's legacy Config as Code is deprecated and no longer applies to new
services. Configure the first fresh deployment explicitly in Railway; if the
project later adopts Railway Infrastructure as Code, use `railway config plan`
and review the exact plan before any apply. See the
[official Railway IaC documentation](https://docs.railway.com/infrastructure-as-code).

## Gates before any real gym/member data or public launch

- Test database backup and restore, including a timed restore drill, and verify
  the recovery point required by the hosting decision.
- Complete a real 2Factor/provider verification flow only after the sender/DLT
  and account decisions are settled.
- Configure the correct production Clerk instance and owned domain only when
  production auth is explicitly approved.
- Complete privacy/terms/grievance contact and retention decisions, and obtain
  the necessary legal review.
- Decide monitoring/alerting and close the remaining M1–M3 hardening items in
  the current-state document.

A successful build and a green CI run are not evidence of tested backups,
working live OTP, legal readiness, or production readiness.
