# Atrium — outreach list

> Ten DMs / emails for Day 0. **Stagger over 30 minutes** — sending ten in one minute trips X's spam heuristics and gets you rate-limited.
>
> Tone: "thought you'd find this interesting, no ask, technical feedback only." The moment you ask for a retweet, the open rate drops to single digits.
>
> Personalize the bracketed `[…]` segments. Generic mass-DMs get ignored or muted.

---

## Template — copy this, then personalize per row

```
Hey [name] —

I just shipped an open-source library you might find interesting: a remote-browser primitive for human-in-the-loop OAuth / captcha / MFA handoff. Real Chromium streamed into a React app, hand control to your end-user, resume automation with their cookies + Playwright storageState.

Saw you've worked on [specific thing]. Curious what you think of [specific architectural detail relevant to their work].

Demo: https://demo.atriumjs.dev
Code: https://github.com/ohmaseclaro/atrium

No expectations — feedback only. Roast it if you see something wrong.
```

---

## The ten targets

| #   | Name / handle                                                                                | Channel                             | Why they'd care                                                 | Personalization hook                                                                                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Paul Klein** (Browserbase founder) — `@pk_iv` / paul@browserbase.com                       | X DM + email                        | Peer building hosted version of the same primitive              | "Thought you'd want to see what an open-source-only take on this looks like. Especially curious whether you've found the BullMQ-allocator step worth the complexity at your scale, or if a simpler dial pattern carries further than I think."                                   |
| 2   | **Steel maintainer team** — `steel-dev` org on GitHub                                        | GitHub Discussion + email if listed | Closest OSS peer; will recognize the architecture               | "What I built on top of patterns I learned from your repo. Curious if you've thought about a tighter URL-allowlist filter at the relay layer — your worker-side enforcement is roughly the same, mine is doubled at the relay because of an imperative `navigate()` regression." |
| 3   | **Stagehand maintainers** (Browserbase) — check repo `CONTRIBUTORS`                          | GitHub + X                          | Agent infra people, will hit OAuth wall regularly               | "I'm guessing Stagehand internally has some version of the human-handoff problem — does it punt to user code, or have you got a pattern?"                                                                                                                                        |
| 4   | **Alex Albert** (Anthropic) — `@alexalbert__`                                                | X DM                                | Agent / browser-infra space, broad reach                        | "Spent a few months on the open-source primitive nobody's building (yet). Would value your gut read on whether the dial-pattern stays sane past ~50 concurrent sessions per node."                                                                                               |
| 5   | **Theo Browne** — `@t3dotgg`                                                                 | X DM                                | Boosts OSS launches; agent / TypeScript / React audience        | Frame as a tooling/SDK question: "TypeScript-first wire protocol with Zod schemas as the source of truth. Curious if you'd take that pattern over hand-rolled types." Do NOT ask for amplification.                                                                              |
| 6   | **A Playwright maintainer** — pick from `microsoft/playwright` recent committers             | GitHub issue or email               | They'd notice mistakes immediately                              | "Built a CDP screencast bridge on top of Playwright's `newCDPSession`. Would you spot-check the worker module? It's the most fragile piece and I want the most experienced eyes I can find on it before more users land on it."                                                  |
| 7   | **Stefan Judis** — `@stefanjudis`                                                            | X DM                                | Web automation / scraping audience, will repost meaningful work | "Specifically curious about your read on the passkey-refusal trick — disguising Chromium as a device without a platform authenticator so most sites never offer the passkey button. Sane workaround or hacky?"                                                                   |
| 8   | **Ilya Pukhalski** (Browser Use) — `@MagnusMaximus__`                                        | X DM                                | Adjacent OSS browser-automation project                         | "Different primitive — yours is agent-first, mine is human-in-the-loop-first — but I bet we hit the same wire-protocol problems. Would love a 15-min compare-notes if you're up for it."                                                                                         |
| 9   | **A Cal.com or n8n maintainer** — pick someone you've actually used                          | X DM or email                       | Workflow automation builders; their users hit OAuth walls       | "Would something like Atrium fit into your handoff story for users connecting third-party accounts? Or do you have an upstream pattern that already covers this?"                                                                                                                |
| 10  | **Someone in your personal network** — a former colleague or friend in agent / browser infra | DM / email                          | They'll actually open it, and might be your first real user     | Personal: ask them to break it. People love being asked to find bugs.                                                                                                                                                                                                            |

---

## Filling in the blanks

Before Day 0:

1. **Pin down handles.** Walk through the table above with real usernames. Replace placeholders. If you don't know someone's handle, look them up on GitHub recent contributors / X search — it's faster than guessing.
2. **Confirm channels.** For each row, pick X DM, email, or LinkedIn. Don't send the same person via two channels in the same hour; that reads as desperation.
3. **Draft each DM** with the bracketed personalization filled in. Keep them as drafts in your X drafts folder so Day 0 is paste-and-send.

On Day 0:

1. Send DMs 1, 2, 3 in the first 10 minutes after your X thread goes up.
2. Sends 4, 5, 6 in the next 10 minutes.
3. Sends 7, 8, 9, 10 in the next 10 minutes.
4. Total: 30 minutes of staggered sends, 10 personalized messages out.

After Day 0:

- Reply to anyone who replies. Quickly, and technically.
- Don't follow up on no-replies after Day +2. Following up reads as needy and 1× of "polite second DM" wins less than 1× of "moved on, kept shipping."

---

## What you're NOT trying to get

- **Retweets.** You can ask politely; you'll be ignored politely. The thread either earns the boost or it doesn't.
- **A blurb.** Asking strangers for testimonials is one of the things every founder tries and every founder regrets.
- **A meeting.** A meeting is the goal, not the ask. If they want one, they'll suggest it. Don't pre-ask.

What you ARE trying to get:

- **One thoughtful reply that critiques the architecture.** That reply, screenshot-quoted with your follow-up, becomes a tweet that performs better than your launch thread.
- **A first issue from someone you don't know.** This is the leading indicator of organic adoption.
- **Permission to follow up later** — implicit if they engage at all.

---

## A cleaner email variant (for the row #2 type, where DMs are too informal)

```
Subject: Atrium — open-source remote-browser primitive (would love your eyes on the worker)

Hi [name],

I just shipped Atrium, an open-source library for human-in-the-loop OAuth / captcha / MFA handoff. It streams a real Chromium session into a React app, hands keyboard/mouse to your end-user, then resumes automation with their Playwright storageState.

You've worked closely on [specific Steel module / Stagehand pattern / Playwright internal]; the part of my codebase that maps closest to your work is [packages/worker/cdp-screencast.ts] / [packages/core/url-allowlist.ts] / etc.

If you have 20 minutes to skim it and tell me where I'm wrong, I'd be very grateful. The repo is github.com/ohmaseclaro/atrium and there's a live demo at demo.atriumjs.dev.

No commercial conversation, no ask for a retweet — just trying to make sure I haven't missed something obvious before more people start running this in production.

Thanks,
Augusto
```
