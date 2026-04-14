import type { NationalItem } from '../types/map'
import { CATEGORY_COLORS } from '../types/map'

interface NationalPanelProps {
  items: NationalItem[]
  isVisible: boolean
  onToggle: () => void
}

export function NationalPanel({ items, isVisible, onToggle }: NationalPanelProps) {
  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-10 flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        className="glass-panel flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10"
      >
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: CATEGORY_COLORS['Uncategorized / National'] }}
        />
        National News
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-slate-300">
          {items.length}
        </span>
      </button>

      {isVisible && items.length > 0 && (
        <div className="glass-panel mt-2 max-h-80 w-72 overflow-y-auto p-3">
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id}>
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group block rounded-md p-2 transition-colors hover:bg-white/5"
                >
                  <p className="text-xs font-medium leading-snug text-slate-200 group-hover:text-white">
                    {item.headline}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {new Date(item.publishedAt).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
