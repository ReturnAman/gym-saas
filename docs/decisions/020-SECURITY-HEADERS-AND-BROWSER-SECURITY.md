# ADR 020: Security Headers and Browser Security

- Status: Proposed
- Date: 2026-09-28
- Decision Type: Security / Web Platform
- Related:
  - `06-SECURITY.md`
  - `08-PWA.md`
  - `10-DEVOPS.md`
  - `11-OBSERVABILITY.md`
  - `decisions/014-API-ERROR-AND-RESPONSE-STRATEGY.md`
  - `decisions/015-AUTHENTICATION-AND-AUTHORIZATION-IMPLEMENTATION.md`
  - `decisions/018-CONFIGURATION-AND-ENVIRONMENT-STRATEGY.md`
  - `decisions/019-API-SECURITY-AND-RATE-LIMITING.md`

---

## 1. Context

The product is a browser-based PWA used by:

- gym owners
- administrators
- trainers
- staff
- members

The application handles sensitive information including:

- personal information
- phone numbers
- membership information
- attendance
- payment records
- organization administration
- authentication-related state

Browser security therefore forms an important part of the application's security boundary.

The application should use appropriate HTTP security headers and browser protections without introducing unnecessary configuration complexity.

---

# 2. Decision

Production will use a deliberate browser-security-header policy.

The application will evaluate and configure, where appropriate:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
frame protections
Permissions-Policy
cookie security attributes

The exact header values will be finalized during implementation and testing.

Security headers must be compatible with:

Next.js
Clerk authentication
PWA behavior
service workers
required third-party integrations
3. HTTPS

Production must use HTTPS.

Sensitive application traffic must not rely on plaintext HTTP.

Examples include:

authentication
member data
payments
attendance
organization administration
API requests
4. HTTP to HTTPS

Where the production hosting platform supports it, HTTP requests should redirect to HTTPS.

The application should not create unnecessary HTTP endpoints.

The exact redirect mechanism depends on the hosting platform.

5. HSTS

Production should use:

Strict-Transport-Security

once HTTPS deployment is stable.

Conceptually:

Browser
   ↓
HTTPS only
   ↓
Application

HSTS configuration must be introduced carefully because browsers may continue enforcing the policy after deployment changes.

6. HSTS Rollout

Do not immediately use an aggressive HSTS configuration before confirming:

all production routes support HTTPS
assets support HTTPS
APIs support HTTPS
authentication flows support HTTPS
required external resources support HTTPS
no production dependency requires HTTP

The final HSTS duration and optional directives will be selected during production hardening.

7. Content Security Policy

A Content Security Policy may reduce risks such as:

cross-site scripting
unexpected script execution
unauthorized resource loading

The application should use CSP where practical.

However, CSP must be compatible with:

Next.js
Clerk
analytics
Sentry
PWA assets
service workers
approved third-party integrations
8. CSP Approach

The project should start with an explicit restrictive policy and loosen it only when a legitimate application dependency requires it.

Conceptually:

default-src 'self'

with additional directives added intentionally.

Do not use an unnecessarily broad policy such as:

default-src *

as a convenience.

9. script-src

Scripts should be restricted to trusted sources.

Avoid unnecessarily allowing:

*

or broad third-party script execution.

If a trusted authentication or analytics provider requires an external script source, it should be explicitly documented.

10. Inline Scripts

Inline scripts should be avoided where practical.

If the framework requires controlled inline execution, the implementation should use an appropriate CSP mechanism such as:

nonce

or another framework-supported approach.

Do not weaken CSP simply because an implementation is inconvenient.

11. style-src

The application should allow only the style sources actually required.

If the frontend framework or styling system requires inline styles, the CSP implementation must account for that intentionally.

Avoid broad wildcard policies.

12. img-src

Images may come from:

self
approved application storage
approved external sources

Only required sources should be permitted.

This becomes particularly important if future progress-photo storage is introduced.

13. connect-src

Network destinations should be restricted where practical.

Potential destinations include:

application API
authentication provider
observability provider
approved external APIs

A wildcard connection policy should not be used simply to avoid debugging CSP issues.

14. font-src

Fonts should be loaded only from approved sources.

If the application uses local fonts, prefer:

self

where possible.

15. frame-ancestors

The application should restrict which origins may embed it in frames.

For an application that does not need third-party framing, an appropriate restrictive policy should be used.

This helps reduce clickjacking risk.

16. Clickjacking Protection

The application should prevent unauthorized framing.

Possible mechanisms include:

Content-Security-Policy: frame-ancestors ...

and, where appropriate:

X-Frame-Options

The CSP policy is the modern primary mechanism.

17. X-Content-Type-Options

Production should use:

X-Content-Type-Options: nosniff

This reduces browser MIME-type sniffing behavior.

18. Referrer Policy

The application should use an intentional:

Referrer-Policy

rather than relying entirely on browser defaults.

The policy should minimize unnecessary URL information being sent to external destinations.

A privacy-conscious policy should be selected during implementation.

19. Permissions Policy

The application should consider:

Permissions-Policy

to limit browser capabilities that the application does not need.

Examples may include:

camera
microphone
geolocation
payment

Only required capabilities should be enabled.

20. Camera Access

The application may eventually use camera functionality for:

QR scanning
other approved workflows

Camera access should be requested only when the user intentionally initiates a feature that requires it.

The application should not request camera permission globally on page load.

21. Geolocation

The application does not currently require geolocation as a core security mechanism.

Therefore geolocation should not be enabled unnecessarily.

If a future feature requires it, the requirement should be explicitly documented.

22. Microphone

The application does not currently require microphone access.

It should not request microphone permission.

23. Browser Storage

The PWA may use browser storage for appropriate client-side state.

Sensitive authentication state should follow the authentication provider's recommended secure mechanism.

Do not store sensitive credentials in arbitrary:

localStorage
sessionStorage
IndexedDB

without a documented security reason.

24. Authentication Cookies

If authentication uses cookies, secure cookie attributes should be used according to the authentication provider and framework requirements.

Where applicable:

Secure
HttpOnly
SameSite

should be configured appropriately.

The exact settings depend on the authentication architecture.

25. Authentication Provider

Clerk is currently the leading authentication candidate.

Browser security configuration must remain compatible with Clerk's documented authentication model.

Application authorization remains separate from authentication-provider configuration.

26. CSRF

CSRF protection depends on how authentication credentials are transported.

If authentication relies on browser cookies, the application must use an appropriate CSRF protection strategy.

The exact mechanism is not finalized by this ADR.

The project must not assume:

"authenticated = automatically CSRF safe"
27. Cross-Origin Requests

The application should use a deliberate CORS policy.

Production should not broadly allow:

*

for authenticated APIs.

Only trusted application origins should be permitted where cross-origin requests are required.

28. Same-Origin Preference

Where practical, the PWA and API should operate within the same trusted application origin.

This reduces unnecessary cross-origin complexity.

The initial architecture should avoid introducing separate frontend/API domains without a concrete requirement.

29. Service Workers

The PWA may use a service worker.

Service-worker behavior must be considered separately from ordinary browser page requests.

The implementation must ensure that:

authentication is not bypassed by cached responses
private API responses are not accidentally cached
stale sensitive data is not served to the wrong user
service-worker scope is correct
service-worker updates are handled safely
30. Sensitive API Caching

Authenticated sensitive API responses should generally not be treated as publicly cacheable.

Examples:

member profile
payment status
attendance history
organization dashboard
staff information

Caching rules must prevent one user's private data from being served to another user.

31. PWA Offline Behavior

Offline support must not weaken authorization.

The initial PWA should prioritize safe behavior over aggressive offline caching.

If offline functionality is added later, each cached data type must be classified as:

public
user-specific
organization-specific
sensitive

before being cached.

32. QR Routes

Gym QR entry routes may be publicly reachable because the QR identifies a gym.

However, the route must expose only information intentionally designed to be public.

The QR itself must never grant authenticated member privileges.

33. URL Parameters

Sensitive information should not be placed unnecessarily in URLs.

Avoid putting:

OTP
access tokens
private credentials
sensitive payment information

in query parameters or paths.

URLs may appear in:

browser history
logs
analytics
referrer information
34. Authentication Tokens

Authentication tokens must not be placed in:

URL query parameters
HTML
public logs
analytics events

unless the authentication provider explicitly requires a temporary mechanism and the flow is designed securely.

35. Error Pages

Production error pages must not expose:

stack traces
environment variables
database connection details
internal paths
provider credentials

Detailed diagnostic information belongs in protected server-side observability systems.

36. Development Error Pages

Development may expose more detailed diagnostics to developers.

However, development behavior must not accidentally ship to production.

Production builds and runtime configuration must disable unsafe debug behavior.

37. Source Maps

Source maps can improve debugging but may expose application implementation details.

The deployment strategy should decide whether production source maps are:

public
private
uploaded only to observability provider
disabled

If Sentry is used, private source-map upload may be preferred over publicly exposing source maps.

The final choice depends on deployment tooling.

38. Third-Party Scripts

Every third-party browser script should have a concrete reason.

Examples may include:

authentication
analytics
observability

Before adding one, evaluate:

security
privacy
performance
CSP impact
data sharing
vendor dependency

Do not add scripts merely because they are convenient.

39. Third-Party Frames

External iframes should be treated as untrusted integrations.

Avoid embedding third-party content unless there is a clear product requirement.

Payment or authentication integrations must follow their provider's documented secure integration method.

40. External Links

Links to external websites should be handled safely.

Where a link opens a new browsing context, the implementation should account for reverse-tabnabbing protections.

Modern browser behavior reduces some historical risks, but explicit safe handling remains preferable.

41. HTML Injection

User-generated content must never be inserted into HTML without appropriate escaping/sanitization.

Potential user-controlled content includes:

gym name
member name
announcement text
notes
payment notes

The frontend must not assume that stored database text is safe HTML.

42. Rich Text

The initial product should avoid arbitrary HTML input where possible.

If rich text is introduced later, it requires:

sanitization
allowed-tag policy
URL validation
script prevention
security testing
43. DOM-Based XSS

Frontend code must avoid unsafe DOM APIs unless required and carefully controlled.

Examples requiring review include:

innerHTML
dangerouslySetInnerHTML
dynamic script insertion
untrusted HTML rendering

User-controlled data should remain text unless there is a documented reason to render HTML.

44. Open Redirect Protection

Authentication and navigation flows should validate redirect destinations.

Do not blindly redirect to arbitrary user-provided URLs.

Example unsafe concept:

/login?redirect=https://malicious.example

Redirect destinations should be restricted to approved internal routes/origins.

45. Password Reset / Recovery Redirects

If account recovery flows are introduced, redirect destinations must be validated.

Authentication-provider defaults should be reviewed rather than overridden casually.

46. Browser Security and Multi-Tenancy

Browser controls do not replace backend tenant isolation.

Even if the UI hides another organization's data, the API must independently enforce:

organization membership
role
resource ownership
47. Browser Security and Payment Data

Browser security does not establish payment validity.

A malicious client can modify:

amount
status
membership ID
organization ID

before sending a request.

The server must independently validate every payment operation.

48. Browser Security and Attendance

The client cannot be trusted to determine:

which gym
which member
whether membership is valid
whether attendance already exists

The server must enforce those rules.

49. Security Headers in Development

Development may use a less restrictive CSP when necessary for tooling.

However, production policy must be explicitly tested.

Do not assume that a development CSP automatically represents production security.

50. Security Header Testing

Production security headers should be tested using automated checks and manual browser verification.

At minimum verify:

HTTPS
HSTS where enabled
CSP
X-Content-Type-Options
Referrer-Policy
frame protections
Permissions-Policy
cookie attributes
51. CSP Testing

CSP changes should be tested across:

owner login
member login
owner dashboard
member dashboard
QR flow
payment flow
attendance
PWA installation
service worker
third-party integrations

A security header is not considered complete if it breaks legitimate product behavior.

52. Report-Only CSP

Where practical, a CSP may initially be deployed in report-only mode to identify legitimate dependencies before enforcement.

Conceptually:

CSP Report-Only
      ↓
Observe violations
      ↓
Fix legitimate dependencies
      ↓
Enforce CSP

The exact rollout mechanism depends on hosting/framework support.

53. Security Headers and Monitoring

Security-policy violations may be useful observability signals.

Examples:

CSP violations
unexpected origin requests
unexpected script execution attempts

Care must be taken not to log sensitive browser data unnecessarily.

54. Security Header Changes

Security-header changes should be treated as security-sensitive changes.

They should include:

implementation
testing
browser verification
documentation
deployment review

when they materially affect production behavior.

55. Dependency Changes

Adding a third-party dependency solely to implement a security header should be justified.

Prefer built-in framework/platform mechanisms when they are sufficient.

Avoid unnecessary security middleware layers.

56. Compatibility

Security configuration must be tested against supported browsers and devices.

The PWA should remain functional on the browsers targeted by the product.

If a security feature causes compatibility problems, the tradeoff must be documented rather than silently weakening the policy.

57. Security Header Review Checklist

Before production release:

[ ] HTTPS enabled
[ ] HSTS reviewed
[ ] CSP reviewed
[ ] X-Content-Type-Options configured
[ ] Referrer-Policy configured
[ ] Frame protection configured
[ ] Permissions-Policy reviewed
[ ] CORS reviewed
[ ] Cookie security reviewed
[ ] Sensitive API caching reviewed
[ ] Service-worker caching reviewed
[ ] Error pages reviewed
[ ] Third-party scripts reviewed
[ ] Redirect handling reviewed
[ ] Browser security tests passed
58. What This Decision Does Not Finalize

This ADR does not finalize:

exact CSP directives
exact HSTS duration
exact CORS origins
exact cookie attributes
exact Permissions-Policy directives
exact service-worker caching strategy
production source-map policy
exact CSRF implementation
final third-party browser integrations

These should be finalized during implementation and deployment hardening.

59. Consequences
Positive
Reduced browser-side attack surface
Better protection against common web attacks
Safer PWA behavior
More deliberate third-party integration
Reduced accidental data exposure
Stronger production security posture
Negative
CSP can introduce integration complexity
Security headers require browser testing
PWA caching becomes more carefully controlled
Third-party integrations require additional review
Incorrect policies can break legitimate functionality

These costs are accepted because browser security is part of the application's production security boundary.

60. Final Rule

Browser security is defense in depth.

Security headers, cookies, CSP, CORS, PWA behavior, and browser permissions improve security, but they never replace:

server-side authentication
server-side authorization
tenant isolation
input validation
database constraints
transaction safety
rate limiting
audit logging

The browser is an untrusted client.

The server remains the final authority.
