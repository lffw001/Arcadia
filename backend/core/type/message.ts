export type MessageType = 'info' | 'warn' | 'error' | 'success'

export interface MessageData {
  title: string
  content: string
  source?: string // 来源标识，格式 "模块@资源ID"，默认 'system'
  category?: string // 模块分类：system / cron / login / user / ...
  type?: MessageType // 消息级别
}
