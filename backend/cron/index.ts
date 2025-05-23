import type { ChildProcess } from 'node:child_process'
import { removeTask, setTask, validateCronExpression } from './engine'
import { task as eventBus } from './eventBus'
import type { Tasks } from '../db'
import db, { task_core as dbTaskCore, tasks as dbTasks } from '../db'
import { APP_ROOT_DIR } from '../type'
import { logger } from '../logger'
import { execShell } from '../cmd'
import type { TaskInstance } from './type'

export const runningTasks: { [key: string]: Tasks } = {} // 正在运行的任务信息
const runningInstance: { [key: string]: ChildProcess | undefined } = {} // 正在运行的任务实例（child_process）

/**
 * 任务初始化
 *
 * @description 从数据库中读取任务并初始化（应用数据库中配置的定时任务）
 */
export function initCronJob() {
  setTimeout(async () => {
    logger.log('定时任务初始化 - 开始')
    for (const task of (await dbTaskCore.findMany())) {
      const taskCoreId = task.id
      const tasksId = Number.parseInt(taskCoreId.substring(2))
      const cronExpression = task.cron.trim()

      // 高危操作
      // 删除不存在的定时任务（处理不符合预期未被移除的非正常任务）
      if (!(await dbTasks.$getById(tasksId))) {
        await dbTaskCore.$deleteById(taskCoreId)
        // logger.warn(`定时任务 ${tasksId} 不存在，已删除`)
      }

      // 定时表达式格式校验
      const cronParams = cronExpression.split(' ')
      if (cronParams.length < 5 || cronParams.length > 6) {
        logger.error(`设置定时任务 ${tasksId} 失败 => ${cronExpression} (格式错误)`)
        continue
      }
      try {
        validateCronExpression(cronExpression)
      }
      catch (error: any) {
        logger.error(`设置定时任务 ${tasksId} 失败 => ${cronExpression} (${error})`)
        continue
      }
      // 设置定时
      try {
        setTask(taskCoreId, cronExpression, () => onCron(task))
        // logger.log(`设置定时任务 ${tasksId} 成功 => ${cronExpression}`)
      }
      catch (e: any) {
        logger.error(`设置定时任务 ${tasksId} 失败 => ${cronExpression} ${e.message || e}`)
      }
    }
    // 应用未正常设置的定时任务
    const ids = (await dbTaskCore.findMany()).map((task) => task.id.substring(2))
    for (const task of (await dbTasks.findMany())) {
      if (ids.includes(String(task.id))) {
        continue
      }
      await applyCron(task.id)
    }
    // logger.log('任务总数', taskCoreCurd.list().length)
    logger.log('定时任务初始化 - 结束')
  }, 1000)
}

/**
 * 定时任务回调
 */
function onCron(task: TaskInstance) {
  if (task.id.startsWith('T_') && task.callback === '') {
    onCronMain(Number.parseInt(task.id.substring(2)))
      .then((_r) => {
        // console.log("over", r)
      })
  }
  eventBus.emit(task.id, task)
  if (typeof task.callback === 'function') {
    task.callback()
  }
  else if (task.callback) {
    eventBus.emit(`callback.${task.callback}`, task)
  }
}

/**
 * 定时任务回调内容
 *
 * @param {number} taskId
 */
async function onCronMain(taskId: number) {
  const task = await dbTasks.$getById(taskId)
  // 删除不存在的定时任务
  if (!task) {
    await dbTaskCore.$deleteById(`T_${taskId}`)
    return
  }
  // logger.log('触发定时任务', task.shell)
  // 跳过禁用的任务
  if (task.active <= 0) {
    // logger.log("触发定时任务", task.shell, "（PASS，原因：已被禁用）")
    return
  }
  // 解析高级配置
  if (task.config) {
    let before_task_shell = ''
    let after_task_shell = ''
    let allow_concurrency = false
    try {
      const config = JSON.parse(task.config)
      if (typeof config.before_task_shell === 'string') {
        before_task_shell = config.before_task_shell
      }
      if (typeof config.after_task_shell === 'string') {
        after_task_shell = config.after_task_shell
      }
      if (typeof config.allow_concurrency === 'boolean') {
        allow_concurrency = config.allow_concurrency
      }
    }
    catch {}
    // 跳过正在运行的任务（运行并发时除外）
    if (runningTasks[taskId] && !allow_concurrency) {
      // logger.log('触发定时任务', task.shell, '（PASS，原因：正在运行）')
      return
    }
    // 补齐命令
    if (before_task_shell) {
      task.shell = `bash -c "cd ${APP_ROOT_DIR} ; ${before_task_shell}" ; ${task.shell}`
    }
    if (after_task_shell) {
      task.shell = `${task.shell} ; bash -c "cd ${APP_ROOT_DIR} ; ${after_task_shell}"`
    }
  }
  else if (runningTasks[taskId]) {
    // 跳过正在运行的任务
    // logger.log('触发定时任务', task.shell, '（PASS，原因：正在运行）')
    return
  }

  runningTasks[taskId] = task // 将任务添加到正在运行的列表
  runningInstance[taskId] = runCronTaskShell(task)
  return runningInstance[taskId]
}

/**
 * 执行定时任务的命令
 *
 */
function runCronTaskShell(task: Tasks) {
  const date = new Date()
  return execShell(task.shell, {
    callback: (error, stdout, _stderr) => {
      // 任务回调
      if (error) {
        logger.warn(`定时任务 "${task.shell}" 执行异常`, error.toString().substring(stdout.length - 1000))
      }
    },
    onExit: (_code) => {
      // logger.log(`定时任务 ${taskId} 运行完毕`)
      const data = { last_runtime: date, last_run_use: (new Date().getTime() - date.getTime()) / 1000 }
      let allow_concurrency = false // 是否允许并发
      if (task.config) {
        try {
          const config = JSON.parse(task.config)
          if (typeof config.allow_concurrency === 'boolean') {
            allow_concurrency = config.allow_concurrency
          }
        }
        catch {}
      }
      // 允许并发后存在任务重叠的情况，需要具体判断
      if (allow_concurrency) {
        dbTasks.$getById(task.id).then((task: Tasks) => {
          // 如果记录的最后时间比当前时间早，则更新
          if (task.last_runtime && task.last_runtime.getTime() <= date.getTime()) {
            // 从正在运行的任务中删除
            delete runningTasks[task.id]
            delete runningInstance[task.id]
            // 更新最后运行时间和其运行时长
            dbTasks.update({ where: { id: task.id }, data }).catch((_e) => {})
          }
        }).catch((_e) => {})
      }
      else {
        // 从正在运行的任务中删除
        delete runningTasks[task.id]
        delete runningInstance[task.id]
        // 更新最后运行时间和其运行时长
        dbTasks.update({ where: { id: task.id }, data }).catch((_e) => {})
      }
    },
  })
}

/**
 * 主动执行任务（接口封装）
 *
 * @param {number} taskId
*/
export async function runTask(taskId: number) {
  const task = await dbTasks.$getById(taskId)
  // 删除不存在的定时任务
  if (!task) {
    throw new Error('任务不存在')
  }
  // logger.log('主动执行任务', task.shell)
  // 跳过正在运行的任务
  if (runningTasks[taskId]) {
    throw new Error('任务正在运行')
  }
  // 解析高级配置
  if (task.config) {
    let before_task_shell = ''
    let after_task_shell = ''
    try {
      const config = JSON.parse(task.config)
      if (typeof config.before_task_shell === 'string') {
        before_task_shell = config.before_task_shell
      }
      if (typeof config.after_task_shell === 'string') {
        after_task_shell = config.after_task_shell
      }
    }
    catch {}
    // 补齐命令
    if (before_task_shell) {
      task.shell = `bash -c "cd ${APP_ROOT_DIR} ; ${before_task_shell}" ; ${task.shell}`
    }
    if (after_task_shell) {
      task.shell = `${task.shell} ; bash -c "cd ${APP_ROOT_DIR} ; ${after_task_shell}"`
    }
  }

  runningTasks[taskId] = task // 将任务添加到正在运行的列表
  runningInstance[taskId] = runCronTaskShell(task)
}

/**
 * 终止运行中的任务（接口封装）
 *
 * @param {number} taskId
*/
export function terminateTask(taskId: number) {
  const task = runningInstance[taskId]
  if (task) {
    let isExited = false
    let elapsedTime = 0

    task.kill('SIGTERM')
    task.once('exit', (_code: string, signal: string) => {
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        delete runningInstance[taskId]
        isExited = true
        // logger.log(`定时任务 ${taskId} 已被终止`);
      }
    })
    const checkInterval = setInterval(() => {
      elapsedTime += 1000
      if (isExited || elapsedTime >= 30000) {
        clearInterval(checkInterval) // 清除定时器（已终止或超时）
      }
      else if (runningInstance[taskId]) {
        task.kill('SIGKILL') // 强制终止
        // logger.log(`定时任务 ${taskId} 已被强制终止`);
      }
    }, 1000) // 每秒检查一次
  }
}

/**
 * 应用定时任务
 *
 * @param {number|number[]} taskId
 * @description 数据库设计了两个表，tasks表只存储用户数据，task_core表关联定时任务
 */
export async function applyCron(taskId: number | string | (number | string)[]) {
  let ids: (number | string)[] = []
  if (Array.isArray(taskId)) {
    ids = taskId
  }
  else {
    ids.push(taskId)
  }
  for (let id of ids) {
    id = Number.parseInt(id as unknown as string)
    const task = await dbTasks.$getById(id)
    if (task) {
      await setTaskCore(`T_${task.id}`, task.cron.trim(), '')
    }
    else {
      const taskId = `T_${id}`
      await dbTaskCore.$deleteById(taskId)
      removeTask(taskId)
    }
  }
}

/**
 * 设置定时任务
 *
 * @param {string} id
 * @param {string} cron
 * @param {string} callback
 */
async function setTaskCore(id: string, cron: string, callback: string) {
  await dbTaskCore.$upsertById({ id, cron, callback })
  const taskData: TaskInstance = { id, cron, callback }
  setTask(id, cron, () => onCron(taskData))
}

/**
 * 查询bind组（标签列表）
 */
export async function getBindGroup() {
  return await db.$queryRaw`SELECT bind, COUNT(*) AS count
                            FROM (
                              SELECT SUBSTR(
                                bind, 
                                INSTR(bind, '#') + 1,
                                INSTR(SUBSTR(bind, INSTR(bind, '#') + 1), '#') - 1
                              ) AS bind
                              FROM tasks
                            )
                            GROUP BY bind`
}

/**
 * 数据库所有成员sort设置为顺序值
 */
export async function fixOrder() {
  await db.$executeRaw`UPDATE tasks
                       SET sort = t.row_num
                       FROM (SELECT id, row_number() over (PARTITION BY type order by sort) as row_num
                             FROM tasks) t
                       WHERE t.id = tasks.id`
}

/**
 * 将指定记录的sort值更新为新的值
 */
export async function updateSortById(taskId: number, newOrder: number) {
  const oldRecord = await dbTasks.$getById(taskId) as Tasks
  if (newOrder === oldRecord.sort) {
    return true
  }
  const args = newOrder > oldRecord.sort
    ? [oldRecord.sort, newOrder, -1, oldRecord.sort + 1, newOrder, oldRecord.type]
    : [oldRecord.sort, newOrder, 1, newOrder, oldRecord.sort - 1, oldRecord.type]
  await db.$executeRaw`BEGIN TRANSACTION;`
  if (newOrder > oldRecord.sort) {
    await db.$executeRaw`UPDATE tasks
                         SET sort = sort + ${args[2]}
                         WHERE sort > ${oldRecord.sort} AND sort <= ${newOrder} AND type = ${args[5]}`
  }
  if (newOrder < oldRecord.sort) {
    await db.$executeRaw`UPDATE tasks
                         SET sort = sort + ${args[2]}
                         WHERE sort >= ${newOrder} AND sort < ${oldRecord.sort} AND type = ${args[5]}`
  }
  await db.$executeRaw`UPDATE tasks
                       SET sort = ${newOrder}
                       WHERE id = ${taskId}`
  await db.$executeRaw`COMMIT;`
  return true
}
