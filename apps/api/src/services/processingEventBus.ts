import { EventEmitter } from 'node:events'

export type ProcessingStage =
  | 'feed_fetch'
  | 'feed_parse'
  | 'deduplication'
  | 'content_fetch'
  | 'content_parse'
  | 'ai_processing'
  | 'ai_tool_call'
  | 'ai_reasoning'
  | 'geocoding'
  | 'fact_check'
  | 'storage'
  | 'complete'
  | 'error'

export type ProcessingStatus = 'info' | 'success' | 'warn' | 'error' | 'start'

export interface ProcessingLogEntry {
  id?: string
  sourceUrl: string
  headline: string | null
  stage: ProcessingStage
  message: string
  status: ProcessingStatus
  metadata?: Record<string, unknown>
  streamId?: string
  isStreaming?: boolean
  createdAt: string
}

class ProcessingEventBus extends EventEmitter {
  private queue: ProcessingLogEntry[] = []
  private flushing = false

  constructor() {
    super()
    this.setMaxListeners(50)
  }

  emitLog(entry: Omit<ProcessingLogEntry, 'createdAt'>): void {
    const fullEntry: ProcessingLogEntry = {
      ...entry,
      createdAt: new Date().toISOString(),
    }

    this.queue.push(fullEntry)

    void this.flush()

    this.emit('log', fullEntry)
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return
    }

    this.flushing = true

    const batch = this.queue.splice(0, this.queue.length)

    try {
      const { getPgPool } = await import('../config/db.js')

      const values = batch.map(
        (e) =>
          `(${escapeSql(e.sourceUrl)}, ${escapeSql(e.headline)}, ${escapeSql(e.stage)}, ${escapeSql(e.message)}, ${escapeSql(e.status)}, '${JSON.stringify(e.metadata ?? {}).replace(/'/g, "''")}')`,
      )

      const sql = `
        INSERT INTO processing_logs (source_url, headline, stage, message, status, metadata)
        VALUES ${values.join(', ')}
      `

      await getPgPool().query(sql)
    } catch {
      // Swallow - live updates logging should never block processing
    } finally {
      this.flushing = false

      if (this.queue.length > 0) {
        void this.flush()
      }
    }
  }
}

function escapeSql(value: string | null): string {
  if (value === null) return 'NULL'
  return `'${value.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`
}

export const processingEventBus = new ProcessingEventBus()
