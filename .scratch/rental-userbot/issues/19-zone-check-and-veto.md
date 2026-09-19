# 19: Zone Check and Zone veto

**What to build:** a Match whose address geocodes to a building outside the Zone is silently dropped (Zone veto); when the address can't be placed precisely, the Match still arrives with a `⚠️ zone not checked: <note>` line. See [spec](../spec.md) § [5] Zone Check, § [6] Notifier, § Startup step 2, [research/locationiq-search.md](../research/locationiq-search.md), [research/geocoding.md](../research/geocoding.md).

**Blocked by:** 18 (Failure paths: retries, ⚠️ couldn't evaluate, failed sends)

**Status:** ready-for-agent

- [ ] `data.example/zone.geojson` holds the OSM outlines of Old Batumi (relation 12695439) and Rustaveli (relation 12695438)
- [ ] Startup crashes, naming the file, if the Zone file is missing, invalid GeoJSON, or has no Polygon/MultiPolygon (unit tested)
- [ ] The Zone file is re-read before every check; a runtime read failure makes the Verdict an evaluation failure (⚠️)
- [ ] Zone Check runs only on a Match with a non-null `address`
- [ ] One `GET GEOCODER_URL` with the query params from the spec (`q=<address>, Batumi`, `countrycodes=ge`, `limit=1`, `matchquality=1`, …); 10s timeout, no retry, no cache; `lat`/`lon` parsed from strings
- [ ] The request URL and token are never logged or shown
- [ ] `matchquality.matchlevel` → outcome (unit tested): `building`/`venue` inside → Match stands; outside → Zone veto; `street` → note `street only`; 404 or coarser → note `not found`; any other error → note `<label>` via the error formatter
- [ ] Point-in-polygon with `@turf/boolean-point-in-polygon` against each feature; unit test with known points against the starting Zone (e.g. Chavchavadze 50 inside Rustaveli, plus a known outside point)
- [ ] A veto sends nothing and is logged with the address and the point; the per-Post log line shows the Zone outcome
- [ ] Match with a note sends `<link>\n<reason>\n⚠️ zone not checked: <note>`
- [ ] msw LocationIQ fixtures (shapes from the research): building inside, building outside, street, city fallback, 404, 401, timeout — each covered by an integration test (Done-when 11)
