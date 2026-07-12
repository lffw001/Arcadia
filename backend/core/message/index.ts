import type { messageModel } from '../../db'
import { db } from '../../db'
import { cleanProperties, validateObject } from '../../utils'
// import { processMessageAlert } from '../alert'
import { logger } from '../../utils/logger'
import { socketCommon } from '../../server/socketCommon'

interface MessageData {
  title: string
  content?: string
  source: string // 来源标识，格式 "模块@资源ID"
  category?: string // 模块分类：system / cron / login / user / ...
  type?: 'info' | 'warn' | 'error' | 'success' // 消息级别
}

interface messageInfo {
  taskId?: number
}

export async function sendTextMessage(str: string, info: messageInfo = {}) {
  if (str.startsWith('{') && str.endsWith('}')) {
    return await sendMessage(JSON.parse(str), info)
  }
  return await sendMessage({
    title: `未知消息:${str.substring(0, 20)}`,
    content: str,
    source: 'system',
    category: 'cron',
    type: 'info',
  }, info)
}

/**
 * 发送消息（内部调用方法）
 */
export async function sendMessage(data: MessageData, info: messageInfo = {}) {
  validateObject(data, [
    ['title', [true, 'string']],
    ['content', [false, 'string']],
    ['source', [true, 'string']],
    ['category', [false, 'string']],
    ['type', [false, ['info', 'error', 'warn', 'success']]],
  ])

  if (info.taskId) {
    logger.debug(`发送消息任务ID:${info.taskId}, data:`, data, info)
  }

  data = cleanProperties(data, ['title', 'content', 'source', 'category', 'type'])
  const msg = await db.message.$create(data) as messageModel

  // await processMessageAlert(msg)

  // 通过 WebSocket 推送新消息
  socketCommon.emit('message:new', {
    id: msg.id,
    category: msg.category,
    type: msg.type,
    title: msg.title,
    create_time: msg.create_time,
  })

  return msg
}

/**
 * 面向外部用户集成的消息推送方法
 *
 * category 固定为 user，不接受 source 字段
 * title 和 content 为必填，缺失时直接抛出错误
 */
export async function pushUserMessage(data: { title: string, content: string, type?: 'info' | 'warn' | 'error' | 'success' }) {
  const messageData: MessageData = {
    title: data.title,
    content: data.content,
    source: 'user',
    category: 'user',
    type: data.type ?? 'info',
  }
  return await sendMessage(messageData)
}

/**
 * 清理已读消息
 */
export async function cleanReadMessages(days: number) {
  const cutoff = new Date(Date.now() - days * 86400000)
  return await db.message.deleteMany({
    where: {
      status: { gt: 0 },
      create_time: { lt: cutoff },
    },
  })
}
