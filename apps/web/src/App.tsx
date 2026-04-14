import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'

import { FilterPanel } from './components/FilterPanel'
import { TerminalPanel } from './components/TerminalPanel'
import { UsageFlyout } from './components/UsageFlyout'
import { useDeepLink } from './hooks/useDeepLink'
import { useMapData } from './hooks/useMapData'
import { useProcessingLogs } from './hooks/useProcessingLogs'
import { useRealtimeStats } from './hooks/useRealtimeStats'
import { useUsageLimits } from './hooks/useUsageLimits'
import { CATEGORY_COLORS, type MapFeature, type NewsCategory } from './types/map'

const MapComponent = lazy(() =>
  import('./components/MapComponent').then((mod) => ({ default: mod.MapComponent })),
)
const NewsCarousel = lazy(() =>
  import('./components/NewsCarousel').then((mod) => ({ default: mod.NewsCarousel })),
)
const NationalPanel = lazy(() =>
  import('./components/NationalPanel').then((mod) => ({ default: mod.NationalPanel })),
)

const CATEGORY_ENTRIES: Array<{ label: string; color: string }> = [
  { label: 'Politics', color: CATEGORY_COLORS.Politics },
  { label: 'Business', color: CATEGORY_COLORS.Business },
  { label: 'Technology', color: CATEGORY_COLORS.Technology },
  { label: 'Sports', color: CATEGORY_COLORS.Sports },
  { label: 'Entertainment', color: CATEGORY_COLORS.Entertainment },
  { label: 'Crime', color: CATEGORY_COLORS.Crime },
  { label: 'Weather', color: CATEGORY_COLORS.Weather },
  { label: 'General', color: CATEGORY_COLORS.General },
]

function App() {
  const { connectedUsers, isSocketConnected, mode } = useRealtimeStats()
  const { initialState, pushState } = useDeepLink()
  const { logs, isEnabled: isDevToolsEnabled, isConnected: isTerminalConnected, nextSyncAt, isSyncing, triggerSync } = useProcessingLogs()
  const usage = useUsageLimits()

  const [selectedCategories, setSelectedCategories] = useState<NewsCategory[]>(
    initialState.categories,
  )
  const [hours, setHours] = useState(initialState.hours)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const [showNational, setShowNational] = useState(false)
  const [showTerminal, setShowTerminal] = useState(false)
  const [showUsage, setShowUsage] = useState(false)

  const { features, nationalItems, isLoading, debouncedFetchViewport } = useMapData(
    hours,
    selectedCategories.length > 0 ? selectedCategories : undefined,
  )

  const handleFeatureClick = useCallback((feature: MapFeature) => {
    setSelectedFeature(feature)
  }, [])

  const handleCloseCarousel = useCallback(() => {
    setSelectedFeature(null)
  }, [])

  const handleViewportChange = useCallback(
    (bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number; zoom: number }) => {
      debouncedFetchViewport(bounds)

      pushState({
        center: [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2],
        zoom: bounds.zoom,
        categories: selectedCategories,
        hours,
      })
    },
    [debouncedFetchViewport, pushState, selectedCategories, hours],
  )

  const handleCategoriesChange = useCallback(
    (categories: NewsCategory[]) => {
      setSelectedCategories(categories)
      pushState({
        center: initialState.center,
        zoom: initialState.zoom,
        categories,
        hours,
      })
    },
    [initialState.center, initialState.zoom, hours, pushState],
  )

  const handleHoursChange = useCallback(
    (newHours: number) => {
      setHours(newHours)
      pushState({
        center: initialState.center,
        zoom: initialState.zoom,
        categories: selectedCategories,
        hours: newHours,
      })
    },
    [initialState.center, initialState.zoom, selectedCategories, pushState],
  )

  useEffect(() => {
    pushState({
      center: initialState.center,
      zoom: initialState.zoom,
      categories: selectedCategories,
      hours,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <main className="flex h-screen flex-col">
      <a
        href="#map-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-sky-500 focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:outline-none"
      >
        Skip to map content
      </a>

      <header className="glass-panel mx-3 mt-3 flex items-center justify-between rounded-xl px-4 py-3" role="banner">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-white">
            Sentinel-i
          </h1>
          <span className="hidden text-xs text-slate-400 sm:inline">
            Geo-Spatial News Aggregator · India
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="flex items-center gap-1.5"
            role="status"
            aria-live="polite"
            aria-label={`Connection status: ${isSocketConnected ? 'live' : 'polling'}. ${connectedUsers} users online`}
          >
            <div
              className={`h-2 w-2 rounded-full ${
                isSocketConnected ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
              aria-hidden="true"
            />
            <span className="text-[11px] text-slate-400">
              {connectedUsers} online · {mode === 'websocket' ? 'Live' : 'Polling'}
            </span>
          </div>
        </div>
      </header>

      <div id="map-content" className="relative flex-1" role="region" aria-label="Interactive news map">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center" role="status" aria-label="Loading map">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
            </div>
          }
        >
          <MapComponent
            features={features}
            isLoading={isLoading}
            onViewportChange={handleViewportChange}
            onFeatureClick={handleFeatureClick}
            initialCenter={initialState.center}
            initialZoom={initialState.zoom}
          />
        </Suspense>

        <FilterPanel
          selectedCategories={selectedCategories}
          hours={hours}
          onCategoriesChange={handleCategoriesChange}
          onHoursChange={handleHoursChange}
          isOpen={showFilters}
          onToggle={() => setShowFilters((prev) => !prev)}
        />

        <Suspense fallback={null}>
          <NationalPanel
            items={nationalItems}
            isVisible={showNational}
            onToggle={() => setShowNational((prev) => !prev)}
          />
        </Suspense>

        <Suspense fallback={null}>
          <NewsCarousel
            feature={selectedFeature}
            onClose={handleCloseCarousel}
          />
        </Suspense>
      </div>

      <footer className="glass-panel mx-3 mb-3 mt-1 rounded-xl px-4 py-2.5" role="contentinfo" aria-label="Category legend and controls">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label="News categories">
          {CATEGORY_ENTRIES.map(({ label, color }) => {
            const isActive =
              selectedCategories.length === 0 || selectedCategories.includes(label as NewsCategory)
            return (
              <li
                key={label}
                className={`flex items-center gap-1.5 transition-opacity ${
                  isActive ? 'opacity-100' : 'opacity-30'
                }`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <span className="text-[11px] text-slate-300">{label}</span>
              </li>
            )
          })}
          <li className="ml-auto text-[10px] text-slate-500" aria-live="polite">
            {features.length} markers · {nationalItems.length} national
          </li>
          <li className="relative flex items-center gap-2">
            {isDevToolsEnabled && (
              <button
                type="button"
                onClick={() => {
                  setShowUsage((prev) => !prev)
                  if (!showUsage) {
                    usage.fetchUsage()
                    usage.startPolling()
                  } else {
                    usage.stopPolling()
                  }
                }}
                aria-label={showUsage ? 'Close usage panel' : 'Open usage panel'}
                aria-expanded={showUsage}
                className="glass-panel flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <CreditCard size={13} aria-hidden="true" />
                <span className="hidden sm:inline">Usage</span>
              </button>
            )}
            <TerminalPanel
              logs={logs}
              isEnabled={isDevToolsEnabled}
              isConnected={isTerminalConnected}
              isOpen={showTerminal}
              onToggle={() => setShowTerminal((prev) => !prev)}
              nextSyncAt={nextSyncAt}
              isSyncing={isSyncing}
              onTriggerSync={triggerSync}
            />
          </li>
        </ul>
      </footer>

      {isDevToolsEnabled && (
        <UsageFlyout
          isOpen={showUsage}
          onClose={() => {
            setShowUsage(false)
            usage.stopPolling()
          }}
          data={usage.data}
          isLoading={usage.isLoading}
          error={usage.error}
          onRefresh={usage.fetchUsage}
        />
      )}
    </main>
  )
}

export default App
