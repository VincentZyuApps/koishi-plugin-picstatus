import { Context } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import { Config as ConfigSchema, type Config as PluginConfig } from './config'
import { CollectorHub } from './collectors'
import { BotCollector, MessageCounter } from './collectors/bot'
import { BackgroundManager } from './background'
import { FontManager } from './font'
import { registerCommand } from './command'

export const name = 'picstatus'
export const inject = {
  required: ['puppeteer', 'http'],
  optional: ['database'],
}
export const reusable = true

export type Config = PluginConfig
export const Config = ConfigSchema

export const usage = `
<h2>PicStatus</h2>
<p>使用 <code>picstatus</code> 查看当前设备与 Koishi 的图片状态面板。</p>
<p>支持 Windows、Linux、macOS 与容器环境；Puppeteer 和 HTTP 服务为必需依赖。</p>
<p>字体支持 npm 内置、Release 下载、自定义绝对路径和系统默认字体四种模式。</p>
`

export function apply(ctx: Context, config: Config) {
  const counter = new MessageCounter(ctx, config)
  if (config.counterStorage === 'database') {
    ctx.inject(['database'], (databaseCtx) => counter.setupDatabase(databaseCtx))
  }
  const collectors = new CollectorHub(ctx, config)
  const bots = new BotCollector(ctx, config, counter)
  const backgrounds = new BackgroundManager(ctx, config)
  const fonts = new FontManager(ctx, config.fontMode, config.customFontPath)
  fonts.warmup()
  collectors.start()
  registerCommand(ctx, config, collectors, bots, backgrounds, fonts)
  ctx.logger(name).info('PicStatus 已启动')
}
