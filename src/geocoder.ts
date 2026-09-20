import { suppressTracing } from '@sentry/node'

export type GeocodePrecision = 'building' | 'place' | 'street' | 'area'

export interface GeocodeResult {
  precision: GeocodePrecision
  lat: number
  lon: number
  label: string
}

export interface GeocodeResponse {
  results: GeocodeResult[]
}

export interface Geocoder {
  geocode(query: string, signal?: AbortSignal): Promise<GeocodeResponse>
}

interface LocationIqResult {
  lat?: unknown
  lon?: unknown
  display_name?: unknown
  matchquality?: {
    matchlevel?: unknown
  }
}

export type Fetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>

export function precisionForMatchLevel(matchLevel: unknown): GeocodePrecision {
  switch (matchLevel) {
    case 'building':
      return 'building'
    case 'venue':
      return 'place'
    case 'street':
      return 'street'
    default:
      return 'area'
  }
}

export function createGeocoder(
  settings: { url: string; token: string },
  fetcher: Fetcher = fetch,
): Geocoder {
  return {
    async geocode(query, signal) {
      const url = new URL(settings.url)
      url.searchParams.set('key', settings.token)
      url.searchParams.set('q', `${query.trim()}, Batumi`)
      url.searchParams.set('countrycodes', 'ge')
      url.searchParams.set('format', 'json')
      url.searchParams.set('limit', '3')
      url.searchParams.set('matchquality', '1')

      let response: Response
      try {
        response = await suppressTracing(() => fetcher(url, { signal }))
      } catch (error) {
        throw new GeocoderError(
          `LocationIQ request failed: ${redact(errorMessage(error), settings.token)}`,
        )
      }

      if (response.status === 404) {
        return { results: [] }
      }

      if (!response.ok) {
        throw new GeocoderError(
          `LocationIQ request failed (${response.status}): ${await responseError(response, settings.token)}`,
        )
      }

      const body: unknown = await response.json()
      if (!Array.isArray(body)) {
        throw new GeocoderError('LocationIQ request failed: response was not a result list')
      }

      return { results: body.slice(0, 3).map(toGeocodeResult) }
    },
  }
}

export class GeocoderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'GeocoderError'
  }
}

function toGeocodeResult(value: unknown): GeocodeResult {
  const result = value as LocationIqResult
  const lat = Number(result.lat)
  const lon = Number(result.lon)
  const label = result.display_name

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof label !== 'string') {
    throw new GeocoderError('LocationIQ request failed: invalid result')
  }

  return {
    precision: precisionForMatchLevel(result.matchquality?.matchlevel),
    lat,
    lon,
    label,
  }
}

async function responseError(response: Response, token: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string'
      ? redact(body.error, token)
      : `HTTP ${response.status}`
  } catch {
    return `HTTP ${response.status}`
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function redact(message: string, token: string): string {
  return token === '' ? message : message.split(token).join('[redacted]')
}
