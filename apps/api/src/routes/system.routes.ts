import { Router } from 'express'

import { getDevToolsStatus, getHealth, triggerSync } from '../controllers/system.controller.js'

const systemRouter = Router()

systemRouter.get('/health', getHealth)
systemRouter.get('/devtools', getDevToolsStatus)
systemRouter.post('/sync', triggerSync)

export { systemRouter }
