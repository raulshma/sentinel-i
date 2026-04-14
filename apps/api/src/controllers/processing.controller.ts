import type { Request, Response } from 'express'

import { processingLogRepository } from '../repositories/processingLog.repository.js'
import { socketGateway } from '../socket/socketGateway.js'

export const getProcessingLogs = async (_req: Request, res: Response): Promise<void> => {
  const logs = await processingLogRepository.findRecent(200)

  res.json({
    data: logs,
    devToolsEnabled: socketGateway.isDevToolsEnabled(),
  })
}
