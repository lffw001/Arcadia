export { requestUpdateCheck, triggerAutoCheckIfNeeded } from './check'
export { isUpgradeRunning, restoreUpgradeState, startUpgrade } from './execute'
export { getUpdateSnapshot, refreshVersionStateAfterUpgrade } from './service'
export type {
  LocalVersionInfo,
  UpdateCheckResult,
  UpdateCheckSource,
  UpdateSnapshot,
} from './types'
export { UpdateCheckErrorCode, UpdateCheckStatus } from './types'
