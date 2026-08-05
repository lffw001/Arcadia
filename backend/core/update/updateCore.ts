import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { getConfigValue, updateConfigValue } from '../config'
import { APP_DIR_PATH, APP_FILE_PATH, APP_SOURCE_DIR } from '../type'
import { ConfigKeyRuntime, ConfigModule } from '../type/config'
import { updateConstants } from './constants'
import type { LocalVersionInfo } from './types'

/**
 * shell/utils/update.sh 子命令
 */
enum ShellCommand {
  CurrentBranch = 'current-branch',
  Fetch = 'fetch',
  ResolveCommit = 'resolve-commit',
  IsAncestor = 'is-ancestor',
  CurrentVersion = 'current-version',
  Upgrade = 'upgrade',
}

/**
 * 本地更新核心
 *
 * @description 统一封装底层 Shell 命令、本地版本信息与版本号缓存，
 * 上层业务只调用语义化方法，不接触脚本命令与 Git 细节
 */
export class UpdateCore {
  /**
   * 执行无交互子命令
   */
  private runScript(args: string[], timeout = 5000): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn('bash', [APP_FILE_PATH.UPDATE_SH, ...args], { cwd: APP_DIR_PATH.ROOT })
      let stdout = ''
      const timer = setTimeout(() => child.kill('SIGTERM'), timeout)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.on('error', () => {
        clearTimeout(timer)
        resolve(null)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve(code === 0 ? stdout.trim() : null)
      })
    })
  }

  /**
   * 获取当前跟踪分支
   */
  getCurrentBranch(): Promise<string | null> {
    return this.runScript([ShellCommand.CurrentBranch, APP_SOURCE_DIR])
  }

  /**
   * 拉取远程分支与标签
   *
   * @description 唯一的网络操作
   */
  fetchRemote(branch: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [APP_FILE_PATH.UPDATE_SH, ShellCommand.Fetch, APP_SOURCE_DIR, branch], {
        cwd: APP_DIR_PATH.ROOT,
        detached: true,
      })
      const pid = child.pid
      let stderr = ''
      let settled = false
      let timer: NodeJS.Timeout
      const done = (fn: () => void) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          fn()
        }
      }
      timer = setTimeout(() => {
        done(() => {
          if (pid) {
            try {
              process.kill(-pid, 'SIGKILL')
            }
            catch {}
          }
          reject(new Error('git fetch 超时'))
        })
      }, updateConstants.GIT_FETCH_TIMEOUT_MS)
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', err => done(() => reject(err)))
      child.on('close', (code) => {
        done(() => {
          if (code === 0)
            resolve()
          else
            reject(new Error(stderr.trim().split('\n').pop() || `git fetch 失败（退出码 ${code}）`))
        })
      })
    })
  }

  /**
   * 解析修订版本对应的完整提交 SHA
   */
  getCommit(revision: string): Promise<string | null> {
    return this.runScript([ShellCommand.ResolveCommit, APP_SOURCE_DIR, revision])
  }

  /**
   * 判断提交是否已包含在目标历史中
   *
   * @description 与目标提交相同时也视为包含
   */
  async isCommitIncluded(commit: string, revision: string): Promise<boolean> {
    return (await this.runScript([ShellCommand.IsAncestor, APP_SOURCE_DIR, commit, revision])) === ''
  }

  /**
   * 启动升级脚本
   *
   * @description 后台运行且自成进程组，供超时终止整条调用链
   */
  spawnUpgrade(env: NodeJS.ProcessEnv): ChildProcessWithoutNullStreams {
    return spawn('bash', [APP_FILE_PATH.UPDATE_SH, ShellCommand.Upgrade, APP_DIR_PATH.ROOT, APP_SOURCE_DIR], {
      cwd: APP_DIR_PATH.ROOT,
      env,
      detached: true,
    })
  }

  /**
   * 获取本地版本信息
   */
  async getLocalVersionInfo(): Promise<LocalVersionInfo> {
    const fullCommit = await this.getCommit('HEAD')
    return { commit: fullCommit ? fullCommit.slice(0, 7) : null }
  }

  /**
   * 获取当前版本号标签
   *
   * @description 按分支判定：dev 分支固定 Dev，生产分支取最近 tag
   */
  getCurrentVersionTag(): Promise<string | null> {
    return this.runScript([ShellCommand.CurrentVersion, APP_SOURCE_DIR])
  }

  /**
   * 读取缓存的当前版本号
   */
  async getCachedVersionTag(): Promise<string | null> {
    return (await getConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_TAG, ConfigModule.RUNTIME)) || null
  }

  /**
   * 刷新当前版本号缓存
   *
   * @description 现算后写入缓存
   */
  async refreshVersionTagCache(): Promise<string | null> {
    const tag = await this.getCurrentVersionTag()
    if (!tag)
      return this.getCachedVersionTag()
    await updateConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_TAG, ConfigModule.RUNTIME, tag)
    return tag
  }

  /**
   * 持久化版本信息缓存
   *
   * @description 仅在值变化时写库
   */
  async persistVersionCache(tag: string | null, fullCommit: string): Promise<void> {
    const [cachedTag, cachedCommit] = await Promise.all([
      getConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_TAG, ConfigModule.RUNTIME),
      getConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_COMMIT, ConfigModule.RUNTIME),
    ])
    if (cachedTag !== (tag ?? ''))
      await updateConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_TAG, ConfigModule.RUNTIME, tag ?? '')
    if (cachedCommit !== fullCommit)
      await updateConfigValue(ConfigKeyRuntime.UPDATE_CURRENT_COMMIT, ConfigModule.RUNTIME, fullCommit)
  }
}

/**
 * 全局共享实例
 *
 * @description 无状态，可安全复用
 */
export const updateCore = new UpdateCore()
