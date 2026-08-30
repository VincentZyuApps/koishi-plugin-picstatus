import type { Bot, Context, Session } from 'koishi'
import type { BotMetric, MetricResult } from '../types'
import type { Config } from '../config'
import type { ImageFileResponse } from '../utils/image'
import { fetchImage, toDataUrl, validateImageFile } from '../utils/image'

interface TelegramAvatarBot {
  platform?: string
  adapterName?: string
  server?: string
  local?: boolean
  file?: {
    config?: { endpoint?: string }
    file?: (source: string, options?: { timeout?: number }) => Promise<ImageFileResponse>
  }
  $getFile?: (filePath: string) => Promise<ImageFileResponse>
}

function pathAfterUrlPrefix(source: string, prefix: string): string | undefined {
  try {
    const sourceUrl = new URL(source)
    const prefixUrl = new URL(prefix)
    if (sourceUrl.origin !== prefixUrl.origin) return
    const basePath = prefixUrl.pathname.replace(/\/+$/, '')
    if (!sourceUrl.pathname.startsWith(`${basePath}/`)) return
    const filePath = sourceUrl.pathname.slice(basePath.length + 1)
    if (!filePath) return
    try {
      return decodeURIComponent(filePath)
    } catch {
      return filePath
    }
  } catch {
    return
  }
}

export function resolveTelegramAvatarPath(bot: TelegramAvatarBot, source: string): string | undefined {
  if (bot.platform !== 'telegram' && bot.adapterName !== 'telegram') return
  const prefixes = [bot.server, bot.file?.config?.endpoint]
  for (const prefix of prefixes) {
    if (!prefix) continue
    const filePath = pathAfterUrlPrefix(source, prefix)
    if (filePath) return filePath
  }
}

async function fetchTelegramAvatar(bot: TelegramAvatarBot, filePath: string, timeout: number) {
  if (!bot.local && bot.file?.file) {
    return validateImageFile(await bot.file.file(`/${filePath}`, { timeout }))
  }
  if (bot.$getFile) return validateImageFile(await bot.$getFile(filePath))
}

export async function fetchBotAvatar(ctx: Context, bot: Bot, source: string, timeout: number) {
  const telegramBot = bot as Bot & TelegramAvatarBot
  const filePath = resolveTelegramAvatarPath(telegramBot, source)
  if (filePath) {
    try {
      const image = await fetchTelegramAvatar(telegramBot, filePath, timeout)
      if (image) return image
    } catch {}
  }
  return fetchImage(ctx, source, timeout)
}

export interface CounterValue {
  received: number
  sent: number
}

interface CounterRecord extends CounterValue {
  id: string
  updatedAt: Date
}

declare module 'koishi' {
  interface Tables {
    picstatus_counter: CounterRecord
  }
}

export class MessageCounter {
  private values = new Map<string, CounterValue>()
  private databaseCtx: Context | null = null
  private writes = new Map<string, Promise<void>>()

  constructor(private ctx: Context, private config: Config) {
    ctx.middleware(async (session, next) => {
      await this.add(this.key(session), 'received')
      return next()
    }, true)
    ctx.on('send', async (session) => {
      await this.add(this.key(session), 'sent')
    })
    ctx.on('bot-disconnect', async (bot) => {
      if (!config.resetCounterOnDisconnect || config.counterStorage === 'database') return
      this.values.delete(this.key(bot))
    })
  }

  setupDatabase(ctx: Context): void {
    this.databaseCtx = ctx
    ctx.model.extend('picstatus_counter', {
      id: 'string', received: 'unsigned', sent: 'unsigned', updatedAt: 'timestamp',
    }, { primary: 'id' })
    ctx.on('dispose', () => {
      if (this.databaseCtx === ctx) this.databaseCtx = null
    })
  }

  private key(value: Pick<Session, 'platform' | 'selfId'> | Pick<Bot, 'platform' | 'selfId'>): string {
    return `${value.platform || 'unknown'}:${value.selfId}`
  }

  private async add(id: string, field: keyof CounterValue): Promise<void> {
    const current = this.values.get(id) || { received: 0, sent: 0 }
    current[field]++
    this.values.set(id, current)
    if (this.config.counterStorage !== 'database' || !this.databaseCtx) return
    const previous = this.writes.get(id) || Promise.resolve()
    const task = previous.then(async () => {
      try {
        const database = this.databaseCtx?.database
        if (!database) return
        const [stored] = await database.get('picstatus_counter', { id })
        await database.upsert('picstatus_counter', [{
          id,
          received: field === 'received' ? (stored?.received || 0) + 1 : stored?.received || 0,
          sent: field === 'sent' ? (stored?.sent || 0) + 1 : stored?.sent || 0,
          updatedAt: new Date(),
        }])
      } catch (error) {
        this.ctx.logger('picstatus').warn(`消息计数写入数据库失败，继续使用内存计数: ${error instanceof Error ? error.message : error}`)
      }
    })
    this.writes.set(id, task)
    await task
    if (this.writes.get(id) === task) this.writes.delete(id)
  }

  async get(bot: Bot): Promise<CounterValue> {
    const id = this.key(bot)
    await this.writes.get(id)
    if (this.config.counterStorage === 'database' && this.databaseCtx) {
      try {
        const [stored] = await this.databaseCtx.database.get('picstatus_counter', { id })
        if (stored) return { received: stored.received, sent: stored.sent }
      } catch (error) {
        this.ctx.logger('picstatus').warn(`消息计数读取数据库失败，回退到内存: ${error instanceof Error ? error.message : error}`)
      }
    }
    return this.values.get(id) || { received: 0, sent: 0 }
  }
}

export class BotCollector {
  private connected = new Map<string, number>()

  constructor(private ctx: Context, private config: Config, private counter: MessageCounter) {
    for (const bot of ctx.bots) this.connected.set(bot.sid, Date.now())
    ctx.on('bot-connect', (bot) => { this.connected.set(bot.sid, Date.now()) })
    ctx.on('bot-disconnect', (bot) => { this.connected.delete(bot.sid) })
  }

  async collect(session: Session): Promise<MetricResult<BotMetric[]>> {
    try {
      const bots = this.config.showCurrentBot ? [session.bot] : Array.from(this.ctx.bots)
      const values = await Promise.all(bots.map((bot) => this.one(bot)))
      return { status: 'ok', value: values }
    } catch (error) {
      return { status: 'error', message: error instanceof Error ? error.message : String(error) }
    }
  }

  private async one(bot: Bot): Promise<BotMetric> {
    let login = bot.toJSON()
    try {
      login = await bot.getLogin()
    } catch {}
    const counter = await this.counter.get(bot)
    const connectedAt = this.connected.get(bot.sid)
    const avatarUrl = login.user?.avatar || bot.user?.avatar
    let avatar: string | undefined
    if (avatarUrl) {
      try {
        const image = await fetchBotAvatar(this.ctx, bot, avatarUrl, this.config.requestTimeout * 1000)
        avatar = toDataUrl(image.data, image.mime)
      } catch {
        this.ctx.logger('picstatus').debug(`Bot ${bot.sid} 头像加载失败，已使用文字头像`)
      }
    }
    return {
      key: bot.sid,
      platform: bot.platform || login.platform || bot.adapterName,
      selfId: bot.selfId,
      name: login.user?.nick || login.user?.name || bot.user?.nick || bot.user?.name || 'Bot',
      avatar,
      status: String(login.status),
      connected: connectedAt ? (Date.now() - connectedAt) / 1000 : null,
      received: counter.received,
      sent: counter.sent,
    }
  }
}
