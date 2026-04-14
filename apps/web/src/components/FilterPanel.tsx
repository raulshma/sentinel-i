import { useCallback } from 'react'

import { CATEGORY_COLORS, type NewsCategory } from '../types/map'

const FILTERABLE_CATEGORIES: NewsCategory[] = [
  'Politics',
  'Business',
  'Technology',
  'Sports',
  'Entertainment',
  'Crime',
  'Weather',
  'General',
]

const TIME_OPTIONS = [
  { label: '12h', value: 12 },
  { label: '24h', value: 24 },
  { label: '48h', value: 48 },
  { label: '72h', value: 72 },
] as const

interface FilterPanelProps {
  selectedCategories: NewsCategory[]
  hours: number
  onCategoriesChange: (categories: NewsCategory[]) => void
  onHoursChange: (hours: number) => void
  isOpen: boolean
  onToggle: () => void
}

export function FilterPanel({
  selectedCategories,
  hours,
  onCategoriesChange,
  onHoursChange,
  isOpen,
  onToggle,
}: FilterPanelProps) {
  const toggleCategory = useCallback(
    (category: NewsCategory) => {
      if (selectedCategories.includes(category)) {
        onCategoriesChange(selectedCategories.filter((c) => c !== category))
      } else {
        onCategoriesChange([...selectedCategories, category])
      }
    },
    [selectedCategories, onCategoriesChange],
  )

  const clearFilters = useCallback(() => {
    onCategoriesChange([])
    onHoursChange(24)
  }, [onCategoriesChange, onHoursChange])

  const hasActiveFilters = selectedCategories.length > 0 || hours !== 24

  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="filter-panel-content"
        aria-label={`Filters${hasActiveFilters ? `, ${selectedCategories.length} categories selected` : ''}`}
        className="glass-panel flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:ring-offset-2 focus:ring-offset-slate-900"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M6 12h12M9 18h6" />
        </svg>
        Filters
        {hasActiveFilters && (
          <span className="rounded-full bg-sky-500/80 px-1.5 py-0.5 text-[9px] font-bold text-white" aria-label={`${selectedCategories.length} active filters`}>
            {selectedCategories.length || ''}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="filter-panel-content"
          role="region"
          aria-label="Filter controls"
          className="glass-panel w-64 p-4 space-y-4 animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              Categories
            </h3>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                aria-label="Clear all filters"
                className="text-[10px] text-slate-400 transition-colors hover:text-white focus:outline-none focus:underline"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category filters">
            {FILTERABLE_CATEGORIES.map((category) => {
              const isSelected = selectedCategories.includes(category)
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => toggleCategory(category)}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`${category} category filter`}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                    isSelected
                      ? 'border border-white/20 bg-white/15 text-white'
                      : 'border border-transparent bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  }`}
                >
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    aria-hidden="true"
                    style={{
                      backgroundColor: isSelected
                        ? CATEGORY_COLORS[category]
                        : `${CATEGORY_COLORS[category]}66`,
                    }}
                  />
                  {category}
                </button>
              )
            })}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">
              Time Range
            </h3>
            <div className="flex gap-1" role="radiogroup" aria-label="Time range filter">
              {TIME_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onHoursChange(option.value)}
                  role="radio"
                  aria-checked={hours === option.value}
                  aria-label={`Last ${option.label}`}
                  className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-sky-400 ${
                    hours === option.value
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                      : 'bg-white/5 text-slate-400 border border-transparent hover:bg-white/10 hover:text-slate-200'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
