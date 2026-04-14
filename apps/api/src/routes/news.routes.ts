import { Router } from 'express'

import { NewsController } from '../controllers/news.controller.js'
import { newsService } from '../services/news.service.js'

const newsRouter = Router()
const newsController = new NewsController(newsService)

newsRouter.get('/viewport', newsController.getViewportNews)
newsRouter.get('/clustered-viewport', newsController.getClusteredViewport)
newsRouter.get('/stats', newsController.getRealtimeStats)

export { newsRouter }
