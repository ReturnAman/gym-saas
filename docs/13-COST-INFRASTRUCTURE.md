# Cost & Infrastructure

## Principles

- Cost is a design constraint, not an afterthought: every ADR notes expected infra cost impact.
- Prefer managed services over self-hosting until scale justifies otherwise.
- Tag all resources by environment and service; review spend monthly.

## Cost model (per gym per month)

| Component | Driver | Notes |
| --- | --- | --- |
| Compute (API) | Requests | Stateless, autoscaled; baseline + burst |
| Database | Storage + IOPS | Shared tenancy keeps per-gym cost low |
| Cache / sessions | Memory | Schedule caching reduces DB load |
| Job queue workers | Jobs/min | Dunning, emails, reports |
| Object storage | GB + egress | Avatars, exports |
| Email / push | Messages sent | Volume-tiered provider pricing |
| Payment provider | % + fixed per transaction | Passed through in pricing model |
| Observability | Log/metric volume | Sample aggressively; budget alerts |

Target: infrastructure cost per gym well below average revenue per gym, with
margin tracked on the business dashboard.

## Budgets & guardrails

- Monthly budget per environment with alerts at 50/80/100%.
- Staging and preview environments auto-sleep outside working hours.
- Log retention tiers: hot 7 d, warm 30 d, cold per compliance.

## Optimization levers

- Right-size caches before scaling databases.
- Batch and schedule non-urgent jobs (reports, exports) off-peak.
- Review top-10 cost drivers monthly; file decisions in `docs/decisions/`.

## Pricing alignment

SaaS pricing tiers must cover: infra per gym + payment fees + support load +
margin. Revisit the model when crossing 1k and 10k gyms.
