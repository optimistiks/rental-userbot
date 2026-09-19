# Rental Listings Userbot

A Telegram userbot on the owner's personal account that watches apartment rental channels, judges each new Post against the owner's Criteria, and saves a link to every match in the owner's Saved Messages.

## Language

**Post**:
One unit published in a channel: a single message, or an album of messages grouped together. The unit that is evaluated exactly once.
_Avoid_: message group, update, event

**Processed Post**:
A Post whose Verdict has been handled, whether it was a match, no match, or evaluation failure. A Processed Post is never evaluated again, even if it arrives again after a restart or as a late part of an album.
_Avoid_: seen, handled, done

**Watched channel**:
A channel whose ID the owner has listed for the bot to follow. Posts from any other chat are ignored.
_Avoid_: source, feed, subscribed channel

**Listing**:
A Post assembled for evaluation: its text, up to six photos, and a link back to the Post.
_Avoid_: ad, offer, apartment

**Rental offer**:
A Post that offers a flat for rent. Ads, "looking for" posts, and sales listings are not rental offers.
_Avoid_: listing (when meaning the real-world offer)

**Criteria**:
The owner's plain-text description of the flat they want, edited as a file, never in code.
_Avoid_: filter, rules, preferences

**Verdict**:
The result of evaluating a Listing against the Criteria: *match*, *no match*, or *evaluation failure*. A Post that is not a Rental offer gets *no match*.
_Avoid_: score, rating, result

**Match**:
A Verdict saying the Listing does not clearly violate any criterion. Missing information never prevents a match.
_Avoid_: hit, pass

**Zone**:
The area the owner will live in, drawn as an outline in a file the owner edits without code changes. The evaluation can check where a Post's flat lies against it. It sits alongside the Criteria and does not replace the location line in them.
_Avoid_: district, area, polygon
