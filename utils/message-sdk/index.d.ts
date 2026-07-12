/** 消息类型 */
export type MessageType = 'info' | 'warn' | 'error' | 'success'

/**
 * 推送消息
 * @param title - 消息标题（必填）
 * @param content - 消息内容（必填）
 * @param type - 消息类型，默认 'info'
 * @returns 推送成功返回 true
 */
export function push(title: string, content: string, type?: MessageType): Promise<boolean>
