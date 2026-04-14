import { useCallback, useState } from 'react'

import { FeatureDetail } from './components/FeatureDetail'
import { MapComponent } from './components/MapComponent'
import { NationalPanel } from './components/NationalPanel'
import { useMapData } from './hooks/useMapData'
import { useRealtimeStats } from './hooks/useRealtimeStats'
import { CATEGORY_COLORS, type MapFeature } from './types/map'

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
  const { features, nationalItems, isLoading, debouncedFetchViewport } = useMapData()
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null)
  const [showNational, setShowNational] = useState(false)

  const handleFeatureClick = useCallback((feature: MapFeature) => {
    setSelectedFeature(feature)
  }, [])

  const handleCloseDetail = useCallback(() => {
    setSelectedFeature(null)
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
          onViewportChange={debouncedFetchViewport}
          onFeatureClick={handleFeatureClick}
        />

        <NationalPanel
          items={nationalItems}
          isVisible={showNational}
          onToggle={() => setShowNational((prev) => !prev)}
        />

        <FeatureDetail
          feature={selectedFeature}
          onClose={handleCloseDetail}
        />
      </div>

      <footer className="glass-panel mx-3 mb-3 mt-1 rounded-xl px-4 py-2.5">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {CATEGORY_ENTRIES.map(({ label, color }) => (
            <li key={label} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-[11px] text-slate-300">{label}</span>
            </li>
          ))}
          <li className="ml-auto text-[10px] text-slate-500">
            {features.length} markers · {nationalItems.length} national
          </li>
        </ul>
      </footer>
    </main>
  )
}

export default App
