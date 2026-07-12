import type { Express } from 'express'
import express from 'express'
import { API_STATUS_CODE } from '../utils/httpUtil'
import type { messageWhereInput } from '../db'
import db from '../db'
import { cleanProperties, validatePageFixedParams, validateRequestParams } from '../utils'
import { cleanReadMessages, pushUserMessage } from '../core/message/index'
import { logger } from '../utils/logger'

const api: Express = express()
const apiOpen: Express = express()
const apiInner: Express = express()

/**
 * 获取消息列表
 */
api.get('/list', async (request, response) => {
  try {
    // 传参校验
    validatePageFixedParams(request, ['create_time'])
    validateRequestParams(request, {
      query: [
        ['category', [false, 'string']],
        ['status', [false, 'string']],
        ['source', [false, 'string']],
      ],
    })

    const where: messageWhereInput = {}
    // 类型过滤
    if (request.query.category) {
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
    const total = await db.message.count({ where: { status: 0 } })
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
    const message = await db.message.$getById(Number.parseInt(id))
    if (!message) {
      response.send(API_STATUS_CODE.fail('消息不存在'))
      return
    }
    response.send(API_STATUS_CODE.okData(message))
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
    validatePageFixedParams(request, ['create_time'])
    validateRequestParams(request, {
      query: [
        ['status', [false, 'string']],
        ['source', [false, 'string']],
      ],
    })
    // OpenAPI 仅可查看 user 分类消息
    const where: messageWhereInput = { category: { equals: 'user' } }
    if (request.query.status) {
      where.status = Number.parseInt(request.query.status as string)
    }
    if (request.query.source) {
      where.source = { equals: request.query.source as string }
    }
    if (request.query.search) {
      const search = request.query.search as string
      where.AND = {
        OR: [
          { title: { contains: search } },
          { content: { contains: search } },
        ],
      }
    }
    const orderBy = request.query.orderBy as string || 'create_time'
    let desc = true
    if (request.query.order === '0') {
      desc = false
    }
    const result = await db.message.$page({
      where,
      orderBy: [{ [orderBy]: desc ? 'desc' : 'asc' }],
      page: String(request.query.page),
      size: String(request.query.size),
    })
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
    // OpenAPI 仅可查看 user 分类消息
    const total = await db.message.count({ where: { status: 0, category: 'user' } })
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
    const message = await db.message.$getById(Number.parseInt(id))
    // OpenAPI 仅可查看 user 分类消息
    if (!message || message.category !== 'user') {
      response.send(API_STATUS_CODE.fail('消息不存在'))
      return
    }
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
    // OpenAPI 仅可查看 user 分类消息
    await db.message.updateMany({
      where: { id: { in: ids }, category: 'user' },
      data: { status },
    })
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
    // 仅允许操作 user 分类消息
    await db.message.updateMany({
      where: { status: 0, category: 'user' },
      data: { status },
    })
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
    // OpenAPI 仅可查看 user 分类消息
    await db.message.deleteMany({ where: { id: { in: ids }, category: 'user' } })
    logger.info('[OpenAPI · Message]', '批量删除消息', JSON.stringify({ ids }))
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 修改消息
 */
api.put('/', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number']],
        ['title', [false, 'string']],
        ['content', [false, 'string']],
        ['category', [false, 'string']],
        ['type', [false, ['info', 'warn', 'error', 'success']]],
        ['source', [false, 'string']],
        ['tags', [false, 'string']],
        ['status', [false, 'number']],
      ] as const,
    })
    const { id } = params.body
    const message = Object.assign({}, request.body)
    delete message.id
    const updatedMessage = await db.message.update({
      where: { id },
      data: message,
    })
    response.send(API_STATUS_CODE.okData(updatedMessage))
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
    await db.message.$deleteById(ids)
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
    await db.message.updateMany({
      where: { status: 0 },
      data: { status },
    })
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
    await db.message.updateMany({
      where: {
        id: { in: ids },
      },
      data: {
        status,
      },
    })
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
