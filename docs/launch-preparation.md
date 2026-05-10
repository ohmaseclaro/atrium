# Atrium — Launch Preparation Guide

> Goal: arrive at launch day with every account, asset, draft, and surface ready, so launch day is execution-only.
> Recommended timeline: **7 days** before launch. You can compress to 3–4 if you push, but the warmup matters.

---

## Day -7 to Day -5 — accounts, assets, infra

### 1. Accounts to create (or polish)

Create these and set the profile fields **today**. Most can sit dormant for a few days; some need karma/aging.

| Platform            | Action                                        | Notes                                                                                                                                                                                                                                                                                                 |
| ------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hacker News**     | Create account if you don't have one          | https://news.ycombinator.com/login. Show HN does not require karma, but a real account history (any prior comments) helps avoid auto-flagging. Make 2–3 thoughtful comments on existing posts in the days before launch.                                                                              |
| **Reddit**          | Use existing or create one with real activity | r/programming heavily auto-mods new accounts. Either use an aged account or be ready to use friendlier subs (r/SideProject, r/webdev, r/javascript, r/typescript) which are more permissive. Comment on a few posts in target subs first.                                                             |
| **Product Hunt**    | Create maker profile                          | https://www.producthunt.com — fill out bio, link to GitHub + atriumjs.dev. PH launches must be queued; do this on Day -5 minimum.                                                                                                                                                                     |
| **Indie Hackers**   | Create account, fill profile                  | https://www.indiehackers.com. Friendly community for indie OSS.                                                                                                                                                                                                                                       |
| **dev.to**          | Create account                                | https://dev.to. Long-form post will live here.                                                                                                                                                                                                                                                        |
| **LinkedIn**        | Polish existing profile                       | Add Atrium to "Projects" or pin a post. Update headline to mention "building open-source remote browser infrastructure" or similar.                                                                                                                                                                   |
| **X / Twitter**     | Polish existing                               | Bio: 1-line about what you build. Header image: Atrium logo or demo screenshot. Pinned tweet (after launch): the launch thread.                                                                                                                                                                       |
| **Discord servers** | Join 5–8 relevant servers                     | Read rules. Most have a `#showcase` or `#self-promotion` channel. Do NOT post yet — lurk and read for a few days. Suggested servers to find via Google: Reactiflux, TypeScript community, Vercel community, AI Engineers, Browser Use community, plus any servers around Playwright / web automation. |

### 2. Assets to produce (the highest-leverage work)

The demo video is more important than the entire launch thread. Spend serious time on it.

#### a. **Demo video — 30–45 seconds**

Record on a clean machine (no notification banners, no extra tabs). Use QuickTime / OBS / Screen Studio.

Script:

1. (0–3s) Open the app. Show the "Login and post" button.
2. (3–8s) Click it. Real Chromium fades in. Status pill shows "Automation in control."
3. (8–18s) X login screen appears. Pill flips to "You have control." You type credentials.
4. (18–25s) Click "I'm logged in — post my tweet." Pill flips back to "Automation in control."
5. (25–35s) Watch the agent compose and post the tweet.
6. (35–40s) Show the resulting tweet on a real X tab.

Captions overlaid (optional but huge for sharing): "Real Chromium. In your React app. Hand control to a human. Get the cookies back."

Export as:

- MP4 (1080p, ~10 MB) for X and LinkedIn
- GIF (~5 MB max for X, lower fps if needed) for README and embedded use
- 720p version for low-bandwidth sharing

Save to `assets/demo/` in the repo so the README links work.

#### b. **Static screenshots**

- The `<RemoteBrowser />` component embedded in a Next.js-style page (the demo)
- The control pill "You have control" close-up
- Code snippet (`<RemoteBrowser session={session} />`) in Carbon style — use https://carbon.now.sh or https://ray.so

#### c. **Logo / favicon**

If you don't have one, generate a wordmark logo: clean sans-serif "atrium" with a small architectural / pillar / vault icon. Use 256×256 PNG and SVG. Don't overthink this — many viral OSS projects launched with a typeset wordmark.

### 3. Infra to ship before launch

- [ ] **Public live demo at `demo.atriumjs.dev`** — this is the single biggest conversion lever. Wire `demoPolicies()` from `@atriumjs/core/policies` (per-IP rate limit, 3-min session TTL, URL allowlist locked to the X login flow). Cloudflare WAF on; aggressive bot rules.
- [ ] **GitHub README** polished. First-screen elements:
  - Demo GIF at the top
  - One-line pitch
  - Three-line install snippet
  - Link to live demo at atriumjs.dev
  - Three bullets of differentiators
  - Then the deeper docs links
- [ ] **GitHub repo metadata**: description, topics (`remote-browser`, `playwright`, `chromium`, `oauth`, `captcha`, `human-in-the-loop`, `automation`, `ai-agents`, `mfa`, `browser-automation`), website (https://atriumjs.dev), license badge in README, CI badge, npm version badges.
- [ ] **GitHub repo "About" right rail** filled in completely.
- [ ] **CHANGELOG.md** at root, populated by `pnpm exec changeset version`.
- [ ] **CONTRIBUTING.md** with how to set up locally, run tests, submit PRs.
- [ ] **CODE_OF_CONDUCT.md** (use the standard Contributor Covenant).
- [ ] **SECURITY.md** with how to report security issues — important for an auth-adjacent library.
- [ ] **GitHub Issue templates** under `.github/ISSUE_TEMPLATE/`: bug report, feature request.
- [ ] **GitHub Discussions** enabled on the repo (better than relying on Issues for "how do I…" questions).
- [ ] **Sponsors button enabled** if you want one (`.github/FUNDING.yml`).
- [ ] All packages published to npm at v0.3.0 with provenance.

### 4. atriumjs.dev landing page

If you only have time for one page: minimal hero with the demo video, three differentiators, install snippet, "Try the live demo" button, GitHub link. Static HTML or a small Next.js app — doesn't matter. Should load in under 1 second.

If you have time for a richer page: add a "How it works" section, a code playground (CodeSandbox or StackBlitz embed), and a quick-start that mirrors the README.

---

## Day -5 to Day -3 — drafts and warmup

### 5. Pre-write every post (don't draft on launch day)

Save these in a single doc you can copy/paste from on launch day. Each draft is below; see the **Execution** guide for when to post each.

#### Show HN post

```
Title: Show HN: Atrium – open-source remote browser for OAuth/captcha/MFA handoff

(post body — leave the URL field linking to the GitHub repo)

Hi HN — Atrium is an open-source library that streams a real Chromium session
into your React app over WebSocket, so when an automation hits a login screen,
captcha, or MFA prompt, you can hand control to your end-user, let them
complete it, and resume the run with their cookies + Playwright `storageState`.

The motivating problem: every "AI browser agent" demo I watched died the
moment a third party asked for a human. Most production scrapers and
onboarding flows hit the same wall. Atrium is the missing 30-second handoff
between "agent driving" and "human typing a password."

How it works: Express middleware mounts session-management endpoints + a
viewer WebSocket relay, a worker (Chromium + Playwright) accepts dials from
the API tier and streams JPEG screencast frames over the same socket, and a
React component renders the canvas + forwards mouse/keyboard back. The
control state is server-authoritative — only one writer at a time, agent or
human, never both.

What's in v0.3.0: per-tenant quotas + idle/session TTL janitor, URL allowlist
on viewer-side navigation, mTLS client cert support (PEM or PFX), passkey-
aware (refuses gracefully so sites fall back to password), stealth Chromium
under Xvfb headed by default, multi-tab support, session snapshot/bootstrap
APIs in Playwright `storageState` shape.

What's not done: Fastify/Hono/Next/NestJS adapters (designed, not shipped),
multi-region demo orchestration, BullMQ-backed allocator for >50 concurrent
sessions per node. Roadmap is in docs/atrium-v2-design.md.

Live demo: https://demo.atriumjs.dev (rate-limited; locked to the X login
flow because shipping a public proxy is a bad idea).

Repo: https://github.com/ohmaseclaro/atrium
Docs: https://atriumjs.dev (or wherever your docs live)

Happy to answer questions about the architecture, the security model, or
why I went with dial-over-WS instead of BullMQ. Roast it if you see something
wrong — there's still a v0.4 to design.
```

HN tip: be transparent about what's broken or unfinished. The community rewards honesty and punishes marketing language.

#### Reddit r/SideProject

```
Title: I built an open source remote browser library for OAuth/captcha/MFA handoff

(body)

Hey r/SideProject — wanted to share Atrium. It's a remote-browser primitive:
real Chromium streamed into a React app over WebSocket, with a server-
authoritative control state so you can hand keyboard/mouse to your end-user
when the site asks for credentials, then resume automation with their
session cookies.

[demo video/gif]

I built it because every AI agent I tried hit the same wall — login screen,
captcha, run dies. Atrium is the 30-second handoff that makes the loop work.

Three packages, three lines:
npm install @atriumjs/express @atriumjs/react @atriumjs/worker

Live demo: demo.atriumjs.dev
GitHub: github.com/ohmaseclaro/atrium

MIT licensed. v0.3.0 just shipped. Feedback / PRs / roasts welcome.
```

#### Reddit r/webdev (slightly different angle)

```
Title: Atrium — open source library that streams a real Chromium into your React app for OAuth/captcha handoff

(body)

For anyone building scrapers, AI agents, or onboarding flows that hit
third-party logins:

[demo gif]

Atrium gives you a `<RemoteBrowser />` React component that renders a live
Chromium session. When the site asks for credentials, the user types them
directly. When they're done, control flips back to your automation and you
get cookies + Playwright `storageState`.

Built on Playwright + CDP screencast over WebSocket. Server-authoritative
control state. URL allowlist. mTLS support. Passkey-aware.

github.com/ohmaseclaro/atrium — MIT
```

#### Reddit r/programming

r/programming is link-only and very strict about self-promo. Submit a link to a high-quality blog post or repo — not a "I made this" body. Use a neutral title like "Atrium: open-source remote-browser primitive built on Playwright + CDP screencast." Expect strict moderation; don't be discouraged if it doesn't take.

#### LinkedIn long-form post

```
I shipped Atrium today — open-source remote browser infrastructure for
human-in-the-loop automation.

The problem: every AI browser agent I watched died at the same step. The
moment a third party demanded a human — OAuth screen, captcha, MFA, passkey
— the automation stopped. There's no clean way around it. You either scrape
passwords (don't), proxy the entire login UI through your service (security
nightmare), or you don't ship the feature.

There's a fourth option: stream the real browser to the user, let them sign
in directly, and exfiltrate the session cleanly. That's Atrium.

Three packages. One Express middleware, one React component, one Docker
worker. The user sees a live Chromium tab embedded in your app. They type
credentials. You get back Playwright `storageState`. Resume automation.

What I learned building it:

— Server-authoritative state matters more than I expected. The control
handoff is one flag, but getting it right (only one writer at a time,
across reconnects, across tabs) ate a third of the implementation time.

— The security regression you didn't think about: I added an imperative
`navigate()` method on the React component to make the SDK nicer, then
realized a viewer with a token could navigate the remote page anywhere —
bypassing the URL allowlist. Filter at the relay layer, not at the worker.

— Playwright vs raw CDP: I tried raw CDP first. Playwright won by a mile
once you need contexts, storageState, and network interception.

v0.3.0 is on npm under @atriumjs/*. Live demo at demo.atriumjs.dev.
Code at github.com/ohmaseclaro/atrium. MIT.

If you're building agents, scrapers, or onboarding flows that hit captchas
— I'd love feedback.
```

LinkedIn tip: posts under 1300 characters perform best, but technical write-ups can break that rule if they're substantial. Add the demo video as the post media. Don't put the GitHub link in the post body — put it in the first comment. (LinkedIn's algorithm down-ranks posts with external links.)

#### dev.to long-form post

Title: "Why I built an open-source remote browser for AI agents (and what I learned)"

This is the engineering story version. ~2000 words. Cover:

1. The problem (every AI agent hits OAuth)
2. Existing options and why they fall short (Browserbase, Steel, Hyperbeam, Operator)
3. The architecture (dial pattern, Playwright, CDP screencast)
4. The hard parts (control handoff, the URL allowlist regression, IME composition, modifier flush)
5. What's next (framework adapters, BullMQ allocator, hosted version)
6. Links to the repo

#### Indie Hackers post

```
Title: Shipped Atrium: open-source remote browser library

Just shipped my first public OSS library — Atrium. It's a remote browser
primitive: real Chromium streamed into your React app, with a clean
handoff pattern so users can sign in to OAuth/MFA/captcha-protected sites
without your service ever seeing their password.

Built it solo over [N] weeks. Six npm packages, MIT licensed, v0.3.0.

[demo gif]

Live: demo.atriumjs.dev
Code: github.com/ohmaseclaro/atrium

Looking for feedback from anyone building agent infra, scrapers, or
onboarding flows. Already have ideas for v0.4 but want to hear what's
actually painful in production first.
```

#### Product Hunt page

Tagline: "Open-source remote browser for OAuth/MFA/captcha handoff"
Description: same as Reddit r/webdev draft.
Launch images: demo GIF + 3–4 product screenshots.
Topics: Developer Tools, Open Source, Web App.

PH lets you preview your launch and queue it. Do this on Day -5 minimum so the maker comments can be drafted in advance.

#### X thread

Use the 8-tweet version from the previous reply, paired with the demo video on tweet 1.

### 6. Outreach list — 10 people

Make a spreadsheet. Columns: Name, Handle, How to reach (X DM / email / both), Why they'd care, Pre-launch context to mention.

Suggested categories:

1. Founder of Browserbase (`Paul Klein`) — peer, not competitor. Frame: "thought you'd want to see what an open-source-only take on this looks like."
2. Founder/maintainer of Steel (`steel-dev`) — closest open-source peer. Frame: "what I built on top of patterns I learned from your repo."
3. Stagehand maintainers — agent infra people who'd recognize the pain.
4. Anthropic devrel team (e.g., Alex Albert, Nick Turley if you can find equivalents) — agent infra is their bread and butter.
5. Theo (`@theo`) or any other Twitter dev with a habit of boosting OSS launches. Don't ask for amplification — ask for technical feedback.
6. 2–3 well-known scraper / automation YouTubers or bloggers.
7. 1–2 Playwright maintainers / contributors.
8. Anyone you know personally in agent infra or browser automation.

Draft DM template:

```
Hey [name] — I just shipped an open-source library you might find interesting.
It's a remote-browser primitive for human-in-the-loop OAuth/captcha handoff.

Saw you've worked on [specific thing they built]. Curious what you think of
the architecture, especially [specific thing relevant to their work].

Demo: demo.atriumjs.dev
Code: github.com/ohmaseclaro/atrium

No expectations — feedback only. Roast it if you see something wrong.
```

### 7. Pre-launch warmup activities

#### a. X warmup (Day -7 to Day -1)

Pick 3 themes you'll engage with: AI agents, browser automation, OAuth/auth pain. Spend 30 minutes/day replying intelligently to existing conversations. Do not pitch Atrium. Just be useful — answer technical questions, share an opinion, point to relevant docs. By Day 0 you should have 30–80 followers and be a recognized voice in the niche.

#### b. LinkedIn warmup (Day -7, Day -3)

Post twice before launch:

- Day -7: a short engineering reflection ("Working on [hard problem]. The thing I didn't expect was [insight]."). 200–400 words.
- Day -3: another similar post about a different aspect of building Atrium.

Each post seeds the algorithm so your launch post on Day 0 reaches more of your network's network.

#### c. Hacker News warmup

If your HN account is new or low-karma, leave 2–3 thoughtful comments on existing posts about adjacent topics (AI agents, browser automation, web scraping). Build a real comment history.

#### d. GitHub repo polish

People who land on the repo from any of these channels will scan for 10 seconds. Make those 10 seconds count.

- README opens with the demo GIF.
- Star the repo yourself, get 2–3 friends to star it. Repos with 0 stars feel abandoned even if they're new.
- Pin a discussion topic ("How are you using Atrium?") so visitors see active community.

### 8. Final pre-launch sanity check (24 hours before launch)

- [ ] CI green on the latest commit on `main`.
- [ ] All six packages published to npm at v0.3.0; verify with `npm view @atriumjs/express version`.
- [ ] Live demo at demo.atriumjs.dev works end-to-end. Test from a different network (mobile hotspot).
- [ ] README's demo GIF loads correctly on github.com (cached versions sometimes break).
- [ ] All draft posts proofread. Run them through a grammar tool.
- [ ] Outreach list finalized; DMs drafted in your X drafts folder.
- [ ] Phone alarms set for launch day timeline.
- [ ] Plan to be at your computer for **at least 4 hours** after the HN submission. The first comments determine whether the post stays on the front page or sinks.
- [ ] Close all distractions. Disable Slack, mute Discord. Launch day is execution-only.
- [ ] Backup plan: if HN doesn't take, the launch isn't dead — Reddit + LinkedIn + DMs continue.

---

## Notes & gotchas

- **Don't double-post the same content across X and LinkedIn.** The audiences overlap less than you think; rewrite per platform.
- **Don't post to all subreddits the same day.** Reddit will flag cross-posting as spam. Stagger Reddit posts across Day 0–Day +2.
- **Don't post to Brazilian Facebook groups in English.** Translate properly to Portuguese if you choose to use that channel.
- **Don't use the word "revolutionary" or "game-changing."** HN, Reddit, and Twitter all sniff out marketing language and downvote it.
- **Don't be defensive in the comments.** When someone pokes a hole in the design, thank them and engage technically. The thread quality below your post is half of the algorithm signal.
- **Your X account is not the launch.** It's documentation. Stop refreshing X metrics; refresh HN and the GitHub stars instead.
