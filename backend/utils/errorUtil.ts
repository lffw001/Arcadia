import {
  PrismaClientInitializationError,
  PrismaClientKnownRequestError,
  PrismaClientRustPanicError,
  PrismaClientUnknownRequestError,
  PrismaClientValidationError,
} from '@prisma/client/runtime/client'

// Prisma 已知错误码 → 面向用户的提示
const PRISMA_KNOWN_ERROR_MAP: Record<string, string> = {
  P2000: '数据库操作失败：字段值超出允许长度',
  P2001: '操作的目标记录不存在',
  P2002: '数据库操作失败：数据重复（唯一约束冲突）',
  P2003: '数据库操作失败：关联数据约束冲突',
  P2005: '数据库操作失败：字段值类型不正确',
  P2006: '数据库操作失败：字段值无效',
  P2007: '数据库操作失败：数据验证未通过',
  P2011: '数据库操作失败：必填字段不能为空',
  P2012: '数据库操作失败：缺少必填数据',
  P2014: '数据库操作失败：关联数据冲突',
  P2015: '操作的目标关联记录不存在',
  P2017: '操作的目标关联记录不存在',
  P2018: '数据库操作失败：缺少必要的关联数据',
  P2019: '数据库操作失败：输入值不正确',
  P2020: '数据库操作失败：数值超出允许范围',
  P2023: '数据库操作失败：数据格式不一致',
  P2024: '服务繁忙，请稍后重试',
  P2025: '操作的目标记录不存在或已被删除',
  P2028: '操作冲突，请稍后重试',
  P2033: '数据库操作失败：数值超出范围',
  P2034: '操作冲突，请稍后重试',
  P2035: '数据库操作失败：数据约束异常',
  P2037: '服务繁忙，请稍后重试',
}

const PRISMA_KNOWN_FALLBACK = '数据库操作异常，请稍后重试'
const PRISMA_INTERNAL_FALLBACK = '服务内部错误（数据库异常）'

// 这些码基本都是后端 bug，不向客户端暴露细节
const PRISMA_INTERNAL_CODES = new Set([
  'P2008',
  'P2009',
  'P2010',
  'P2013',
  'P2016',
  'P2021',
  'P2022',
  'P2026',
  'P2027',
  'P2030',
  'P2036',
])

// fs errno → 面向用户的提示
const FS_ERROR_MAP: Record<string, string> = {
  ENOENT: '文件或目录不存在',
  EEXIST: '目标文件或目录已存在',
  EACCES: '文件操作被拒绝（权限不足）',
  EPERM: '文件操作被拒绝（操作不允许）',
  EISDIR: '目标是一个目录，无法作为文件操作',
  ENOTDIR: '目标不是一个目录',
  ENOTEMPTY: '目录不为空，无法删除',
  EMFILE: '服务繁忙（文件句柄耗尽），请稍后重试',
  ENFILE: '服务繁忙（文件句柄耗尽），请稍后重试',
  ENOSPC: '存储空间不足，操作无法完成',
  EROFS: '文件系统为只读，无法写入',
  EBUSY: '文件或目录正被占用，请稍后重试',
  EINVAL: '文件操作参数无效',
  EIO: '文件读写异常（I/O 错误）',
  ELOOP: '路径存在符号链接循环',
  ENAMETOOLONG: '文件或目录名称过长',
  EPIPE: '文件传输中断',
  EBADF: '服务内部错误（文件句柄异常）',
}

const FS_FALLBACK = '文件操作异常，请稍后重试'
const UNKNOWN_ERROR_MESSAGE = '服务器内部错误'

export type OpenApiErrorKind = 'prisma-known' | 'prisma' | 'fs' | 'business' | 'unknown'

export interface ResolvedErrorMessage {
  message: string
  kind: OpenApiErrorKind
  code?: string
  name?: string
  syscall?: string
}

// fs 错误通常是 Error 附带 code/syscall；部分场景只有 code，这里宽松判断
export function isFsError(err: any): err is Error & { code: string, syscall?: string } {
  return (
    typeof err?.code === 'string'
    && /^[A-Z][A-Z0-9]{1,15}$/.test(err.code)
    && (typeof err.syscall === 'string' || err.code in FS_ERROR_MAP)
  )
}

/**
 * fs 原生错误 → 面向用户的中文提示
 */
export function getFsErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code
  return (typeof code === 'string' && FS_ERROR_MAP[code]) || FS_FALLBACK
}

/**
 * 解析错误为可返回给客户端的消息，并附上分类信息供日志使用
 */
export function resolveErrorMessage(error: unknown): ResolvedErrorMessage {
  if (error instanceof PrismaClientKnownRequestError) {
    return {
      kind: 'prisma-known',
      code: error.code,
      message: PRISMA_INTERNAL_CODES.has(error.code)
        ? PRISMA_INTERNAL_FALLBACK
        : (PRISMA_KNOWN_ERROR_MAP[error.code] ?? PRISMA_KNOWN_FALLBACK),
    }
  }

  if (
    error instanceof PrismaClientUnknownRequestError
    || error instanceof PrismaClientValidationError
    || error instanceof PrismaClientInitializationError
    || error instanceof PrismaClientRustPanicError
  ) {
    return {
      kind: 'prisma',
      name: error.name,
      message: error instanceof PrismaClientInitializationError
        ? '数据库连接异常，请稍后重试'
        : PRISMA_INTERNAL_FALLBACK,
    }
  }

  if (error instanceof Error && isFsError(error)) {
    return {
      kind: 'fs',
      code: error.code,
      syscall: error.syscall,
      message: FS_ERROR_MAP[error.code] ?? FS_FALLBACK,
    }
  }

  if (error instanceof Error) {
    // 业务主动 throw 的消息是开发者手写的，直接透传
    return { kind: 'business', message: error.message }
  }

  return { kind: 'unknown', message: UNKNOWN_ERROR_MESSAGE }
}
