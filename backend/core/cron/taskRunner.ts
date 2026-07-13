import type { tasksModel } from '../../db'
import { db } from '../../db'
import type { ChildProcess } from 'node:child_process'
import { logger } from '../../utils/logger'
import { execShell } from '../../utils/cmdUtil'
import { APP_ROOT_DIR } from '../type'
import { emitTaskCompleted, emitTaskStarted } from '../../server/socket'
import { notifyTaskFailure } from '../message/task'

export interface taskRunInfo {
  startTime: number
  endTime: number
  duration: number
  success: boolean
  task: Pick<tasksModel, 'id' | 'name' | 'type' | 'error_notify'>
}

export const runningTasks: { [key: string]: tasksModel } = {} // 正在运行的任务信息
export const runningTasksInsts: { [key: string]: ChildProcess | undefined } = {} // 正在运行的任务实例（child_process）

export const liveLogRegistered = new Set<number>() // 已注册实时日志监听器的任务集合（key: taskId）

/**
 * 定时任务回调内容
 *
 * @param {number} taskId
 * @param {boolean} manual - 是否为手动触发，手动触发时忽略禁用状态
 */
export async function runCronTask(taskId: number, manual: boolean = false) {
  const task = await db.tasks.$getById(taskId)
  // 删除不存在的定时任务
  if (!task) {
    await db.taskCore.$deleteById(`T_${taskId}`)
    return
  }
  // logger.log('触发定时任务', task.shell)
  // 跳过禁用的任务
  if (!manual && task.active <= 0) {
    // logger.log("触发定时任务", task.shell, "（PASS，原因：已被禁用）")
    return
  }
  // 解析高级配置
  let allow_concurrency = false // 默认不允许并发
  let before_task_shell = ''
  let after_task_shell = ''
  if (task.config) {
    try {
      const config = JSON.parse(task.config)
      if (typeof config.allow_concurrency === 'boolean') {
        allow_concurrency = config.allow_concurrency
      }
      if (typeof config.before_task_shell === 'string') {
        before_task_shell = config.before_task_shell
      }
      if (typeof config.after_task_shell === 'string') {
        after_task_shell = config.after_task_shell
      }
    }
    catch {}
  }
  if (runningTasks[taskId] && !allow_concurrency) {
    // 跳过正在运行的任务
    // logger.log('触发定时任务', task.shell, '（PASS，原因：正在运行）')
    return
  }
  // 运行前/后命令
  if (before_task_shell) {
    task.shell = `bash -c "cd ${APP_ROOT_DIR} ; ${before_task_shell}" ; ${task.shell}`
  }
  if (after_task_shell) {
    task.shell = `${task.shell} ; bash -c "cd ${APP_ROOT_DIR} ; ${after_task_shell}"`
  }
  runningTasks[taskId] = task // 将任务添加到正在运行的列表
  runningTasksInsts[taskId] = runTaskModel(task)
  return runningTasksInsts[taskId]
}

/**
 * 终止运行中的任务（接口封装）
 *
 * @param {number} taskId
 */
export function stopCronTask(taskId: number) {
  const task = runningTasksInsts[taskId]
  if (task) {
    let isExited = false
    let elapsedTime = 0

    task.kill('SIGTERM')
    task.once('exit', (_code: string, signal: string) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        delete runningTasksInsts[taskId]
        isExited = true
        // logger.log(`定时任务 ${taskId} 已被终止`);
      }
    })
    const checkInterval = setInterval(() => {
      elapsedTime += 1000
      if (isExited || elapsedTime >= 30000) {
        clearInterval(checkInterval) // 清除定时器（已终止或超时）
      }
      else if (runningTasksInsts[taskId]) {
        task.kill('SIGKILL') // 强制终止
        // logger.log(`定时任务 ${taskId} 已被强制终止`);
      }
    }, 1000) // 每秒检查一次
  }
}

/**
 * 执行定时任务的命令
 */
function runTaskModel(task: Pick<tasksModel, 'id' | 'name' | 'type' | 'shell' | 'error_notify'>) {
  const startTime = Date.now()

  emitTaskStarted(task)

  return execShell(task.shell, {
    callback: (error, stdout, _stderr) => {
      if (error) {
        logger.warn(`定时任务 "${task.shell}" 执行异常`, error.toString().substring(stdout.length - 1000))
      }
    },
    onExit: (code) => {
      const endTime = new Date().getTime()
      const duration = endTime - startTime
      const success = code === 0 || code === null
      const info: taskRunInfo = { task, startTime, endTime, duration, success }

      cleanupRunningTaskState(task, startTime, duration)
      emitTaskCompleted(info)
      if (!success) {
        notifyTaskFailure(info).catch((e) =>
          logger.error('发送任务失败通知异常', e))
      }
    },
  })
}

/**
 * 清理任务运行状态并更新最后运行时间
 * 从 cron/index.ts::registerCronCallbacks 迁移而来
 */
function cleanupRunningTaskState(task: Pick<tasksModel, 'id'>, startTime: number, duration: number) {
  const data = {
    last_runtime: new Date(startTime),
    last_run_use: duration / 1000,
  }

  // 存在并发重叠（另一个实例仍在运行），需要比较时间戳
  if (runningTasks[task.id]) {
    db.tasks.$getById(task.id).then((t: tasksModel) => {
      // 如果记录的最后时间比当前时间早，则更新
      if (t.last_runtime && t.last_runtime.getTime() <= startTime) {
        delete runningTasks[t.id]
        delete runningTasksInsts[t.id]
        db.tasks.update({ where: { id: t.id }, data }).catch((_e) => {})
      }
    }).catch((_e) => {})
  }
  else {
    // 从正在运行的任务中删除
    delete runningTasks[task.id]
    delete runningTasksInsts[task.id]
    // 更新最后运行时间和其运行时长
    db.tasks.update({ where: { id: task.id }, data }).catch((_e) => {})
  }
}
