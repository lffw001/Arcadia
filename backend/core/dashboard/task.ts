import type { tasksModel } from '../../db'
import db from '../../db'
import { ConfigKeyUser } from '../type/config'
import { logger } from '../../utils/logger'
import { getUserConfigValue } from '../config'

/**
 * 初始化监控系统
 */
export async function initTaskMonitor() {
  scheduleCleanup()
}

/**
 * 持久化单条任务执行记录到数据库
 */
export async function persistTaskExecution(task: Pick<tasksModel, 'id' | 'name' | 'type'>, duration: number, success: boolean) {
  const execTimestamp = Date.now()
  const formattedDuration = duration < 1 ? 0 : Math.round(duration)

  const record = {
    task_id: task.id,
    task_name: task.name,
    task_type: task.type,
    exec_timestamp: execTimestamp,
    duration: formattedDuration,
    success: success ? 1 : 0,
  }

  try {
    await db.tasksExecutionStats.create({ data: record })
  }
  catch (e: any) {
    logger.warn('[定时任务监控] 持久化失败', e.message || e)
  }
}

/**
 * 定时清理（每天凌晨3点）
 */
function scheduleCleanup() {
  const now = new Date()
  const nextCleanup = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 3, 0, 0)
  const delay = nextCleanup.getTime() - now.getTime()

  setTimeout(async () => {
    await cleanupOldData()
    setInterval(cleanupOldData, 24 * 60 * 60 * 1000)
  }, delay)
}

/**
 * 执行数据清理
 */
async function cleanupOldData() {
  try {
    let retentionDays = 7
    try {
      const days = await getUserConfigValue(ConfigKeyUser.CRON_TASK_HISTORY_DAYS)
      if (days) {
        retentionDays = Number.parseInt(days, 10)
      }
    }
    catch {}

    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
    cutoffDate.setHours(0, 0, 0, 0) // 以保留天数的当天零点为边界，避免删除当天部分数据
    const cutoffTimestamp = cutoffDate.getTime()

    await db.tasksExecutionStats.deleteMany({
      where: {
        exec_timestamp: {
          lt: cutoffTimestamp,
        },
      },
    })
  }
  catch (e: any) {
    logger.error('[定时任务监控] 数据清理异常', e.message || e)
  }
}
