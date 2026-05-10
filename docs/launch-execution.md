# Atrium — Launch Execution Guide

> Use this on launch day and the week after.
> Assumes the **Preparation Guide** is complete: accounts created, demo video shot, live demo deployed, all drafts written.

---

## Choose the launch day

Pick a **Tuesday, Wednesday, or Thursday**. Avoid Mondays (week-start noise) and Fridays (people checked out).
Avoid US holidays. Avoid the day after a major tech event (everyone's tweeting about that).

Best windows for HN traffic, in order:

1. Tuesday 9am–10am Pacific (12pm–1pm Eastern, 6pm–7pm Central European Time)
2. Wednesday same window
3. Thursday same window

The 9am Pacific submission catches the US tech industry waking up + Europe still in afternoon work + India dropping into evening. It's the densest engaged-audience overlap.

---

## Day 0 — hour-by-hour timeline

All times below are in **Pacific Time**. Convert to your local zone in advance and put alarms on your phone.

### 06:30 — wake-up routine

- [ ] Check CI on `main`. If anything is red, fix or revert. Do not launch on a red branch.
- [ ] `npm view @atriumjs/express version` → confirm 0.3.0 (or whatever you tagged).
- [ ] `curl -I https://demo.atriumjs.dev` → 200.
- [ ] Click through the live demo from a fresh incognito window. End-to-end. Login with throwaway credentials. Watch the tweet post. Confirm everything works.
- [ ] Eat breakfast. You won't have time later.

### 08:00 — final asset check

- [ ] Demo video uploaded to a fast CDN (Cloudflare Stream / Mux / direct S3) so HN's traffic doesn't hammer GitHub's raw GIF endpoint.
- [ ] All draft posts open in tabs, ready to copy/paste.
- [ ] Phone DND on. Slack closed. Email closed.
- [ ] Open these tabs:
  - news.ycombinator.com (your account logged in)
  - reddit.com/r/SideProject/submit
  - reddit.com/r/webdev/submit
  - linkedin.com (logged in)
  - x.com/compose/post (logged in)
  - producthunt.com (your queued launch)
  - dev.to (your draft)
  - indiehackers.com
  - github.com/ohmaseclaro/atrium (the repo)

### 09:00 — Submit to Hacker News

This is the single highest-stakes action of the day.

- [ ] On HN, click "submit"
- [ ] **Title**: `Show HN: Atrium – open-source remote browser for OAuth/captcha/MFA handoff`
- [ ] **URL field**: `https://github.com/ohmaseclaro/atrium`
- [ ] **Text field**: leave EMPTY (HN auto-pulls from URL; the body explanation goes in your first comment)
- [ ] Submit

### 09:01 — first comment on HN (within 60 seconds)

Post your first comment. This shows up at the top and is read by every visitor.

```
Author here — happy to answer questions.

Atrium streams a real Chromium session into your React app over WebSocket
so you can hand the keyboard to a human when a third party demands one
(OAuth, MFA, captcha) and resume automation with their session cookies +
Playwright `storageState` afterwards.

Architecture: Express middleware mounts session HTTP routes + a viewer
WebSocket relay; an inbound-dialed Playwright worker streams JPEG screencast
frames; a `<RemoteBrowser />` React component renders the canvas and
forwards input. Server-authoritative control state — only one writer at a
time, agent or human, never both.

What's implemented: per-tenant quotas, idle/session TTL janitor, URL
allowlist on viewer-driven navigation, mTLS client cert support (PEM or
PFX), passkey-aware refusal, multi-tab.

What's not: Fastify/Hono/Next/NestJS adapters (designed in
docs/atrium-v2-design.md, not shipped), BullMQ-backed allocator for >50
concurrent sessions per node, multi-region demo orchestration.

Live demo: https://demo.atriumjs.dev (rate-limited; locked to the X login
flow because shipping a public proxy would be irresponsible).

Roast it if you see something wrong — there's still a v0.4 to design.
```

### 09:05 — post the X thread

Paste tweet 1 (with demo video attached). Add tweets 2–8 as replies in quick succession. Quote-tweet tweet 1 with a link to the HN post once it's a few minutes old:

```
Live on Hacker News if you want to discuss the architecture: [HN link]
```

### 09:10 — post on LinkedIn

Paste your LinkedIn long-form post. Attach the demo video. Add the GitHub link in the **first comment**, not the body — LinkedIn down-ranks posts with external links in the body.

Within 5 minutes, like and reply to your own first comment so the GitHub link rises up the comment list. Reply to any colleagues/connections who like the post.

### 09:15 — Reddit r/SideProject

- [ ] Submit to r/SideProject (most permissive, indie-friendly).
- [ ] Title and body from your prep doc.
- [ ] Add the demo GIF or video as media.
- [ ] First comment from your account: same as your HN first comment, lightly rewritten.

### 09:25 — Indie Hackers

- [ ] Post to Indie Hackers.
- [ ] Tag yourself as the maker.

### 09:30 — DM and email outreach

- [ ] Send the 10 DMs from your outreach list. **Stagger them over 30 minutes** so you're not flagged as a spammer by X.
- [ ] Send 3–5 personal emails to the people who don't have public DMs.
- [ ] Each message references something specific they've worked on. Generic mass-DMs get ignored.

### 09:45 — first-hour engagement

You should now be sitting on HN. Do this loop continuously:

- Refresh HN every 60–90 seconds. **Reply to every comment within 5 minutes.**
- For criticism: thank the commenter, engage technically. Never defensive.
- For questions: answer concretely with file/line citations from the repo when possible.
- For "why not [other tool]?": acknowledge the comparison honestly. Don't trash the alternative.

Refresh Reddit threads every 5 minutes; same engagement rules.

LinkedIn comments: reply within 30 minutes. The algorithm rewards engagement velocity.

### 11:00 — Reddit second wave (if HN is going)

If HN is on the front page or has 50+ points, post to additional subs:

- [ ] r/webdev (use that prep doc draft)
- [ ] r/javascript (different angle: highlight TypeScript-first design)
- [ ] r/typescript (same)
- [ ] r/opensource (frame as an open-source project that needs eyes)
- [ ] r/selfhosted (only if you can frame the demo as something selfhosters care about — maybe stretch this one)

Stagger these by 10–15 minutes each. Reddit detects rapid-fire cross-posting.

If HN didn't take, **don't panic.** Many great launches get a so-so HN turnout and break later via word-of-mouth. Continue the schedule.

### 12:00 — lunch / hydrate

You're going to be at this for 6+ more hours. Take 30 minutes. Step outside.

### 12:30 — Product Hunt

If you queued PH for today: it's already live. Visit your launch page, comment as the maker, respond to comments. PH peak engagement is 10am–2pm Pacific.

### 13:00 — dev.to long-form post

Publish the dev.to article. This won't drive massive launch-day traffic, but it lives forever and ranks for SEO. People searching "open source remote browser" or "OAuth handoff library" months from now will find it.

### 14:00 — Discord servers

Visit each Discord server you joined. Post in the **`#showcase` or `#self-promotion` channel**, NOT the general or off-topic channels. Read the channel rules first; some require a specific format.

Sample Discord post:

```
Hey 👋 just shipped Atrium — open source remote-browser primitive
for human-in-the-loop automation. Streams real Chromium into your
React app over WebSocket, hand control to your end-user for OAuth/
captcha/MFA, get cookies back as Playwright storageState.

Live demo: demo.atriumjs.dev
Code: github.com/ohmaseclaro/atrium

MIT, v0.3.0. Looking for feedback / feature requests.
```

### 16:00 — afternoon engagement loop

Continue replying everywhere. By now HN momentum is either there or it isn't, but Reddit, LinkedIn, and DMs are still active.

### 18:00 — post-mortem (private to you)

Don't publish anything. Just write down for yourself:

- HN points + comments + ranking
- GitHub stars gained today
- npm downloads (check via npmtrends.com — they update next-day)
- X impressions on the launch tweet
- LinkedIn impressions
- Standout pieces of feedback (positive and negative)
- 3 things to do tomorrow

### 21:00 — end of Day 0

- Pin the X launch thread to your X profile.
- Pin the LinkedIn launch post.
- Pin a "Welcome — start here" discussion in GitHub Discussions for the wave of newcomers.
- Sleep. Tomorrow has its own work.

---

## Day +1 — Wednesday

The launch isn't done on Day 0. The first week is where the long tail happens.

### Morning

- Check overnight HN/Reddit/LinkedIn for late comments. Reply to all.
- Check GitHub issues. The first issues to come in are usually quick fixes — high-leverage to handle them within 4 hours, because contributors who feel responded to often become evangelists.
- Check npm downloads from yesterday — useful as a confidence baseline.

### Mid-morning — second X post

Post a follow-up clip. 10–15 second segment of the demo with one specific result:

```
Watch a real Twitter login + post happen with two `await`s and one component.

[10s clip]

This is what real-world OAuth handoff looks like in @atriumjs.

github.com/ohmaseclaro/atrium
```

This second post often outperforms the launch thread because the algorithm has now learned you have an audience.

### Afternoon — engineering deep-dive on LinkedIn

Post a short engineering story. ~400 words. Pick one thing you fixed in the last sprint and tell the story.

Example: "The security regression I caught (and how I fixed it)." Walk through how adding the imperative `navigate()` method created a URL-allowlist bypass, and how filtering at the relay layer was the right answer. This kind of post performs well on LinkedIn and demonstrates depth.

### Evening — community engagement

- Reply to every GitHub issue, PR, and discussion.
- Star + meaningfully comment on related projects (Steel, Browserbase Stagehand, Cap, etc.). Builds genuine community presence; not transactional.

---

## Day +2 to Day +7 — daily content plan

One small piece of content per day, each amplifying a different facet of Atrium. Each lands on a different platform's algorithm fresh.

| Day    | Platform                            | Content angle                                                                                                          |
| ------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Day +2 | X                                   | "Here's the wheel-scaling math: deltas scaled to remote viewport via deltaMode unit normalization." Code screenshot.   |
| Day +3 | LinkedIn                            | "Why Playwright over raw CDP — a 3-paragraph breakdown of what Playwright bought us and what we paid in dependencies." |
| Day +4 | dev.to                              | Tutorial: "Building a Cal.com-style scheduling agent that survives Google OAuth using Atrium." Code-heavy, reusable.   |
| Day +5 | X                                   | "How the URL allowlist filter survives 3 different transports (WS, SSE, polling)." Architecture sketch.                |
| Day +6 | Reddit r/javascript or r/typescript | "Lessons from typing every WebSocket message end-to-end." Writeup of the protocol package design.                      |
| Day +7 | LinkedIn or X                       | "Atrium's first week: stars, downloads, what surprised me." Vulnerability + transparency = strong engagement.          |

### Daily engagement loop (every day, ~30 min total)

- 5 min: Reply to comments on previous day's post.
- 10 min: Reply to every GitHub issue/PR/discussion.
- 5 min: Engage with 3 adjacent projects (star, comment, reply on their posts).
- 10 min: Skim X / LinkedIn for agent/automation/OAuth conversations and reply usefully (not pitchy).

---

## Contingency plans

### If HN doesn't take (less than 30 points after 2 hours)

This is **not** the end of the launch. ~70% of HN submissions don't make the front page; many of those projects still grow.

Pivot focus to:

- Direct DMs (more, more carefully personalized)
- LinkedIn (often lower ceiling than HN, but very steady)
- Reddit r/SideProject (which is forgiving of "not viral on day 1")
- Newsletter outreach: email TLDR Newsletter, BytesDev, Pointer, Console.dev, JavaScript Weekly. These can drive thousands of views each, and editors love OSS launches with clean READMEs.

### If something breaks under traffic

You will probably hit a real bug under launch traffic. Have these ready:

- A `STATUS.md` template you can update in real time and link from the README.
- The ability to roll the demo to a degraded mode (read-only, "demo at capacity, here's the GitHub" page). Wire the kill switch from `demoPolicies()` (DEMO_ENABLED=0).
- A list of common error messages with workarounds, ready to paste into HN comments.

### If the project is criticized publicly

Engage technically. Don't get defensive. Specifically:

- "This is just like [X], why use Atrium?" → answer the differentiator concretely with file:line evidence.
- "This is broken / has a security hole." → If they're right, thank them, file the issue, ship the fix that day. Public bug-fix-in-15-minutes is a positive signal, not a negative one.
- "Why not just use Playwright directly?" → explain that Atrium IS Playwright, plus the relay, control handoff, snapshot APIs, React component, and rate-limiting. The value is in the integration, not the engine.
- Trolls / unconstructive comments → ignore. Don't waste energy.

### If the demo gets abused

The `demoPolicies()` preset has aggressive defaults (1 session per IP every 90s, 3-min total session, locked URL allowlist) but a determined attacker can still cause cost spikes. Watch:

- Total concurrent sessions in your worker dashboard (>40 = approaching cap).
- Egress bandwidth from the worker host.
- CloudFlare WAF "challenge" rate.

If costs spike, rotate `ATRIUM_WORKER_SECRET` immediately and ship a tighter rate limit. Document the incident in a follow-up post — incident transparency builds trust.

---

## Success metrics — what to actually measure

Don't fixate on stars. Measure these in order:

1. **GitHub stars after 1 week** — a useful but noisy indicator. Healthy v0.x launch: 200–1,500 stars in week 1. Outliers: 5,000+ in 24h.
2. **npm downloads in week 2** — much more meaningful than stars. Stars come from people who like the README; downloads come from people who actually `npm install`. Healthy: 50–500 weekly downloads in week 2.
3. **Issues opened by people who aren't you** — every external issue is a real user. Aim for >5 in week 1.
4. **Stars-per-day curve** — if it's still > zero/day after week 4, you have organic growth. If it dropped to zero by week 2, the launch was a flash.
5. **HN front page rank** — useful to know but doesn't determine long-term success.
6. **Twitter follower count** — vanity. Don't chase.
7. **Inbound from companies** — if 1–2 companies reach out asking about commercial support / hosted version, that's a 6-month signal.

If after 2 weeks you have:

- < 100 stars: the launch under-performed but the project isn't dead. Iterate, ship a v0.4 with a sharp differentiator, relaunch.
- 100–500 stars + steady downloads: solid base. Focus on retention via good issue response and a steady content cadence.
- 500–2000 stars: actual momentum. Consider what the v1 commercial story looks like.
- 2000+ stars: rare but possible. Don't squander it — ship fast, hire help if you can, plan a v1 launch.

---

## After the dust settles (Day +7 onwards)

Once the launch wave subsides, Atrium needs to keep getting better and more visible. Some structural things to set up:

- **Weekly changelog post** on dev.to or LinkedIn summarizing what shipped that week.
- **Monthly "Atrium Office Hours"** — 30-min open call (Discord stage or Zoom) where you answer user questions live. Builds community without being a sales push.
- **"Built with Atrium" page** on the docs site listing real users. Ask the first ~10 production users if you can list them.
- **A blog post per major feature** as you ship v0.4, v0.5. Each one is a fresh launch.
- **Speaker submissions** to JS conferences (JSConf, React Summit, Local-First Conf) once you have 1k+ stars. Even a 15-min lightning talk drives a year of inbound.
- **Open up GitHub Sponsors / OpenCollective** if you'd accept funding. Many users will throw $10–$50/month at projects they actually use.

---

## Reminders

- The launch is one day. Atrium's reputation is built over months.
- Reply to every issue, PR, and DM in the first month. After that, you can taper.
- Don't ship random features because someone tweeted about them. Stay disciplined to the v0.4 plan in the design doc.
- Take care of yourself. Launches are stressful. Eat. Sleep. Touch grass.
