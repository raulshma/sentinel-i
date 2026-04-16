import { Router } from 'express'

import { NewsController } from '../controllers/news.controller.js'
import { newsService } from '../services/news.service.js'
import { rssFeedService } from '../services/rssFeed.service.js'

const newsRouter = Router()
const newsController = new NewsController(newsService, rssFeedService)

newsRouter.get('/feed', newsController.getFeed)
newsRouter.get('/viewport', newsController.getViewportNews)
newsRouter.get('/clustered-viewport', newsController.getClusteredViewport)
newsRouter.get('/cluster-articles', newsController.getClusterArticles)
newsRouter.get('/stats', newsController.getRealtimeStats)

export { newsRouter }
