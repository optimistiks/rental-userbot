# Geocoding and district boundary facts for Batumi

Researched 2026-09-19. Sources:

- live, low-volume, keyless queries against public **Overpass API** (`overpass-api.de`, data timestamp `2026-09-19T19:14:35Z`), public **Nominatim** (`nominatim.openstreetmap.org`, software 5.3.0, data updated `2026-09-19T19:13:34Z`) and public **Photon** (`photon.komoot.io`). All requests were spaced at least 2 s apart and sent an identifying User-Agent.
- first-party docs and terms from OSMF, nominatim.org, komoot/photon, Google Maps Platform, Mapbox and LocationIQ.
- the npm tarball of `@turf/boolean-point-in-polygon@7.4.0` (fetched with `npm pack`).

Google, Mapbox and LocationIQ were **not** tested live. Each needs a key, and signing up was out of scope.

## Summary / recommendations

- **OSM covers central Batumi well.** Inside the Batumi city boundary there are **17,486 objects with `addr:housenumber`** and 25,375 building ways. Old Batumi has 1,407 addressed objects and Rustaveli has 1,090. Of 2,122 named street ways, about 99% carry `name:ru` (2,103) and `name:en` (2,098). The `addr:street` values themselves are Georgian.
- **Nominatim resolves clean addresses in all three scripts to the same building.** "Gorgiladze 45 Batumi", "ул. Горгиладзе 45 Батуми", "გორგილაძის 45 ბათუმი" and "Горгиладзе 45" all returned OSM way 410645026 at house precision (`place_rank` 30). So did 8 other house queries (Russian, English, and a Soviet-era name, "ул. Кирова 10", which resolved to 26 May St). It is **brittle on noise**:
  - Extra words (e.g. "Old Boulevard") gave no result.
  - A Cyrillic letter suffix ("45а") fell back to a single street segment.
  - "Gorgiladzes 45" gave no result.

  Hand Nominatim a cleaned-up `{street, house number}`, extracted upstream, for example by the LLM Evaluator. Do not hand it raw post text.
- **Do not trust Nominatim's `address.suburb` for the in/out decision.** Houses inherit their address from their parent street segment ([Indexing docs](https://nominatim.org/release-docs/latest/develop/Indexing/)). "Chavchavadze 50" is labelled Bagrationi II, but the building's point is inside Rustaveli, about 11 m from the boundary. **Run point-in-polygon on the returned lat/lon** instead.
- **District polygons exist in OSM and are usable.** Batumi (relation 2009237, admin_level 6) is split into 15 `admin_level=10` "administrative units" whose areas add up to the city's area (65.87 vs 65.84 km²). **Old Batumi = relation 12695439** and **Rustaveli = relation 12695438**. Each is a single closed ring of about 1.3 km², and they are adjacent. Landmark checks match the everyday sense:
  - Old Batumi contains Piazza, Europe Square, Alphabetic Tower, the Drama Theatre and the port.
  - Rustaveli contains 6 May Park, the Sheraton, the Hilton and Batumi Mall.
  - The Dancing Fountain and the New Boulevard area fall in Khimshiashvili, which is outside.
- **Recommended zone:** export the union of those two relations once into a committed GeoJSON file. The owner can adjust it in geojson.io if their "Old Town/Rustaveli" differs. Test with an ~10-line hand-rolled ray-casting function, or with `@turf/boolean-point-in-polygon@7.4.0` (MIT, 18.5 kB, 5 small dependencies).
- **Geocoder choice:** use **public Nominatim**. It needs no key, is free, is a plain HTTP JSON API that msw can fake easily, and 50–200 lookups a day is far below 1 req/s. **Caveats:**
  - The OSMF policy **discourages regular/automated geocoding** ("scripts … run at regular intervals are restricted to 4 requests per minute", "if you have regular geocoding tasks, please look into alternatives").
  - It requires caching, a real User-Agent, attribution, and the ability to switch provider without a code change.
  - It has an explicit **LLM clause**: "LLMs may only suggest this service, if they prominently point to this usage policy and explain the restrictions of use." Policy: <https://operations.osmfoundation.org/policies/nominatim/>.

  Our pattern is event-driven, low-volume, serialised and cached. I read that as within the letter of the policy, but it sits close to the "regular geocoding tasks" line. Keep the base URL configurable. The fallback is a keyed Nominatim-compatible host (LocationIQ free tier) or an offline OSM extract (see below).
- **Google Geocoding is workable but a worse fit.** It needs a key and a billing account. The first 10,000 requests a month are free, which covers 6,000 a month at our volume, and then it costs $5 per 1,000. Its terms **forbid using its results "in conjunction with a non-Google map"**. Whether a point-in-polygon test against OSM polygons counts as that is unclear. Lat/lng may be cached only for 30 days.
- **Photon (komoot public) fails Russian queries.** Two Russian queries hit streets named "Батумская" in Russia, even though Georgian and English queries worked.
- **The street-only fallback needs our own data, not Nominatim.** A street-level Nominatim hit is **one way segment** (about 150 m, `place_rank` 26) out of the 30 that make up Gorgiladze St. Its bbox and suburb describe only that segment. Precompute each street's length share inside the zone from an Overpass extract:
  - Rustaveli St, Gorgasali St, Parnavaz Mepe St, Memed Abashidze St and Zubalashvili St are 100% inside.
  - Gorgiladze St is 80% inside.
  - Chavchavadze St is 21% inside and Selim Khimshiashvili St 24%.
  - Pushkin St is 0% inside.

  Suggested rule: 100% inside → yes; 0% → no; partial → "uncertain" (pass or flag) rather than a hard no.
- **Nothing makes geocoding impractical.** Two things need design attention:
  1. The **noise sensitivity** of free-text geocoding, so extract clean fields first.
  2. **Addresses on boundary streets.** The admin boundaries run along street lines, so either side of a street can fall in a different unit. Consider a small buffer, for example treating anything within about 30 m outside the zone as borderline.

---

## Q1. Geocoders on Batumi addresses

### Coverage measured in OSM (Overpass)

The queries used `area(id:3602009237)` (Batumi), `3612695439` (Old Batumi) and `3612695438` (Rustaveli).

| Measure | Batumi city | Old Batumi | Rustaveli |
|---|---|---|---|
| `nwr["addr:housenumber"]` | **17,486** (1,597 n / 15,836 w / 53 r) | 1,407 | 1,090 |
| `way["building"]` | 25,375 | 1,033 | 950 |
| `nwr["addr:housenumber"]["addr:street"]` | 17,312 | – | – |
| named `highway` ways | 2,122 | – | – |
| … with `name:ru` / `name:en` | 2,103 / 2,098 | – | – |
| … with some `old_name*` / `alt_name*` | 49 / 4 (43 with `old_name:ru`) | – | – |

House numbers on sample central streets, counting objects whose `addr:street` equals the Georgian street name:

| Street | Objects | Notes |
|---|---|---|
| Zurab Gorgiladze St | 225 | 45 is present |
| Vakhtang Gorgasali St | 220 | |
| Ilia Chavchavadze St | 198 | |
| Selim Khimshiashvili St | 154 | |
| Sherif Khimshiashvili St | 108 | |
| Shota Rustaveli St | 83 | |
| Nikoloz Baratashvili St | 66 | |

- House numbers use Georgian letter suffixes (`45ა`, `6ბ`), slashes for corner buildings (`29/56`), and ranges (`39-47`).
- There are small data-quality variants: `ზურაბ გორგილაძს ქუჩა`, `ნიკოლოზ ბარათაშვილის ქუჩის`, `ნიქოლოზ ბარათაშვილი`.
- Other `addr:*` keys seen on these objects: `addr:street:en` 471, `addr:street:ru` 3.

Russian and English search therefore works through the **parent street's** `name:ru`/`name:en`, not through the house's own tags. Nominatim documents this: "Dependent places are all places on rank 30: house numbers, POIs etc. These places don't have a full address of their own. Instead they are attached to a parent street or place and use the information of the parent for searching and displaying information." ([Indexing](https://nominatim.org/release-docs/latest/develop/Indexing/))

Soviet-era names are only partly tagged. For example, Gorgiladze St has `old_name:en=Era Street`, and 26 May St has `old_name:ru=улица Кирова`.

### Live Nominatim queries (raw results)

Request shape: `GET https://nominatim.openstreetmap.org/search?q=<q>&format=jsonv2&addressdetails=1&limit=2..3&countrycodes=ge`, with User-Agent `tg-userbot-research/0.1 (<contact>)`. `suburb` is Nominatim's `address.suburb`. PIP is my point-in-polygon test of the returned point against the OSM admin_level=10 polygons.

| Query | Top hit | Rank | lat, lon | Nominatim suburb | PIP |
|---|---|---|---|---|---|
| `Gorgiladze 45 Batumi` | way 410645026 building=apartments, "45, ზურაბ გორგილაძის ქუჩა" | 30 (house) | 41.6456051, 41.6284693 | რუსთაველი | Rustaveli |
| `ул. Горгиладзе 45 Батуми` | same way 410645026 | 30 | same | რუსთაველი | Rustaveli |
| `გორგილაძის 45 ბათუმი` | same way 410645026 | 30 | same | რუსთაველი | Rustaveli |
| `Горгиладзе 45` (no city) | same way 410645026 | 30 | same | რუსთაველი | Rustaveli |
| structured `street=45 Gorgiladze&city=Batumi` | same way 410645026 | 30 | same | – | Rustaveli |
| structured `street=45 Горгиладзе&city=Батуми` | same way 410645026 | 30 | same | – | Rustaveli |
| `Chavchavadze 50 Batumi` | way 421175520 building=retail, 50 Chavchavadze St. **Second hit:** node 10201873998 (fast_food), also "50", at 41.6474814, 41.6435715 in Old Batumi, about 1 km away | 30 | 41.6437281, 41.6322006 | **ბაგრატიონი II** | **Rustaveli** (11 m from the boundary) |
| `ул. Чавчавадзе 50, Батуми` | same two, in the same order | 30 | same | ბაგრატიონი II | Rustaveli |
| structured `street=50 Чавчавадзе&city=Батуми` | way 421175520 | 30 | same | – | Rustaveli |
| `Gorgasali 33 Batumi` | way 1127835288 building=commercial | 30 | 41.6481086, 41.6393883 | ძველი ბათუმი | Old Batumi |
| `Батуми, Руставели 30` | way 1195896834 building=construction, 30 Shota Rustaveli St | 30 | 41.6502583, 41.6292616 | რუსთაველი | Rustaveli |
| `Батуми, ул. Зубалашвили 12` | way 1199283397, housenumber "12/50" | 30 | 41.6482015, 41.6413649 | ძველი ბათუმი | Old Batumi |
| `Batumi, Baratashvili st. 25` | node 10162297021 (hotel) and way 96037257 (circus), both "25" | 30 | 41.6498127, 41.6374506 | ძველი ბათუმი | Old Batumi |
| `Батуми, Химшиашвили 7` | way 1212979087, **Selim** Khimshiashvili 7. Second hit: **Sherif** Khimshiashvili 7 (Justice House) at 41.6411, 41.6151, suburb ხიმშიაშვილი | 30 | 41.6451348, 41.6280555 | რუსთაველი | Rustaveli |
| `Батуми, ул. Пушкина 120` | way 410885496 (hospital) | 30 | 41.6423523, 41.6349532 | ბაგრატიონი II | Bagrationi II |
| `Батуми, ул. Инасаридзе 7` | way 423555873 residential | 30 | 41.6343930, 41.6107038 | ხიმშიაშვილი | Khimshiashvili |
| `Батуми, ул. Кирова 10` (Soviet name) | way 296476470, "10, 26 მაისის ქუჩა" | 30 | 41.6495771, 41.6302174 | რუსთაველი | – |
| `Батуми, Горгиладзе 45а` (Cyrillic "а") | way 892593225 highway=tertiary: **street segment only** | 26 (street) | 41.6443890, 41.6239136 | რუსთაველი | – |
| `Batumi Gorgiladzes 45` | **no result** | – | – | – | – |
| `Batumi, Old Boulevard, Ninoshvili 20` | **no result** | – | – | – | – |
| `Батуми, улица Горгиладзе` (free-form, street only) | POIs on the street (Batumi Mall node, 90 Gorgiladze; a bus stop), not the street | 30 | 41.6436, 41.6195 | რუსთაველი | – |
| `Gorgiladze street, Batumi` | POI: clinic at 96 Gorgiladze, in **Khimshiashvili** | 30 | 41.6425, 41.6175 | ხიმშიაშვილი | – |

Tally: 14 house-style queries. 11 returned the house (in all three scripts), 1 fell back to street level (a letter suffix in the wrong script), and 2 returned nothing (a transliteration typo, and extra noise words). Two ambiguity traps showed up:

- Two "Khimshiashvili" streets (Selim and Sherif) are in different districts.
- Duplicate "50" tags on Chavchavadze St are about 1 km apart, which is an OSM data error.

### Live Photon queries (public komoot instance)

Request: `GET https://photon.komoot.io/api/?q=<q>&limit=2`.

| Query | Result |
|---|---|
| `Gorgiladze 45 Batumi` | node 4803429121 and way 410645026, housenumber 45, district რუსთაველი ✔ |
| `გორგილაძის 45 ბათუმი` | same ✔ |
| `ул. Горгиладзе 45 Батуми` | ✘ "45 Батумская улица", Volgograd, and Khabarovsk |
| `Батуми, ул. Зубалашвили 12` | ✘ Moscow and Shakhty |
| `Chavchavadze 50 Batumi` with `lang=en` | non-JSON error response |

Photon's API doc says the set of languages "depends on individual photon installations" ([api-v1.md](https://raw.githubusercontent.com/komoot/photon/master/docs/api-v1.md)). Photon's own README says the published GraphHopper dumps contain "names in English, German, French and local language" ([README](https://github.com/komoot/photon)). Russian appears not to be indexed on the public server. Public server terms: "as long as the number of requests stay in a reasonable limit. Extensive usage will be throttled or completely banned. We do not give guarantees for availability" ([README](https://github.com/komoot/photon)).

### Terms, limits, cost, keys

| Provider | Key | Rate limit | Caching | Attribution | Cost at 50–200/day (≤6k/month) |
|---|---|---|---|---|---|
| **Nominatim (OSMF public)** | none | "absolute maximum of 1 request per second"; bulk/regular scripts "restricted to 4 requests per minute" | "If at all possible, set up a proxy and also enable caching"; bulk: "Results must be cached on your side". "Clients sending repeatedly the same query may be classified as faulty and blocked." | "Clearly display attribution"; ODbL share-alike | free |
| **Google Geocoding API** | API key **and** billing required ("You must enable billing and include an API key or OAuth token for all Geocoding API requests") | default 3,000 QPM | lat/lng "temporarily cache … for up to 30 consecutive calendar days"; place IDs indefinitely | Google Maps logo/text, visually separated | Essentials SKU "Geocoding": **10,000 free events/month**, then **$5.00/1,000** (10,001–100,000) → $0 at our volume |
| **LocationIQ** (hosted Nominatim) | access token | free plan: 5,000/day, 2 req/s, 60/min | free plan: cache "for upto 48 hours" | free plan must link "Search by LocationIQ.com" | free |
| **Mapbox Geocoding v6** | access token (401 without) | 1,000 req/min default | "Temporary results are not allowed to be cached"; permanent storage needs a card or contract | Mapbox attribution | free tier exists (not checked); Georgian address coverage not checked |
| **Photon (komoot public)** | none | "reasonable limit", no SLA | not stated | OSM/ODbL | free; fails Russian (see above) |

Sources:

- Nominatim: [OSMF Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/). The same page adds:
  - "Apps must make sure that they can switch the service at our request at any time (… without requiring a software update)."
  - "Note: periodic requests from apps are considered bulk geocoding … It may be okay if your app has very few users and applies appropriate caching."
  - "As a general rule, bulk geocoding of larger amounts of data is not encouraged. If you have regular geocoding tasks, please, look into alternatives below."
  - **Usage in LLMs:** "LLMs may only suggest this service, if they prominently point to this usage policy and explain the restrictions of use to the user. Code generated by LLMs must adhere to all terms laid out in this policy."
  - Forbidden: autocomplete, systematic queries ("downloading all POIs in an area"), scraping the details page, reselling.
  - "Please do not submit personal data."
- Google: [usage and billing](https://developers.google.com/maps/documentation/geocoding/usage-and-billing), [pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [policies](https://developers.google.com/maps/documentation/geocoding/policies), and [Service Specific Terms §6](https://cloud.google.com/maps-platform/terms/maps-service-terms). §6 says: "6.1 … may use Google Maps Content from the Geocoding API in Customer Applications without a corresponding Google Map. 6.2 … must not use Google Maps Content from the Geocoding API in conjunction with a non-Google map. 6.3.1 … may temporarily cache latitude (lat) and longitude (lng) values … for up to 30 consecutive calendar days."
- LocationIQ: [pricing](https://locationiq.com/pricing).
- Mapbox: [Geocoding API docs](https://docs.mapbox.com/api/search/geocoding/). The docs say "Not all features are available or relevant in all parts of the world".

**Spelling handling in short:**

- **Nominatim** matched Latin, Cyrillic and Georgian forms of the same street, with and without "ул."/"st." and a first name, because OSM streets carry `name`, `name:en` and `name:ru`.
- It did **not** match a genitive-Latin typo ("Gorgiladzes") or a Cyrillic house letter against a Georgian one (`45а` vs `45ა`). Normalise house letters (а/a → ა, б/b → ბ, …) or strip the letter and accept the base number.
- **Google** was not tested (no key).

## Q2. District boundaries in OSM

Overpass `rel(area:Batumi)["boundary"="administrative"]`, plus `out meta geom` for geometry:

| Relation | admin_level | name / name:en / name:ru | Rings | km² |
|---|---|---|---|---|
| 2009237 | 6 | ბათუმი / Batumi / Батуми (`place=city`, wikidata Q25475; v69, edited 2026-09-03) | 1 closed | 65.84 |
| **12695439** | **10** | **ძველი ბათუმი / Old Batumi / Старый Батуми**. `official_name:en` = "Old Batumi Administrative Unit". v9, last edit 2024-04-25. 3 outer ways, 111 nodes | 1 closed | 1.30 |
| **12695438** | **10** | **რუსთაველი / Rustaveli / Руставели**. `official_name:en` = "Rustaveli Administrative Unit". v11, last edit 2024-04-25. 5 outer ways, 43 nodes | 1 closed | 1.30 |
| 12695435 | 10 | Javakhishvili | 1 | 1.70 |
| 12695436 | 10 | Bagrationi II | 1 | 1.27 |
| 12695437 | 10 | Khimshiashvili | 1 | 1.12 |
| 15057027 | 10 | Bagrationi I | 1 | 1.15 |
| 12822696 | 10 | Agmashenebeli | 1 | 2.35 |
| 15061765 | 10 | Tamari | 1 | 3.04 |
| 15061766 | 10 | Boni-Gorodoki | 1 | 2.95 |
| 12715721 | 10 | Airport | 1 | 13.39 |
| 12865081 | 10 | Kakhaberi | 1 | 9.08 |
| 12865104 | 10 | Mtsvane-Kontskhi | 1 | 8.69 |
| 15066810 | 10 | Batumi's Industrial District | 1 | 4.40 |
| 15066811 | 10 | Gonio-Kvariati | 1 | 14.12 |

**Quality:**

- Every unit is a single closed outer ring with no inner rings, and all carry ka/en/ru names.
- The 15 units add up to 65.87 km² against 65.84 km² for the city, so they tile the city with no significant gap or overlap. I computed areas with a flat-earth approximation.
- No `source` tag is present, so I could not verify them against an official municipal map. See Open uncertainties.
- The boundaries run along street lines. One example is Chavchavadze St, where building 50 is 11 m inside Rustaveli while its street segment belongs to Bagrationi II.

**Match to everyday meaning.** I classified OSM landmarks by point-in-polygon:

- **Old Batumi:** Batumi Piazza, Europe Square, Astronomical Clock, Alphabetic Tower, Batumi Lighthouse, Batumi Drama Theatre, Circus, Cathedral of the Mother of God, Port Passenger Terminal, and the Batumi Boulevard centroid.
- **Rustaveli:** 6 May Park, Sheraton, Hilton, Batumi Mall, Heart Arch, Japanese Garden.
- **Outside:** the Dancing Fountain and Equator Boat (Khimshiashvili, the "New Boulevard" side), and Shindisi Heroes Park (Javakhishvili).

That matches the usual picture: Old Town is the northern peninsula around Piazza and Europe Square, and "Rustaveli" is the strip along Rustaveli Ave and the boulevard down to 6 May Park. Two caveats:

1. Rental posts often say "Rustaveli" meaning **Rustaveli Avenue**, a street. Rustaveli St lies 100% within the Old Batumi ∪ Rustaveli union (2,329 m in Rustaveli, 1,407 m in Old Batumi), so that reading is also covered.
2. Agents may stretch "Old Town" to streets just across the edge, for example the Bagrationi I/II side of Chavchavadze or Baratashvili.

**Owner-drawn GeoJSON is practical.** geojson.io is "a browser-based tool for creating and editing spatial data", and it imports and exports GeoJSON ([mapbox/geojson.io](https://github.com/mapbox/geojson.io)). The easiest workflow:

1. Export the two OSM relations' rings, already assembled in this research as closed rings of 111 + 43 nodes. Save them as a `FeatureCollection` with coordinates in `[lon, lat]` order.
2. Load the file in geojson.io and let the owner nudge the edges.
3. Commit the file.

A static file removes any runtime dependency on OSM for boundaries. If share-alike matters (it does not for a private bot), note that a polygon derived from OSM stays under ODbL. OSM's terms: "If you alter or build upon our data, you may distribute the result only under the same license" ([osm.org/copyright](https://www.openstreetmap.org/copyright)).

## Q3. Point-in-polygon in Node

`@turf/boolean-point-in-polygon`:

- **7.4.0** is the latest release (published 2026-08-03; the previous one was 7.3.5 on 2026-04-19). MIT, unpacked 18.5 kB, `"type": "module"` with both ESM and CJS exports (`npm view`, `npm pack`).
- Dependencies: `@turf/helpers`, `@turf/invariant`, `point-in-polygon-hao ^1.1.0` (latest 1.2.4, which depends on `robust-predicates`), `tslib`, and `@types/geojson`.
- API (from `dist/esm/index.js`): `booleanPointInPolygon(point, polygon, { ignoreBoundary? })`.
  - `point` is a `[lon, lat]` coordinate or a Point feature.
  - `polygon` is a Polygon/MultiPolygon geometry or feature.
  - It short-circuits on `polygon.bbox`, and counts a point on the boundary as inside unless `ignoreBoundary` is set.

A hand-rolled even-odd ray-casting test is about 10 lines. That is what produced the PIP column above:

```ts
function inRing([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
```

At a 1 km² scale with points never exactly on an edge, the floating-point robustness that `point-in-polygon-hao` adds does not matter. Hand-rolled is enough, provided we keep the zone to plain Polygons without holes, or loop over the rings. Choose turf if you want MultiPolygon/hole handling for free.

## Q4. Street-only fallback

**What Nominatim returns.** Structured `street=Gorgiladze&city=Batumi&polygon_geojson=1&polygon_threshold=0.0005` returned **two results, each one OSM way segment**, deduplicated per district:

- way 892593225, `place_rank` 26, bbox about 150 m, suburb Rustaveli
- way 1123458032, suburb Old Batumi

Trimmed raw response:

```json
{"place_id":206811007,"licence":"Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
 "osm_type":"way","osm_id":892593225,"lat":"41.6443890","lon":"41.6239136",
 "category":"highway","type":"tertiary","place_rank":26,"importance":0.0534,"addresstype":"road",
 "name":"ზურაბ გორგილაძის ქუჩა",
 "display_name":"ზურაბ გორგილაძის ქუჩა, რუსთაველი, ბათუმი, აჭარის ავტონომიური რესპუბლიკა, 6000, საქართველო",
 "address":{"road":"ზურაბ გორგილაძის ქუჩა","suburb":"რუსთაველი","city":"ბათუმი","state":"…","ISO3166-2-lvl4":"GE-AJ","postcode":"6000","country":"საქართველო","country_code":"ge"},
 "boundingbox":["41.6441216","41.6446563","41.6230418","41.6247855"],
 "geojson":{"type":"LineString","coordinates":[[41.6247855,41.6446563],[41.6230418,41.6441216], "…"]}}
```

The `lat/lon` is a point on that one segment, and the `boundingbox` and `geojson` cover only that segment. In OSM, Gorgiladze St is **30 ways** with a bbox of lat 41.6404–41.6496 and lon 41.6152–41.6369. A free-form street-only query ("улица Горгиладзе, Батуми") returns **POIs on the street** instead: Batumi Mall in Rustaveli, and a clinic in Khimshiashvili for the English form. Nominatim's street-level answer is therefore essentially a random point on the street. Do not use it for the decision.

**Better: a precomputed street table from Overpass.** Fetch every named `highway` way in Batumi once, with its name variants and geometry. Then compute each street's length inside the zone. Length share inside Old Batumi ∪ Rustaveli, measured on 11 streets (`way(area.c)[highway][name~"^(…) ქუჩა$"]; out geom tags;`, each segment assigned by its midpoint):

| Street | Total | Inside zone | Breakdown (m) |
|---|---|---|---|
| Shota Rustaveli St | 3,737 m | 100% | Rustaveli 2,329, Old Batumi 1,407 |
| Vakhtang Gorgasali St | 2,056 m | 100% | Rustaveli 1,269, Old Batumi 788 |
| Parnavaz Mepe St | 1,917 m | 100% | Rustaveli 1,026, Old Batumi 891 |
| Memed Abashidze St | 1,064 m | 100% | Old Batumi 807, Rustaveli 258 |
| Stefane Zubalashvili St | 820 m | 100% | Old Batumi 812, Rustaveli 8 |
| Merab Kostava St | 361 m | 100% | Old Batumi |
| Nikoloz Baratashvili St | 816 m | 97% | Old Batumi 794, Bagrationi I 22 |
| Zurab Gorgiladze St | 2,089 m | 80% | Rustaveli 1,334, **Khimshiashvili 426**, Old Batumi 329 |
| Selim Khimshiashvili St | 1,798 m | 24% | Bagrationi II 767, Javakhishvili 600, Rustaveli 432 |
| Ilia Chavchavadze St | 2,815 m | 21% | Bagrationi I 1,313, Bagrationi II 901, Old Batumi 600 |
| Alexander Pushkin St | 2,917 m | 0% | Bagrationi II 1,694, Bagrationi I 1,223 |

**Suggested treatment of a street crossing the zone boundary:**

- share = 100% (or ≥ ~95%): **inside**.
- share = 0%: **outside**, a hard no.
- anything else: **uncertain**. Don't hard-reject. Let the Evaluator pass it with a note such as "street partly in zone", or ask for the house number.

This table can come from a one-off Overpass pull committed as JSON, so there is no runtime dependency. Public Overpass asks for "a maximum of about 10000 requests per day and … below about 1 GB per day". It warns that relying on it as the backend of a general-user app is inappropriate ([Overpass commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)), which is one more reason to extract once rather than query at runtime.

The same extract could replace the geocoder entirely. There are about 17k `addr:*` objects with street names in 3 scripts, so a local `(street variant, housenumber) → point` index would work. The cost is writing our own fuzzy name matching for Latin transliterations ("Gorgiladzes", "Gorgiladze ul."). Nominatim does that tokenising for us.

## Q5. Testability

Nominatim is a plain HTTPS GET that returns JSON, with no auth, so msw can intercept it with `http.get('https://nominatim.openstreetmap.org/search', …)`.

**Request.** `GET /search` with query parameters:

- either `q=<free text>` or structured `street=<housenumber> <streetname>`, `city=Batumi`. The docs say structured parameters "cannot be combined with the `q=<query>` parameter".
- `countrycodes=ge`
- `format=jsonv2` (the default; `geojson` and `geocodejson` also exist)
- `addressdetails=1`
- `limit` (default 10, max 40)
- optionally `accept-language=en`, `layer=address`, `viewbox=<lon1,lat1,lon2,lat2>&bounded=1` to hard-filter to Batumi, `polygon_geojson=1`, and `dedupe=0`

Source: [Search API](https://nominatim.org/release-docs/latest/api/Search/).

Header: `User-Agent: <app>/<ver> (<contact>)`, as required by policy.

**Response.** HTTP 200, `content-type: application/json; charset=utf-8`. The body is an array, `[]` when there are no results. Captured live:

```json
[{"place_id":208137191,"licence":"Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright",
  "osm_type":"way","osm_id":410645026,"lat":"41.6456051","lon":"41.6284693",
  "category":"building","type":"apartments","place_rank":30,"importance":6.58373388265357e-05,
  "addresstype":"building","name":"",
  "display_name":"45, ზურაბ გორგილაძის ქუჩა, რუსთაველი, ბათუმი, აჭარის ავტონომიური რესპუბლიკა, 6000, საქართველო",
  "address":{"house_number":"45","road":"ზურაბ გორგილაძის ქუჩა","suburb":"რუსთაველი","city":"ბათუმი",
             "state":"აჭარის ავტონომიური რესპუბლიკა","ISO3166-2-lvl4":"GE-AJ","postcode":"6000",
             "country":"საქართველო","country_code":"ge"},
  "boundingbox":["41.6454026","41.6458069","41.6282819","41.6286539"]}]
```

**Points to encode in the client and its tests:**

- `lat`/`lon`/`boundingbox` are **strings**, and `boundingbox` is ordered `[minLat, maxLat, minLon, maxLon]`.
- Precision comes from `place_rank`: 30 = house or POI, 26–27 = street, lower = area.
- `address.house_number` is present only on house-level hits.
- Several rank-30 hits can come back for one address (the building plus shops inside it). Take the first, or prefer `category=building`.
- There is a real OSM trap where the same number sits on the same street about 1 km apart (Chavchavadze 50). Consider flagging when the top-N house hits are far apart.
- Observed response headers: `x-nominatim-server`, `vary: accept-language`, Varnish cache headers.
- The policy page describes throttling or blocking, but I could not verify the exact status code or body the server sends when it blocks a client (see uncertainties). Treat any non-200 or network error as a retryable "geocoder unavailable" and do not decide in/out on it.

Google's Geocoding API is also plain HTTP JSON (`GET https://maps.googleapis.com/maps/api/geocode/json?address=…&key=…`), so it is equally fakeable. I did not verify its response shape live.

## Open uncertainties

- **Nominatim policy fit.** Our pattern is event-driven, about 50–200 a day, serialised, cached, with a few users. That is arguably allowed. The policy also says regular geocoding tasks should "look into alternatives", and periodic app requests count as bulk, which caps them at 4 per minute. There is no clear bright line. Mitigations:
  - a configurable base URL, so we can switch to LocationIQ (Nominatim-compatible, key, 5k a day free, 48 h caching limit) or our own index
  - a long-lived cache keyed on the normalised query
  - at most 1 request per second
  - attribution in the bot's output or README
- **Google "no use with a non-Google map".** Whether testing Google-derived points against OSM-derived polygons, with nothing displayed, breaches §6.2 of the Service Specific Terms is a legal question I did not resolve.
- **Google/Mapbox/HERE quality in Batumi** was not measured because no keys were used. Mapbox's Georgia address coverage and free-tier size were not checked. HERE was not researched.
- **Authority of the OSM admin_level=10 units.** No `source` tag. I did not find the Batumi City Hall's official map of administrative units to compare against. The landmark check suggests they are sensible.
- **Everyday "Old Town"/"Rustaveli" vs the admin units.** This is the owner's call. The owner should look at the two polygons, for example by loading the exported GeoJSON in geojson.io, and adjust edges such as the Chavchavadze/Baratashvili side or the Gorgiladze stretch in Khimshiashvili.
- **Boundary-street addresses.** Because units split along street lines, a house on the edge may land on either side. I did not measure how many zone addresses lie within, say, 30 m of the outer boundary.
- **Transliteration robustness.** I ran only 14 house queries. Common agent spellings ("Gorgiladzes", "Chavchavadzis", "Zubalashvilis", Georgian genitives in Latin) and Russian letter suffixes need a larger test set before trusting the free-text path. Normalising upstream (LLM extraction plus house-letter mapping) is assumed, not proven.
- **Soviet-era street names** are only partly tagged (49 streets with `old_name*`). Posts using old names may miss.
- **Nominatim throttling response shape** (status code and body when blocked) was not observed.
