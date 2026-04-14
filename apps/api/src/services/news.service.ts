import { newsRepository, type NewsRepository } from '../repositories/news.repository.js'
import { socketGateway } from '../socket/socketGateway.js'
import type {
  ClusteredViewportQuery,
  ClusteredViewportResponse,
  NewsItem,
  RealtimeStats,
  ViewportQuery,
} from '../types/news.js'

export class NewsService {
  constructor(private readonly repository: NewsRepository = newsRepository) {}

  async getViewportNews(viewport: ViewportQuery): Promise<NewsItem[]> {
    return this.repository.findByViewport(viewport)
  }

  async getClusteredViewport(query: ClusteredViewportQuery): Promise<ClusteredViewportResponse> {
    const { features, nationalItems } = await this.repository.findClusteredViewport(query)

    return {
      features,
      nationalItems,
      meta: {
        totalFeatures: features.length,
        nationalCount: nationalItems.length,
        query,
      },
    }
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
  ): Promise<NewsItem[]> {
    return this.repository.findClusterArticles(longitude, latitude, radiusMeters, limit, hours)
  }
}

export const newsService = new NewsService()
