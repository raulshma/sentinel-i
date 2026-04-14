import { CATEGORY_COLORS, type MapFeature } from '../types/map'

interface FeatureDetailProps {
  feature: MapFeature | null
  onClose: () => void
}

export function FeatureDetail({ feature, onClose }: FeatureDetailProps) {
  if (!feature) return null

  const color = feature.isCluster
    ? CATEGORY_COLORS[feature.topCategories[0] ?? 'General']
    : CATEGORY_COLORS[feature.category]

  return (
    <div className="glass-panel pointer-events-auto absolute right-3 top-3 z-10 w-72 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: color }}
          />
          {feature.isCluster ? (
            <div>
              <p className="text-sm font-semibold text-white">
                {feature.count} articles
              </p>
              <p className="text-[10px] text-slate-400">
                {feature.topCategories.join(', ')}
              </p>
            </div>
          ) : (
            <p className="text-xs font-medium text-slate-300">{feature.category}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {!feature.isCluster && feature.headline && (
        <p className="mt-3 text-sm leading-relaxed text-slate-200">
          {feature.headline}
        </p>
      )}

      <p className="mt-2 text-[10px] text-slate-500">
        {feature.latitude.toFixed(4)}, {feature.longitude.toFixed(4)}
      </p>
    </div>
  )
}
