export type MessageType = 'info' | 'warn' | 'error' | 'success'

export interface MessageData {
  title: string
  content: string
  category?: string // 模块分类：system / cron / login / user / ...
  type?: MessageType // 消息级别
}
