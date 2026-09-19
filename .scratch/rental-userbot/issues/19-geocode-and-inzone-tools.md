# 19: Geocode and inZone tools

**What to build:** the agent gets its two tools and places the flat itself. `geocode` searches (LocationIQ behind our own shape) and `inZone` answers from the Zone file. The agent decides what to make of the answers; no code overrides its Verdict. See [spec](../spec.md) § [4] Evaluator (tools), § Startup step 2, [Agentic Evaluator](20-agentic-evaluator.md), [research/locationiq-search.md](../research/locationiq-search.md), [research/agentic-evaluator.md](../research/agentic-evaluator.md).

**Blocked by:** 18 (Failure paths: retries, ⚠️ couldn't evaluate, failed sends)

**Status:** ready-for-agent

- [ ] `data.example/zone.geojson` holds the OSM outlines of Old Batumi (relation 12695439) and Rustaveli (relation 12695438)
- [ ] Startup crashes, naming the file, if the Zone file is missing, invalid GeoJSON, or has no Polygon/MultiPolygon (unit tested)
- [ ] Tools are defined with `tool({ description, inputSchema, execute })` and zod 4; their descriptions are what the model sees, and nothing about them goes in the prompt file
- [ ] `geocode(query)` returns `{ results: Array<{ precision, lat, lon, label }> }`, up to 3, `[]` when nothing is found
- [ ] The LocationIQ adapter is the only code that knows the provider: it appends ", Batumi", sends the spec's query params, and maps `matchlevel` → `precision` (building→`building`, venue→`place`, street→`street`, coarser→`area`), never `matchcode` (pure function, unit tested)
- [ ] The request URL and token are never logged or shown
- [ ] `inZone(lat, lon)` returns `{ inside, zone }`, re-reading the Zone file on every call; `zone` is the matching feature's name; point-in-polygon with `@turf/boolean-point-in-polygon` against each feature (unit tested with known points: Chavchavadze 50 inside Rustaveli, the DS Mall point 41.6400004 / 41.6220370 outside)
- [ ] Tool failures (geocoder timeout or 401, unreadable Zone file, arguments failing their schema) reach the model as tool results and never fail the attempt; a single tool call is capped at 10s
- [ ] Every tool call and result is logged
- [ ] msw LocationIQ fixtures (shapes from the live responses): building, venue, street, city fallback, 404, 401, timeout — each asserted against the `precision` reported (Done-when 11)
- [ ] Agent-run test with the mock model: step 1 calls `geocode`, step 2 calls `inZone` with the returned point, step 3 returns `{ match, notes }`; the pipeline sends exactly what the agent decided
- [ ] Manual: on a real Post naming a place outside the Zone, the agent calls both tools and returns *no match* (Done-when 11a). The DS Mall smoke test is the template
