import { Prisma } from './generated/prisma/client'

export interface PageResult<T> { data: T, total?: number, page: number, size: number }

// https://github.com/prisma/prisma/blob/v7/packages/client/src/runtime/core/types/exported/Result.ts#L96
export interface BatchPayload { count: number } // GetBatchResult

export function clean(model: any, o: any): any {
  if (!o)
    return o

  // 获取当前模型的字段信息
  const validFields = model.fields ? Object.keys(model.fields) : []
  const specialFields = ['AND', 'OR', 'NOT']

  return Object.keys(o as any)
    .filter(key => specialFields.includes(key) || validFields.includes(key))
    .reduce((obj: any, key) => {
      obj[key] = (o as any)[key]
      return obj
    }, {})
}

export function cleanArgs(data: any, keys: string[]) {
  if (!data || typeof data !== 'object')
    return {}
  const res: any = {}
  const src = data as any
  for (const k of Object.keys(src)) {
    if (!keys.includes(k)) {
      res[k] = src[k]
    }
  }
  return res
}

export function cleanId(model: any, value: any, fieldName: string): string | number | undefined {
  if (value === undefined || value === null)
    return value
  const field = model.fields?.[fieldName]
  if (!field)
    return value
  switch (field.typeName) {
    case 'Int': {
      const num = Number(value)
      return Number.isNaN(num) ? undefined : num
    }
    case 'String':
      return String(value)
    default:
      return value
  }
}

export function withMyFunc() {
  return Prisma.defineExtension((client) => {
    return client.$extends({
      model: {
        $allModels: {

          $create<T, A extends Prisma.Args<T, 'create'> = Prisma.Args<T, 'create'>, D extends A['data'] | A['data'][] = A['data']>(
            this: T,
            data: D,
            opts?: Omit<A, 'data'>,
          ): Promise<D extends readonly any[] ? Prisma.Result<T, A, 'create'> | Prisma.Result<T, A, 'createMany'> : Prisma.Result<T, A, 'create'>> {
            if (typeof data !== 'string' && Array.isArray(data)) {
              if (data.length === 1) {
                data = data[0]
              }
              else {
                const args = opts ? { data, ...opts } : { data }
                return (this as any).createMany(args)
              }
            }
            const args = opts ? { data, ...opts } : { data }
            return (this as any).create(args)
          },

          $updateById<T, A extends Prisma.Args<T, 'update'> = Prisma.Args<T, 'update'>, R = Prisma.Result<T, A, 'update'>>(
            this: T,
            input: { id: number | string, data: A['data'] },
            idName: string = 'id',
            options: Partial<Omit<A, 'where' | 'data'>> = {},
          ): Promise<R> {
            const { id, data } = input

            const cleanedId = cleanId(this, id, idName)

            if (cleanedId === undefined || cleanedId === null || cleanedId === '') {
              throw new Error(`${idName} 不能为空`)
            }

            const cleanedData = clean(this, data)

            return (this as any).update({
              where: { [idName]: cleanedId },
              data: cleanedData,
              ...options,
            }) as Promise<R>
          },

          $upsertById<T, A extends Prisma.Args<T, 'upsert'> = Prisma.Args<T, 'upsert'>, R = Prisma.Result<T, A, 'upsert'>>(
            this: T,
            data: A['create'],
            idName: string = 'id',
            options?: A,
          ): Promise<R> {
            const idValue = (data as any)[idName]
            const cleanedId = cleanId(this, idValue, idName)

            const cleanedData = clean(this, data)
            // 没有id时一定为新增
            if (cleanedId === undefined || cleanedId === null || cleanedId === '') {
              return (this as any).create({
                data: cleanedData,
                ...cleanArgs(options, ['where', 'create', 'update']),
              })
            }
            // 存在id使用默认的upsert逻辑
            return (this as any).upsert({
              where: { [idName]: cleanedId },
              create: cleanedData,
              update: cleanedData,
              ...cleanArgs(options, ['where', 'create', 'update']),
            })
          },

          $list<T, A extends Prisma.Args<T, 'findMany'> = Prisma.Args<T, 'findMany'>, R = Prisma.Result<T, A, 'findMany'>>(
            this: T,
            query?: Omit<Prisma.Args<T, 'findMany'>, 'select' | 'include' | 'omit'>,
            options?: A,
          ): Promise<R> {
            return (this as any).findMany({
              ...cleanArgs(options, ['where', 'orderBy']),
              ...query,
              where: clean(this, query?.where),
            })
          },

          $getById<T, O extends Prisma.Args<T, 'findUnique'> | NonNullable<unknown> = NonNullable<unknown>, R = Prisma.Result<T, O, 'findUnique'> | null>(
            this: T,
            id: number | string,
            idName: string = 'id',
            options?: O,
          ): Promise<R> {
            const cleanedId = cleanId(this, id, idName)

            if (cleanedId === undefined || cleanedId === null || cleanedId === '') {
              return Promise.resolve(null) as Promise<R>
            }

            return (this as any).findUnique({
              where: { [idName]: cleanedId },
              ...(cleanArgs(options, ['where'])),
            }) as Promise<R>
          },

          $deleteById<T, DA extends Prisma.Args<T, 'delete'> = Prisma.Args<T, 'delete'>, I extends number | string | (number | string)[] = number | string>(
            this: T,
            id: I,
            idName: string = 'id',
            options: Partial<Omit<DA, 'where'>> = {},
          ): Promise<I extends readonly any[] ? Prisma.Result<T, DA, 'deleteMany'> : Prisma.Result<T, DA, 'delete'>> {
            if (typeof id !== 'string' && Array.isArray(id)) {
              if (id.length === 0) {
                throw new Error(`${idName} 数组不能为空`)
              }

              return (this as any).deleteMany({
                where: {
                  [idName]: {
                    in: id.map(item => cleanId(this, item, idName)),
                  },
                },
                ...options,
              })
            }

            const cleanedId = cleanId(this, id, idName)

            if (cleanedId === undefined || cleanedId === null || cleanedId === '') {
              throw new Error(`${idName} 不能为空`)
            }

            return (this as any).delete({
              where: { [idName]: cleanedId },
              ...options,
            })
          },

          async $page<T, A extends Prisma.Args<T, 'findMany'> = Prisma.Args<T, 'findMany'>, D = Prisma.Result<T, A, 'findMany'>>(
            this: T,
            args: A & { page?: number | string, size?: number | string, searchCount?: boolean },
          ): Promise<PageResult<D>> {
            const size = Number(args.size || 20)
            const page = Number(args.page || 1)
            if (!Number.isSafeInteger(size) || size < 1) {
              throw new Error('size 必须大于0且为整数')
            }
            if (!Number.isSafeInteger(page) || page < 1) {
              throw new Error('page 必须大于0且为整数')
            }
            // 清理查询条件
            const cleanedWhere = clean(this, args.where)
            // 剔除无关参数
            const { page: _page, size: _size, searchCount, ...restArgs } = cleanArgs(args, ['where'])
            // 获取数据和总数
            const p = [
              (this as any).findMany({
                ...restArgs,
                where: cleanedWhere,
                skip: (page - 1) * size,
                take: size,
              }),
            ]
            if (args.searchCount !== false) {
              p.push((this as any).count({ where: cleanedWhere }))
            }
            const res = await Promise.all(p)
            return {
              data: res[0],
              total: res.length > 1 ? res[1] : -1,
              page,
              size,
            }
          },
        },
      },
    })
  })
}
