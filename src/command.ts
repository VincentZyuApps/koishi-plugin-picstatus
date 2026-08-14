import { Context, h } from 'koishi'
import { PROCESS_COUNT_MAX, PROCESS_COUNT_MIN, type Config } from './config'
import { FontError, FontManager } from './font'
import { CollectorHub } from './collectors'
import { BotCollector } from './collectors/bot'
import { BackgroundManager } from './background'
import { renderStatus } from './render'

export interface PicStatusOptions {
  sort?: string
  count?: number
  theme?: string
}

interface ResolvedOptions {
  config: Config
  recollectProcesses: boolean
}

export class OptionError extends Error {
  readonly name = 'OptionError'
}

export function resolveOptions(config: Config, options: PicStatusOptions): ResolvedOptions {
  const resolved = { ...config }
  const recollectProcesses = options.sort !== undefined || options.count !== undefined

  if (options.sort !== undefined) {
    const sort = String(options.sort).trim().toLowerCase()
    if (sort !== 'cpu' && sort !== 'memory') {
      throw new OptionError(`进程排序方式“${options.sort}”无效，请使用 cpu 或 memory。`)
    }
    resolved.processSort = sort
  }

  if (options.count !== undefined) {
    if (!Number.isInteger(options.count) || options.count < PROCESS_COUNT_MIN || options.count > PROCESS_COUNT_MAX) {
      throw new OptionError(`进程显示数量“${options.count}”无效，请填写 ${PROCESS_COUNT_MIN}-${PROCESS_COUNT_MAX} 范围内的整数。`)
    }
    resolved.processCount = options.count
  }

  if (options.theme !== undefined) {
    const theme = String(options.theme).trim().toLowerCase()
    if (theme !== 'light' && theme !== 'dark') {
      throw new OptionError(`图片主题“${options.theme}”无效，请使用 light 或 dark。`)
    }
    resolved.theme = theme
  }

  return { config: resolved, recollectProcesses }
}

export function registerCommand(
  ctx: Context,
  config: Config,
  collectors: CollectorHub,
  bots: BotCollector,
  backgrounds: BackgroundManager,
  fonts: FontManager,
): void {
  const command = ctx.command(config.command, '以图片显示当前设备与 Koishi 的运行状态', {
    authority: config.authority,
  })
    .option('sort', '-s, --sort <sort:string> 进程排序方式：cpu 或 memory')
    .option('count', `-n, --count <count:number> 进程显示数量：${PROCESS_COUNT_MIN}-${PROCESS_COUNT_MAX}`)
    .option('theme', '-t, --theme <theme:string> 图片主题：light 或 dark')
  for (const alias of new Set(config.aliases.map((item) => item.trim()).filter(Boolean))) {
    if (alias === config.command) continue
    try {
      command.alias(alias)
    } catch (error) {
      ctx.logger('picstatus').warn(`跳过冲突的指令别名“${alias}”: ${error instanceof Error ? error.message : error}`)
    }
  }

  command.action(async ({ session, options }) => {
    if (!session) return
    let request
    try {
      request = resolveOptions(config, options)
    } catch (error) {
      if (error instanceof OptionError) {
        return `${config.reply && session.messageId ? h.quote(session.messageId) : ''}⚠️ ${error.message}`
      }
      throw error
    }
    let waitingHintId: string | undefined
    if (config.enableWaitingHint) {
      try {
        const messageIds = await session.send(`${config.reply && session.messageId ? h.quote(session.messageId) : ''}📊 正在采集并渲染状态图片，请稍候... ⏳`)
        waitingHintId = messageIds[0]
      } catch (error) {
        ctx.logger('picstatus').warn(`发送等待提示失败，继续采集状态：${error instanceof Error ? error.message : error}`)
      }
    }
    try {
      const [background, botStatus] = await Promise.all([backgrounds.get(session), bots.collect(session)])
      const processOverrides = request.recollectProcesses
        ? { processSort: request.config.processSort, processCount: request.config.processCount }
        : undefined
      const snapshot = await collectors.collect(botStatus, processOverrides)
      const image = await renderStatus(ctx, snapshot, background, request.config, fonts)
      const elements = [h.image(image, `image/${request.config.imageType}`)]
      if (request.config.reply && session.messageId) elements.unshift(h.quote(session.messageId))
      await session.send(elements)
      if (waitingHintId) {
        try {
          await session.bot.deleteMessage(session.channelId, waitingHintId)
        } catch (error) {
          ctx.logger('picstatus').warn(`撤回等待提示失败：${error instanceof Error ? error.message : error}`)
        }
      }
    } catch (error) {
      ctx.logger('picstatus').error(error)
      if (error instanceof FontError) {
        return `${config.reply && session.messageId ? h.quote(session.messageId) : ''}状态图字体准备失败，请检查字体模式、字体路径或后台下载日志。`
      }
      return `${config.reply && session.messageId ? h.quote(session.messageId) : ''}获取运行状态图片失败，请检查后台日志。`
    }
  })
}
