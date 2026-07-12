import type { messageModel } from '../../db'
import { db } from '../../db'
import { validateObject } from '../../utils'
// import { processMessageAlert } from '../alert'
import { logger } from '../../utils/logger'
import { socketCommon } from '../../server/socketCommon'

interface MessageData {
  title: string
  content: string
  source?: string // 来源标识，格式 "模块@资源ID"，默认 'system'
  category?: string // 模块分类：system / cron / login / user / ...
  type?: 'info' | 'warn' | 'error' | 'success' // 消息级别
}

interface messageInfo {
  taskId?: number
}

// 消息去重 LRU 缓存
interface DedupEntry {
  fingerprint: string
  messageId: number
  timestamp: number
}

const DEDUP_MAX_SIZE = 1000
const DEDUP_WINDOW_MS = 5 * 60 * 1000 // 5 分钟
const dedupCache = new Map<string, DedupEntry>()

function dedupEvict() {
  if (dedupCache.size > DEDUP_MAX_SIZE) {
    // 删除最早插入的条目（Map 按插入顺序迭代）
    const firstKey = dedupCache.keys().next().value
    if (firstKey !== undefined) {
      dedupCache.delete(firstKey)
    }
  }
}

// 内容长度校验
const TITLE_MAX_LENGTH = 200
const CONTENT_MAX_LENGTH = 20000

function validateMessageLength(data: MessageData) {
  if (data.title && data.title.length > TITLE_MAX_LENGTH) {
    throw new Error(`消息标题长度不能超过 ${TITLE_MAX_LENGTH} 个字符`)
  }
  if (data.content && data.content.length > CONTENT_MAX_LENGTH) {
    throw new Error(`消息内容长度不能超过 ${CONTENT_MAX_LENGTH} 个字符`)
  }
}

// 消息发送
export async function sendTextMessage(str: string) {
  if (str.startsWith('{') && str.endsWith('}')) {
    return await sendMessage(JSON.parse(str))
  }
  return await sendMessage({
    title: str.substring(0, 20),
    content: str,
    source: 'system',
    category: 'cron',
    type: 'info',
  })
}

/**
 * 发送消息（内部调用方法）
 */
export async function sendMessage(data: MessageData, info: messageInfo = {}) {
  if (!data.title) {
    logger.error('[Message] sendMessage: title 不能为空')
    throw new Error('title 不能为空')
  }
  if (!data.content) {
    logger.error('[Message] sendMessage: content 不能为空')
    throw new Error('content 不能为空')
  }

  validateObject(data, [
    ['title', [true, 'string']],
    ['content', [true, 'string']],
    ['source', [false, 'string']],
    ['category', [false, 'string']],
    ['type', [false, ['info', 'error', 'warn', 'success']]],
  ])

  if (!data.source) {
    data.source = 'system'
  }

  // 内容长度校验
  validateMessageLength(data)

  if (info.taskId) {
    logger.debug(`发送消息任务ID:${info.taskId}, data:`, data)
  }

  // 构造 DB 记录
  const record: { title: string, content: string, source: string, category?: string, type?: string } = {
    title: data.title,
    content: data.content,
    source: data.source,
  }
  if (data.category)
    record.category = data.category
  if (data.type)
    record.type = data.type

  // 消息去重
  const fingerprint = `${record.source}:${record.title}:${record.content.substring(0, 50)}`
  const now = Date.now()
  const existing = dedupCache.get(fingerprint)

  if (existing && (now - existing.timestamp) < DEDUP_WINDOW_MS) {
    // 检查对应消息是否未读
    const existingMsg = await db.message.findUnique({ where: { id: existing.messageId } })
    if (existingMsg && existingMsg.status === 0) {
      // 合并：repeat_count + 1，刷新 create_time
      const updated = await db.message.update({
        where: { id: existing.messageId },
        data: {
          repeat_count: { increment: 1 },
          create_time: new Date(),
        },
      }) as messageModel

      // 更新缓存时间戳
      dedupCache.set(fingerprint, { fingerprint, messageId: existing.messageId, timestamp: now })

      // 推送更新事件
      socketCommon.emit('message:update', {
        id: updated.id,
        category: updated.category,
        type: updated.type,
        title: updated.title,
        repeat_count: updated.repeat_count,
        create_time: updated.create_time,
      })

      return updated
    }
    // 已读或不存在，清除缓存条目，继续走正常插入流程
    dedupCache.delete(fingerprint)
  }

  // 正常插入
  const msg = await db.message.$create(record) as messageModel

  // 记录到去重缓存
  dedupCache.set(fingerprint, { fingerprint, messageId: msg.id, timestamp: now })
  dedupEvict()

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
 * 获取未读消息数量
 */
export async function getUnreadCount(scope: 'all' | 'user' = 'all'): Promise<number> {
  const where: any = { status: 0 }
  if (scope === 'user') {
    where.category = 'user'
  }
  return await db.message.count({ where })
}

/**
 * 删除已读消息
 */
export async function cleanReadMessages(days: number) {
  const cutoffDate = new Date(Date.now() - days * 86400000)
  const result = await db.message.deleteMany({
    where: {
      status: 1,
      create_time: { lt: cutoffDate },
    },
  })
  logger.info(`[Message] 清理已读消息: 删除 ${result.count} 条 (超过 ${days} 天)`)
  return { count: result.count }
}
