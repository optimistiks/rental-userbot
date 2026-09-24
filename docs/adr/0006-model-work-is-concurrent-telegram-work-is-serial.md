# Model work is concurrent, Telegram work is serial

Evaluating a Listing is mostly waiting on the model: seconds to minutes of thinking, agent steps and retries, against a few photo downloads that finish in well under a second. Run one at a time, a busy hour builds a backlog behind whichever Listing is slowest. So the pipeline evaluates up to `EVALUATION_CONCURRENCY` Listings at once (default 3), started in arrival order as slots free up.

The account is protected separately, inside the Telegram adapter: every explicit call — a photo download or a Saved Messages write, including Notices — passes through one lock, so no two ever overlap. Concurrency does not change how many calls a Post costs: its photos are downloaded once and at most one message is written, as before. Over time the call rate still follows the rate Posts arrive; the lock only caps how tightly calls can bunch while a backlog drains, at the pace of a single client scrolling a channel. The flood-wait policy is unchanged ([ADR-0004](0004-nothing-restarts-the-bot.md)).

## Considered options

A fuller design was specified and built: a channel-fair scheduler with a queue cap and eviction, a global flood-wait cooldown, a circuit breaker that shuts the daemon down, and cancellation threaded through the Evaluator. It was discarded as far more machinery than the problem needed. Any of those can be added on its own once a real backlog or rate limit shows it is needed.

## Consequences

- The model provider's rate limit, not Telegram's, is the ceiling on `EVALUATION_CONCURRENCY`. Going past it turns into Evaluation failures after the Evaluator's three attempts.
- Matches reach Saved Messages in the order they finish, not the order they were posted. Every Match carries its link.
- The lock is held for the whole call, including mtcute's own flood-wait sleeps. A flood wait on one download or write pauses every other Telegram call behind it until it clears, which is the conservative side to err on.
- Do not remove or widen the Telegram lock to gain speed; model time, not Telegram, is what it would be trading against.
- A Post queued or running is held in an in-memory set, so a second delivery of it is dropped at once instead of taking a slot ([ADR-0002](0002-notify-before-marking-processed.md)).
- The queue is still unbounded and in memory; a restart drops it, as before ([ADR-0001](0001-only-look-forward.md)).
