import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

import type { NationalItem, NewsItemLocation } from '../types/map'
import type {
  ClusteredViewportResponse,
  MapFeature,
  ViewportBounds,
} from '../types/map'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const DEBOUNCE_MS = 350

type SocketArticle = NationalItem & {
  isNational: boolean
}

type SocketPayload = {
  article: SocketArticle
  locations: NewsItemLocation[]
}

function deduplicateFeatures(features: MapFeature[]): MapFeature[] {
  const seen = new Set<string>()
  const result: MapFeature[] = []
  for (const f of features) {
    if (f.isCluster) {
      result.push(f)
      continue
    }
    if (!f.newsItemId) {
      result.push(f)
      continue
    }
    if (seen.has(f.newsItemId)) continue
    seen.add(f.newsItemId)
    result.push(f)
  }
  return result
}

function deduplicateNationalItems(items: NationalItem[]): NationalItem[] {
  const seen = new Set<string>()
  const result: NationalItem[] = []
  for (const item of items) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    result.push(item)
  }
  return result
}

export const useMapData = (hours = 24, categories?: string[]) => {
  const [features, setFeatures] = useState<MapFeature[]>([])
  const [nationalItems, setNationalItems] = useState<NationalItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const hoursRef = useRef(hours)
  const categoriesRef = useRef(categories)
  const lastBoundsRef = useRef<ViewportBounds | null>(null)

  hoursRef.current = hours
  categoriesRef.current = categories

  const fetchViewport = useCallback(async (bounds: ViewportBounds) => {
    lastBoundsRef.current = bounds

    if (abortRef.current) {
      abortRef.current.abort()
    }

    const controller = new AbortController()
    abortRef.current = controller

    const params = new URLSearchParams({
      minLng: bounds.minLng.toString(),
      minLat: bounds.minLat.toString(),
      maxLng: bounds.maxLng.toString(),
      maxLat: bounds.maxLat.toString(),
      zoom: Math.round(bounds.zoom).toString(),
      hours: hoursRef.current.toString(),
    })

    if (categoriesRef.current && categoriesRef.current.length > 0) {
      params.set('categories', categoriesRef.current.join(','))
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `${API_BASE}/api/v1/news/clustered-viewport?${params}`,
        { signal: controller.signal },
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = (await response.json()) as ClusteredViewportResponse

      if (!controller.signal.aborted) {
        setFeatures(deduplicateFeatures(data.features))
        setNationalItems(deduplicateNationalItems(data.nationalItems))
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to fetch map data')
    } finally {
      if (abortRef.current === controller) {
        setIsLoading(false)
        abortRef.current = null
      }
    }
  }, [])

  const debouncedFetchViewport = useCallback(
    (bounds: ViewportBounds) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        void fetchViewport(bounds)
      }, DEBOUNCE_MS)
    },
    [fetchViewport],
  )

  useEffect(() => {
    if (lastBoundsRef.current) {
      void fetchViewport(lastBoundsRef.current)
    }
  }, [hours, categories, fetchViewport])

  useEffect(() => {
    const socket = getSocket()

    const onNewsCreated = (payload: SocketPayload) => {
      const { article, locations } = payload

      if (article.isNational || locations.length === 0) {
        setNationalItems((prev) => {
          if (prev.some((n) => n.id === article.id)) return prev
          return [article, ...prev].slice(0, 100)
        })
      }

      const geocodedLocations = locations.filter(
        (loc) => loc.latitude !== null && loc.longitude !== null,
      )

      const primaryLocation = geocodedLocations.find((loc) => loc.isPrimary) ?? geocodedLocations[0]

      if (!primaryLocation) return

      const allCities = [...new Set(locations.map((loc) => loc.city).filter((c): c is string => c !== null))]

      setFeatures((prev) => {
        const existingNewsItemIds = new Set(
          prev.filter((f) => !f.isCluster).map((f) => f.newsItemId),
        )

        if (existingNewsItemIds.has(article.id)) return prev

        const marker: MapFeature = {
          id: primaryLocation.id,
          newsItemId: article.id,
          cities: allCities,
          latitude: primaryLocation.latitude!,
          longitude: primaryLocation.longitude!,
          category: article.category,
          headline: article.headline,
          summary: article.summary,
          sourceUrl: article.sourceUrl,
          city: primaryLocation.city,
          state: primaryLocation.state,
          publishedAt: article.publishedAt,
          isCluster: false,
        }

        return [marker, ...prev].slice(0, 500)
      })
    }

    socket.on('news:created', onNewsCreated)

    return () => {
      socket.off('news:created', onNewsCreated)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      if (abortRef.current) {
        abortRef.current.abort()
      }
    }
  }, [])

  return useMemo(
    () => ({
      features,
      nationalItems,
      isLoading,
      error,
      debouncedFetchViewport,
    }),
    [features, nationalItems, isLoading, error, debouncedFetchViewport],
  )
}
