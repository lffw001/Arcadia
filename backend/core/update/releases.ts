import { request } from '../../utils/httpUtil'
import { updateConstants } from './constants'

/**
 * GitHub Release 元数据（仅取用到的字段）
 */
export interface GithubRelease {
  tag_name: string
  draft: boolean
  prerelease: boolean
  published_at: string | null
  body: string | null
}

/**
 * 获取最新正式 Release
 *
 * @description 过滤草稿与预发布，按发布时间倒序取第一条
 */
export async function fetchLatestRelease(): Promise<GithubRelease | null> {
  const res = await request({
    method: 'GET',
    url: `${updateConstants.GITHUB_API_BASE}/releases`,
    params: { per_page: 100 },
    headers: { Accept: 'application/vnd.github+json' },
    timeout: updateConstants.GITHUB_API_TIMEOUT_MS,
  })
  if (!res.success || !Array.isArray(res.data))
    throw new Error(res.error || 'GitHub Releases API 请求失败')
  const releases = (res.data as GithubRelease[])
    .filter(r => !r.draft && !r.prerelease)
    .sort((a, b) => new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime())
  return releases[0] ?? null
}
