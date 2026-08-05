import type { Buffer } from 'node:buffer'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { getConfigValue, updateConfigValue } from '../config'
import { sendMessage } from '../message'
import { socketCommon } from '../../server/socketCommon'
import { APP_DIR_PATH, APP_FILE_PATH } from '../type'
import { ConfigKeyRuntime, ConfigModule } from '../type/config'
import { logger } from '../../utils/logger'
import { requestUpdateCheck } from './check'
import { updateConstants } from './constants'
import { UpdateCheckStatus } from './types'
import { updateCore } from './updateCore'

/**
 * 更新任务标记文件内容
 */
interface UpgradeMarker {
  targetCommit: string
  versionTag: string | null
  startedAt: number
  pid?: number
}

let updating = false

/**
 * 查询是否有更新任务正在执行
 *
 * @description 供快照接口与检测门控使用
 */
export async function isUpgradeRunning(): Promise<boolean> {
  if (updating)
    return true
  if (await getConfigValue(ConfigKeyRuntime.UPDATE_UPGRADE_PENDING, ConfigModule.RUNTIME) !== 'true')
    return false
  const marker = await readMarker()
  if (!marker)
    return false
  if (Date.now() - marker.startedAt >= updateConstants.UPGRADE_SCRIPT_TIMEOUT_MS)
    return false
  return marker.pid ? isProcessAlive(marker.pid) : true
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (e: any) {
    return e?.code === 'EPERM'
  }
}

async function clearUpgradeHook(): Promise<void> {
  await clearMarker()
  await updateConfigValue(ConfigKeyRuntime.UPDATE_UPGRADE_PENDING, ConfigModule.RUNTIME, 'false')
}

async function writeMarker(marker: UpgradeMarker): Promise<void> {
  await mkdir(APP_DIR_PATH.TMP, { recursive: true })
  await writeFile(APP_FILE_PATH.UPDATE_MARKER, JSON.stringify({ ...marker, startedAt: Date.now() }), 'utf8')
}

async function readMarker(): Promise<UpgradeMarker | null> {
  try {
    return JSON.parse(await readFile(APP_FILE_PATH.UPDATE_MARKER, 'utf8')) as UpgradeMarker
  }
  catch {
    return null
  }
}

async function clearMarker(): Promise<void> {
  await rm(APP_FILE_PATH.UPDATE_MARKER, { force: true })
}

/**
 * 启动后台更新
 *
 * @description 重新检测确认存在可更新目标后转入后台执行
 */
export async function startUpgrade(): Promise<void> {
  if (updating)
    throw new Error('已有更新任务在执行中，请勿重复触发')
  // 先同步置位再 await，避免并发请求同时通过互斥检查
  updating = true

  try {
    // 跨进程互斥：未过期的任务标记拒绝重复触发
    const flag = await getConfigValue(ConfigKeyRuntime.UPDATE_UPGRADE_PENDING, ConfigModule.RUNTIME)
    if (flag === 'true') {
      const existing = await readMarker()
      const stale = !existing || !Number.isFinite(existing.startedAt) || Date.now() - existing.startedAt >= updateConstants.UPGRADE_SCRIPT_TIMEOUT_MS
      if (!stale)
        throw new Error('已有更新任务在执行中，请勿重复触发')
      await clearUpgradeHook()
    }

    const fresh = await requestUpdateCheck('manual')
    // 仅无更新目标时拒绝
    if (fresh.status !== UpdateCheckStatus.UPDATE_AVAILABLE)
      throw new Error(fresh.error?.message ?? '当前没有可更新的版本，请重新检查更新后再试')

    const marker: UpgradeMarker = { targetCommit: fresh.target!.fullCommit, versionTag: fresh.target!.versionTag, startedAt: Date.now() }
    await updateConfigValue(ConfigKeyRuntime.UPDATE_UPGRADE_PENDING, ConfigModule.RUNTIME, 'true')
    runUpgradeProcess(marker)
  }
  catch (e: any) {
    updating = false
    throw e
  }
}

function runUpgradeProcess(marker: UpgradeMarker): void {
  const displayVersionTag = marker.versionTag
  const targetCommitShort = marker.targetCommit
  logger.info(`[版本更新] 开始更新（目标版本标签：${displayVersionTag ?? '未知'}）`)

  // detached 使子进程自成进程组，超时后可终止整条调用链；来源标识让 shell 钩子跳过回调
  const child = updateCore.spawnUpgrade({ ...process.env, ARCADE_UPDATE_SOURCE: 'backend' })

  const childPid = child.pid
  // 拿到 pid 后才落标记，供重启后的存活探测使用
  writeMarker({ ...marker, pid: childPid }).catch(() => {})
  let finished = false
  let sigkillTimer: NodeJS.Timeout | undefined

  const overallTimeout = setTimeout(() => {
    if (finished || !childPid)
      return
    logger.error('[版本更新] 更新超时，正在终止整个进程组...')
    process.kill(-childPid, 'SIGTERM')
    sigkillTimer = setTimeout(() => {
      if (!finished && childPid)
        process.kill(-childPid, 'SIGKILL')
    }, updateConstants.UPGRADE_SIGKILL_GRACE_MS)
  }, updateConstants.UPGRADE_SCRIPT_TIMEOUT_MS)

  // 脚本输出（含原生 git 报错）写入后端日志
  child.stdout.on('data', (data: Buffer) => logger.info(`[更新日志] ${data.toString('utf-8').trimEnd()}`))
  child.stderr.on('data', (data: Buffer) => logger.warn(`[更新日志] ${data.toString('utf-8').trimEnd()}`))

  child.on('close', async () => {
    finished = true
    clearTimeout(overallTimeout)
    if (sigkillTimer)
      clearTimeout(sigkillTimer)
    updating = false
    await finalizeUpgradeOutcome(targetCommitShort, displayVersionTag)
  })

  child.on('error', async (err) => {
    finished = true
    clearTimeout(overallTimeout)
    updating = false
    logger.error('[版本更新] 启动更新脚本失败', err.message || err)
    await clearUpgradeHook()
    await sendMessage({ title: '更新失败', content: '更新脚本启动失败，请查看后端日志排查原因', category: 'system', type: 'error' })
    socketCommon.emit('update:refresh', {})
  })
}

/**
 * 更新收尾
 *
 * @description 不依赖脚本退出码，以更新后本地 HEAD 是否落在目标 commit 上为准
 */
async function finalizeUpgradeOutcome(targetCommitShort: string, displayVersionTag: string | null): Promise<{ success: boolean }> {
  const newHead = await updateCore.getCommit('HEAD')
  const success = !!newHead && newHead.startsWith(targetCommitShort)

  if (success) {
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_COMMIT, ConfigModule.RUNTIME, '')
    await updateConfigValue(ConfigKeyRuntime.UPDATE_CHECK_LAST_AT, ConfigModule.RUNTIME, String(Date.now()))
    // 取不到真实标签时保留已有缓存
    if (displayVersionTag)
      await updateConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_TAG, ConfigModule.RUNTIME, displayVersionTag)
    if (newHead)
      await updateConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_COMMIT, ConfigModule.RUNTIME, newHead)
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_TAG, ConfigModule.RUNTIME, '')
  }
  else {
    await sendMessage({ title: '更新失败', content: '更新脚本执行结束，但版本未发生变化，请查看更新日志排查原因', category: 'system', type: 'error' })
  }

  await clearUpgradeHook()
  socketCommon.emit('update:refresh', {})
  return { success }
}

/**
 * 后端启动时恢复未完成的更新状态
 *
 * @description 清理残留标记，或补齐进程重启丢失的收尾
 */
export async function restoreUpgradeState(): Promise<void> {
  const flag = await getConfigValue(ConfigKeyRuntime.UPDATE_UPGRADE_PENDING, ConfigModule.RUNTIME)
  if (flag !== 'true')
    return
  const marker = await readMarker()
  const stale = !marker || !Number.isFinite(marker.startedAt) || Date.now() - marker.startedAt >= updateConstants.UPGRADE_SCRIPT_TIMEOUT_MS
  if (stale) {
    await clearUpgradeHook()
    return
  }
  const newHead = await updateCore.getCommit('HEAD')
  if (newHead && newHead.startsWith(marker.targetCommit)) {
    await finalizeUpgradeOutcome(marker.targetCommit, marker.versionTag)
    return
  }
  // 进程已退出且未到达目标：清理残留并通知失败；否则等待脚本结束或超时
  if (marker.pid && !isProcessAlive(marker.pid)) {
    await clearUpgradeHook()
    await sendMessage({ title: '版本更新失败', content: '更新呈现异常退出且版本未发生变化，请重新发起更新或查看更新日志排查原因', category: 'system', type: 'error' })
    socketCommon.emit('update:refresh', {})
  }
}
