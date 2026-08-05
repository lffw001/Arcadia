import { createServer } from 'node:http'
import { initAppFileSystem } from './core/file'
import { initCronJob } from './core/cron'
import { initDaemonTask } from './core/daemon'
import { initSocketServer } from './server/socket'
import { socketCommon } from './server/socketCommon'
import { createApiAuthentication, registerApp } from './server/httpServer'
import { initConfig } from './core/config'
import { restoreUpgradeState } from './core/update'
import { initTokenCache as initOpenApiAccessKeyCache } from './api/openapi/openApiCore'
import { initLog } from './core/log'
import { initTerminalServer } from './server/terminal'
import { initDaemonLogServer } from './server/daemonLog'
import { initDepManagerSystem } from './core/dep'

async function startServer() {
  // 初始化操作日志持久化
  initLog()

  // 初始化文件系统
  initAppFileSystem()

  // 初始化 OpenAPI 访问令牌缓存
  await initOpenApiAccessKeyCache()

  // 初始化用户配置数据
  await initConfig()

  // 初始化定时任务系统
  await initCronJob()

  // 初始化守护（进程）任务
  await initDaemonTask()

  // 初始化依赖管理系统
  initDepManagerSystem()

  // 创建 API 认证中间件
  const apiAuthentication = createApiAuthentication()

  // 注册应用服务
  const app = registerApp(apiAuthentication)
  const server = createServer(app)
  const io = initSocketServer(server)
  socketCommon.setSocket(io)

  // 初始化终端命名空间
  await initTerminalServer(io)

  // 初始化守护任务日志实时推送命名空间
  initDaemonLogServer(io)

  // 恢复未完成的更新状态
  await restoreUpgradeState()

  // 启动服务
  server.listen(5678, '0.0.0.0', async () => {
    console.log('Arcadia server is running on port 5678')
  })
}

startServer()
