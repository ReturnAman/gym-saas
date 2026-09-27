# Observability

## Pillars

- **Logs**: structured JSON, `trace_id` on every request; never log PII, tokens, or card data.
- **Metrics**: RED (rate, errors, duration) per endpoint; business metrics (bookings/min, MRR movements, dunning outcomes).
- **Traces**: distributed tracing across API → DB → queue → providers; sample tail-based.

## SLOs (initial)

| Service | SLO | Window |
| --- | --- | --- |
| Booking & check-in API | 99.9% success, p95 < 300 ms | 30 d rolling |
| Schedule reads (PWA) | 99.9% success, p95 < 500 ms | 30 d rolling |
| Webhook processing | 99.5% processed < 60 s | 30 d rolling |
| Notification delivery | 99% delivered < 5 min | 30 d rolling |

Error budgets gate releases: budget exhausted → feature freeze until recovered.

## Alerting

- Page (on-call): SLO burn, 5xx spikes, failed deploys, DB failover, payment webhook backlog.
- Ticket (next business day): elevated p95, queue depth growth, cert expiry < 14 d.
- Alerts link directly to runbooks in `docs/learning/` or `scripts/`.

## Dashboards

- Golden signals per service; per-gym views for support (no PII beyond need).
- Business dashboard: signups, bookings, churn, revenue — mirrors `01-PRODUCT-REQUIREMENTS.md` reporting.

## Audit

- Immutable audit log for: role changes, refunds, plan edits, support access, data exports/deletes.
- Retained per legal requirements; queryable by superadmin only.
