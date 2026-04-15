export type NewsCategory =
  | 'Politics'
  | 'Business'
  | 'Technology'
  | 'Sports'
  | 'Entertainment'
  | 'Crime'
  | 'Weather'
  | 'General'
  | 'Uncategorized / National'

export interface NewsItemLocation {
  id: string
  locationName: string | null
  city: string | null
  state: string | null
  isPrimary: boolean
  latitude: number | null
  longitude: number | null
}

export interface MapMarker {
  id: string
  latitude: number
  longitude: number
  category: NewsCategory
  headline: string
  summary: string
  sourceUrl: string
  city: string | null
  state: string | null
  publishedAt: string
  isCluster: false
}

export interface MapCluster {
  id: string
  latitude: number
  longitude: number
  count: number
  topCategories: NewsCategory[]
  isCluster: true
}

export type MapFeature = MapMarker | MapCluster

export interface NationalItem {
  id: string
  headline: string
  summary: string
  sourceUrl: string
  category: NewsCategory
  publishedAt: string
}

export interface ClusteredViewportResponse {
  features: MapFeature[]
  nationalItems: NationalItem[]
  meta: {
    totalFeatures: number
    nationalCount: number
  }
}

export interface ViewportBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
  zoom: number
}

export const CATEGORY_COLORS: Record<NewsCategory, string> = {
  Politics: '#ef4444',
  Business: '#f59e0b',
  Technology: '#3b82f6',
  Sports: '#22c55e',
  Entertainment: '#a855f7',
  Crime: '#dc2626',
  Weather: '#06b6d4',
  General: '#64748b',
  'Uncategorized / National': '#94a3b8',
}
