import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, resolve } from 'node:path'
import type { Context } from 'koishi'
import type { FontMode } from './config'

export const FONT_FAMILY = 'PicStatusFont'
export const RELEASE_FONT_NAME = 'LXGWWenKaiMono-Regular.ttf'
export const FONT_SAMPLE = '运行状态 处理器 内存 磁盘 网络 Koishi 123'

const FONT_ORIGIN = 'https://picstatus-font.invalid'
const NPM_PACKAGE = 'lxgw-wenkai-screen-web'
const GITEE_URL = `https://gitee.com/vincent-zyu/koishi-plugin-awa-quote-image/releases/download/fonts/${RELEASE_FONT_NAME}`
const GITHUB_URL = `https://github.com/VincentZyuApps/koishi-plugin-awa-quote-image/releases/download/fonts/${RELEASE_FONT_NAME}`
const RELEASE_INTEGRITY = {
  size: 24755236,
  md5: '90e75a25cca0e8868977b880352c6a53',
  sha1: '7f018ad4a181e4d2df4f972f357e612885d6c24a',
  sha256: 'ee9faa6479c5b2434f9bceca8e2e7b643f699f4f3d067aac9609261e07c6be61',
  sha512: '793dc4357d311dba539c50b0ae38ff247af066f141ffea54ff0cc51e274453671e736989cee4998fd89211035ecfe52ad38aa828ba7f1739bcf107b94a023be5',
} as const

type FontErrorCode = 'configuration' | 'download' | 'integrity' | 'read' | 'write' | 'browser'

export class FontError extends Error {
  readonly name = 'FontError'

  constructor(readonly code: FontErrorCode, message: string, readonly cause?: unknown) {
    super(message)
  }
}

interface FontAsset {
  contentType: string
  load: () => Promise<Buffer>
}

export interface FontSource {
  family: string
  css: string
  assets: Map<string, FontAsset>
  mode: FontMode
}

interface FontRequest {
  url(): string
  continue(): Promise<unknown>
  respond(options: Record<string, unknown>): Promise<unknown>
  abort(errorCode?: string): Promise<unknown>
  isInterceptResolutionHandled?(): boolean
}

export interface FontPage {
  setRequestInterception(enabled: boolean): Promise<unknown>
  on(event: 'request', handler: (request: FontRequest) => void): unknown
  off?(event: 'request', handler: (request: FontRequest) => void): unknown
}

export interface FontInstallation {
  assertHealthy(): void
  dispose(): void
}

const releaseTasks = new Map<string, Promise<Buffer>>()

export function getReleaseFontPath(baseDir: string): string {
  return join(baseDir, 'data', 'fonts', RELEASE_FONT_NAME)
}

export class FontManager {
  private readonly logger: ReturnType<Context['logger']>
  private sourcePromise?: Promise<FontSource>

  constructor(
    private readonly ctx: Context,
    private readonly mode: FontMode,
    private readonly customFontPath: string,
  ) {
    this.logger = ctx.logger('picstatus')
  }

  warmup(): void {
    if (this.mode !== 'release') return
    void this.resolve().catch((error) => {
      this.logger.error('Release 字体准备失败：%s', formatError(error))
    })
  }

  resolve(): Promise<FontSource> {
    this.sourcePromise ??= this.load()
    return this.sourcePromise
  }

  private async load(): Promise<FontSource> {
    switch (this.mode) {
      case 'npm': return loadNpmFont()
      case 'release': return createFileFont('release', await prepareReleaseFont(this.ctx), '.ttf')
      case 'custom': return loadCustomFont(this.customFontPath)
      case 'system': return { family: FONT_FAMILY, css: '', assets: new Map(), mode: 'system' }
      default: throw new FontError('configuration', `不支持的字体模式：${String(this.mode)}`)
    }
  }
}

export async function installFont(page: FontPage, source: FontSource): Promise<FontInstallation> {
  if (!source.assets.size) return { assertHealthy() {}, dispose() {} }
  let failure: unknown
  const handler = (request: FontRequest) => {
    handleFontRequest(request, source).catch((error) => {
      failure ??= error
      if (!request.isInterceptResolutionHandled?.()) void request.abort('failed').catch(() => undefined)
    })
  }
  page.on('request', handler)
  try {
    await page.setRequestInterception(true)
  } catch (error) {
    page.off?.('request', handler)
    throw new FontError('browser', `无法启用 Puppeteer 字体请求拦截：${formatError(error)}`, error)
  }
  return {
    assertHealthy() {
      if (failure) throw failure
    },
    dispose() {
      page.off?.('request', handler)
    },
  }
}

export async function handleFontRequest(request: FontRequest, source: FontSource): Promise<boolean> {
  if (request.isInterceptResolutionHandled?.()) return false
  const asset = source.assets.get(request.url())
  if (!asset) {
    await request.continue()
    return false
  }
  const body = await asset.load()
  if (request.isInterceptResolutionHandled?.()) return false
  await request.respond({
    status: 200,
    contentType: asset.contentType,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body,
  })
  return true
}

export function rewriteNpmFontCss(css: string, fontRoot: string): { css: string, assets: Map<string, FontAsset> } {
  const assets = new Map<string, FontAsset>()
  let rewritten = css.replace(/\/\*[\s\S]*?\*\//g, '')
  rewritten = rewritten.replace(/local\((?:"[^"]*"|'[^']*'|[^)]*)\),?/gi, '')
  rewritten = rewritten.replace(/url\((['"]?)\.\/(\d+\.woff2)\1\)/gi, (_match, _quote, filename: string) => {
    const url = `${FONT_ORIGIN}/npm/${filename}`
    let cached: Promise<Buffer> | undefined
    assets.set(url, {
      contentType: 'font/woff2',
      load: () => cached ??= readFile(resolve(fontRoot, filename)),
    })
    return `url("${url}")`
  })
  rewritten = rewritten.replace(/font-family:\s*"LXGW WenKai Screen"/gi, `font-family:"${FONT_FAMILY}"`)
  if (/local\(/i.test(rewritten) || /url\((['"]?)\.\//i.test(rewritten)) {
    throw new FontError('read', 'npm 字体 CSS 中仍存在未解析的本地字体地址')
  }
  if (!assets.size) throw new FontError('read', 'npm 字体 CSS 中没有找到 WOFF2 切片')
  return { css: rewritten, assets }
}

function loadNpmFont(): Promise<FontSource> {
  return Promise.resolve().then(async () => {
    let packageRoot: string
    try {
      packageRoot = dirname(require.resolve(`${NPM_PACKAGE}/package.json`))
    } catch (error) {
      throw new FontError('read', `无法定位 npm 字体包 ${NPM_PACKAGE}`, error)
    }
    const fontRoot = resolve(packageRoot, 'lxgwwenkaiscreen')
    let css: string
    try {
      css = await readFile(resolve(fontRoot, 'result.css'), 'utf8')
    } catch (error) {
      throw new FontError('read', `无法读取 npm 字体 CSS：${formatError(error)}`, error)
    }
    const rewritten = rewriteNpmFontCss(css, fontRoot)
    return { family: FONT_FAMILY, css: rewritten.css, assets: rewritten.assets, mode: 'npm' }
  })
}

async function loadCustomFont(configuredPath: string): Promise<FontSource> {
  const fontPath = configuredPath.trim()
  if (!fontPath) throw new FontError('configuration', '自定义字体路径不能为空')
  if (!isAbsolute(fontPath)) throw new FontError('configuration', `自定义字体必须使用绝对路径：${fontPath}`)
  const extension = extname(fontPath).toLowerCase()
  if (!['.ttf', '.otf', '.woff2'].includes(extension)) {
    throw new FontError('configuration', `自定义字体格式不受支持：${extension || '无扩展名'}`)
  }
  const absolutePath = normalize(fontPath)
  let info
  try {
    info = await stat(absolutePath)
  } catch (error) {
    throw new FontError('read', `无法访问自定义字体：${absolutePath}`, error)
  }
  if (!info.isFile() || info.size === 0) throw new FontError('read', `自定义字体路径不是有效文件：${absolutePath}`)
  let buffer: Buffer
  try {
    buffer = await readFile(absolutePath)
  } catch (error) {
    throw new FontError('read', `无法读取自定义字体：${absolutePath}`, error)
  }
  if (!hasFontSignature(buffer)) throw new FontError('integrity', `自定义字体文件头无效：${absolutePath}`)
  return createFileFont('custom', buffer, extension)
}

function createFileFont(mode: 'release' | 'custom', buffer: Buffer, extension: string): FontSource {
  const metadata = fontMetadata(extension)
  const url = `${FONT_ORIGIN}/${mode}/font${extension}`
  const css = `@font-face{font-family:"${FONT_FAMILY}";src:url("${url}") format("${metadata.format}");font-style:normal;font-weight:400;font-display:block}`
  return {
    family: FONT_FAMILY,
    css,
    mode,
    assets: new Map([[url, { contentType: metadata.contentType, load: async () => buffer }]]),
  }
}

async function prepareReleaseFont(ctx: Context): Promise<Buffer> {
  const fontPath = getReleaseFontPath(ctx.baseDir)
  const key = process.platform === 'win32' ? resolve(fontPath).toLowerCase() : resolve(fontPath)
  const active = releaseTasks.get(key)
  if (active) return active
  const task = prepareReleaseFontUncached(ctx, fontPath)
  releaseTasks.set(key, task)
  try {
    return await task
  } finally {
    if (releaseTasks.get(key) === task) releaseTasks.delete(key)
  }
}

async function prepareReleaseFontUncached(ctx: Context, fontPath: string): Promise<Buffer> {
  const existing = await readOptional(fontPath)
  if (existing && verifyReleaseFont(existing)) return existing
  const logger = ctx.logger('picstatus')
  if (existing) logger.warn('公共 LXGW 字体校验失败，将重新下载：%s', fontPath)
  try {
    await mkdir(dirname(fontPath), { recursive: true })
  } catch (error) {
    throw new FontError('write', `无法创建公共字体目录：${formatError(error)}`, error)
  }
  let lastError: unknown
  for (const source of [{ name: 'Gitee', url: GITEE_URL }, { name: 'GitHub', url: GITHUB_URL }]) {
    try {
      logger.info('开始从 %s 下载 LXGW 字体：%s', source.name, source.url)
      const response = await ctx.http.get<ArrayBuffer>(source.url, { responseType: 'arraybuffer', timeout: 120000 })
      const buffer = Buffer.from(response)
      if (!verifyReleaseFont(buffer)) throw new FontError('integrity', `${source.name} 返回的 LXGW 字体完整性校验失败`)
      await replaceAtomically(fontPath, buffer)
      logger.info('LXGW 字体下载并校验成功：source=%s path=%s', source.name, fontPath)
      return buffer
    } catch (error) {
      lastError = error
      logger.warn('从 %s 下载 LXGW 字体失败：%s', source.name, formatError(error))
    }
  }
  throw new FontError('download', `Gitee 与 GitHub 字体源均不可用：${formatError(lastError)}`, lastError)
}

async function replaceAtomically(fontPath: string, buffer: Buffer): Promise<void> {
  const temporaryPath = join(dirname(fontPath), `.${RELEASE_FONT_NAME}.${process.pid}.${randomUUID()}.part`)
  try {
    await writeFile(temporaryPath, buffer, { flag: 'wx' })
    if (!verifyReleaseFont(await readFile(temporaryPath))) throw new FontError('integrity', '字体临时文件校验失败')
    try {
      await rename(temporaryPath, fontPath)
    } catch (error) {
      const code = isNodeError(error) ? error.code : undefined
      if (code !== 'EEXIST' && code !== 'EPERM') throw error
      await unlink(fontPath).catch(() => undefined)
      await rename(temporaryPath, fontPath)
    }
    if (!verifyReleaseFont(await readFile(fontPath))) throw new FontError('integrity', '字体写入后校验失败')
  } catch (error) {
    if (error instanceof FontError) throw error
    throw new FontError('write', `无法写入公共字体：${formatError(error)}`, error)
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}

async function readOptional(filePath: string): Promise<Buffer | null> {
  try {
    return await readFile(filePath)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return null
    throw new FontError('read', `无法读取公共字体：${filePath}`, error)
  }
}

export function verifyReleaseFont(buffer: Buffer): boolean {
  if (buffer.length !== RELEASE_INTEGRITY.size) return false
  return createHash('md5').update(buffer).digest('hex') === RELEASE_INTEGRITY.md5
    && createHash('sha1').update(buffer).digest('hex') === RELEASE_INTEGRITY.sha1
    && createHash('sha256').update(buffer).digest('hex') === RELEASE_INTEGRITY.sha256
    && createHash('sha512').update(buffer).digest('hex') === RELEASE_INTEGRITY.sha512
}

export function hasFontSignature(buffer: Buffer): boolean {
  if (buffer.length < 4) return false
  const tag = buffer.subarray(0, 4).toString('latin1')
  return buffer.readUInt32BE(0) === 0x00010000 || ['OTTO', 'ttcf', 'true', 'typ1', 'wOF2'].includes(tag)
}

function fontMetadata(extension: string): { contentType: string, format: string } {
  if (extension === '.otf') return { contentType: 'font/otf', format: 'opentype' }
  if (extension === '.woff2') return { contentType: 'font/woff2', format: 'woff2' }
  return { contentType: 'font/ttf', format: 'truetype' }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
