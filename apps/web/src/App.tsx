import { useRealtimeStats } from './hooks/useRealtimeStats'

const categories = [
  'Politics',
  'Business',
  'Technology',
  'Sports',
  'Entertainment',
  'Crime',
  'Weather',
  'General',
] as const

function App() {
  const { connectedUsers, isSocketConnected, mode } = useRealtimeStats()
  const timestamp = new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date())

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="glass-panel p-6">
          <p className="text-xs uppercase tracking-[0.22em] text-sky-200/80">
            Geo-Spatial News Aggregator · India
          </p>
          <h1 className="mt-3 text-2xl font-semibold text-white sm:text-3xl">
            Sentinel-i · Phase 1 foundation
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-300">
            Core infrastructure is live: React + Node.js boilerplates,
            PostGIS/Redis Docker stack, 15-minute ingestion scheduler skeleton,
            and realtime presence over WebSockets.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <article className="glass-panel p-5">
            <p className="text-xs uppercase tracking-wider text-slate-300/80">
              Active users
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {connectedUsers}
            </p>
          </article>

          <article className="glass-panel p-5">
            <p className="text-xs uppercase tracking-wider text-slate-300/80">
              Realtime mode
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              {mode === 'websocket' ? 'WebSocket push' : 'HTTP polling fallback'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {isSocketConnected
                ? 'Socket connected'
                : 'Socket unavailable, polling every 15 seconds'}
            </p>
          </article>

          <article className="glass-panel p-5">
            <p className="text-xs uppercase tracking-wider text-slate-300/80">
              Last refresh
            </p>
            <p className="mt-2 text-lg font-semibold text-white">{timestamp}</p>
            <p className="mt-1 text-xs text-slate-400">Locale: en-IN</p>
          </article>
        </section>

        <section className="glass-panel relative overflow-hidden p-6">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.18),transparent_35%),radial-gradient(circle_at_80%_70%,rgba(34,197,94,0.12),transparent_35%)]" />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">
                Map viewport shell (Phase 4 target)
              </h2>
              <span className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-slate-200">
                mapcn integration pending
              </span>
            </div>

            <div className="mt-4 flex h-90 items-center justify-center rounded-xl border border-dashed border-white/20 bg-slate-900/60 text-center">
              <div>
                <p className="text-sm font-medium text-slate-200">
                  Interactive India map placeholder
                </p>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-slate-400">
                  Backend viewport endpoint is ready at
                  <code className="mx-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-100">
                    /api/v1/news/viewport
                  </code>
                  and will feed map markers and clustering in the next phase.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="glass-panel p-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Category legend baseline
          </h3>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((category) => (
              <li
                key={category}
                className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
              >
                {category}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  )
}

export default App
