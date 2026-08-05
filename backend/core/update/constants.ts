/**
 * 版本更新模块常量
 *
 * @description 以对象形式统一导出，减少调用方 import 污染
 */
export const updateConstants = {
  /** GitHub 仓库标识，只用于请求官方 Releases API */
  GITHUB_API_BASE: 'https://api.github.com/repos/SuperManito/Arcadia',
  // GitHub Releases API 请求超时（毫秒），失败仅影响版本号展示
  GITHUB_API_TIMEOUT_MS: 8000,
  // git fetch 的 Node 侧执行超时（毫秒），卡死时由 Node 杀掉子进程
  GIT_FETCH_TIMEOUT_MS: 60 * 1000,
  // 被动自动检测间隔（毫秒）：首次立即检测，之后超过该间隔才再次检测
  UPDATE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000,
  // 更新执行阶段超时（毫秒），覆盖 git 操作后的依赖安装与服务重启
  UPGRADE_SCRIPT_TIMEOUT_MS: 60 * 60 * 1000,
  // 超时终止时 SIGTERM 到 SIGKILL 的宽限时间（毫秒）
  UPGRADE_SIGKILL_GRACE_MS: 30 * 1000,
} as const
