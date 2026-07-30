import type { Express } from 'express'
import express from 'express'
import { API_STATUS_CODE } from '../utils/httpUtil'
import type { dependencyManageWhereInput } from '../db'
import db from '../db'
import { validateRequestParams } from '../utils'
import { DepStatus, ECOSYSTEMS, enqueueInstall, enqueueUninstall, getBaseName, PROTECTED, syncDeps } from '../core/dep'

const api: Express = express()

/**
 * 获取依赖列表（分页）
 */
api.get('/', async (request, response) => {
  try {
    const search = request.query.search as string | undefined
    const ecosystem = request.query.ecosystem as string | undefined
    const status = request.query.status !== undefined ? Number.parseInt(request.query.status as string) : undefined
    const where: dependencyManageWhereInput = {}
    const and: dependencyManageWhereInput[] = []
    if (ecosystem)
      and.push({ ecosystem: { equals: ecosystem } })
    if (status !== undefined && !Number.isNaN(status))
      and.push({ status: { equals: status } })
    if (search) {
      and.push({
        OR: [
          { name: { contains: search } },
          { remark: { contains: search } },
        ],
      })
    }
    if (and.length > 0)
      where.AND = and
    const orderByField = request.query.orderBy as string | undefined
    let desc = true
    if (request.query.order === '0')
      desc = false
    const result = await db.dependencyManage.$page({
      where,
      orderBy: orderByField ? { [orderByField]: desc ? 'desc' : 'asc' } : { id: 'desc' },
      page: String(request.query.page),
      size: String(request.query.size),
    })
    response.send(API_STATUS_CODE.okData(result))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 新增依赖记录
 */
api.post('/', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['name', [true, 'string']],
        ['ecosystem', [true, ECOSYSTEMS]],
        ['remark', [false, 'string']],
      ] as const,
    })
    const { name, ecosystem, remark } = params.body as { name: string, ecosystem: string, remark?: string }
    const cleanName = name.trim()
    if (!cleanName)
      throw new Error('名称不能为空')
    const baseName = getBaseName(ecosystem, cleanName)
    if (PROTECTED[ecosystem]?.has(baseName))
      throw new Error(`${baseName} 为平台保留依赖，禁止添加！`)
    const exists = await db.dependencyManage.findFirst({ where: { name: cleanName, ecosystem } })
    if (exists)
      throw new Error(`${cleanName} 依赖已存在`)
    const item = await db.dependencyManage.$create({
      name: cleanName,
      ecosystem,
      remark: remark?.trim() ?? '',
      status: DepStatus.NOT_INSTALLED,
    })
    response.send(API_STATUS_CODE.okData(item))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 删除依赖记录，安装中 / 卸载中状态不允许删除
 */
api.delete('/', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['id', [true, 'number | number[]']],
      ] as const,
    })
    const { id } = params.body as { id: number | number[] }
    const ids = Array.isArray(id) ? id : [id]
    if (ids.some(v => v <= 0))
      throw new Error('参数 id 无效')

    const items = await db.dependencyManage.$list({ where: { id: { in: ids } } })
    for (const item of items) {
      if (item.status === DepStatus.INSTALLING || item.status === DepStatus.UNINSTALLING) {
        throw new Error(`依赖 ${item.name} 正在操作中，无法删除！`)
      }
    }
    await db.dependencyManage.$deleteById(ids)
    response.send(API_STATUS_CODE.ok())
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 安装 / 卸载 / 同步状态
 */
api.post('/operate', async (request, response) => {
  try {
    const params = validateRequestParams(request, {
      body: [
        ['action', [true, ['install', 'uninstall', 'sync']]],
        ['ids', [false, 'number[]']],
      ] as const,
    })
    const { action, ids } = params.body as { action: 'install' | 'uninstall' | 'sync', ids?: number[] }
    if (action === 'sync') {
      const result = await syncDeps()
      response.send(API_STATUS_CODE.okData(result))
      return
    }
    if (!ids || ids.length === 0)
      throw new Error('ids 不能为空')
    const items = await db.dependencyManage.$list({ where: { id: { in: ids } } })
    if (items.length === 0)
      throw new Error('未找到指定依赖')
    if (action === 'install') {
      const toInstall = items.filter(
        v => v.status === DepStatus.NOT_INSTALLED || v.status === DepStatus.FAILED,
      )
      if (toInstall.length === 0)
        throw new Error('所选依赖均无需安装')
      for (const v of toInstall) {
        if (PROTECTED[v.ecosystem]?.has(getBaseName(v.ecosystem, v.name)))
          throw new Error(`${v.name} 为平台保留依赖，禁止操作！`)
      }
      enqueueInstall(toInstall.map(v => ({ id: v.id, name: v.name, ecosystem: v.ecosystem })))
      response.send(API_STATUS_CODE.okData({ total: toInstall.length }))
    }
    else {
      // uninstall — 逐个入队
      const toUninstall = items.filter(v => (v.status === DepStatus.INSTALLED || v.status === DepStatus.FAILED) && !!v.installed_ver)
      if (toUninstall.length === 0)
        throw new Error('所选依赖均无需卸载')
      for (const v of toUninstall) {
        if (PROTECTED[v.ecosystem]?.has(getBaseName(v.ecosystem, v.name)))
          throw new Error(`${v.name} 为平台保留依赖，禁止操作！`)
      }
      enqueueUninstall(toUninstall.map(v => ({ id: v.id, name: v.name, ecosystem: v.ecosystem })))
      response.send(API_STATUS_CODE.okData({ total: toUninstall.length }))
    }
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

/**
 * 查询依赖的最近错误日志
 */
api.get('/error', async (request, response) => {
  try {
    validateRequestParams(request, {
      query: [['id', [true, 'string']]] as const,
    })
    const idStr = request.query.id as string
    if (!/^\d+$/.test(idStr))
      throw new Error('参数 id 无效')
    const id = Number.parseInt(idStr)
    const item = await db.dependencyManage.$getById(id)
    if (!item)
      throw new Error('依赖不存在')
    response.send(API_STATUS_CODE.okData({ id: item.id, last_error: item.last_error }))
  }
  catch (e: any) {
    response.send(API_STATUS_CODE.fail(e.message || e))
  }
})

export { api as API }
