import { Router } from 'express'

import { getProcessingLogs } from '../controllers/processing.controller.js'

const processingRouter = Router()

processingRouter.get('/logs', getProcessingLogs)

export { processingRouter }
