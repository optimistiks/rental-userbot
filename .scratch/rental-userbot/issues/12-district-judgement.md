# Judging the district from a Post's address

Type: grilling
Status: open
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
- Free-plan terms to respect, from [research/geocoding.md](../research/geocoding.md): 5,000 requests a day, 2 per second, 60 per minute; results cached for **at most 48 hours**; the free plan requires a "Search by LocationIQ.com" link. Decide whether and where that link appears, since nothing is displayed apart from Saved Messages.
- The token goes in the request query string, so request URLs must never be logged or put into ⚠️ messages.
- The exact LocationIQ endpoint and response shape weren't checked live. Confirm them against LocationIQ's docs before writing the msw fixture.
- Keep the base URL as a config setting, so the provider can still be swapped.
