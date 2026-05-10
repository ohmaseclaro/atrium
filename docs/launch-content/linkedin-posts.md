# Atrium — LinkedIn posts

> Three posts: two warmup (Day -7, Day -3) that seed the algorithm, and one launch post (Day 0) that lands the announcement.
>
> Hard rules:
>
> - **No external links in the body.** LinkedIn down-ranks posts with external links visible in the body by ~30%. Put the GitHub link in the **first comment** of each post, not the body.
> - **Like and reply to your own first comment within 5 minutes** of posting so it rises up the comment list.
> - Posts under 1300 characters perform best, but technical write-ups can break that rule if they're substantial. Don't pad to hit 1300; don't trim to fit it either.

---

## Day -7 warmup post — engineering reflection

> Theme: a small, real insight from building Atrium that has nothing to do with Atrium. Builds your credibility as someone who thinks, not someone selling.

```
Spent the last sprint chasing a sticky state bug in a remote-browser project.

The handoff between agent and human is one boolean: who's allowed to send mouse/keyboard right now. I'd reasoned about it the way you'd reason about a mutex — one writer at a time, no contention.

Then a viewer reconnect during an in-flight control transfer wedged the whole session. Two clients held what each thought was the lock; the server held neither.

The fix wasn't subtle. The control state has to live on the server, and every transition has to be the server's response to a client request, not a client-driven write. The client just renders the current state; it doesn't own it.

In retrospect, obvious. In the moment, three days.

The recurring lesson for me on this project: any state both sides need to agree on belongs to whoever stays alive longer. Clients reconnect; servers don't.
```

_Engagement target: 20–40 likes, 3–8 thoughtful comments. Don't pitch Atrium. Reply technically to anyone who comments._

---

## Day -3 warmup post — the security regression story

> Theme: a specific concrete mistake you caught. People share these because vulnerability + competence is irresistible on LinkedIn.

```
The security regression I almost shipped this week.

We let the React component for our remote browser expose an imperative `navigate(url)` method — handy for tests, polite for the SDK ergonomics. Looked harmless.

It wasn't. The whole point of the architecture is that the server enforces a URL allowlist before any navigation reaches the headless Chromium. The new method bypassed the allowlist: a viewer holding a valid session token could send a `navigate` over the viewer WebSocket and steer the worker anywhere.

The fix was to filter at the relay layer, not the worker layer — same place we already validated the bootstrap URL. Five lines of code. Two regression tests. One issue I quietly added to the wire-protocol design doc so I don't repeat it next sprint.

The interesting part isn't the fix; it's that the bug only existed because we tried to be nice to consumers of the SDK. The lesson: every imperative method on a relay client is a potential filter bypass. Default to "you propose, server disposes" no matter how chatty the SDK gets.
```

_This one's borderline 800 characters. Tight, single story, one concrete takeaway. Engages people who do real security work._

---

## Day 0 launch post — main announcement

> Theme: the project, the why, what's in it, what's not, where to go. Designed for the algorithm and for the technical reader.

```
I shipped Atrium today — open-source remote browser infrastructure for human-in-the-loop automation.

The problem: every AI browser agent I watched died at the same step. The moment a third party demanded a human — OAuth screen, captcha, MFA, passkey — the automation stopped. There's no clean way around it. You either scrape passwords (don't), proxy the entire login UI through your service (security nightmare), or you don't ship the feature.

There's a fourth option: stream the real browser to the user, let them sign in directly, and exfiltrate the session cleanly. That's Atrium.

Three packages. One Express middleware, one React component, one Docker worker. The user sees a live Chromium tab embedded in your app. They type credentials. You get back Playwright `storageState`. Resume automation.

What I learned building it:

— Server-authoritative state matters more than I expected. The control handoff is one flag, but getting it right (only one writer at a time, across reconnects, across tabs) ate a third of the implementation time.

— The security regression you didn't think about: I added an imperative `navigate()` method on the React component to make the SDK nicer, then realized a viewer with a token could navigate the remote page anywhere — bypassing the URL allowlist. Filter at the relay layer, not at the worker.

— Playwright vs raw CDP: I tried raw CDP first. Playwright won by a mile once you need contexts, storageState, and network interception.

v0.3.0 is on npm under @atriumjs/*. Live demo at demo.atriumjs.dev. MIT.

If you're building agents, scrapers, or onboarding flows that hit captchas — I'd love feedback. Code link in the first comment.
```

_~1550 characters. Over the magic 1300 number, but the algorithm forgives length when the content is substantive. The two-paragraph "What I learned" middle is what drives engagement._

### First comment to paste immediately after publishing

```
Code: https://github.com/ohmaseclaro/atrium
Live demo: https://demo.atriumjs.dev
Show HN thread (if you'd rather discuss the architecture): https://news.ycombinator.com/item?id=<HN_ID>
```

_Replace `<HN_ID>` with your Show HN post's numeric ID once it's live._

---

## Day +1 mid-morning — engineering deep dive

> Theme: one specific thing you fixed. Lives forever on LinkedIn search; demonstrates depth.

```
A small lesson from yesterday's Atrium launch.

Question that came up: "Why Playwright instead of raw CDP?"

I tried raw CDP first. The Chrome DevTools Protocol gives you everything Atrium needs — page screencast frames, input dispatch, navigation events. No dependency hell, no version churn.

It also gives you everything you don't need: 400+ commands and events spread across 30+ domains, a target lifecycle you have to manage manually, and a context model that doesn't quite line up with how products think about "sessions."

Playwright wraps all of that in a layer with three things that turned out to matter:

1. BrowserContext as a first-class object. Cookies and storage are scoped to it, you can serialize the whole thing as `storageState`, and you can clone or seed it. We export `storageState` to the host after a handoff — Playwright makes that one line.

2. A network-interception API that survives across navigation. Raw CDP's `Fetch.requestPaused` does too, but Playwright's surface is the documented, supported one.

3. A test ecosystem. Every contributor already knows Playwright. Onboarding cost: zero.

Cost: an extra peer dependency, and you're at the mercy of the Playwright team's CDP fluency for new features. Worth it.

Atrium's worker is ~600 lines of Playwright calls and ~80 lines of CDP screencast bridge. The 80 lines that needed raw CDP could not have been Playwright; the 600 that didn't, would have tripled in size with raw CDP. That's the trade.
```

---

## Day +3 — "Why I built this" (LinkedIn doesn't index Show HN, this is your evergreen)

> Theme: the founding story. Less technical, more product. Drives followers and inbound recruiter spam (sorry).

```
A few months ago I was watching AI agent demos. The good ones — Stagehand, Operator, Browser Use — all hit a wall at the same step.

OAuth. The agent walks up to a Google or Twitter or Slack login, freezes, and the demo cuts to "now we have credentials in our config." Off-camera, somebody signed in. The agent didn't.

This is not a small wrinkle. Every production scraper, every onboarding flow, every "let me automate this for you" workflow eventually hits a third-party login. Most products solve it by asking the user for their password and storing it. That's how breach reports happen.

The proper solution is to stream the real browser to the user, let them sign in directly, and capture the session afterward. The user's password never crosses your service. You get cookies, you get `storageState`, you get to resume automation.

Browserbase and Steel are doing this commercially — both are great products. Atrium is the open-source primitive for builders who want to embed the pattern themselves, on their own infrastructure, on their own terms.

v0.3.0 is on npm. MIT. github.com/ohmaseclaro/atrium.

If you're building anything that touches a third-party login, this is what the cleanest version looks like.
```

---

## Tone notes for all five posts

- First person, plain language. No "we are pleased to" or "I am thrilled to."
- One concrete technical detail per post (a file:line, a number, a specific failure mode).
- Lead with a specific moment, not a pitch. "Spent the last sprint chasing…" beats "Atrium is a library for…"
- Don't use the word "revolutionary," "game-changing," or "disruptive." LinkedIn's algorithm doesn't punish them but technical readers mute on sight.
- End with a hook that invites real engagement — a question, an open problem, or a "roast it" — not a CTA to like/follow.

## Posting cadence summary

| Day    | Time (your local) | Post                                                              |
| ------ | ----------------- | ----------------------------------------------------------------- |
| Day -7 | 10am              | Warmup #1 — sticky state bug                                      |
| Day -3 | 10am              | Warmup #2 — security regression                                   |
| Day 0  | 9:10am PT         | Main launch post (after HN submission)                            |
| Day +1 | 11am              | Engineering deep-dive (Playwright vs CDP)                         |
| Day +3 | 9am               | Founding story                                                    |
| Day +7 | 9am               | "Week one in numbers" (stars, npm downloads, surprising feedback) |
