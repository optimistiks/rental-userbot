# Rental Listings Userbot

A Telegram userbot on the owner's personal account that watches apartment rental channels, judges each new Listing against the owner's Criteria, and writes Matches and Notices to the owner's Saved Messages.

## Language

### The owner

**Owner**:
The one person the bot exists for: the holder of the Telegram account it runs on, the author of everything it reads, and the only person it ever writes to.
_Avoid_: user, admin

### What the owner writes

**Watchlist**:
The channels the bot follows, written by the owner as a file of channel IDs they edit without code changes or a restart. An empty Watchlist watches nothing, which is a normal state.
_Avoid_: channel list, subscriptions, sources

**Criteria**:
The owner's plain-text description of the flat they want, edited as a file, never in code.
_Avoid_: filter, rules, preferences

**Prompt**:
The owner's instructions to the agent — the order it works in and the rules it decides by — edited as a file alongside the Criteria. The Criteria say what the owner wants; the Prompt says how to go about judging it.
_Avoid_: system message, instructions, template

**Zone**:
The area the owner will live in, drawn as an outline in a file the owner edits without code changes. The evaluation can check where a Post's flat lies against it. It sits alongside the Criteria and does not replace the location line in them.
_Avoid_: district, area, polygon

### What the bot writes

**Notice**:
A message the bot writes to Saved Messages about itself, not about a Post: that it started, or that an owner-edited file was picked up or became unreadable. A healthy Notice starts with 🟢. An unreadable Criteria, Prompt, or Zone starts with ⚠️, and no Listing is judged until that file reads again.
_Avoid_: system message, status, log, heartbeat

### What the bot sees

**Post**:
One unit published in a channel: a single message, or an album of messages grouped together. A Post that is not a Listing is ignored.
_Avoid_: message group, update, event

**Watched channel**:
A channel on the Watchlist. Posts from any other chat are ignored. The owner joins it in Telegram; the Watchlist does not join it.
_Avoid_: source, feed, subscribed channel

**Listing**:
A Post with post text and at least three photos, assembled for evaluation: its text, up to six photos, and a link back to the Post. A Listing is judged exactly once.
_Avoid_: ad, offer, apartment

**Rental offer**:
A Post that offers a flat for rent. Ads, "looking for" posts, and sales listings are not rental offers.
_Avoid_: listing (when meaning the real-world offer)

**Processed Post**:
A Post whose Verdict has been handled, whether it was a match, no match, or evaluation failure. A Processed Post is never evaluated again, even if it arrives again after a restart or as a late part of an album.
_Avoid_: seen, handled, done

### What the bot decides

**Verdict**:
The result of evaluating a Listing against the Criteria: *match*, *no match*, or *evaluation failure*. A Post that is not a Rental offer gets *no match*.
_Avoid_: score, rating, result

**Match**:
A Verdict saying the Listing does not clearly violate any criterion. Missing information never prevents a match.
_Avoid_: hit, pass

**Evaluation failure**:
A Verdict saying the Listing could not be judged at all, rather than judged and rejected. The owner is told about it, because a Post nobody looked at is not the same as one that was turned down.
_Avoid_: error, no match

**Notes**:
The agent's own account of a Verdict, written in the language of the Criteria. It is what the owner reads beside the link, so it says why the Listing matched and what to double-check.
_Avoid_: reason, explanation, summary
