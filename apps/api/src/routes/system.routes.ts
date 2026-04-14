import { Router } from 'express'

import { getHealth } from '../controllers/system.controller.js'

const systemRouter = Router()

systemRouter.get('/health', getHealth)

export { systemRouter }
