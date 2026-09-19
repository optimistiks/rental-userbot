# LocationIQ forward geocoding (Search) API

Researched 2026-09-19. Sources are LocationIQ's own docs, fetched as raw HTML and read, including the OpenAPI spec embedded in the API reference page:

- [Search / Forward Geocoding guide](https://docs.locationiq.com/docs/search-forward-geocoding)
- [API reference: Free Form Query](https://docs.locationiq.com/reference/search). It embeds the OpenAPI document: `servers`, `securitySchemes`, the `location-forward` schema and the `*Error-search` responses.
- [Errors](https://docs.locationiq.com/docs/errors)
- [Security (access tokens)](https://docs.locationiq.com/docs/authentication)
- Parameter pages: [Match Quality](https://docs.locationiq.com/docs/match-quality), [Address details](https://docs.locationiq.com/docs/address-details), [Normalize Address](https://docs.locationiq.com/docs/normalize-address), [Country Codes](https://docs.locationiq.com/docs/country-codes), [Accept Language](https://docs.locationiq.com/docs/accept-language)
- One exception to docs-only: **docs.locationiq.com gives no rate-limit numbers and no caching terms.** Those come from the first-party [pricing page](https://locationiq.com/pricing) (plan table and FAQ).

No live API requests were made. No token was used.

## Summary

- **Endpoint:** `GET https://us1.locationiq.com/v1/search` or `GET https://eu1.locationiq.com/v1/search`. The docs say to pick the region nearer your users, so eu1 for Georgia. `api.locationiq.com/v1` is documented as the "Autocomplete only Endpoint".
- **Auth:** the key goes in the query string as `key=<token>`. The OpenAPI spec defines exactly one security scheme, `{"name":"key","type":"apiKey","in":"query"}`. **No header option is documented.** Data tokens start with `pk.`. A scoped token needs the `geocoding:forward` scope.
- **No `place_rank`.** The documented response schema has no `place_rank` field, and the string does not appear anywhere in the reference page. To tell a house-level hit from a street-level hit, use one of these:
  - **`matchquality=1` (the purpose-built signal):** each result gets `matchquality: {matchcode, matchtype, matchlevel}`. `matchlevel` is `building` for a house-level hit and `street` for a street-level hit. `venue` means POI level; the other values are neighbourhood, island, borough, city, county, state, country, marine and postalcode. `matchtype` is `point` (rooftop), `centroid` (centroid of a road or admin boundary) or `interpolated`.
  - **Weaker fallback:** `addressdetails=1` (or `normalizeaddress=1`) and check whether `address.house_number` is present. Nominatim-style `class`/`type` also come back, but the docs describe them only generically.
- **No results is HTTP 404 with body `{"error":"Unable to geocode"}`**, not `200 []` as on Nominatim. Treat 404 plus that message as "no match", not as a failure.
- **Rate limited is HTTP 429** with body `{"error":"Rate Limited Second"}`, `"Rate Limited Minute"` or `"Rate Limited Day"`.
- **Bad key is HTTP 401** with body `{"error":"Invalid key"}`. The reference examples spell it `"Invalid Key"`, so compare case-insensitively or on status alone. The other 401 body is `"Key not active - Please write to …"`.
- **Free plan:** 5,000 requests/day, 2 requests/second and 60 requests/minute. The free plan may cache request-response pairs **for up to 48 hours**. Commercial use requires a link back ("Search by LocationIQ.com").

## (1) Endpoint, method, auth

The OpenAPI `servers` section of the [reference](https://docs.locationiq.com/reference/search) lists these hosts:

| URL | description |
|---|---|
| `https://us1.locationiq.com/v1` | US Region Endpoint |
| `https://eu1.locationiq.com/v1` | EU Region Endpoint |
| `https://api.locationiq.com/v1` | Autocomplete only Endpoint |

- **Path and method:** `GET /search` (free-form). The related endpoints are `/search/structured` and `/search/postalcode`.
- **Example from the [guide](https://docs.locationiq.com/docs/search-forward-geocoding):** `https://eu1.locationiq.com/v1/search?key=YOUR_ACCESS_TOKEN&q=SEARCH_STRING&format=json`
- **Region advice from the guide:** "Always choose the endpoint (`us1` or `eu1`) closer to the majority of your user base".
- **Security scheme:** `securitySchemes.key = {"name":"key","type":"apiKey","in":"query","description":"LocationIQ Access Token"}`. It is the only scheme, and no header alternative is documented anywhere in the docs.
- **Token details ([Security](https://docs.locationiq.com/docs/authentication)):**
  - Data access tokens start with `pk.` and call the product APIs.
  - Account tokens start with `sk.` and cannot call data APIs.
  - Scopes are written like `geocoding:forward`. Older unscoped data tokens keep access to all data APIs.
  - You can add IP restrictions (up to 5 IPv4/CIDR entries, taking up to 10 minutes to apply) and HTTP referrer restrictions.
  - Because the key travels in the URL, **redact `key=` from any logged URL**.

## (2) Parameters (from the reference)

| param | documented behaviour |
|---|---|
| `q` | Required. Free-form query. "Commas are optional, but improves performance". Do not combine with structured params. |
| `format` | `xml` (default), `json` or `xmlv1.1`. Pass `format=json`. "compatible with OpenStreetMap's Nominatim … However, all our enhancements … are supported only in json or xmlv1.1". |
| `countrycodes` | ISO 3166-1 alpha-2 code(s), comma-separated. Use `ge` for Georgia. |
| `limit` | Accepts 1–50. Default **10**. |
| `viewbox` | Two corner points in either order (`max_lon,max_lat,min_lon,min_lat` or `min_lon,min_lat,max_lon,max_lat`). A preference unless combined with `bounded`. |
| `bounded` | `0`/`1`. Default 0. Restricts results to the viewbox. |
| `accept-language` | Default **`en`**. Overrides the Accept-Language header. `native` gives the local language. Search accepts a comma-separated list of codes. The docs warn that setting it "does not guarantee a response purely in that language". |
| `addressdetails` | `0`/`1`. Default 0. Adds the `address` breakdown. |
| `normalizeaddress` | `0`/`1`. Default 0 ("We recommend setting this to 1 for new projects"). Rolls `address` up to a fixed set: `name, house_number, road, neighbourhood, suburb, island, city, county, state, state_code, postcode, country, country_code`. |
| `normalizecity` | `0`/`1`. Default 0. If `city` is missing, fills it from the first of `city_district, locality, town, borough, municipality, village, hamlet, quarter, neighbourhood`. |
| `dedupe` | `0`/`1`. Default **1**. Merges duplicate OSM objects, such as split street ways. `limit` is applied *before* dedupe, so you can get fewer results than `limit`. |
| `matchquality` | `0`/`1`. Default 0. Adds the `matchquality` object (see (3)). |
| `source` | Omit to use "multiple public and proprietary datasets". `nom` restricts results to their internal Nominatim cluster ("results may vary from the official Nominatim instance"). |
| `normalizeimportance` | Default 1. Clamps `importance` to 0..1. |
| others | `statecode`, `postaladdress`, `namedetails`, `extratags`, `polygon_geojson`/`kml`/`svg`/`text`, `polygon_threshold`, `json_callback`. |

## (3) Response shape for a hit

On success the response is `200` with a JSON **array** of results. The `location-forward` schema in the reference lists these properties:

- `place_id` (string)
- `licence` (string)
- `osm_type` (string)
- `osm_id` (string)
- **`lat` and `lon` are strings.** The schema says `"type":"string"`, and the examples show `"lat": "40.7484284"`.
- `display_name` (string)
- `class` (string): "The category of this result"
- `type` (string): "The 'type' of the class/category of this result"
- `importance` (number, 0..1)
- `address`: the plain or normalized address object
- `boundingbox`: an array of 4 strings, `[min_lat, max_lat, min_lon, max_lon]`
- `icon`
- optional objects, returned only when requested: `namedetails`, `extratags`, `geojson`, `geokml`, `svg`, `geotext`, `matchquality`, `postaladdress`

Required properties are `place_id, licence, lat, lon, display_name, boundingbox`. Everything else, including `class`, `type`, `importance` and `address`, is optional.

Example hit, from the reference:

```json
[{"place_id":"116136978","licence":"https://locationiq.com/attribution","osm_type":"way","osm_id":"34633854",
  "boundingbox":["40.7479255","40.7489585","-73.9865012","-73.9848166"],
  "lat":"40.74844205","lon":"-73.98565890160751",
  "display_name":"Empire State Building, 350, 5th Avenue, …","class":"tourism","type":"attraction",
  "importance":0.8515868466874569,"icon":"…",
  "address":{"attraction":"Empire State Building","house_number":"350","road":"5th Avenue", "…":"…","country_code":"us"}}]
```

**`place_rank` is not part of the documented response.** It is absent from the schema and from every example on the reference page. There is also no `addresstype`. The documented way to judge precision is **`matchquality=1`** ([Match Quality](https://docs.locationiq.com/docs/match-quality)), which adds these fields:

| field | values |
|---|---|
| `matchcode` | `exact`: matches the query "with a high level of probability"<br>`fallback`: "does not exactly match the input but is closely related to it provided there is direct a hierarchical relation"<br>`approximate`: "medium to low level of probability" |
| `matchtype` | `point`: "a point address, typically with rooftop accuracy"<br>`centroid`: "centroid of a road or administrative boundary"<br>`interpolated` |
| `matchlevel` | `venue` (POI), **`building` ("house level")**, **`street`**, `neighbourhood`, `island`, `borough`, `city`, `county`, `state`, `country`, `marine`, `postalcode` |

Example from the spec: `{"matchcode":"exact","matchtype":"point","matchlevel":"venue"}`.

**Suggested classification (inference, not tested live):**

- **House-level:** `matchlevel ∈ {building, venue}`.
- **Street-level:** `matchlevel === "street"`.
- Anything coarser counts as not a usable hit.
- A cross-check is `address.house_number` present, which needs `addressdetails=1` or `normalizeaddress=1`.
- `matchcode: "fallback"` probably marks the case where you asked for a house and got the street. **This is not verified.** Confirm it against a real Batumi query before relying on it.

## (4) Errors

On errors the body is `{"error": "<message>"}` (schema `error`), and the HTTP status carries the meaning. Table from [Errors](https://docs.locationiq.com/docs/errors), cross-checked against the `*Error-search` responses in the reference:

| HTTP | `error` body | meaning |
|---|---|---|
| 400 | `Invalid Request` | required params missing or invalid |
| 401 | `Invalid key` (reference examples: `Invalid Key`) | invalid access token |
| 401 | `Key not active - Please write to [support email]` | token invalid or inactive |
| 403 | `Service not enabled` | service not enabled on the token |
| 403 | `Access restricted` | unauthorized domain/IP, **or token missing the required scope** |
| **404** | **`Unable to geocode`** | "No location or places were found for the given input" |
| **429** | `Rate Limited Second` / `Rate Limited Minute` / `Rate Limited Day` | exceeded the per-second / per-minute / per-day limit |
| 500 | `Unknown error - Please try again after some time` | server-side error; retry |

So **"no results" is `404 {"error":"Unable to geocode"}`, not `200 []`.** A client ported from Nominatim must map 404 plus that message to "no match" and not throw on it.

- **Retry-After:** the docs do not mention a `Retry-After` header on 429.
- **Retry advice:** the guide only says to "retry failed requests after a short while".
- **Suggested handling:**
  - Treat `Rate Limited Second` or `Rate Limited Minute` as transient.
  - Treat `Rate Limited Day` as "stop until tomorrow".
  - Treat 401 and 403 as configuration errors.

## (5) Free-plan limits and caching

These are not on docs.locationiq.com. They come from the [pricing page](https://locationiq.com/pricing) as fetched 2026-09-19.

- **Limits:** "Free … 5000 requests /day, 2 requests /second … 60 requests per minute".
- **Attribution:** "Limited Commercial Use: You can use our free plan in commercial projects if you spread the love by adding a prominent link back to us on your website or app in this format: `<a href='https://locationiq.com'>Search by LocationIQ.com</a>`". The pricing page also lists: 1 Access Token, IP and HTTP Restrictions, US & EU Datacenters.
- **Caching (pricing FAQ):** "If you have a free account, you can cache API request-response pairs for upto 48 hours. If you're a customer, cache request-response pairs for as long as you're a customer!" The same answer opens with "You can store response data forever". The most plausible reading is that the stored *derived data* (for example the verdict we compute) may be kept, while the raw request→response cache is capped at 48 h on free. **That reading is an interpretation, not a stated rule.**
- **Map tiles:** "We do not allow server-side caching of map tiles" (not relevant here).
- **Docs guidance:** the forward-geocoding guide only says "consider caching results to reduce redundant calls".

## Live check (2026-09-19)

Five queries against `eu1.locationiq.com/v1/search` using the owner's token, each with `q=<address>, Batumi&countrycodes=ge&format=json&limit=1&matchquality=1&addressdetails=1`:

| Query | HTTP | matchcode / matchtype / matchlevel | Result |
|---|---|---|---|
| `Chavchavadze 50` | 200 | exact / point / building | house 50. Labelled Bagrationi II, although the research places it 11 m inside Rustaveli |
| `ул. Горгасали 45` | 200 | exact / point / building | house `45/30`, Old Batumi |
| `Gorgasali 999` (no such house) | 200 | **exact** / centroid / **street** | street centroid, no house_number |
| `Pushkin street` | 200 | exact / centroid / street | street centroid |
| `Chavchavdze 50` (misspelt) | 200 | **fallback** / centroid / **city** | the Batumi city centroid |

Conclusions:
- **`matchlevel` is the signal, not `matchcode`.** A missing house number falls back to the street with `matchcode: exact`.
- **A misspelling returns `200` with a city-level fallback, not `404`.** In practice, "not found" is mostly `matchlevel` coarser than `street`. A `404` can still happen and is treated the same way.
