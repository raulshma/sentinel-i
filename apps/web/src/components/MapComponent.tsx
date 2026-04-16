import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type MapLibreGL from "maplibre-gl";

import {
  Map as MapGL,
  MapClusterLayer,
  MapControls,
  MapPopup,
  MapRoute,
  MapTileSelector,
  useMap,
  type MapViewport,
  type TileStyle,
} from "@/components/ui/map";
import {
  CATEGORY_COLORS,
  type MapFeature,
  type MapMarker,
  type MapUpdatePulse,
  type NewsCategory,
} from "@/types/map";

const TILE_STYLES: TileStyle[] = [
  {
    id: "dark",
    label: "Dark",
  },
  {
    id: "positron",
    label: "Positron",
  },
  {
    id: "bright",
    label: "Bright",
  },
  {
    id: "liberty",
    label: "Liberty",
  },
  {
    id: "fiord",
    label: "Fiord",
  },
  {
    id: "liberty-3d",
    label: "3D",
  },
];

const TILE_URLS: Record<string, { light: string; dark: string }> = {
  dark: {
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  },
  positron: {
    light: "https://tiles.openfreemap.org/styles/positron",
    dark: "https://tiles.openfreemap.org/styles/positron",
  },
  bright: {
    light: "https://tiles.openfreemap.org/styles/bright",
    dark: "https://tiles.openfreemap.org/styles/bright",
  },
  liberty: {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/liberty",
  },
  "liberty-3d": {
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/liberty",
  },
  fiord: {
    light: "https://tiles.openfreemap.org/styles/fiord",
    dark: "https://tiles.openfreemap.org/styles/fiord",
  },
};

const TILE_STORAGE_KEY = "sentinel-i:tile-style";

function normalizeCities(cities: unknown): string[] {
  if (Array.isArray(cities)) return cities;
  if (typeof cities === "string" && cities.length > 0) {
    try {
      const parsed = JSON.parse(cities);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return cities
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function normalizeCategory(category: string): NewsCategory {
  if (category in CATEGORY_COLORS) {
    return category as NewsCategory;
  }

  return "General";
}

const INDIA_CENTER: [number, number] = [78.9629, 20.5937];
const DEFAULT_ZOOM = 4.5;

const CLUSTER_COLORS: [string, string, string] = [
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
];
const CLUSTER_THRESHOLDS: [number, number] = [5, 25];

interface NewsProperties {
  id: string;
  category: string;
  color: string;
  headline: string;
  isCluster: boolean;
  count: number | null;
  topCategories: NewsCategory[];
  zoom?: number;
  newsItemId: string;
  cities: string[];
  city: string | null;
  state: string | null;
  summary: string;
  sourceUrl: string;
  publishedAt: string;
}

function toMapMarker(
  feature: GeoJSON.Feature<GeoJSON.Point, NewsProperties>,
): MapMarker | null {
  const properties = feature.properties;
  if (!properties || properties.isCluster || !properties.newsItemId) {
    return null;
  }

  const [longitude, latitude] = feature.geometry.coordinates;

  return {
    id: properties.id,
    newsItemId: properties.newsItemId,
    cities: normalizeCities(properties.cities),
    latitude,
    longitude,
    category: normalizeCategory(properties.category),
    headline: properties.headline,
    summary: properties.summary,
    sourceUrl: properties.sourceUrl,
    city: properties.city,
    state: properties.state,
    publishedAt: properties.publishedAt,
    isCluster: false,
  };
}

interface MapComponentProps {
  features: MapFeature[];
  isLoading: boolean;
  onViewportChange: (bounds: {
    minLng: number;
    minLat: number;
    maxLng: number;
    maxLat: number;
    zoom: number;
  }) => void;
  onFeatureClick?: (feature: MapFeature) => void;
  initialCenter?: [number, number];
  initialZoom?: number;
  liveUpdatePulse?: MapUpdatePulse | null;
}

export function MapComponent({
  features,
  isLoading,
  onViewportChange,
  onFeatureClick,
  initialCenter,
  initialZoom,
  liveUpdatePulse,
}: MapComponentProps) {
  const mapCenter = initialCenter ?? INDIA_CENTER;
  const mapZoom = initialZoom ?? DEFAULT_ZOOM;

  const [tileStyle, setTileStyle] = useState(() => {
    try {
      const saved = localStorage.getItem(TILE_STORAGE_KEY);
      if (saved && TILE_URLS[saved]) return saved;
    } catch {
      /* localStorage unavailable */
    }
    return "dark";
  });

  const handleTileStyleChange = useCallback((id: string) => {
    if (!TILE_URLS[id]) return;
    setTileStyle(id);
    try {
      localStorage.setItem(TILE_STORAGE_KEY, id);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const tileStyles = useMemo(
    () => TILE_URLS[tileStyle] ?? TILE_URLS.dark,
    [tileStyle],
  );

  const [selectedPoint, setSelectedPoint] = useState<{
    coordinates: [number, number];
    properties: NewsProperties;
  } | null>(null);

  const [highlightedArticleId, setHighlightedArticleId] = useState<
    string | null
  >(null);

  const currentZoomRef = useRef(mapZoom);

  const geojsonData = useMemo<
    GeoJSON.FeatureCollection<GeoJSON.Point, NewsProperties>
  >(() => {
    const seenNewsItemIds = new Set<string>();
    const deduped = features.filter((f) => {
      if (f.latitude === 0 && f.longitude === 0) return false;
      if (f.isCluster) return true;
      if (!f.newsItemId) return true;
      if (seenNewsItemIds.has(f.newsItemId)) return false;
      seenNewsItemIds.add(f.newsItemId);
      return true;
    });

    return {
      type: "FeatureCollection",
      features: deduped.map((f) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [f.longitude, f.latitude] as [number, number],
        },
        properties: {
          id: f.id,
          category: f.isCluster
            ? (f.topCategories[0] ?? "General")
            : f.category,
          color: f.isCluster
            ? CATEGORY_COLORS[f.topCategories[0] ?? "General"]
            : CATEGORY_COLORS[f.category],
          headline: f.isCluster ? `${f.count} articles` : f.headline,
          isCluster: f.isCluster,
          count: f.isCluster ? f.count : null,
          topCategories: f.isCluster ? f.topCategories : [],
          zoom: f.isCluster ? f.zoom : undefined,
          newsItemId: f.isCluster ? "" : f.newsItemId,
          cities: f.isCluster ? [] : f.cities,
          city: f.isCluster ? null : f.city,
          state: f.isCluster ? null : f.state,
          summary: f.isCluster ? "" : f.summary,
          sourceUrl: f.isCluster ? "" : f.sourceUrl,
          publishedAt: f.isCluster ? "" : f.publishedAt,
        },
      })),
    };
  }, [features]);

  const articleGroups = useMemo(() => {
    const groups = new Map<string, MapFeature[]>();
    for (const f of features) {
      if (f.isCluster) continue;
      const key = f.newsItemId;
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(f);
      groups.set(key, group);
    }
    return [...groups.values()].filter((g) => g.length >= 2);
  }, [features]);

  const highlightFeatures = useMemo(() => {
    if (!highlightedArticleId) return [];
    return features.filter(
      (f) => !f.isCluster && f.newsItemId === highlightedArticleId,
    );
  }, [features, highlightedArticleId]);

  const handleViewportChange = useCallback(
    (viewport: MapViewport) => {
      currentZoomRef.current = viewport.zoom;
      onViewportChange({
        minLng: viewport.viewBounds.minLng,
        minLat: viewport.viewBounds.minLat,
        maxLng: viewport.viewBounds.maxLng,
        maxLat: viewport.viewBounds.maxLat,
        zoom: viewport.zoom,
      });
    },
    [onViewportChange],
  );

  const handlePointClick = useCallback(
    (
      feature: GeoJSON.Feature<GeoJSON.Point, NewsProperties>,
      coordinates: [number, number],
    ) => {
      const p = feature.properties;

      const mapFeature: MapFeature = p.isCluster
        ? {
            id: p.id,
            latitude: coordinates[1],
            longitude: coordinates[0],
            count:
              typeof p.count === "number"
                ? p.count
                : Number.parseInt(p.headline, 10) || 1,
            topCategories:
              p.topCategories.length > 0
                ? p.topCategories
                : [p.category as NewsCategory],
            zoom: p.zoom ?? currentZoomRef.current,
            isCluster: true,
          }
        : {
            id: p.id,
            newsItemId: p.newsItemId,
            cities: p.cities,
            latitude: coordinates[1],
            longitude: coordinates[0],
            category: p.category as NewsCategory,
            headline: p.headline,
            summary: p.summary,
            sourceUrl: p.sourceUrl,
            city: p.city,
            state: p.state,
            publishedAt: p.publishedAt,
            isCluster: false,
          };

      setSelectedPoint({ coordinates, properties: p });
      setHighlightedArticleId(p.isCluster ? null : p.newsItemId || null);
      onFeatureClick?.(mapFeature);
    },
    [onFeatureClick],
  );

  const handleClusterClick = useCallback(
    (
      _clusterId: number,
      coordinates: [number, number],
      pointCount: number,
      leaves: GeoJSON.Feature<GeoJSON.Point, NewsProperties>[],
    ) => {
      const uniqueArticles = new Map<string, MapMarker>();
      const categoryCounts = new Map<NewsCategory, number>();

      for (const leaf of leaves) {
        const marker = toMapMarker(leaf);
        if (!marker || uniqueArticles.has(marker.newsItemId)) continue;

        uniqueArticles.set(marker.newsItemId, marker);
        categoryCounts.set(
          marker.category,
          (categoryCounts.get(marker.category) ?? 0) + 1,
        );
      }

      const clusterArticles = [...uniqueArticles.values()];
      const topCategories =
        categoryCounts.size > 0
          ? ([...categoryCounts.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3)
              .map(([category]) => category) as NewsCategory[])
          : (["General"] as NewsCategory[]);

      const mapFeature: MapFeature = {
        id: `cluster-${coordinates[0]}-${coordinates[1]}`,
        latitude: coordinates[1],
        longitude: coordinates[0],
        count: pointCount,
        topCategories,
        zoom: currentZoomRef.current,
        clusterArticles:
          clusterArticles.length > 0 ? clusterArticles : undefined,
        isCluster: true,
      };

      onFeatureClick?.(mapFeature);
    },
    [onFeatureClick],
  );

  return (
    <div className="relative h-full w-full">
      <MapGL
        center={mapCenter}
        zoom={mapZoom}
        minZoom={3}
        maxZoom={16}
        theme="dark"
        styles={tileStyles}
        dragRotate={tileStyle === "liberty-3d"}
        onViewportChange={handleViewportChange}
      >
        {articleGroups.map((group) => {
          const first = group[0];
          if (first.isCluster) return null;
          const coords = group
            .filter((f): f is typeof first => !f.isCluster)
            .map((f) => [f.longitude, f.latitude] as [number, number]);
          const color = CATEGORY_COLORS[first.category] ?? "#64748b";
          const articleId = first.newsItemId;
          const isHighlighted = articleId === highlightedArticleId;

          return (
            <MapRoute
              key={articleId}
              id={`link-${articleId}`}
              coordinates={coords}
              color={color}
              width={isHighlighted ? 2 : 1.5}
              opacity={isHighlighted ? 0.7 : 0.35}
              dashArray={[4, 4]}
              interactive={false}
            />
          );
        })}

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

        <LiveUpdatePulseLayer pulse={liveUpdatePulse ?? null} />

        <HighlightLayer
          features={highlightFeatures}
          highlightedArticleId={highlightedArticleId}
        />

        <PitchHandler tileStyle={tileStyle} />

        <MapControls position="bottom-right" showZoom showCompass={false} />

        <MapTileSelector
          position="bottom-left"
          styles={TILE_STYLES}
          value={tileStyle}
          onChange={handleTileStyleChange}
        />

        {selectedPoint && (
          <MapPopup
            key={`${selectedPoint.coordinates[0]}-${selectedPoint.coordinates[1]}`}
            longitude={selectedPoint.coordinates[0]}
            latitude={selectedPoint.coordinates[1]}
            onClose={() => {
              setSelectedPoint(null);
              setHighlightedArticleId(null);
            }}
            closeOnClick={false}
            focusAfterOpen={false}
            closeButton
          >
            <div className="min-w-[200px] max-w-[280px] space-y-2 p-1">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shadow-sm"
                  style={{
                    backgroundColor: selectedPoint.properties.color,
                    boxShadow: `0 0 6px ${selectedPoint.properties.color}60`,
                  }}
                />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {selectedPoint.properties.category}
                </span>
              </div>
              <p className="text-[13px] font-medium leading-snug text-slate-100 break-words overflow-wrap-anywhere">
                {selectedPoint.properties.headline}
              </p>
              {normalizeCities(selectedPoint.properties.cities).length > 1 && (
                <div className="flex flex-wrap gap-1">
                  {normalizeCities(selectedPoint.properties.cities).map(
                    (city) => (
                      <span
                        key={city}
                        className="rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-300"
                      >
                        {city}
                      </span>
                    ),
                  )}
                </div>
              )}
            </div>
          </MapPopup>
        )}
      </MapGL>

      {isLoading && (
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="animate-fade-in flex items-center gap-2 rounded-lg border border-white/10 bg-slate-900/80 px-3 py-1.5 backdrop-blur-sm">
            <div className="h-2 w-2 animate-pulse rounded-full bg-sky-400" />
            <span className="text-xs text-slate-300">Loading...</span>
          </div>
        </div>
      )}
    </div>
  );
}

function HighlightLayer({
  features,
  highlightedArticleId,
}: {
  features: MapFeature[];
  highlightedArticleId: string | null;
}) {
  const { map, isLoaded } = useMap();
  const layerId = "highlight-pulse";
  const sourceId = "highlight-pulse-source";
  const prevArticleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 12,
          "circle-color": "#38bdf8",
          "circle-opacity": 0.3,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#38bdf8",
          "circle-stroke-opacity": 0.6,
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getSource(sourceId)) return;

    if (prevArticleRef.current === highlightedArticleId) return;
    prevArticleRef.current = highlightedArticleId;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;

    if (!highlightedArticleId || features.length === 0) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    const geojsonFeatures: GeoJSON.Feature<GeoJSON.Point>[] = features.map(
      (f) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [f.longitude, f.latitude],
        },
        properties: {},
      }),
    );

    source.setData({ type: "FeatureCollection", features: geojsonFeatures });
  }, [isLoaded, map, features, highlightedArticleId]);

  return null;
}

function LiveUpdatePulseLayer({ pulse }: { pulse: MapUpdatePulse | null }) {
  const { map, isLoaded } = useMap();
  const layerId = "live-update-pulse";
  const sourceId = "live-update-pulse-source";

  useEffect(() => {
    if (!isLoaded || !map) return;

    if (!map.getSource(sourceId)) {
      map.addSource(sourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
    }

    if (!map.getLayer(layerId)) {
      map.addLayer({
        id: layerId,
        type: "circle",
        source: sourceId,
        paint: {
          "circle-radius": 0,
          "circle-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "circle-opacity": 0,
          "circle-stroke-width": 2,
          "circle-stroke-color": ["coalesce", ["get", "color"], "#38bdf8"],
          "circle-stroke-opacity": 0,
          "circle-radius-transition": { duration: 700, delay: 0 },
          "circle-opacity-transition": { duration: 700, delay: 0 },
          "circle-stroke-opacity-transition": { duration: 700, delay: 0 },
        },
      });
    }

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
  }, [isLoaded, map]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getSource(sourceId)) return;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;

    if (!pulse) {
      source.setData({ type: "FeatureCollection", features: [] });
      return;
    }

    source.setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [pulse.longitude, pulse.latitude],
          },
          properties: {
            color: CATEGORY_COLORS[pulse.category],
          },
        },
      ],
    });

    map.setPaintProperty(layerId, "circle-radius", 4);
    map.setPaintProperty(layerId, "circle-opacity", 0.45);
    map.setPaintProperty(layerId, "circle-stroke-opacity", 0.85);

    const frameId = requestAnimationFrame(() => {
      if (!map.getLayer(layerId)) return;

      map.setPaintProperty(layerId, "circle-radius", 24);
      map.setPaintProperty(layerId, "circle-opacity", 0);
      map.setPaintProperty(layerId, "circle-stroke-opacity", 0);
    });

    const cleanupTimeout = setTimeout(() => {
      if (!map.getSource(sourceId)) return;
      source.setData({ type: "FeatureCollection", features: [] });
    }, 760);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(cleanupTimeout);
    };
  }, [isLoaded, map, pulse]);

  return null;
}

function PitchHandler({ tileStyle }: { tileStyle: string }) {
  const { map, isLoaded } = useMap();
  const prevTileStyleRef = useRef(tileStyle);

  useEffect(() => {
    if (!isLoaded || !map) return;
    if (prevTileStyleRef.current === tileStyle) return;
    prevTileStyleRef.current = tileStyle;

    if (tileStyle === "liberty-3d") {
      map.easeTo({ pitch: 60, bearing: 30, duration: 800 });
    } else if (map.getPitch() !== 0 || map.getBearing() !== 0) {
      map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
    }
  }, [isLoaded, map, tileStyle]);

  return null;
}
