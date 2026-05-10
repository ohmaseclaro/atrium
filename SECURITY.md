# Security policy

Atrium is auth-adjacent infrastructure: it brokers control of a real Chromium between a server-side automation and a human end-user, and it exports browser cookies and Playwright `storageState` back to the host. We take reports about its security model seriously.

## Supported versions

The `@atriumjs/*` packages are pre-1.0. We only ship fixes on the latest minor.

| Package version | Supported |
| --------------- | --------- |
| `0.3.x`         | Yes       |
| `< 0.3`         | No        |

Anything below the supported line: please upgrade before reporting, since the fix may already be in `latest`.

## Reporting a vulnerability

**Do not open a public issue.** Public disclosure before a patch ships puts every Atrium user at risk.

Use one of these channels instead:

1. **GitHub private vulnerability report** (preferred) — https://github.com/ohmaseclaro/atrium/security/advisories/new. This routes directly to the maintainers and lets us coordinate a fix + CVE in a private fork.
2. **Email** — security at atriumjs dot dev. Include the same information as the GitHub form.

Please include in your report:

- A description of the issue and the threat model it breaks (who attacks whom, with what access).
- A minimal reproduction or proof-of-concept. The smaller and more deterministic the repro, the faster the fix.
- The affected version(s) and commit SHAs.
- Any suggested mitigations or patches if you have them.

### What to expect

- **Acknowledgement**: within 3 business days. If you haven't heard back, please re-send through the other channel — mail occasionally falls into spam.
- **Triage**: within 7 days we'll tell you whether we accept the report, what severity we assign (CVSS 3.1), and a target patch date.
- **Fix and disclosure**: critical and high-severity issues are patched and released within 14 days of triage; medium within 30 days; low within 90 days. We coordinate disclosure with you and publish a GitHub Security Advisory naming the reporter (unless you ask to stay anonymous).

We don't run a paid bounty program yet. We'll credit you in the advisory and the release notes, and we'd love to send a thank-you note.

## In scope

Atrium's stated threat model is documented in [`docs/remote-browser-design.md`](docs/remote-browser-design.md). Roughly, the surfaces we care about:

- **Host ↔ API** (the `@atriumjs/express` middleware). Tenant-scoped session authorization, the URL allowlist enforced on viewer-driven navigation, mTLS material handling, snapshot/cookie export endpoints.
- **API ↔ Worker** dial WebSocket. `ATRIUM_WORKER_SECRET` handling, timing-safe credential compare, the `publicBaseUrl` defense.
- **Viewer ↔ API** WebSocket relay. Viewer-token capability scope, allowlist filter on inbound `navigate` messages, control-transfer state machine.
- **Worker → Browser**. Chromium launch flags, stealth defaults, passkey refusal, clipboard bridge.
- **Snapshots and credentials**. Cookies and `storageState` must never leave the host-authenticated HTTP endpoints.
- **Default configurations** under `policies.demo()` and the example apps. We treat insecure defaults as bugs.

Examples of issues we'd consider in scope:

- Cross-tenant access to a session, its cookies, or its control state.
- Any way for a viewer-only token to read worker secrets, navigate outside the URL allowlist, or read another tenant's data.
- Authentication bypass on the API, worker, or relay surfaces.
- Server-side request forgery via session navigation or snapshot bootstrap.
- Memory or file-descriptor leaks reachable from a public endpoint that an attacker can use to degrade availability.
- Insecure defaults that ship in `demoPolicies()` or the published Docker image.

## Out of scope

The following are not vulnerabilities for the purposes of this policy:

- **Reports against third-party sites** that Atrium's worker visits. If a site you're handing the user to has its own bug, report it to that site.
- **Reports requiring a malicious admin** who already has the API host token. Anyone holding that token controls the system by design.
- **Self-XSS** in a page you yourself visit inside the remote browser. The whole point of the product is that the user types into a real browser; what they type is theirs.
- **Denial of service via expensive but legitimate API usage** when `AtriumPolicies` limits are not configured. Configure them (`maxConcurrentSessionsPerTenant`, `sessionTtlMs`, `idleTtlMs`, `urlAllowlist`) — see the user guide.
- **Missing security headers** on the optional static landing page at `atriumjs.dev`. The landing page is content-only and ships no Atrium machinery. Please still report them — we'll fix — but they aren't tracked as advisories.
- **Outdated dependencies** without a demonstrated exploit path in Atrium's code. Please open a regular PR or issue for those.

## Hardening pointers for operators

Even with a clean security model, your deployment configuration carries most of the risk. The minimum we recommend before pointing real users at Atrium:

- Set `policies.urlAllowlist` to the smallest set of origins your flow needs. Default-deny.
- Rotate `ATRIUM_WORKER_SECRET` on a schedule and on every suspected compromise.
- Put the worker network behind a private VPC or a tight firewall; only the API tier should reach `ws://worker/internal/stream/:sessionId`.
- Set `publicBaseUrl` explicitly when running behind a reverse proxy; do not trust the request `Host` header.
- Use mTLS for any host ↔ API hop that leaves your private network.
- Enable per-tenant quotas (`maxConcurrentSessionsPerTenant`) and the idle / session TTL janitor.
- For public demos, start from `demoPolicies()` (per-IP rate limit, 3-min session TTL, URL allowlist locked to the demo flow) and add a Cloudflare WAF rule on top.

See [`docs/remote-browser-design.md`](docs/remote-browser-design.md) §"Security model" for the full version.

---

Thanks for helping keep Atrium and its users safe.
