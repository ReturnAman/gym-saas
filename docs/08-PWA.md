# PWA (Member App)

The member experience ships as an installable Progressive Web App — one
codebase, no app-store gate, working on mid-range Android and iOS.

## Installability checklist

- [ ] Web app manifest: name, icons (192/512 + maskable), theme/display `standalone`
- [ ] Served over HTTPS; service worker registered
- [ ] Install prompt strategy: contextual (after first booking), not on first paint
- [ ] iOS: `apple-touch-icon`, standalone meta tags, tested Add-to-Home-Screen flow

## Offline & resilience

- **App shell** cached; navigations fall back to offline page.
- **Read offline**: schedule, my bookings, membership card — served from cache/IndexedDB with staleness indicators.
- **Write offline**: bookings queued and synced on reconnect; conflicts resolved server-side (capacity/credits re-checked; user notified of failures).
- Background Sync for queued mutations; Periodic Sync for schedule refresh where supported.

## Performance budgets

- First load < 3 s on 4G / mid-range device; repeat visits near-instant from cache.
- Route-level code splitting; images responsive + lazy; total JS < 200 KB gzipped per route.
- Lighthouse PWA + Performance ≥ 90 in CI.

## Push notifications

- Opt-in after value moment (first booking); preferences per category (see `01-PRODUCT-REQUIREMENTS.md`).
- Payloads carry IDs, not PII; tapping deep-links to the relevant screen.

## Platform quirks to handle

- iOS service worker / push limitations — degrade gracefully, document gaps.
- Timezone correctness: gym timezone for class times, device timezone for display clarity.
- QR check-in must work with screen brightness variations; provide manual code fallback.

## Testing

- Device lab matrix (Android Chrome, iOS Safari) in `09-TESTING.md`.
- Offline test scenarios: airplane-mode booking, sync conflicts, stale cache.
