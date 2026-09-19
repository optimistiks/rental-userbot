# Judging the district from a Post's address

Type: grilling
Status: resolved
Blocked by: 11

## Question

**Fact from the owner (2026-09-19):**
- Many Posts come from districts that are a hard no.
- Location usually appears as a **street name + house number**, sometimes as a district name.
- It never appears as a map link or coordinates.
- Posts with no location at all are very rare.

So the lenient rule for missing information can stay. What's needed is reliably placing a stated address inside or outside the owner's districts.

Given [Geocoding and district boundary facts for Batumi](11-geocoding-facts.md), decide:
- **Where the geocoding happens.** Options:
  - a tool the model calls during evaluation (tool loop plus structured output)
  - a fixed pipeline step: the model extracts the address as a structured field, code geocodes it and checks the point against the district polygon, and the result feeds the Verdict, either as a hard override or as a fact passed to a second model call
  - no geocoding: a street and landmark list in the Criteria file
- **Where the districts are defined.** An OSM boundary or an owner-drawn GeoJSON file, which would live on the data volume next to the Criteria and be editable without code changes. And whether the "Old Town or Rustaveli" line in the Criteria stays, moves out, or both.
- **Unplaceable addresses.** Geocoder miss, a street that crosses the boundary, or geocoder down or rate-limited: lenient match, fall back to model judgement, or ⚠️.
- **Effect on resolved decisions.** Changes to [Evaluator contract and failure classes](06-evaluator-contract.md), such as the output schema, retries and msw fixtures, and to the Telegram boundary. Also: new config (geocoder key, polygon path) and Docker volume contents, for [Docker and compose layout](09-docker-layout.md).

**Tool loop vs fixed step, as discussed with the owner (2026-09-19).** A tool loop is not ruled out, and the AI SDK runs it itself (`tools` + `stopWhen` on the same `generateText` call).
- **For a tool loop:** the model can retry other spellings (Russian, Latin, Georgian) after a miss, it skips geocoding when a district is named, and it can check several addresses. Tests fake the tool's `execute` just as they would a pipeline step.
- **Against a tool loop:** every step resends the full context, including up to 6 photos, so a Post costs roughly 2–3× (~$0.02–0.03) and takes longer. The model may ignore the tool result, whereas a fixed step can override in code. The 3-attempt rule and 60s timeout have to be redefined for a multi-step attempt, and msw needs multi-step fixtures.
- **Hybrid:** a text-only call with a tool loop places the location (cheap, can retry spellings), then one evaluation call with photos gets the placement as a fact or a code override.
- **Deciding fact:** how well the geocoder handles spelling variants, from the research ticket. Good handling favours a fixed step; poor handling favours spelling retries, i.e. a loop or the hybrid.
- **Deciding fact, now answered** ([Geocoding and district boundary facts for Batumi](11-geocoding-facts.md)): Nominatim handles Latin, Cyrillic and Georgian spellings well, but misses on misspellings and extra words. The weak point is **extracting a clean `street + number`**, not spelling variants. This favours a fixed step where the model outputs a clean address (perhaps a few spellings), over a tool loop. Also still to decide:
  - how to treat street-only addresses (precomputed share of each street inside the zone; is partial "uncertain" a lenient match?)
  - whether the owner accepts the OSM Old Batumi + Rustaveli outlines or adjusts them
  - the Nominatim policy duties: User-Agent, 1 request per second, cache, attribution, configurable base URL

**Owner decision (2026-09-19): use LocationIQ from the start.** The token is in `.env` as `LOCATIONIQ_TOKEN`, and `.env` is now in `.gitignore`. LocationIQ is hosted Nominatim (same OSM data, Nominatim-compatible API), so the geocoding findings still apply; public Nominatim stays out.
- Free-plan terms to respect, from [research/geocoding.md](../research/geocoding.md): 5,000 requests a day, 2 per second, 60 per minute; results cached for **at most 48 hours**. Owner decision: no "Search by LocationIQ.com" attribution. Results are only seen by the owner, in Saved Messages.
- The token goes in the request query string, so request URLs must never be logged or put into ⚠️ messages.
- The exact LocationIQ endpoint and response shape weren't checked live. Confirm them against LocationIQ's docs before writing the msw fixture.
- Keep the base URL as a config setting, so the provider can still be swapped.

## Answer

Decided with the owner (2026-09-19), building on [Geocoding and district boundary facts for Batumi](11-geocoding-facts.md). The LocationIQ API facts, including a live check with the owner's token, are in [research/locationiq-search.md](../research/locationiq-search.md). New glossary terms: **Zone** and **Zone veto** ([CONTEXT.md](../../CONTEXT.md)).

**Where the check happens: one model call plus a code veto**
- No tool loop and no second call. The existing Evaluator call gets one more output field, `address`: the first street and house number as the Post writes it, cleaned of extra words, or `null` if there's no house number. There's no transliteration and there are no alternative spellings.
- The "Old Town or Rustaveli" line **stays in the Criteria**. The model judges district names from it, and the lenient rule still applies.
- Geocoding runs only when the Verdict is *match* and `address` isn't null.
- **Zone veto:** a hit with `matchlevel: "building"` whose point lies outside the Zone turns the *match* into *no match*. It's logged with the address and point, and nothing is sent. The veto can only take a match away.
- The precomputed street shares are dropped. A street-only address never triggers the veto.

**The Zone**
- The OSM outlines of Old Batumi (relation 12695439) and Rustaveli (relation 12695438), exported to one GeoJSON file. The owner accepts them as a starting point and can adjust them in geojson.io.
- The repo commits a starting copy. The bot reads the file from the data volume at `ZONE_PATH`, default `data/zone.geojson`.
- It's validated at startup (the bot crashes if the file is missing or invalid) and re-read before every check, like the Criteria. A runtime read failure is an evaluation failure (⚠️).
- The point check uses `@turf/boolean-point-in-polygon`, pinned to an exact version.

**The geocoder (LocationIQ)**
- `GET` `GEOCODER_URL`, default `https://eu1.locationiq.com/v1/search`, with `key=<LOCATIONIQ_TOKEN>`, `q=<address>, Batumi`, `countrycodes=ge`, `format=json`, `limit=1` and `matchquality=1`.
- `LOCATIONIQ_TOKEN` is required; the bot crashes at startup if it's missing.
- One attempt with a 10s timeout, no retries, no cache and no throttle. Geocoding only runs on matches, one Post at a time, so the free plan's 2 per second, 60 per minute and 5,000 per day are out of reach.
- Request URLs contain the token, so they are never logged or shown.
- No attribution, because this is personal, non-commercial use.
- **Use `matchlevel` to judge a hit, not `matchcode`.** Live check: a house number that doesn't exist returns `matchlevel: street` with `matchcode: exact`. A misspelled street returns **HTTP 200** with `matchlevel: city` (the Batumi centroid), not a 404.

**When the Zone can't be checked.** Any of these can happen when the model said *match* and gave an address:

| Outcome | Result |
|---|---|
| `matchlevel: street` | the *match* goes out with the line `⚠️ zone not checked: street only` |
| 404, or a level coarser than street | the *match* goes out with the line `⚠️ zone not checked: not found` |
| any other error (timeout, 5xx, 429, 401, bad body) | the *match* goes out with the line `⚠️ zone not checked: <label>`, following the Evaluator's `<label>: <first line>` rules, never including the URL |
| `address` is null | nothing to check; no line is added |

Match message format: `<link>\n<reason>\n⚠️ zone not checked: …`. The last line appears only when the Zone couldn't be checked.

**Effect on resolved decisions**
- [Evaluator contract and failure classes](06-evaluator-contract.md): the output schema becomes `{ match, reason, address }`, and the six model fixtures gain `address`. The 3-attempt retry rules still cover only the model call. The geocoder has its own single attempt.
- [Telegram boundary and Post shape](05-telegram-boundary.md): no change.
- New LocationIQ msw fixtures: building inside, building outside, street-level fallback, city-level fallback, 404, 401 and timeout. Their shapes are taken from the live responses.
- [Docker and compose layout](09-docker-layout.md): the data volume also holds `zone.geojson`. New settings: `ZONE_PATH`, `LOCATIONIQ_TOKEN` and `GEOCODER_URL`.

## Comments

**2026-09-20, `address` becomes `places`** (agreed with the owner, after the spec was locked):
- Why: *"Квартира на улице Тбеля Абусеридзе в здании торгового центра DS Mall"* has no house number, so the old rule gave `null`, the Zone Check never ran, and the lenient rule let it through. Public Nominatim (same OSM data as LocationIQ) finds `DS Mall, Batumi` as a building in Bagrationi II, outside both the Old Batumi and Rustaveli outlines. The Russian `улица Тбеля Абусеридзе, Батуми` finds nothing, because of the case ending and OSM's spelling "Абусерисдзе".
- The model returns `places: string[]`, at most 3 queries, most precise first: a named building or landmark (with street), then street + number, then the street alone. Streets are in base form, with at most one Latin-script fallback. This reverses the "no transliteration, no alternative spellings" rule above.
- Code geocodes the queries in order and stops at the first `building`/`venue` hit. Otherwise the best outcome wins (`street` > not found > error). An error on one query never stops the next.
- The owner considered and rejected a geocoding tool loop again: it adds cost from resending photos each step, a softer veto, and multi-step retries and fixtures. The query list gets the retry benefit in one model call.
- Live LocationIQ check (2026-09-20, owner's token, spec query params):
  - `DS Mall, Tbel Abuseridze Street` and `DS Mall` both give `matchlevel: venue`: the DS Mall building (5ა), Bagrationi II, at lat 41.6400 / lon 41.6220. That point is outside the Old Batumi and Rustaveli outlines, so the query list produces the correct Zone veto.
  - `Tbel Abuseridze Street 5a` gives `venue`: a shop at 5a, next door. A POI at the address stands in for the building, which is fine.
  - `Tbel Abuseridze Street` gives `street` (a centroid).
  - `улица Тбеля Абусеридзе` gives a `city` fallback (i.e. not found). This confirms the Latin-script fallback query is needed.
