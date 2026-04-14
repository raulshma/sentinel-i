export const NEWS_CATEGORIES = [
  'Politics',
  'Business',
  'Technology',
  'Sports',
  'Entertainment',
  'Crime',
  'Weather',
  'General',
  'Uncategorized / National',
] as const

export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

export interface NewsItem {
  id: string
  headline: string
  summary: string
  sourceUrl: string
  locationName: string | null
  city: string | null
  state: string | null
  category: NewsCategory
  latitude: number | null
  longitude: number | null
  isNational: boolean
  publishedAt: string
}

export interface ViewportQuery {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
  hours: number
  categories?: NewsCategory[]
}

export interface RealtimeStats {
  connectedUsers: number
  websocketEnabled: boolean
  fallbackPollingIntervalMs: number
}

export interface CreateNewsItemInput {
  sourceUrl: string
  headline: string
  summary: string
  category: NewsCategory
  locationName: string | null
  city: string | null
  state: string | null
  isNational: boolean
  latitude: number | null
  longitude: number | null
  publishedAt: string
}

export interface IngestionRunInput {
  feedUrl: string
  decisionPath: string
  status: string
  errorMessage?: string | null
  startedAt?: Date
  finishedAt?: Date
}

export interface ClusteredViewportQuery extends ViewportQuery {
  zoom: number
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

export interface ClusteredViewportResponse {
  features: MapFeature[]
  nationalItems: NewsItem[]
  meta: {
    totalFeatures: number
    nationalCount: number
    query: ClusteredViewportQuery
  }
}

export const isNewsCategory = (value: string): value is NewsCategory => {
  return NEWS_CATEGORIES.includes(value as NewsCategory)
}
