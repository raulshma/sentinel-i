import { EventEmitter } from 'node:events'
import type { Server as HttpServer } from 'node:http'

import { Server } from 'socket.io'

import { env } from '../config/env.js'
import { isDevToolsEnabled } from '../config/env.js'
import { logger } from '../config/logger.js'
import { processingEventBus, type ProcessingLogEntry } from '../services/processingEventBus.js'
import type { NewsItem, NewsItemLocation } from '../types/news.js'

class SocketGateway extends EventEmitter {
  private io?: Server
  private connectedUsers = 0

  attach(server: HttpServer): void {
    if (this.io) {
      return
    }

    this.io = new Server(server, {
      cors: {
        origin: env.CLIENT_ORIGIN,
        credentials: true,
      },
    })

    this.io.on('connection', (socket) => {
      this.connectedUsers += 1
      this.broadcastPresence()

      logger.debug(
        { socketId: socket.id, connectedUsers: this.connectedUsers },
        'Socket client connected',
      )

      socket.on('disconnect', () => {
        this.connectedUsers = Math.max(0, this.connectedUsers - 1)
        this.broadcastPresence()

        logger.debug(
          { socketId: socket.id, connectedUsers: this.connectedUsers },
          'Socket client disconnected',
        )
      })
    })

    if (isDevToolsEnabled) {
      processingEventBus.on('log', (entry: ProcessingLogEntry) => {
        this.publishProcessingLog(entry)
      })
    }
  }

  getConnectedUsers(): number {
    return this.connectedUsers
  }

  publishNewsCreated(item: NewsItem, locations: NewsItemLocation[]): void {
    this.io?.emit('news:created', { article: item, locations })
  }

  publishProcessingLog(entry: ProcessingLogEntry): void {
    this.io?.emit('processing:log', entry)
  }

  isDevToolsEnabled(): boolean {
    return isDevToolsEnabled
  }

  shutdown(): void {
    processingEventBus.removeAllListeners('log')
    this.io?.removeAllListeners()
    void this.io?.close()
    this.io = undefined
    this.connectedUsers = 0
  }

  private broadcastPresence(): void {
    this.io?.emit('presence:user-count', {
      connectedUsers: this.connectedUsers,
    })
  }
}

export const socketGateway = new SocketGateway()
