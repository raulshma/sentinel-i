import { EventEmitter } from 'node:events'

import { getDb } from '../config/db.js'
import { processingLogs } from '../db/schema.js'

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
      const db = getDb()

      await db.insert(processingLogs).values(
        batch.map((e) => ({
          sourceUrl: e.sourceUrl,
          headline: e.headline,
          stage: e.stage,
          message: e.message,
          status: e.status,
          metadata: e.metadata ?? {},
        })),
      )
    } catch {
    } finally {
      this.flushing = false

      if (this.queue.length > 0) {
        void this.flush()
      }
    }
  }
}

export const processingEventBus = new ProcessingEventBus()
