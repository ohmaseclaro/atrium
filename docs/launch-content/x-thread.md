# Atrium — X (Twitter) launch thread

> Copy-paste on Day 0. Tweet 1 has the demo video attached. Reply tweets 2–8 in quick succession (X's algorithm rewards a tight thread in the first hour).
>
> Hard rules:
>
> - Tweet 1 has the demo video and **no link**. Putting a link in the first tweet of a thread cuts reach by ~40%.
> - The GitHub link goes in a **quote-tweet of tweet 1** posted a few minutes after the thread settles, OR as a reply to the last tweet — never in tweet 1.
> - Don't tag accounts you haven't talked to. Tagging strangers in a launch tweet is the fastest way to get muted.

---

## Tweet 1 — hook (attach demo video, no link)

```
Every AI browser agent demo I've watched dies the moment a third party demands a human.

OAuth screen. Captcha. MFA. Passkey.

So I built Atrium: stream a real Chromium into your React app, hand control to a human, get the cookies back. Open source.
```

_Character count: ~275._

_Media: 30–45s demo video (1080p H.264 MP4, ≤ 512MB, < 2:20). X will auto-loop it. Caption optional but recommended: "Real Chromium. In your React app. Hand control to a human. Get the cookies back."_

---

## Tweet 2 — the problem in one paragraph

```
Existing options all break somewhere:
— Scrape passwords: please don't.
— Proxy the login UI: security nightmare.
— Skip the feature: leaves money on the table.
— Use Browserbase/Steel: amazing tools, but you're renting the relay.

There's a fourth option.
```

---

## Tweet 3 — the fourth option

```
Stream the real browser to the user. They sign in directly. You get back a Playwright `storageState` blob with their cookies and origins. Resume automation.

The handoff is server-authoritative: only one writer at a time, agent or human, never both.
```

---

## Tweet 4 — three packages, the install

```
Three packages, three lines:

npm install @atriumjs/express @atriumjs/react @atriumjs/worker

One Express middleware. One <RemoteBrowser /> React component. One Docker worker (Chromium + Playwright).
```

---

## Tweet 5 — what's in v0.3.0 (highlights, no marketing language)

```
v0.3.0 ships:
— Per-tenant quotas + idle/session TTL janitor
— URL allowlist enforced on viewer-driven navigation
— mTLS client cert support (PEM or PFX)
— Passkey-aware refusal (WebAuthn is unrelayable by design)
— Stealth Chromium under Xvfb, headed by default
— Multi-tab support
```

---

## Tweet 6 — what's NOT done (lead with weakness, the algorithm and HN both reward this)

```
What's not done:
— Fastify / Hono / Next / NestJS adapters (designed, not shipped)
— BullMQ-backed allocator for >50 concurrent sessions per node
— Multi-region demo orchestration

If you build agents and the architecture interests you, the roadmap is open.
```

---

## Tweet 7 — a "what I learned" tweet (drives quote-tweets)

```
Two things I didn't expect building this:

1. Server-authoritative control state. The handoff is one flag, but getting it right across reconnects and tabs ate a third of the implementation time.

2. The security regression I almost shipped: an imperative navigate() bypassed the URL allowlist. Filter at the relay.
```

---

## Tweet 8 — the CTA

```
MIT licensed. Live demo at demo.atriumjs.dev (rate-limited, locked to the X login flow because shipping a public proxy would be irresponsible).

Roast it if you see something wrong — there's still a v0.4 to design.
```

---

## Quote-tweet (post 5–10 min after tweet 8 lands)

```
Live on Hacker News if you want to discuss the architecture:

https://news.ycombinator.com/item?id=<HN_ID>
```

_The HN_ID is the numeric ID of your Show HN submission. URL pattern: `https://news.ycombinator.com/item?id=1234567`._

---

## Post-launch reply to the last tweet (Day 0, 30 min after main thread)

```
Code: https://github.com/ohmaseclaro/atrium
Docs: https://atriumjs.dev
Issues / discussions welcome.
```

_This is where the link lives. X down-ranks first-link-in-tweet-1 hard, so we put it in a reply to your own thread where it doesn't affect the algorithmic reach of the original._

---

## Tone notes

- No "revolutionary," "game-changing," "next-gen," or "we're excited to announce."
- No emojis except maybe one 🧵 on tweet 1 if you want to signal "thread."
- Don't bait engagement ("retweet if you'd use this"). The algorithm sniffs it out.
- One specific number per tweet where possible: "3 packages," "30-second handoff," "1 React component." Specificity reads as competence.

## After launch: the second post (Day +1, mid-morning)

This second post often outperforms the launch thread because the algorithm has now learned you have an audience.

```
Watch a real Twitter login + post happen with two `await`s and one component.

[10-15s focused clip]

This is what real-world OAuth handoff looks like in @atriumjs.

github.com/ohmaseclaro/atrium
```

## Day +2 onwards — micro-thread topics that have legs

Each of these is a single tweet with a code screenshot, posted 24h apart. Saves the launch-thread energy for one shot and gives you content for the week.

- "How the URL allowlist filter survives 3 different transports (WS, SSE, polling)."
- "Wheel scaling: deltas scaled to remote viewport via deltaMode unit normalization."
- "Lessons from typing every WebSocket message end-to-end with Zod."
- "Why playwright-extra + puppeteer-extra-plugin-stealth over a custom CDP client."
- "Server-authoritative state machines: one boolean, three edge cases."
