import {
  getRuntimeConfigValue,
  getRuntimeModuleConfigReadonly,
  updateConfigValue,
} from '../config'
import { sendMessage } from '../message'
import { socketCommon } from '../../server/socketCommon'
import { ConfigKeyRuntime, ConfigModule } from '../type/config'
import { logger } from '../../utils/logger'
import { updateConstants } from './constants'
import { fetchLatestRelease } from './releases'
import type { GithubRelease } from './releases'
import { UpdateCheckErrorCode, UpdateCheckErrors, UpdateCheckStatus } from './types'
import type { UpdateCheckResult, UpdateCheckSource } from './types'
import { updateCore } from './updateCore'

/**
 * 执行真实更新检测
 *
 * @description 会真实执行 git fetch 与 Releases API 请求；
 * 只负责判断与计算，不落库、不推送消息
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const [local, branch, cachedTag] = await Promise.all([
    updateCore.getLocalVersionInfo(),
    updateCore.getCurrentBranch(),
    updateCore.getCachedVersionTag(),
  ])
  if (!branch) {
    return {
      status: UpdateCheckStatus.ERROR,
      current: { versionTag: cachedTag, ...local },
      error: UpdateCheckErrors[UpdateCheckErrorCode.NO_TRACKED_BRANCH],
    }
  }

  try {
    await updateCore.fetchRemote(branch)
  }
  catch {
    return {
      status: UpdateCheckStatus.ERROR,
      current: { versionTag: cachedTag, ...local },
      error: UpdateCheckErrors[UpdateCheckErrorCode.GITHUB_UNREACHABLE],
    }
  }

  const localHead = await updateCore.getCommit('HEAD')
  const remoteHead = await updateCore.getCommit(`origin/${branch}`)
  if (!localHead || !remoteHead) {
    return {
      status: UpdateCheckStatus.ERROR,
      current: { versionTag: cachedTag, ...local },
      error: UpdateCheckErrors[UpdateCheckErrorCode.UNKNOWN],
    }
  }

  // 当前版本号：分支判定，dev 固定 Dev，生产分支取最近 tag
  const currentVersionTag = await updateCore.getCurrentVersionTag()
  const current = { versionTag: currentVersionTag, ...local }
  await updateCore.persistVersionCache(currentVersionTag, localHead)

  if (localHead === remoteHead) {
    return { status: UpdateCheckStatus.UP_TO_DATE, current }
  }

  if (!await updateCore.isCommitIncluded(localHead, remoteHead)) {
    return {
      status: UpdateCheckStatus.ERROR,
      current,
      error: UpdateCheckErrors[UpdateCheckErrorCode.REPO_DIVERGED],
    }
  }

  // 目标版本号与更新说明来自最新正式 Release
  let latestRelease: GithubRelease | null = null
  try {
    latestRelease = await fetchLatestRelease()
  }
  catch {}
  const targetVersionTag = latestRelease?.tag_name ?? null
  // 更新说明始终取最新正式 Release 正文，不做版本匹配
  const changelog = latestRelease?.body ?? null
  const target = { versionTag: targetVersionTag, commit: remoteHead.slice(0, 7), fullCommit: remoteHead, changelog }

  return { status: UpdateCheckStatus.UPDATE_AVAILABLE, current, target }
}

// in-flight 互斥：并发检测复用同一次真实执行
let inflightCheck: Promise<UpdateCheckResult> | null = null

/**
 * 检测统一入口
 *
 * @description auto=被动触发（推送消息），manual=主动触发（仅 Socket 广播）；并发请求复用同一次检测
 */
export async function requestUpdateCheck(source: UpdateCheckSource): Promise<UpdateCheckResult> {
  if (!inflightCheck) {
    inflightCheck = runCheckAndPersist(source).finally(() => {
      inflightCheck = null
    })
  }
  return inflightCheck
}

/**
 * 执行检测并持久化结果
 *
 * @description 落待处理目标、按来源推送消息、广播前端刷新
 */
async function runCheckAndPersist(source: UpdateCheckSource): Promise<UpdateCheckResult> {
  const result = await checkForUpdate()

  if (result.target) {
    const previousCommit = await getRuntimeConfigValue(ConfigKeyRuntime.UPDATE_PENDING_COMMIT)
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_COMMIT, ConfigModule.RUNTIME, result.target.fullCommit)
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_TAG, ConfigModule.RUNTIME, result.target.versionTag ?? '')

    // 仅被动检测且目标变化时推送消息
    if (source === 'auto' && previousCommit !== result.target.fullCommit) {
      const content = result.target.changelog?.trim() || '检测到新版本，请前往版本更新页面查看更多细节'
      await sendMessage({
        title: '发现新版本',
        content,
        category: 'system',
        type: 'info',
      })
    }
  }
  else if (result.status === UpdateCheckStatus.UP_TO_DATE) {
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_COMMIT, ConfigModule.RUNTIME, '')
    await updateConfigValue(ConfigKeyRuntime.UPDATE_PENDING_TAG, ConfigModule.RUNTIME, '')
  }

  // 仅成功检测时刷新检测时间
  if (result.status !== UpdateCheckStatus.ERROR)
    await updateConfigValue(ConfigKeyRuntime.UPDATE_CHECK_LAST_AT, ConfigModule.RUNTIME, String(Date.now()))

  socketCommon.emit('update:refresh', {})
  return result
}

/**
 * 被动自动检测
 *
 * @description 首次或超过固定频率时触发
 */
export async function triggerAutoCheckIfNeeded(): Promise<void> {
  const runtime = await getRuntimeModuleConfigReadonly()
  if (runtime[ConfigKeyRuntime.UPDATE_UPGRADE_PENDING] === 'true')
    return
  if (runtime[ConfigKeyRuntime.UPDATE_PENDING_COMMIT])
    return
  const lastAt = Number(runtime[ConfigKeyRuntime.UPDATE_CHECK_LAST_AT]) || 0
  if (lastAt > 0 && Date.now() - lastAt < updateConstants.UPDATE_CHECK_INTERVAL_MS)
    return
  try {
    await requestUpdateCheck('auto')
  }
  catch (e: any) {
    logger.error('[版本更新] 自动检测失败', e?.message ?? e)
  }
}
