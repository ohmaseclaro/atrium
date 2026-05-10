# Launch content drafts

Paste-ready copy for the v0.3.0 launch. Drafted ahead of time so Day 0 is execution-only.

| File                                     | What it is                                                                                   | When to use                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| [`x-thread.md`](x-thread.md)             | 8-tweet launch thread, quote-tweet copy, Day +1 follow-up, and a week of micro-thread topics | Day 0 — 09:05 PT (after HN submission)  |
| [`linkedin-posts.md`](linkedin-posts.md) | Two warmup posts (Day -7, Day -3), the main launch post, two follow-ups                      | Day -7 onwards                          |
| [`devto-longform.md`](devto-longform.md) | ~2000-word engineering story                                                                 | Day 0 — 13:00 PT                        |
| [`outreach-list.md`](outreach-list.md)   | Ten personalized DM / email targets with a per-row personalization hook                      | Day 0 — 09:30 PT, staggered over 30 min |

The accompanying **schedule / mechanics** live one directory up:

- [`../launch-preparation.md`](../launch-preparation.md) — Day -7 to Day -1 prep (accounts, assets, infra)
- [`../launch-execution.md`](../launch-execution.md) — hour-by-hour Day 0 + Day +1 to Day +7 follow-on plan

## A note on tone

The drafts here aim for the same voice across every channel: specific, technical, with one concrete number per beat ("3 packages," "30-second handoff," "5 of 6 packages on first publish"). They lead with weakness — what's _not_ done, what regression we _almost_ shipped — because pre-1.0 OSS communities reward honesty and punish marketing language.

Hard rules baked into every draft:

- **No "revolutionary," "game-changing," or "next-gen."** HN, Reddit, and Twitter all sniff out marketing language and downvote it.
- **No GitHub link in the body of an X tweet or a LinkedIn post.** X cuts reach by ~40%; LinkedIn cuts by ~30%. Link goes in the first comment or a reply.
- **Don't tag accounts you haven't talked to.** Mass-tagging strangers in a launch tweet is the fastest way to get muted.
- **Reply to every comment in the first hour.** Engagement velocity is half the algorithmic signal.

## What's not here yet

- **The Reddit posts** — drafts live in [`../launch-preparation.md`](../launch-preparation.md) §5 under "Reddit r/SideProject", "Reddit r/webdev", "Reddit r/programming". They're short enough that having them in the prep doc was sufficient.
- **The Show HN post body** — the post is _link-only_ (URL → GitHub repo). The body content goes in your **first comment on the HN thread**, drafted in [`../launch-execution.md`](../launch-execution.md) §09:01.
- **The Product Hunt page copy** — fill the PH launch builder directly; the tagline and description seeds are in [`../launch-preparation.md`](../launch-preparation.md) §5 under "Product Hunt page".
- **The Indie Hackers post** — see [`../launch-preparation.md`](../launch-preparation.md) §5 under "Indie Hackers post". Short enough that paste-from-prep-doc is fine.
- **Discord posts** — see [`../launch-execution.md`](../launch-execution.md) §14:00. Same paste-from-prep-doc shape.

## Personalization checklist before Day 0

Open each file and fill in:

- [ ] HN post ID for the X quote-tweet (`<HN_ID>` placeholder)
- [ ] HN post ID for the LinkedIn first-comment (`<HN_ID>` placeholder)
- [ ] X handle and email of each row in the outreach list (10 rows)
- [ ] One specific architectural hook per outreach row (the bracketed details)
- [ ] dev.to cover image path / URL once the demo GIF exists

After Day 0:

- [ ] Pin the X launch thread
- [ ] Pin the LinkedIn launch post
- [ ] Pin a "Welcome — start here" Discussion in the GitHub repo
