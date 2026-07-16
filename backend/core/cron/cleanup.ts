import { removeTask, setTask, validateCronExpression } from './engine'
import { getConfigValue, updateConfigValue } from '../config'
import { ConfigKeySystem, ConfigModule } from '../type/config'
import { runCleanup } from '../cleanup'
import { logger } from '../../utils/logger'

/**
 * 定时清理任务 ID（硬编码，不计入 tasks / taskCore 数据表）
 */
const CLEANUP_CRON_ID = 'SYSTEM_CLEANUP'

/**
 * 注册定时清理任务
 *
 * @param cronExpression 可选覆盖值；不传则从配置读取
 */
export async function registerCleanupCron(cronExpression?: string) {
  let expression = cronExpression ?? await getConfigValue(ConfigKeySystem.CLEANUP_CRON_EXPRESSION, ConfigModule.SYSTEM)

  // 默认生成随机每日执行表达式
  if (!expression || !expression.trim()) {
    const randomHour = Math.floor(Math.random() * 24)
    const randomMinute = Math.floor(Math.random() * 60)
    expression = `${randomMinute} ${randomHour} * * *`
    await updateConfigValue(ConfigKeySystem.CLEANUP_CRON_EXPRESSION, ConfigModule.SYSTEM, expression)
  }

  try {
    validateCronExpression(expression)
  }
  catch (e: any) {
    logger.warn(`[定时清理] cron 表达式无效: ${expression}`, e.message || e)
    removeTask(CLEANUP_CRON_ID)
    return
  }

  setTask(CLEANUP_CRON_ID, expression, async () => {
    try {
      // 回调触发时检查是否启用（默认启用定时清理任务）
      const enabled = await getConfigValue(ConfigKeySystem.CLEANUP_CRON_ENABLED, ConfigModule.SYSTEM)
      if (enabled && enabled !== 'true') {
        return
      }
      await runCleanup()
    }
    catch (e: any) {
      logger.error('[定时清理] 执行异常', e.message || e)
    }
  })

  logger.log(`[定时清理] 已注册 cron: ${expression}`)
}
