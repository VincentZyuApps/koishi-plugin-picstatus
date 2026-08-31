import type { Bot, Context, Session } from 'koishi'
import FileType from 'file-type'
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

type AvatarDiagnostic = (message: string) => void

function safeMime(file: ImageFileResponse): string {
  return (file.mime || file.type || 'unknown')
    .split(';')[0]
    .replace(/[^\w.+/-]/g, '')
    .slice(0, 80) || 'unknown'
}

function safeErrorSummary(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError'
  if (/^(响应不是图片: [\w.+/-]+|图片内容为空|图片超过 \d+ MiB 限制)$/.test(error.message)) return error.message
  const name = /^[\w.-]{1,64}$/.test(error.name) ? error.name : 'Error'
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && /^[\w.-]{1,64}$/.test(code) ? `${name} code=${code}` : name
}

function telegramFileUrl(endpoint: string, filePath: string): string {
  const url = new URL(endpoint)
  const basePath = url.pathname.replace(/\/+$/, '')
  const encodedPath = filePath.split('/').map(encodeURIComponent).join('/')
  url.pathname = `${basePath}/${encodedPath}`
  url.search = ''
  url.hash = ''
  return url.href
}

async function validateTelegramImageFile(file: ImageFileResponse, diagnostic?: AvatarDiagnostic) {
  if (safeMime(file) !== 'application/octet-stream') return validateImageFile(file)
  let detected: string | undefined
  try {
    detected = (await FileType.fromBuffer(file.data))?.mime
  } catch {}
  diagnostic?.(`Telegram 头像类型嗅探: detected=${detected?.startsWith('image/') ? detected : 'unknown'}`)
  if (!detected?.startsWith('image/')) return validateImageFile(file)
  return validateImageFile({ ...file, type: detected, mime: detected })
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

async function fetchTelegramAvatar(
  bot: TelegramAvatarBot,
  filePath: string,
  timeout: number,
  diagnostic?: AvatarDiagnostic,
) {
  const endpoint = bot.file?.config?.endpoint
  if (!bot.local && endpoint && bot.file?.file) {
    diagnostic?.('Telegram 原生头像请求开始: transport=file-client')
    const file = await bot.file.file(telegramFileUrl(endpoint, filePath), { timeout })
    diagnostic?.(`Telegram 原生头像响应: transport=file-client mime=${safeMime(file)} bytes=${file.data.byteLength}`)
    return validateTelegramImageFile(file, diagnostic)
  }
  if (bot.$getFile) {
    diagnostic?.(`Telegram 原生头像请求开始: transport=adapter-reader local=${Boolean(bot.local)}`)
    const file = await bot.$getFile(filePath)
    diagnostic?.(`Telegram 原生头像响应: transport=adapter-reader mime=${safeMime(file)} bytes=${file.data.byteLength}`)
    return validateTelegramImageFile(file, diagnostic)
  }
}

export async function fetchBotAvatar(
  ctx: Context,
  bot: Bot,
  source: string,
  timeout: number,
  diagnostic?: AvatarDiagnostic,
) {
  const telegramBot = bot as Bot & TelegramAvatarBot
  const filePath = resolveTelegramAvatarPath(telegramBot, source)
  const telegram = telegramBot.platform === 'telegram' || telegramBot.adapterName === 'telegram'
  diagnostic?.(`头像来源已解析: telegram=${telegram} nativePath=${Boolean(filePath)} dataUrl=${source.startsWith('data:')}`)
  if (filePath) {
    try {
      const image = await fetchTelegramAvatar(telegramBot, filePath, timeout, diagnostic)
      if (image) return image
      diagnostic?.('Telegram 原生头像客户端不可用，转用通用 HTTP')
    } catch (error) {
      diagnostic?.(`Telegram 原生头像失败: ${safeErrorSummary(error)}，转用通用 HTTP`)
    }
  }
  diagnostic?.('通用头像请求开始')
  try {
    const image = await fetchImage(ctx, source, timeout)
    diagnostic?.(`通用头像请求成功: mime=${image.mime} bytes=${image.data.byteLength}`)
    return image
  } catch (error) {
    diagnostic?.(`通用头像请求失败: ${safeErrorSummary(error)}`)
    throw error
  }
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
  private logger: ReturnType<Context['logger']>

  constructor(private ctx: Context, private config: Config, private counter: MessageCounter) {
    this.logger = ctx.logger('picstatus')
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

  private diagnostic(bot: Bot, message: string): void {
    if (this.config.debug) this.logger.info(`[debug] Bot ${bot.sid}: ${message}`)
  }

  private async one(bot: Bot): Promise<BotMetric> {
    let login = bot.toJSON()
    try {
      login = await bot.getLogin()
      this.diagnostic(bot, `getLogin 成功: avatar=${Boolean(login.user?.avatar)}`)
    } catch (error) {
      this.diagnostic(bot, `getLogin 失败: ${safeErrorSummary(error)}，使用缓存登录信息`)
    }
    const counter = await this.counter.get(bot)
    const connectedAt = this.connected.get(bot.sid)
    const avatarUrl = login.user?.avatar || bot.user?.avatar
    let avatar: string | undefined
    if (avatarUrl) {
      try {
        const image = await fetchBotAvatar(
          this.ctx,
          bot,
          avatarUrl,
          this.config.requestTimeout * 1000,
          (message) => this.diagnostic(bot, message),
        )
        avatar = toDataUrl(image.data, image.mime)
        this.diagnostic(bot, `头像已转为 Data URL: mime=${image.mime} bytes=${image.data.byteLength}`)
      } catch {
        this.diagnostic(bot, '头像加载最终失败，已使用文字头像')
        this.logger.debug(`Bot ${bot.sid} 头像加载失败，已使用文字头像`)
      }
    } else {
      this.diagnostic(bot, '登录信息中没有头像地址，已使用文字头像')
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
