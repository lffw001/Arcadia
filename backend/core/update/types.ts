/**
 * 检测结果状态码
 */
export enum UpdateCheckStatus {
  UP_TO_DATE = 0, // 已是最新
  UPDATE_AVAILABLE = 1, // 有可用更新
  ERROR = 2, // 检测失败
}

/**
 * 检测失败错误码：仅 status=ERROR 时出现
 */
export enum UpdateCheckErrorCode {
  UNKNOWN = 0, // 无法解析本地或远程提交
  GITHUB_UNREACHABLE = 1, // git fetch 失败（网络不可达或超时）
  NO_TRACKED_BRANCH = 2, // 仓库处于游离（detached HEAD）状态，无法确定跟踪分支
  REPO_DIVERGED = 3, // 本地存在远程没有的提交，无法自动更新
}

/**
 * 检测失败信息
 */
export interface UpdateCheckError {
  code: UpdateCheckErrorCode
  message: string
}

/**
 * 检测失败错误信息表
 *
 * @description code 与 message 一一对应，检测失败时统一取用
 */
export const UpdateCheckErrors: Record<UpdateCheckErrorCode, UpdateCheckError> = {
  [UpdateCheckErrorCode.UNKNOWN]: {
    code: UpdateCheckErrorCode.UNKNOWN,
    // 无法解析本地或远程提交（仓库状态异常）
    message: '无法获取本地或远程版本信息，请稍后重试',
  },
  [UpdateCheckErrorCode.GITHUB_UNREACHABLE]: {
    code: UpdateCheckErrorCode.GITHUB_UNREACHABLE,
    // 网络不可达或 git fetch 超时
    message: '无法连接远程仓库，请检查网络后重试',
  },
  [UpdateCheckErrorCode.NO_TRACKED_BRANCH]: {
    code: UpdateCheckErrorCode.NO_TRACKED_BRANCH,
    // 仓库处于游离（detached HEAD）状态，无法确定跟踪分支
    message: '当前仓库状态异常，无法自动检测更新，请手动检查部署环境',
  },
  [UpdateCheckErrorCode.REPO_DIVERGED]: {
    code: UpdateCheckErrorCode.REPO_DIVERGED,
    // 本地存在远程没有的提交，分支已分叉
    message: '本地与远程版本存在差异，无法自动更新，请手动检查仓库状态',
  },
}

/**
 * 检测来源：auto=被动触发（推送消息），manual=主动触发（仅 Socket 通知）
 */
export type UpdateCheckSource = 'auto' | 'manual'

/**
 * 本地版本信息：取不到的值统一为 null
 */
export interface LocalVersionInfo {
  commit: string | null
}

/**
 * 更新检测结果
 */
export interface UpdateCheckResult {
  status: UpdateCheckStatus
  current: { versionTag: string | null, commit: string | null }
  target?: { versionTag: string | null, commit: string, fullCommit: string, changelog: string | null }
  error?: UpdateCheckError
}

/**
 * 版本更新状态快照（前端关于页展示用）
 */
export interface UpdateSnapshot {
  current: { versionTag: string | null, commit: string | null }
  lastCheckedAt: number | null
  updating: boolean
}
