import type { Express, Request, Response } from 'express'
import express from 'express'
import { API_STATUS_CODE } from '../utils/httpUtil'
import { validateRequestParams } from '../utils'
import { getCliModuleConfig, getSystemModuleConfig, updateConfigValue } from '../core/config'
import { ConfigKeyCli, ConfigKeySystem, ConfigModule } from '../core/type/config'
import { generateCliConfigSh } from '../core/config/cli'
import { applySystemTimezone, depSetSource } from '../core/config/system'

// 接口参数名（camelCase）内部配置键映射
const SYSTEM_PARAM_TO_KEY: Record<string, ConfigKeySystem> = {
  timezone: ConfigKeySystem.SYSTEM_TIMEZONE,
  npmRegistry: ConfigKeySystem.NPM_REGISTRY,
  pipIndexUrl: ConfigKeySystem.PIP_INDEX_URL,
  aptMirrorUrl: ConfigKeySystem.APT_MIRROR_URL,
}
const SYSTEM_KEY_TO_PARAM: Record<ConfigKeySystem, string> = {
  [ConfigKeySystem.SYSTEM_TIMEZONE]: 'timezone',
  [ConfigKeySystem.NPM_REGISTRY]: 'npmRegistry',
  [ConfigKeySystem.PIP_INDEX_URL]: 'pipIndexUrl',
  [ConfigKeySystem.APT_MIRROR_URL]: 'aptMirrorUrl',
}
const SYSTEM_PARAM_ECOSYSTEM: Record<string, 'npm' | 'pip' | 'apt' | null> = {
  timezone: null,
  npmRegistry: 'npm',
  pipIndexUrl: 'pip',
  aptMirrorUrl: 'apt',
}

export const API: Express = express()

/**
 * 获取 CLI 功能配置
 */
API.get('/cli', async (_request: Request, response: Response) => {
  try {
    const config = await getCliModuleConfig()
    response.send(API_STATUS_CODE.okData(config))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || '获取 CLI 配置失败'))
  }
})

/**
 * 更新 CLI 功能配置
 */
API.post('/cli', async (request: Request, response: Response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['REMOVE_LOG_DAYS_AGO', [false, 'string', true]],
        ['ENABLE_UPDATE_EXTRA', [false, 'string', true]],
        ['ENABLE_UPDATE_EXTRA_SYNC_FILE', [false, 'string', true]],
        ['UPDATE_EXTRA_SYNC_FILE_URL', [false, 'string', true]],
        ['ENABLE_INIT_EXTRA', [false, 'string', true]],
        ['ENABLE_TASK_BEFORE_EXTRA', [false, 'string', true]],
        ['ENABLE_TASK_AFTER_EXTRA', [false, 'string', true]],
        ['ENABLE_AUTO_DELETE_REMOTE_FILE', [false, 'string', true]],
        ['ENABLE_CUSTOM_NOTIFY', [false, 'string', true]],
        ['RUN_DELAY_MAX_SECONDS', [false, 'string', true]],
        ['DEFAULT_JS_RUNTIME', [false, 'string', true]],
        ['DEFAULT_TS_RUNTIME', [false, 'string', true]],
        ['ENABLE_PYTHON_UV', [false, 'string', true]],
      ] as const,
    })
    const body = request.body as Partial<Record<ConfigKeyCli, string>>
    const validKeys = new Set(Object.values(ConfigKeyCli))
    const updates: Promise<any>[] = []
    for (const [key, value] of Object.entries(body)) {
      if (!validKeys.has(key as ConfigKeyCli)) {
        return response.send(API_STATUS_CODE.fail(`无效的配置键: ${key}`))
      }
      updates.push(updateConfigValue(key as ConfigKeyCli, ConfigModule.CLI, value as string))
    }
    if (updates.length === 0) {
      return response.send(API_STATUS_CODE.fail('没有可更新的配置项'))
    }
    await Promise.all(updates)
    await generateCliConfigSh()
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || '更新 CLI 配置失败'))
  }
})

/**
 * 获取系统通用配置
 */
API.get('/system', async (_request: Request, response: Response) => {
  try {
    const config = await getSystemModuleConfig()
    const result = Object.fromEntries(
      Object.entries(config).map(([k, v]) => [SYSTEM_KEY_TO_PARAM[k as ConfigKeySystem] ?? k, v]),
    )
    response.send(API_STATUS_CODE.okData(result))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || '获取系统配置失败'))
  }
})

/**
 * 更新系统通用配置
 */
API.post('/system', async (request: Request, response: Response) => {
  try {
    validateRequestParams(request, {
      body: [
        ['timezone', [false, 'string']],
        ['npmRegistry', [false, 'string', true]],
        ['pipIndexUrl', [false, 'string', true]],
        ['aptMirrorUrl', [false, 'string', true]],
      ] as const,
    })
    const body = request.body as Record<string, string>
    const updates: Promise<any>[] = []
    const sideEffects: Array<{ param: string, value: string }> = []
    for (const [param, value] of Object.entries(body)) {
      const configKey = SYSTEM_PARAM_TO_KEY[param]
      if (!configKey) {
        return response.send(API_STATUS_CODE.fail(`无效的配置键: ${param}`))
      }
      updates.push(updateConfigValue(configKey, ConfigModule.SYSTEM, value))
      sideEffects.push({ param, value })
    }
    if (updates.length === 0) {
      return response.send(API_STATUS_CODE.fail('没有可更新的配置项'))
    }
    await Promise.all(updates)
    for (const { param, value } of sideEffects) {
      if (param === 'timezone' && value) {
        applySystemTimezone(value)
      }
      // 软件源仅在传入非空值时才立即应用，空值保留 DB 记录但不重置工具配置
      const ecosystem = SYSTEM_PARAM_ECOSYSTEM[param]
      if (ecosystem && value) {
        depSetSource(ecosystem, value)
      }
    }
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || '更新系统配置失败'))
  }
})
