import type { Express } from 'express'
import express from 'express'
import { API_STATUS_CODE } from '../utils/httpUtil'
import type { messageWhereInput } from '../db'
import db from '../db'
import { cleanProperties, validatePageFixedParams, validateRequestParams } from '../utils'
import { cleanReadMessages, getUnreadCount, pushUserMessage } from '../core/message/index'
import { logger } from '../utils/logger'

const api: Express = express()
const apiOpen: Express = express()
const apiInner: Express = express()

type MessageScope = 'all' | 'user'

/**
 * 消息列表查询
 */
async function handleMessageList(request: any, scope: MessageScope) {
  validatePageFixedParams(request, ['create_time'])

  const where: messageWhereInput = {}
  if (scope === 'user') {
    where.category = { equals: 'user' }
  }

  // 类型过滤
  if (request.query.category && scope === 'all') {
    where.category = { equals: request.query.category as string }
  }
  // 状态过滤
  if (request.query.status) {
    where.status = Number.parseInt(request.query.status as string)
  }
  // 消息来源过滤
  if (request.query.source) {
    where.source = { equals: request.query.source as string }
  }
  // 搜索过滤
  if (request.query.search) {
    const search = request.query.search as string
    where.AND = {
      OR: [
        { title: { contains: search } },
        { content: { contains: search } },
      ],
    }
  }
  // 排序
  const orderBy = request.query.orderBy as string || 'create_time'
  let desc = true // desc 降序，asc 升序
  if (request.query.order === '0') {
    desc = false // 0 升序，1 降序
  }
  const result = await db.message.$page({
    where,
    orderBy: [{ [orderBy]: desc ? 'desc' : 'asc' }],
    page: String(request.query.page),
    size: String(request.query.size),
  })
  return result
}

/**
 * 消息详情
 */
async function handleMessageDetail(id: number, scope: MessageScope) {
  const message = await db.message.$getById(id)
  if (!message)
    throw new Error('消息不存在')
  if (scope === 'user' && message.category !== 'user')
    throw new Error('消息不存在')
  return message
}

/**
 * 标记已读（支持批量和全部）
 */
async function handleMarkRead(ids: number[] | null, scope: MessageScope, status: number) {
  const where: any = { status: 0 }
  if (scope === 'user')
    where.category = 'user'
  if (ids)
    where.id = { in: ids }
  await db.message.updateMany({ where, data: { status } })
}

/**
 * 删除消息
 */
async function handleDelete(ids: number[], scope: MessageScope) {
  const where: any = { id: { in: ids } }
  if (scope === 'user')
    where.category = 'user'
  await db.message.deleteMany({ where })
}

/**
 * 获取消息列表
 */
api.get('/list', async (request, response) => {
  try {
    validateRequestParams(request, {
      query: [
        ['category', [false, 'string']],
        ['status', [false, 'string']],
        ['source', [false, 'string']],
      ],
    })
    const result = await handleMessageList(request, 'all')
    response.send(API_STATUS_CODE.okData(result))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 获取未读消息计数
 */
api.get('/unread/count', async (_request, response) => {
  try {
    const total = await getUnreadCount('all')
    response.send(API_STATUS_CODE.okData({ total }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 获取消息详情
 */
api.get('/', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      query: [
        ['id', [true, 'string']],
      ] as const,
    })
    const { id } = params.query
    if (!/^\d+$/.test(id) || Number.parseInt(id) <= 0) {
      throw new Error('参数 id 无效（参数值类型错误）')
    }
    const message = await handleMessageDetail(Number.parseInt(id), 'all')
    response.send(API_STATUS_CODE.okData(message))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 删除消息
 */
api.delete('/', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number | number[]']],
      ] as const,
    })
    const { id } = params.body
    const ids: number[] = Array.isArray(id) ? id : [id]
    await handleDelete(ids, 'all')
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 全部标记为已读
 */
api.put('/status/all', async (request, response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['status', [false, 'number']],
      ] as const,
    })
    const status = request.body.status ?? 1
    await handleMarkRead(null, 'all', status)
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 更新消息状态
 */
api.put('/status', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number | number[]']],
        ['status', [true, 'number']],
      ] as const,
    })
    const { id, status } = params.body
    const ids: number[] = Array.isArray(id) ? id : [id]
    await handleMarkRead(ids, 'all', status)
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 清空已读消息
 */
api.delete('/read', async (_request, response) => {
  try {
    const result = await db.message.deleteMany({ where: { status: 1 } })
    response.send(API_STATUS_CODE.okData({ count: result.count }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 推送消息（OpenAPI）
 */
apiOpen.post('/v1/create', async (request, response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['title', [true, 'string']],
        ['content', [true, 'string']],
        ['type', [false, ['info', 'warn', 'error', 'success']]],
      ] as const,
    })
    const data = cleanProperties(request.body, ['title', 'content', 'type'])
    await pushUserMessage(data as any)
    logger.info('[OpenAPI · Message]', '推送消息', JSON.stringify({ title: data.title }))
    response.send(API_STATUS_CODE.okData({ count: 1 }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 分页查询消息（OpenAPI）
 */
apiOpen.get('/v1/list', async (request, response) => {
  try {
    validateRequestParams(request, {
      query: [
        ['status', [false, 'string']],
        ['source', [false, 'string']],
      ],
    })
    const result = await handleMessageList(request, 'user')
    logger.info('[OpenAPI · Message]', '分页查询消息', JSON.stringify({ page: request.query.page, size: request.query.size }))
    response.send(API_STATUS_CODE.okData(result))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 获取未读消息计数（OpenAPI）
 */
apiOpen.get('/v1/unreadCount', async (_request, response) => {
  try {
    const total = await getUnreadCount('user')
    logger.info('[OpenAPI · Message]', '查询未读消息计数', JSON.stringify({ total }))
    response.send(API_STATUS_CODE.okData({ total }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 获取消息详情（OpenAPI）
 */
apiOpen.get('/v1/detail', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      query: [
        ['id', [true, 'string']],
      ] as const,
    })
    const { id } = params.query
    if (!/^\d+$/.test(id) || Number.parseInt(id) <= 0) {
      throw new Error('参数 id 无效（参数值类型错误）')
    }
    const message = await handleMessageDetail(Number.parseInt(id), 'user')
    logger.info('[OpenAPI · Message]', '查询消息详情', JSON.stringify({ id }))
    response.send(API_STATUS_CODE.okData(message))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 批量标记消息已读（OpenAPI）
 */
apiOpen.post('/v1/readStatus', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number | number[]']],
        ['status', [true, 'number']],
      ] as const,
    })
    const { id, status } = params.body
    const ids: number[] = Array.isArray(id) ? id : [id]
    await handleMarkRead(ids, 'user', status)
    logger.info('[OpenAPI · Message]', '批量标记消息已读', JSON.stringify({ ids, status }))
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 全部标记已读（OpenAPI）
 */
apiOpen.post('/v1/readAll', async (request, response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['status', [false, 'number']],
      ] as const,
    })
    const status = request.body.status ?? 1
    await handleMarkRead(null, 'user', status)
    logger.info('[OpenAPI · Message]', '全部标记消息已读', JSON.stringify({ status }))
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 批量删除消息（OpenAPI）
 */
apiOpen.post('/v1/delete', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number | number[]']],
      ] as const,
    })
    const { id } = params.body
    const ids: number[] = Array.isArray(id) ? id : [id]
    await handleDelete(ids, 'user')
    logger.info('[OpenAPI · Message]', '批量删除消息', JSON.stringify({ ids }))
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 推送消息（Inner API，仅本地访问）
 */
apiInner.post('/push', async (request, response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['title', [true, 'string']],
        ['content', [true, 'string']],
        ['type', [false, ['info', 'warn', 'error', 'success']]],
      ] as const,
    })
    const data = cleanProperties(request.body, ['title', 'content', 'type'])
    await pushUserMessage(data as any) // sendMessage 内部已通过 socketCommon.emit 全量广播
    // 单用户系统，消息广播给所有在线客户端
    const count = 1
    logger.info('[Inner API · Message]', '推送消息', JSON.stringify({ title: data.title, count }))
    response.send(API_STATUS_CODE.okData({ count }))
  }
  catch (e: any) {
    logger.error('[Inner API · Message]', '推送消息失败', e)
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 清理已读消息（Inner API）
 */
apiInner.post('/clean', async (request, response) => {
  try {
    const days = Number(request.body.days)
    if (!Number.isFinite(days) || !(days > 0)) {
      return response.send(API_STATUS_CODE.fail('days 必须为大于 0 的有效数字'))
    }
    const result = await cleanReadMessages(days)
    response.send(API_STATUS_CODE.okData({ count: result?.count ?? 0 }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

export {
  api as API,
  apiInner as InnerAPI,
  apiOpen as OpenAPI,
}
