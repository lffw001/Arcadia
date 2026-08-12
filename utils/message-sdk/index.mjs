/**
 * Arcadia 消息推送 SDK（Node.js — ESM 入口）
 */

const VALID_TYPES = ['info', 'warn', 'error', 'success']
const API_URL = 'http://127.0.0.1:5678/api/inner/message/push'

/**
 * 推送消息
 * @param {string} title - 消息标题（必填）
 * @param {string} content - 消息内容（必填）
 * @param {'info'|'warn'|'error'|'success'} [type] - 消息类型，默认 info
 * @returns {Promise<boolean>} 推送成功返回 true
 */
export async function push(title, content, type) {
  const msgType = type === undefined || type === null ? 'info' : type

  if (!VALID_TYPES.includes(msgType)) {
    throw new Error('type must be one of: info, warn, error, success')
  }

  const body = { title, content, type: msgType }

  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error('网络连接失败：' + (e instanceof Error ? e.message : String(e)))
  }

  let data
  try {
    data = await response.json()
  } catch (e) {
    throw new Error('响应解析失败：' + (e instanceof Error ? e.message : String(e)))
  }

  if (data.code !== 1) {
    throw new Error('推送失败：' + (data.message || '未知错误'))
  }

  return true
}
