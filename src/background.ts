import fs from 'node:fs/promises'
import path from 'node:path'
import { Context, h, type Session } from 'koishi'
import type { Config } from './config'
import type { BackgroundData } from './types'
import { fetchImage } from './utils/image'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
}
const MAX_IMAGE_SIZE = 15 * 1024 * 1024

class BackgroundPreloader {
  private queue: BackgroundData[] = []
  private loading: Promise<void> | null = null

  constructor(private ctx: Context, private count: number, private load: () => Promise<BackgroundData>) {
    ctx.on('dispose', () => { this.queue.length = 0 })
  }

  start(): void {
    if (!this.count || this.loading) return
    this.loading = this.fill().finally(() => { this.loading = null })
  }

  private async fill(): Promise<void> {
    while (this.queue.length < this.count) {
      try {
        this.queue.push(await this.load())
      } catch (error) {
        this.ctx.logger('picstatus').warn(`背景预加载失败: ${error instanceof Error ? error.message : error}`)
        return
      }
    }
  }

  async get(): Promise<BackgroundData> {
    const cached = this.queue.shift()
    this.start()
    return cached || this.load()
  }
}

function resolveLocal(baseDir: string, input: string): string {
  return path.isAbsolute(input) ? path.normalize(input) : path.resolve(baseDir, input)
}

async function localBackground(baseDir: string, input: string): Promise<BackgroundData> {
  const target = resolveLocal(baseDir, input)
  const stat = await fs.stat(target)
  let file = target
  if (stat.isDirectory()) {
    const entries = await fs.readdir(target, { withFileTypes: true })
    const files = entries.filter((entry) => entry.isFile() && MIME[path.extname(entry.name).toLowerCase()])
    if (!files.length) throw new Error('背景目录中没有受支持的图片')
    file = path.join(target, files[Math.floor(Math.random() * files.length)].name)
  }
  const mime = MIME[path.extname(file).toLowerCase()]
  if (!mime) throw new Error('不支持的本地背景格式')
  const fileStat = await fs.stat(file)
  if (fileStat.size > MAX_IMAGE_SIZE) throw new Error('本地背景超过 15 MiB 限制')
  return { data: await fs.readFile(file), mime, source: file }
}

async function configuredBackground(ctx: Context, config: Config): Promise<BackgroundData> {
  if (config.backgroundMode === 'none') return { data: null, mime: 'application/octet-stream', source: 'none' }
  if (config.backgroundMode === 'local') return localBackground(ctx.baseDir, config.backgroundPath)
  if (config.backgroundMode === 'url') {
    if (!config.backgroundUrl) throw new Error('未配置背景 URL')
    const image = await fetchImage(ctx, config.backgroundUrl, config.requestTimeout * 1000)
    return { ...image, source: config.backgroundUrl }
  }
  return { data: null, mime: 'application/octet-stream', source: 'builtin' }
}

export class BackgroundManager {
  private preloader: BackgroundPreloader

  constructor(private ctx: Context, private config: Config) {
    this.preloader = new BackgroundPreloader(ctx, config.preloadCount, () => this.loadConfigured())
    if (config.backgroundMode !== 'none') this.preloader.start()
  }

  private async loadConfigured(): Promise<BackgroundData> {
    try {
      return await configuredBackground(this.ctx, this.config)
    } catch (error) {
      this.ctx.logger('picstatus').warn(`配置背景加载失败，使用内置渐变背景: ${error instanceof Error ? error.message : error}`)
      return { data: null, mime: 'application/octet-stream', source: 'builtin' }
    }
  }

  private imageSource(session: Session): string | undefined {
    const current = h.select(session.elements || [], 'img, image')[0]
    const quoted = h.select(session.quote?.elements || [], 'img, image')[0]
    const element = current || quoted
    return element?.attrs?.src || element?.attrs?.url
  }

  async get(session: Session): Promise<BackgroundData> {
    const source = this.imageSource(session)
    if (source) {
      try {
        const image = await fetchImage(this.ctx, source, this.config.requestTimeout * 1000)
        return { ...image, source: 'message' }
      } catch (error) {
        this.ctx.logger('picstatus').warn(`消息背景加载失败，回退到配置背景: ${error instanceof Error ? error.message : error}`)
      }
    }
    return this.preloader.get()
  }
}
