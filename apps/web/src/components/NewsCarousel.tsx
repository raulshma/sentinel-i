import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CATEGORY_COLORS, type MapFeature, type NewsCategory } from '../types/map'

interface CarouselItem {
  id: string
  headline: string
  summary: string
  sourceUrl: string
  category: NewsCategory
  publishedAt: string
  city: string | null
  state: string | null
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
        const params = new URLSearchParams({
          longitude: feature.longitude.toString(),
          latitude: feature.latitude.toString(),
          radius: '5000',
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
      className="fixed inset-0 z-50 flex items-end justify-center pb-4 sm:items-center sm:pb-0"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="glass-panel relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-white/15 bg-slate-900/80 shadow-2xl animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: categoryColor }}
            />
            {feature.isCluster ? (
              <span className="text-sm font-medium text-white">
                {feature.count} articles
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
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            No articles found at this location
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 py-4 scroll-smooth scrollbar-hide"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {items.map((item) => (
                <div
                  key={item.id}
                  className="min-w-full snap-center shrink-0 snap-always rounded-xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[item.category] ?? '#64748b' }}
                    />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                      {item.category}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-500">
                      {formatTime(item.publishedAt)}
                    </span>
                  </div>

                  <h3 className="mb-2 text-sm font-semibold leading-snug text-white">
                    {item.headline}
                  </h3>

                  {item.summary && (
                    <p className="mb-3 text-xs leading-relaxed text-slate-300">
                      {item.summary}
                    </p>
                  )}

                  {item.sourceUrl && (
                    <a
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 transition-colors hover:text-sky-300"
                    >
                      Read source
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M7 17L17 7M17 7H7M17 7v10" />
                      </svg>
                    </a>
                  )}
                </div>
              ))}
            </div>

            {items.length > 1 && (
              <div className="flex items-center justify-center gap-1.5 pb-3">
                {items.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => scrollToIndex(i)}
                    className={`h-1.5 rounded-full transition-all duration-200 ${
                      i === currentIndex
                        ? 'w-4 bg-sky-400'
                        : 'w-1.5 bg-white/20 hover:bg-white/40'
                    }`}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
