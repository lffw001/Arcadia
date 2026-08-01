import type { Express } from 'express'
import express from 'express'
import { API_STATUS_CODE } from '../../utils/httpUtil'

export const systemApi: Express = express()

/**
 * 健康检测
 */
systemApi.get('/health', async (_request, response) => {
  response.send(API_STATUS_CODE.okData(true))
})
