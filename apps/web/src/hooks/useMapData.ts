import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSocket } from '../lib/socket'

import type { NationalItem } from '../types/map'
import type {
  ClusteredViewportResponse,
  MapFeature,
  ViewportBounds,
} from '../types/map'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const DEBOUNCE_MS = 350

type IncomingSocketItem = NationalItem & {
  latitude: number | null
  longitude: number | null
  isNational: boolean
  summary?: string
  sourceUrl?: string
  city?: string | null
  state?: string | null
  publishedAt?: string
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
        setFeatures(data.features)
        setNationalItems(data.nationalItems)
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

    const onNewsCreated = (item: IncomingSocketItem) => {
      if (item.isNational || item.latitude === null || item.longitude === null) {
        setNationalItems((prev) => {
          if (prev.some((n) => n.id === item.id)) return prev
          return [item, ...prev].slice(0, 100)
        })
        return
      }

      setFeatures((prev) => {
        if (prev.some((f) => f.id === item.id)) return prev

        return [
          {
            id: item.id,
            latitude: item.latitude!,
            longitude: item.longitude!,
            category: item.category,
            headline: item.headline,
            summary: item.summary ?? '',
            sourceUrl: item.sourceUrl ?? '',
            city: item.city ?? null,
            state: item.state ?? null,
            publishedAt: item.publishedAt ?? new Date().toISOString(),
            isCluster: false as const,
          },
          ...prev,
        ].slice(0, 500)
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
