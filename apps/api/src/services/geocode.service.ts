import { env } from '../config/env.js'
import { logger } from '../config/logger.js'

type GeocodeResult = {
  lat: string
  lon: string
  display_name: string
}

export interface ForwardGeocodeInput {
  locationName: string
  city?: string | null
  state?: string | null
}

export interface Coordinates {
  latitude: number
  longitude: number
  displayName: string
}

export class GeocodeService {
  async forwardGeocode(input: ForwardGeocodeInput): Promise<Coordinates | null> {
    if (!env.GEOCODE_API_KEY) {
      logger.debug('GEOCODE_API_KEY missing; skipping forward geocode')
      return null
    }

    const query = [input.locationName, input.city, input.state, 'India']
      .filter(Boolean)
      .join(', ')

    const endpoint = new URL('/search', env.GEOCODE_BASE_URL)
    endpoint.searchParams.set('q', query)
    endpoint.searchParams.set('countrycodes', 'in')
    endpoint.searchParams.set('limit', '1')
    endpoint.searchParams.set('api_key', env.GEOCODE_API_KEY)

    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${env.GEOCODE_API_KEY}`,
      },
    })

    if (!response.ok) {
      logger.warn(
        { status: response.status, endpoint: endpoint.toString() },
        'Geocode API returned non-success status',
      )
      return null
    }

    const payload = (await response.json()) as GeocodeResult[]
    const topResult = payload[0]

    if (!topResult) {
      return null
    }

    const latitude = Number(topResult.lat)
    const longitude = Number(topResult.lon)

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null
    }

    return {
      latitude,
      longitude,
      displayName: topResult.display_name,
    }
  }
}

export const geocodeService = new GeocodeService()
