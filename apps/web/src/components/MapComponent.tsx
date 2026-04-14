import { useCallback, useMemo, useState } from 'react'

import {
  Map,
  MapClusterLayer,
  MapControls,
  MapPopup,
  type MapViewport,
} from '@/components/ui/map'
import { CATEGORY_COLORS, type MapFeature, type NewsCategory } from '@/types/map'

const INDIA_CENTER: [number, number] = [78.9629, 20.5937]
const DEFAULT_ZOOM = 4.5

const CLUSTER_COLORS: [string, string, string] = ['#3b82f6', '#f59e0b', '#ef4444']
const CLUSTER_THRESHOLDS: [number, number] = [5, 25]

interface NewsProperties {
  id: string
  category: string
  color: string
  headline: string
}

interface MapComponentProps {
  features: MapFeature[]
  isLoading: boolean
  onViewportChange: (bounds: {
    minLng: number
    minLat: number
    maxLng: number
    maxLat: number
    zoom: number
  }) => void
  onFeatureClick?: (feature: MapFeature) => void
}

export function MapComponent({
  features,
  isLoading,
  onViewportChange,
  onFeatureClick,
}: MapComponentProps) {
  const [selectedPoint, setSelectedPoint] = useState<{
    coordinates: [number, number]
    properties: NewsProperties
  } | null>(null)

  const geojsonData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, NewsProperties>>(
    () => ({
      type: 'FeatureCollection',
      features: features
        .filter((f) => f.latitude !== 0 && f.longitude !== 0)
        .map((f) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [f.longitude, f.latitude] as [number, number],
          },
          properties: {
            id: f.id,
            category: f.isCluster ? f.topCategories[0] ?? 'General' : f.category,
            color: f.isCluster
              ? CATEGORY_COLORS[f.topCategories[0] ?? 'General']
              : CATEGORY_COLORS[f.category],
            headline: f.isCluster ? `${f.count} articles` : f.headline,
          },
        })),
    }),
    [features],
  )

  const handleViewportChange = useCallback(
    (viewport: MapViewport) => {
      const bounds = {
        minLng: viewport.center[0] - 360 / Math.pow(2, viewport.zoom),
        minLat: viewport.center[1] - 180 / Math.pow(2, viewport.zoom),
        maxLng: viewport.center[0] + 360 / Math.pow(2, viewport.zoom),
        maxLat: viewport.center[1] + 180 / Math.pow(2, viewport.zoom),
        zoom: viewport.zoom,
      }
      onViewportChange(bounds)
    },
    [onViewportChange],
  )

  const handlePointClick = useCallback(
    (feature: GeoJSON.Feature<GeoJSON.Point, NewsProperties>, coordinates: [number, number]) => {
      const mapFeature: MapFeature = {
        id: feature.properties.id,
        latitude: coordinates[1],
        longitude: coordinates[0],
        category: feature.properties.category as NewsCategory,
        headline: feature.properties.headline,
        isCluster: false,
      }

      setSelectedPoint({ coordinates, properties: feature.properties })
      onFeatureClick?.(mapFeature)
    },
    [onFeatureClick],
  )

  const handleClusterClick = useCallback(
    (_clusterId: number, coordinates: [number, number], pointCount: number) => {
      const mapFeature: MapFeature = {
        id: `cluster-${coordinates[0]}-${coordinates[1]}`,
        latitude: coordinates[1],
        longitude: coordinates[0],
        count: pointCount,
        topCategories: ['General'],
        isCluster: true,
      }

      onFeatureClick?.(mapFeature)
    },
    [onFeatureClick],
  )

  return (
    <div className="relative h-full w-full">
      <Map
        center={INDIA_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={3}
        maxZoom={16}
        theme="dark"
        onViewportChange={handleViewportChange}
      >
        <MapClusterLayer<NewsProperties>
          data={geojsonData}
          clusterRadius={50}
          clusterMaxZoom={14}
          clusterColors={CLUSTER_COLORS}
          clusterThresholds={CLUSTER_THRESHOLDS}
          pointColor="#3b82f6"
          onPointClick={handlePointClick}
          onClusterClick={handleClusterClick}
        />

        <MapControls position="bottom-right" showZoom showCompass={false} />

        {selectedPoint && (
          <MapPopup
            key={`${selectedPoint.coordinates[0]}-${selectedPoint.coordinates[1]}`}
            longitude={selectedPoint.coordinates[0]}
            latitude={selectedPoint.coordinates[1]}
            onClose={() => setSelectedPoint(null)}
            closeOnClick={false}
            focusAfterOpen={false}
            closeButton
          >
            <div className="space-y-1 p-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: selectedPoint.properties.color }}
                />
                <span className="text-xs font-medium text-slate-300">
                  {selectedPoint.properties.category}
                </span>
              </div>
              <p className="text-sm text-slate-100">
                {selectedPoint.properties.headline}
              </p>
            </div>
          </MapPopup>
        )}
      </Map>

      {isLoading && (
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/80 px-3 py-1.5 backdrop-blur-sm">
            <div className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            <span className="text-xs text-slate-300">Loading...</span>
          </div>
        </div>
      )}
    </div>
  )
}
