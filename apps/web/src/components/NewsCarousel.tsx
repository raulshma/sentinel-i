import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CATEGORY_COLORS, type MapFeature, type NewsCategory } from '../types/map'
import { ScrollArea, ScrollAreaViewport } from './ui/scroll-area'

interface CarouselItem {
  id: string
  headline: string
  summary: string
  sourceUrl: string
  category: NewsCategory
  publishedAt: string
  city: string | null
  state: string | null
  cities: string[]
}

interface NewsCarouselProps {
  feature: MapFeature | null
  clusterArticles?: CarouselItem[]
  isLoadingCluster?: boolean
  onClose: () => void
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function useClusterArticles(feature: MapFeature | null, hours: number) {
  const [articles, setArticles] = useState<CarouselItem[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!feature || !feature.isCluster) {
      if (feature && !feature.isCluster) {
        setArticles([])
      }
      return
    }

    let cancelled = false

    const fetchArticles = async () => {
      setIsLoading(true)
      try {
        const zoom = feature.zoom ?? 4
        const radiusMeters = Math.min(500000, Math.max(5000, Math.round(400000 / Math.pow(2, zoom - 4))))

        const params = new URLSearchParams({
          longitude: feature.longitude.toString(),
          latitude: feature.latitude.toString(),
          radius: radiusMeters.toString(),
          limit: '20',
          hours: hours.toString(),
        })

        const response = await fetch(`${API_BASE}/api/v1/news/cluster-articles?${params}`)

        if (!response.ok) throw new Error(`HTTP ${response.status}`)

        const data = (await response.json()) as { data: CarouselItem[] }
        if (!cancelled) {
          setArticles(data.data ?? [])
        }
      } catch {
        if (!cancelled) setArticles([])
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetchArticles()

    return () => {
      cancelled = true
    }
  }, [feature, hours])

  return { articles, isLoading }
}

export function NewsCarousel({
  feature,
  clusterArticles: externalClusterArticles,
  isLoadingCluster: externalIsLoading,
  onClose,
}: NewsCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const prevFeatureIdRef = useRef<string | null>(null)

  if (feature?.id !== prevFeatureIdRef.current) {
    prevFeatureIdRef.current = feature?.id ?? null
    if (currentIndex !== 0) {
      setCurrentIndex(0)
    }
  }

  const clusterResult = useClusterArticles(
    feature?.isCluster ? feature : null,
    24,
  )

  const items = useMemo<CarouselItem[]>(() => {
    if (!feature) return []

    if (feature.isCluster) {
      return externalClusterArticles ?? clusterResult.articles
    }

    return [
      {
        id: feature.id,
        headline: feature.headline,
        summary: feature.summary,
        sourceUrl: feature.sourceUrl,
        category: feature.category,
        publishedAt: feature.publishedAt,
        city: feature.city,
        state: feature.state,
        cities: Array.isArray(feature.cities) ? feature.cities : [],
      },
    ]
  }, [feature, externalClusterArticles, clusterResult.articles])

  const isLoading = feature?.isCluster
    ? (externalIsLoading ?? clusterResult.isLoading)
    : false

  const scrollToIndex = useCallback((index: number) => {
    if (!scrollRef.current) return
    const child = scrollRef.current.children[index] as HTMLElement
    if (child) {
      scrollRef.current.scrollTo({
        left: child.offsetLeft - scrollRef.current.offsetLeft,
        behavior: 'smooth',
      })
      setCurrentIndex(index)
    }
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = 0
    }
  }, [feature?.id])

  useEffect(() => {
    if (!feature) return

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowRight' && currentIndex < items.length - 1) {
        scrollToIndex(currentIndex + 1)
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        scrollToIndex(currentIndex - 1)
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [feature, currentIndex, items.length, onClose, scrollToIndex])

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const scrollLeft = scrollRef.current.scrollLeft
    const childWidth = (scrollRef.current.children[0] as HTMLElement)?.offsetWidth ?? 1
    const gap = 12
    const newIndex = Math.round(scrollLeft / (childWidth + gap))
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < items.length) {
      setCurrentIndex(newIndex)
    }
  }, [currentIndex, items.length])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  if (!feature) return null

  const categoryColor = feature.isCluster
    ? CATEGORY_COLORS[feature.topCategories[0] ?? 'General']
    : CATEGORY_COLORS[feature.category]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pb-0 sm:items-center sm:pb-0"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={feature.isCluster ? `News cluster with ${feature.count} articles` : `News article: ${feature.headline}`}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" />

      <div className="glass-panel relative z-10 flex w-full max-w-2xl max-h-[75vh] sm:max-h-[80vh] flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-slate-900/90 shadow-2xl animate-slide-in-up duration-200 sm:mx-4 sm:rounded-2xl">
        <div
          className="flex items-center justify-between border-b border-white/10 px-6 py-3.5"
          style={{
            background: `linear-gradient(135deg, ${categoryColor}15 0%, transparent 60%)`,
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="inline-block h-3 w-3 rounded-full shadow-sm"
              style={{ backgroundColor: categoryColor, boxShadow: `0 0 8px ${categoryColor}60` }}
            />
            {feature.isCluster ? (
              <span className="text-sm font-semibold text-white">
                {feature.count} articles in this area
              </span>
            ) : (
              <span className="text-xs font-medium text-slate-300">
                {feature.category}
                {feature.city ? ` · ${feature.city}` : ''}
                {feature.state ? `, ${feature.state}` : ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close news carousel"
            className="rounded-lg p-2 text-slate-400 transition-all duration-150 hover:bg-white/10 hover:text-white hover:rotate-90 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            <span className="text-xs text-slate-400">Loading articles...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-slate-400">
            No articles found at this location
          </div>
        ) : (
          <>
            <div className="relative min-h-0 flex-1">
              {items.length > 1 && currentIndex > 0 && (
                <button
                  type="button"
                  onClick={() => scrollToIndex(currentIndex - 1)}
                  aria-label="Previous article"
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-slate-800/90 p-2 text-white shadow-lg backdrop-blur-sm transition-all duration-150 hover:bg-slate-700/90 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
              )}
              {items.length > 1 && currentIndex < items.length - 1 && (
                <button
                  type="button"
                  onClick={() => scrollToIndex(currentIndex + 1)}
                  aria-label="Next article"
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border border-white/15 bg-slate-800/90 p-2 text-white shadow-lg backdrop-blur-sm transition-all duration-150 hover:bg-slate-700/90 hover:scale-110 active:scale-95 focus:outline-none focus:ring-2 focus:ring-sky-400"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              )}
              <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="flex snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden px-5 py-5 scroll-smooth"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                role="list"
                aria-label="News articles carousel"
                tabIndex={0}
              >
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="w-[calc(100svw-2.5rem)] max-w-full snap-center shrink-0 snap-always rounded-xl border border-white/10 bg-white/[0.03] sm:w-[calc(100%-1rem)] min-w-0 max-h-[calc(75vh-8rem)] sm:max-h-[calc(80vh-8rem)] flex flex-col overflow-hidden"
                    role="listitem"
                    aria-label={`Article ${items.indexOf(item) + 1} of ${items.length}: ${item.headline}`}
                  >
                    <div
                      className="h-1 transition-all duration-300"
                      style={{
                        background: `linear-gradient(90deg, ${CATEGORY_COLORS[item.category] ?? '#64748b'}, transparent)`,
                      }}
                    />
                    <ScrollArea className="min-h-0 flex-1">
                      <ScrollAreaViewport className="min-h-0 p-5">
                        <div className="mb-3 flex items-center gap-2">
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? '#64748b' }}
                          />
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                            {item.category}
                          </span>
                          <span className="ml-auto text-[11px] text-slate-500">
                            {formatTime(item.publishedAt)}
                          </span>
                        </div>

                        <h3 className="mb-3 text-base font-bold leading-snug text-white" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                          {item.headline}
                        </h3>

                        {item.cities.length > 1 && (
                          <div className="mb-3 flex flex-wrap gap-1.5">
                            {item.cities.map((city) => (
                              <span
                                key={city}
                                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-slate-300"
                              >
                                {city}
                              </span>
                            ))}
                          </div>
                        )}

                        {item.summary && (
                          <p className="mb-4 text-[13px] leading-relaxed text-slate-300/90" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                            {item.summary}
                          </p>
                        )}

                        {item.sourceUrl && (
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-1.5 text-xs font-semibold text-sky-400 transition-all duration-150 hover:bg-sky-400/20 hover:border-sky-400/30 hover:gap-2 hover:scale-[1.03] active:scale-[0.98]"
                          >
                            Read source
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                              <path d="M7 17L17 7M17 7H7M17 7v10" />
                            </svg>
                          </a>
                        )}
                      </ScrollAreaViewport>
                    </ScrollArea>
                  </div>
                ))}
              </div>
            </div>

            {items.length > 1 && (
              <div className="flex items-center justify-between border-t border-white/5 px-6 pb-3.5 pt-2.5">
                <span className="text-[11px] text-slate-500">
                  {currentIndex + 1} of {items.length}
                </span>
                <div className="flex items-center gap-1.5" role="tablist" aria-label="Carousel pagination">
                  {items.map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => scrollToIndex(i)}
                      role="tab"
                      aria-selected={i === currentIndex}
                      aria-label={`Go to article ${i + 1}`}
                      className={`h-1.5 rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                        i === currentIndex
                          ? 'w-5 bg-sky-400'
                          : 'w-1.5 bg-white/15 hover:bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
