# Geocoding and district boundary facts for Batumi

Type: research
Status: resolved
Blocked by: —

## Question

Posts usually give their location as a **street name and house number** (Russian, Georgian or English, in various transliterations), sometimes as a district name, never as a map link or coordinates. What can turn that text into "inside / outside the owner's districts" reliably and cheaply? Cite primary sources.

1. **Geocoders on Batumi addresses.** Compare Nominatim (public OSM instance), Google Geocoding API, and one or two others (e.g. Mapbox, HERE, Photon, LocationIQ):
   - coverage of Batumi streets and house numbers
   - handling of Russian, Georgian and Latin spellings of the same street
   - terms, rate limits (Nominatim: 1 req/s, caching rules, attribution) and cost at ~50–200 lookups/day
   - whether a key is needed
   If possible, check coverage directly, e.g. count `addr:housenumber` objects in Batumi via Overpass, and run a handful of real-looking queries such as "Gorgiladze 45 Batumi", "ул. Горгиладзе 45 Батуми", "გორგილაძის 45 ბათუმი".
2. **District boundaries.** Does OSM have boundary polygons for Batumi's administrative districts (Rustaveli, Old Batumi / ძველი ბათუმი, and others)? If so, give their admin_level, relation IDs and quality. How well do they match the everyday meaning of "Old Town" and "Rustaveli"? Is an owner-drawn GeoJSON polygon (e.g. geojson.io) a practical alternative?
3. **Point-in-polygon in Node.** A small, maintained library (e.g. `@turf/boolean-point-in-polygon`) or a hand-rolled function. Keep it minimal.
4. **Street-only fallback.** When there's no house number, or it doesn't geocode, what does a street-level result look like (a line or centroid), and how should a street that crosses a district boundary be treated?
5. **Testability.** Whether the recommended geocoder is a plain HTTP JSON API that msw can fake, and the request and response shape.

Write findings to `.scratch/rental-userbot/research/geocoding.md`.

## Answer

Findings are in [research/geocoding.md](../research/geocoding.md), which includes the raw results of the live Overpass and Nominatim queries. Nothing makes geocoding impractical.

- **Geocoder:** public Nominatim, no key needed.
  - OSM Batumi has 17,486 house-numbered objects, and about 99% of named streets have Russian and English names.
  - 11 of 14 live house queries hit the exact building across Latin, Cyrillic and Georgian spellings, including the Soviet-era name "ул. Кирова". One Cyrillic "45а" fell back to a street segment. A misspelling and a query with extra words returned nothing.
  - So Nominatim handles spelling variants well, **as long as it gets a clean `street + number`**.
  - **Policy** (https://operations.osmfoundation.org/policies/nominatim/): max 1 request per second, a User-Agent naming the app, caching, attribution, and the ability to switch providers. Periodic automated geocoding is capped at 4 requests a minute. Our event-driven, cached, one-at-a-time use at ~50–200 lookups a day is probably fine but close to the line, so keep the base URL configurable.
  - Photon failed on Russian. Google needs a key and billing (free at this volume); its terms forbid use with a non-Google map and limit caching to 30 days.
- **Districts:** OSM has all 15 Batumi units at admin_level 10: Old Batumi = relation 12695439, Rustaveli = 12695438, about 1.3 km² each and adjacent. Landmarks fall where expected.
  - Recommendation: export both into one GeoJSON file that the owner can adjust in geojson.io.
  - **Do not trust Nominatim's district label.** It is inherited from the street, e.g. "Chavchavadze 50" is labelled Bagrationi II although it sits 11 m inside Rustaveli. Test the returned point against the polygon.
- **Point-in-polygon:** a hand-rolled check (~10 lines) is enough; `@turf/boolean-point-in-polygon@7.4.0` is the library alternative.
- **Street only (no house number or no hit):** Nominatim's street result is a single ~150 m segment, which is useless. Instead, precompute each street's share inside the zone from OSM geometry: Rustaveli, Gorgasali and Parnavaz Mepe 100%; Gorgiladze 80%; Chavchavadze 21%; Pushkin 0%. Suggested rule: 100% yes, 0% no, partial "uncertain".
- **Testing:** a plain GET returning a JSON array, easy to fake with msw. Coordinates come back as strings. `place_rank` gives precision: 30 = house, 26 = street.
- **Open:**
  - how agents actually spell streets in real Posts
  - addresses on the boundary between districts
  - whether the official districts match the owner's "Old Town / Rustaveli"
  - Google, Mapbox and HERE were not tested
