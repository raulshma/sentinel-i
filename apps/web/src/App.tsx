import { useCallback, useEffect, useState } from 'react'

import { FilterPanel } from './components/FilterPanel'
import { MapComponent } from './components/MapComponent'
import { NewsCarousel } from './components/NewsCarousel'
import { NationalPanel } from './components/NationalPanel'
import { useDeepLink } from './hooks/useDeepLink'
import { useMapData } from './hooks/useMapData'
import { useRealtimeStats } from './hooks/useRealtimeStats'
import { CATEGORY_COLORS, type MapFeature, type NewsCategory } from './types/map'

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

  const [selectedCategories, setSelectedCategories] = useState<NewsCategory[]>(
    initialState.categories,
  )
  const [hours, setHours] = useState(initialState.hours)
  const [showFilters, setShowFilters] = useState(false)
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const [showNational, setShowNational] = useState(false)

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
      <header className="glass-panel mx-3 mt-3 flex items-center justify-between rounded-xl px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-base font-semibold text-white">
            Sentinel-i
          </h1>
          <span className="hidden text-xs text-slate-400 sm:inline">
            Geo-Spatial News Aggregator · India
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div
              className={`h-2 w-2 rounded-full ${
                isSocketConnected ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span className="text-[11px] text-slate-400">
              {connectedUsers} online · {mode === 'websocket' ? 'Live' : 'Polling'}
            </span>
          </div>
        </div>
      </header>

      <div className="relative flex-1">
        <MapComponent
          features={features}
          isLoading={isLoading}
          onViewportChange={handleViewportChange}
          onFeatureClick={handleFeatureClick}
          initialCenter={initialState.center}
          initialZoom={initialState.zoom}
        />

        <FilterPanel
          selectedCategories={selectedCategories}
          hours={hours}
          onCategoriesChange={handleCategoriesChange}
          onHoursChange={handleHoursChange}
          isOpen={showFilters}
          onToggle={() => setShowFilters((prev) => !prev)}
        />

        <NationalPanel
          items={nationalItems}
          isVisible={showNational}
          onToggle={() => setShowNational((prev) => !prev)}
        />

        <NewsCarousel
          feature={selectedFeature}
          onClose={handleCloseCarousel}
        />
      </div>

      <footer className="glass-panel mx-3 mb-3 mt-1 rounded-xl px-4 py-2.5">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
                />
                <span className="text-[11px] text-slate-300">{label}</span>
              </li>
            )
          })}
          <li className="ml-auto text-[10px] text-slate-500">
            {features.length} markers · {nationalItems.length} national
          </li>
        </ul>
      </footer>
    </main>
  )
}

export default App
