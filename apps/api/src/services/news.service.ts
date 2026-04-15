import {
  newsRepository,
  type NewsRepository,
} from '../repositories/news.repository.js'
import { cacheService } from './cache.service.js'
import { socketGateway } from '../socket/socketGateway.js'
import type {
  ClusteredViewportQuery,
  ClusteredViewportResponse,
  MapMarker,
  RealtimeStats,
  ViewportQuery,
} from '../types/news.js'

export class NewsService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  async getViewportNews(viewport: ViewportQuery): Promise<MapMarker[]> {
    return this.repository.findByViewport(viewport)
  }

  async getClusteredViewport(
    query: ClusteredViewportQuery,
  ): Promise<ClusteredViewportResponse> {
    const cached = await cacheService.getViewport<ClusteredViewportResponse>({
      endpoint: 'clustered-viewport',
      ...query,
    })

    if (cached) {
      return cached
    }

    const { features, nationalItems } =
      await this.repository.findClusteredViewport(query)

    const response: ClusteredViewportResponse = {
      features,
      nationalItems,
      meta: {
        totalFeatures: features.length,
        nationalCount: nationalItems.length,
        query,
      },
    }

    await cacheService.setViewport(
      { endpoint: 'clustered-viewport', ...query },
      response,
    )

    return response
  }

  getRealtimeStats(): RealtimeStats {
    return {
      connectedUsers: socketGateway.getConnectedUsers(),
      websocketEnabled: true,
      fallbackPollingIntervalMs: 15_000,
    }
  }

  async getClusterArticles(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    limit: number,
    hours: number,
  ): Promise<MapMarker[]> {
    const cached = await cacheService.getViewport<MapMarker[]>({
      endpoint: 'cluster-articles',
      longitude,
      latitude,
      radiusMeters,
      limit,
      hours,
    })

    if (cached) {
      return cached
    }

    const articles = await this.repository.findClusterArticles(
      longitude,
      latitude,
      radiusMeters,
      limit,
      hours,
    )

    await cacheService.setViewport(
      {
        endpoint: 'cluster-articles',
        longitude,
        latitude,
        radiusMeters,
        limit,
        hours,
      },
      articles,
      60,
    )

    return articles
  }

  async invalidateCache(): Promise<void> {
    await cacheService.invalidateViewport()
  }
}

export const newsService = new NewsService()
