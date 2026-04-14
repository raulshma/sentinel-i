import { Router } from 'express'

import { getDevToolsStatus, getHealth, getUsageLimits, triggerSync } from '../controllers/system.controller.js'

const systemRouter = Router()

systemRouter.get('/health', getHealth)
systemRouter.get('/devtools', getDevToolsStatus)
systemRouter.get('/usage', getUsageLimits)
systemRouter.post('/sync', triggerSync)

export { systemRouter }
