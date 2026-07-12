# Arcadia 消息推送 SDK

零外部依赖的多语言 SDK，**仅用于推送消息**。

通过后端内部接口（Inner API）直连，不走 OpenAPI，无需 API Token。Inner API 使用 IP 白名单认证，仅允许本地（127.0.0.1）调用。

## 通信方式

| 方式 | 端点 | 认证 | 适用场景 |
|------|------|------|----------|
| **SDK（本库）** | `POST /api/inner/message/push` | IP 白名单（本地） | 服务器端脚本、定时任务、CI/CD 等本地场景 |
| **OpenAPI** | `POST /api/open/message/v1/create` | api-token | 远程调用、需要完整消息管理功能的场景 |

> 如需查询、标记已读、删除等完整消息管理功能，请使用 OpenAPI 方式，参见 [Arcadia 文档站](https://docs.arcadia.dev)。

## 依赖要求

| 语言 | 最低版本 | 说明 |
|------|----------|------|
| Node.js | 18+ | 使用原生 `fetch`，同时支持 CJS 和 ESM |
| Python | 3.7+ | 仅使用标准库 `urllib.request`，无需安装第三方包 |

## 导入

项目运行在容器中，SDK 位于 `/arcadia/src/utils/message-sdk/` 目录下，以目录路径直接导入。

### Node.js（ESM，推荐）

```javascript
import { push } from '/arcadia/src/utils/message-sdk'
```

### Node.js（CommonJS）

```javascript
const { push } = require('/arcadia/src/utils/message-sdk')
```

### Python

```python
from message_sdk import push
```

## 脚本使用示例

以下示例均为可直接复制运行的完整脚本，适用于容器内的定时任务、自定义脚本等场景。

### 定时任务执行后推送结果（Node.js CJS，推荐用于脚本）

大多数脚本以 `.js` 或 `.cjs` 文件运行，使用 `require` 加载 SDK：

```javascript
// backup-notify.js — 备份完成后推送通知
const { execSync } = require('child_process')
const { push } = require('/arcadia/src/utils/message-sdk')

;(async () => {
  try {
    execSync('tar czf /backup/db-$(date +%Y%m%d).tar.gz /data/db', { stdio: 'inherit' })
    await push('备份完成', '数据库备份已成功完成', 'success')
    console.log('备份及通知完成')
  } catch (e) {
    await push('备份失败', `数据库备份执行异常：${e.message}`, 'error')
    console.error('备份失败，已发送通知')
  }
})()
```

运行方式：`node backup-notify.js`

### 版本更新后推送通知（Node.js CJS）

```javascript
// version-notify.js — 版本更新后推送通知
const { push } = require('/arcadia/src/utils/message-sdk')
const newVersion = process.env.NEW_VERSION || 'v2.1.0'

;(async () => {
  await push('版本更新', `${newVersion} 已发布，请查看更新日志`, 'success')
})()
```

运行方式：`node version-notify.js` 或 `NEW_VERSION=v3.0.0 node version-notify.js`

### 监控告警脚本（Node.js CJS）

```javascript
// monitor.js — 检查服务状态并推送告警
const { push } = require('/arcadia/src/utils/message-sdk')
const { execSync } = require('child_process')

;(async () => {
  try {
    const uptime = execSync('uptime -s').toString().trim()
    const loadAvg = execSync("cat /proc/loadavg | awk '{print $1}'").toString().trim()
    const loadNum = parseFloat(loadAvg)

    if (loadNum > 4.0) {
      await push('服务器告警', `系统负载过高：${loadAvg}（启动时间：${uptime}）`, 'warn')
    }
  } catch (e) {
    await push('监控异常', `健康检查执行失败：${e.message}`, 'error')
  }
})()
```

运行方式：`node monitor.js`

### 使用 ESM 方式（Node.js ESM）

如果你的脚本使用 `.mjs` 扩展名，或所在项目的 `package.json` 声明了 `"type": "module"`，可以直接使用 top-level `await`：

```javascript
// deploy-notify.mjs — 部署完成后推送通知
import { push } from '/arcadia/src/utils/message-sdk'

try {
  // 你的业务逻辑...
  await push('部署完成', '前端应用已成功部署到生产环境', 'success')
} catch (e) {
  await push('部署失败', `部署过程出现异常：${e.message}`, 'error')
}
```

运行方式：`node deploy-notify.mjs`

### Python 脚本示例

```python
#!/usr/bin/env python3
# sync_notify.py — 同步任务完成后推送通知
import subprocess
from message_sdk import push

try:
    subprocess.run(['rsync', '-avz', '/data/', '/backup/'], check=True)
    push('同步完成', '数据同步已成功完成', type='success')
except subprocess.CalledProcessError as e:
    push('同步失败', f'数据同步执行异常：{e}', type='error')
```

运行方式：`python3 sync_notify.py`

## Node.js 24+ 注意事项

Node.js 24+ 不允许在同一文件中同时使用 `require()`（CJS 语法）和 top-level `await`（ESM 语法）。如果你在 `.js` 文件中写了 `require()` 又在顶层写 `await`，会抛出以下错误：

```
ReferenceError: Cannot determine intended module format because both 'require' and top-level await are present.
```

**解决方案（二选一）**：

1. **CJS + IIFE**（推荐用于普通脚本）：用 `;(async () => { await push(...) })()` 包裹异步调用，参见上方脚本示例
2. **ESM 方式**：将文件改为 `.mjs` 扩展名，或在项目 `package.json` 中声明 `"type": "module"`，即可使用 top-level `await`

## API 参考

### `push(title, content, type?)`

推送一条消息到消息中心。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 消息标题 |
| `content` | string | 是 | 消息内容 |
| `type` | string | 否 | 消息类型：`info`（默认）/ `warn` / `error` / `success` |

**返回值：** 推送成功返回 `true`（布尔值），推送失败直接抛出 Error（包含具体错误信息）。

> 后端响应包含 `count` 字段（Inner API 返回实际推送的 WebSocket 连接数，OpenAPI 固定为 1），SDK 已封装为布尔值，不暴露 count 给调用者。
