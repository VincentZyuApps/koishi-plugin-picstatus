import type { Config } from '../config'
import type { BackgroundData } from '../types'
import { escapeHtml } from '../utils/format'
import { toDataUrl } from '../utils/image'
import type { ViewModel } from './view'
import { styles } from './styles'

const e = escapeHtml
const level = (percent: number | null) => percent != null && percent >= 90 ? 'high' : percent != null && percent >= 70 ? 'medium' : ''
const empty = '<div class="empty">暂无数据</div>'

function donut(item: ViewModel['cpu']): string {
  const percent = item.percent == null ? null : Math.round(item.percent)
  return `<div class="donut"><div class="ring ${level(percent)}" style="--p:${percent ?? 0}"><div class="ring-value">${percent == null ? '未部署' : `${percent}%`}</div></div><div class="donut-title">${e(item.title)}</div><div class="donut-caption">${e(item.caption)}</div></div>`
}

function header(view: ViewModel): string {
  const bots = view.bots.length ? view.bots.map((bot) => `<div class="account">${bot.avatar ? `<img class="avatar" src="${e(bot.avatar)}" alt="">` : `<div class="avatar avatar-fallback">${e(bot.name.slice(0, 1).toUpperCase())}</div>`}<div class="identity"><div class="nickname">${e(bot.name)}</div><div class="labels"><span class="label purple">${e(bot.platform)}</span><span class="label green">Bot已连接 ${e(bot.connected)}</span><span class="label blue">收 ${bot.received}</span><span class="label orange">发 ${bot.sent}</span></div></div></div>`).join('') : empty
  return `<section class="card split">${bots}<div class="extra"><span class="label">Koishi运行 ${e(view.koishiUptime)}</span><span class="label">系统运行 ${e(view.systemUptime)}</span></div></section>`
}

function disk(view: ViewModel): string {
  const usage = view.disks.length ? view.disks.map((item) => `<div class="disk-row"><div class="name">${e(item.name)}</div><div class="bar"><div class="bar-fill ${level(item.percent)}" style="width:${item.percent ?? 0}%"></div><div class="bar-text">${e(item.usage)}</div></div><div class="right">${item.percent == null ? '??.?%' : `${item.percent.toFixed(1)}%`}</div></div>`).join('') : empty
  const io = view.diskIo.length ? view.diskIo.map((item) => `<div class="io-row"><div class="name">${e(item.name)}</div><div>读</div><div class="right">${e(item.read)}</div><div>|</div><div>写</div><div class="right">${e(item.write)}</div></div>`).join('') : empty
  return `<section class="card split"><div class="grid disk-grid">${usage}</div><div class="grid">${io}</div></section>`
}

function network(view: ViewModel): string {
  const io = view.networks.length ? view.networks.map((item) => `<div class="io-row"><div class="name">${e(item.name)}</div><div>↑</div><div class="right">${e(item.sent)}</div><div>|</div><div>↓</div><div class="right">${e(item.received)}</div></div>`).join('') : empty
  const sites = view.sites.length ? view.sites.map((item) => `<div class="io-row"><div class="name">${e(item.name)}</div><div class="${item.error ? 'error' : ''}" style="grid-column:span 3">${e(item.result)}</div><div></div><div class="right">${e(item.delay)}</div></div>`).join('') : empty
  return `<section class="card split"><div class="grid">${io}</div><div class="grid">${sites}</div></section>`
}

function processes(view: ViewModel): string {
  const rows = view.processes.length ? view.processes.map((item) => `<div class="io-row"><div class="name">${e(item.name)}</div><div>CPU</div><div class="right">${e(item.cpu)}</div><div>|</div><div>MEM</div><div class="right">${e(item.memory)}</div></div>`).join('') : empty
  return `<section class="card"><div class="grid">${rows}</div></section>`
}

export function buildHtml(view: ViewModel, background: BackgroundData, config: Config, fontCss = ''): string {
  const map: Record<string, () => string> = {
    header: () => header(view), cpu: () => `<section class="card donuts">${donut(view.cpu)}${donut(view.memory)}${donut(view.swap)}</section>`,
    disk: () => disk(view), network: () => network(view), process: () => processes(view),
    footer: () => `<footer class="footer">npm/github: koishi-plugin-picstatus | ${e(view.generatedAt)}<br>${e(view.system)}${view.container ? ' | 容器资源' : ''}</footer>`,
  }
  const components = config.components.map((name) => map[name]?.() || '').join('')
  const backgroundUrl = toDataUrl(background.data, background.mime)
  const fallback = 'linear-gradient(135deg,#375b68 0%,#69786a 42%,#a36f5b 100%)'
  const backgroundStyle = backgroundUrl ? `url('${backgroundUrl}')` : fallback
  const classes = [`theme-${config.theme}`, config.disableBlur && 'no-blur', config.disableRadius && 'no-radius', config.disableShadow && 'no-shadow'].filter(Boolean).join(' ')
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${fontCss}\n${styles}</style></head><body><div class="canvas ${classes}" style="--canvas-width:${config.imageWidth}px;--background:${backgroundStyle}"><div class="mask"><main class="main">${components}</main></div></div></body></html>`
}
