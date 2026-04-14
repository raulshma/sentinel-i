import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { NewsCategory } from '../types/map'

export interface DeepLinkState {
  center: [number, number]
  zoom: number
  categories: NewsCategory[]
  hours: number
}

const DEFAULT_STATE: DeepLinkState = {
  center: [78.9629, 20.5937],
  zoom: 4.5,
  categories: [],
  hours: 24,
}

function parseUrlState(): DeepLinkState {
  try {
    const params = new URLSearchParams(window.location.search)

    const lng = parseFloat(params.get('lng') ?? '')
    const lat = parseFloat(params.get('lat') ?? '')
    const zoom = parseFloat(params.get('zoom') ?? '')
    const hours = parseInt(params.get('hours') ?? '', 10)
    const categoriesRaw = params.get('categories') ?? ''

    return {
      center: [
        Number.isFinite(lng) ? lng : DEFAULT_STATE.center[0],
        Number.isFinite(lat) ? lat : DEFAULT_STATE.center[1],
      ],
      zoom: Number.isFinite(zoom) ? Math.min(Math.max(zoom, 3), 16) : DEFAULT_STATE.zoom,
      hours: Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 72) : DEFAULT_STATE.hours,
      categories: categoriesRaw
        ? (categoriesRaw
            .split(',')
            .filter((c): c is NewsCategory => c.length > 0) as NewsCategory[])
        : [],
    }
  } catch {
    return { ...DEFAULT_STATE, categories: [] }
  }
}

function buildUrl(state: DeepLinkState): string {
  const params = new URLSearchParams()

  params.set('lng', state.center[0].toFixed(4))
  params.set('lat', state.center[1].toFixed(4))
  params.set('zoom', state.zoom.toFixed(1))

  if (state.hours !== 24) {
    params.set('hours', state.hours.toString())
  }

  if (state.categories.length > 0) {
    params.set('categories', state.categories.join(','))
  }

  const search = params.toString()
  return `${window.location.pathname}${search ? `?${search}` : ''}`
}

export function useDeepLink() {
  const [initialState] = useState(parseUrlState)
  const stateRef = useRef<DeepLinkState>(initialState)
  const pushTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pushState = useCallback((state: DeepLinkState) => {
    stateRef.current = state

    if (pushTimeoutRef.current) {
      clearTimeout(pushTimeoutRef.current)
    }

    pushTimeoutRef.current = setTimeout(() => {
      const url = buildUrl(stateRef.current)
      window.history.replaceState(null, '', url)
    }, 300)
  }, [])

  useEffect(() => {
    return () => {
      if (pushTimeoutRef.current) {
        clearTimeout(pushTimeoutRef.current)
      }
    }
  }, [])

  return useMemo(
    () => ({
      initialState,
      pushState,
    }),
    [initialState, pushState],
  )
}
