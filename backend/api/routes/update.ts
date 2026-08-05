import type { Express } from 'express'
import express from 'express'
import {
  getUpdateSnapshot,
  isUpgradeRunning,
  refreshVersionStateAfterUpgrade,
  requestUpdateCheck,
  startUpgrade,
} from '../../core/update'
import { API_STATUS_CODE } from '../../utils/httpUtil'

const api: Express = express()
const apiInner: Express = express()

api.get('/', async (_request, response) => {
  try {
    const data = await getUpdateSnapshot()
    response.send(API_STATUS_CODE.okData(data))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

api.get('/check', async (_request, response) => {
  try {
    // 更新任务执行中禁止检测，避免干扰进行中的更新
    if (await isUpgradeRunning())
      return response.send(API_STATUS_CODE.fail('更新任务正在执行中，请等待完成后再检查更新'))
    const data = await requestUpdateCheck('manual')
    response.send(API_STATUS_CODE.okData(data))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

api.post('/apply', async (_request, response) => {
  try {
    await startUpgrade()
    response.send(API_STATUS_CODE.ok('已开始更新，更新结果将通过消息中心通知'))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

apiInner.post('/refresh', async (_request, response) => {
  try {
    await refreshVersionStateAfterUpgrade()
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

export {
  api as API,
  apiInner as InnerAPI,
}
