import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import type { Context } from 'koishi'
import {
  FONT_FAMILY,
  FontError,
  FontManager,
  getReleaseFontPath,
  handleFontRequest,
  hasFontSignature,
  installFont,
  rewriteNpmFontCss,
  verifyReleaseFont,
} from '../src/font'

function context(baseDir: string): Context {
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  return { baseDir, logger: () => logger } as unknown as Context
}

test('release mode uses the shared Koishi data/fonts path', () => {
  assert.equal(getReleaseFontPath('C:\\koishi'), join('C:\\koishi', 'data', 'fonts', 'LXGWWenKaiMono-Regular.ttf'))
})

test('font signatures and release integrity reject invalid data', () => {
  const ttf = Buffer.alloc(12)
  ttf.writeUInt32BE(0x00010000, 0)
  assert.equal(hasFontSignature(ttf), true)
  assert.equal(hasFontSignature(Buffer.from('not-a-font')), false)
  assert.equal(verifyReleaseFont(ttf), false)
})

test('npm CSS is rewritten to an allowlisted virtual WOFF2 URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'picstatus-font-'))
  try {
    const fontData = Buffer.from('woff2-data')
    await writeFile(join(directory, '3.woff2'), fontData)
    const rewritten = rewriteNpmFontCss('@font-face{font-family:"LXGW WenKai Screen";src:local("LXGW WenKai Screen"),url("./3.woff2") format("woff2")}', directory)
    assert.match(rewritten.css, new RegExp(FONT_FAMILY))
    assert.doesNotMatch(rewritten.css, /local\(/)
    assert.equal(rewritten.assets.size, 1)

    const url = rewritten.assets.keys().next().value as string
    let response: Record<string, unknown> | undefined
    const handled = await handleFontRequest({
      url: () => url,
      continue: async () => undefined,
      respond: async (options) => { response = options },
      abort: async () => undefined,
      isInterceptResolutionHandled: () => false,
    }, { family: FONT_FAMILY, css: rewritten.css, assets: rewritten.assets, mode: 'npm' })
    assert.equal(handled, true)
    assert.deepEqual(response?.body, await readFile(join(directory, '3.woff2')))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('non-font requests continue through the interceptor', async () => {
  let continued = false
  const handled = await handleFontRequest({
    url: () => 'https://example.com/image.png',
    continue: async () => { continued = true },
    respond: async () => undefined,
    abort: async () => undefined,
  }, { family: FONT_FAMILY, css: '', assets: new Map(), mode: 'system' })
  assert.equal(handled, false)
  assert.equal(continued, true)
})

test('system mode neither reads fonts nor enables request interception', async () => {
  const source = await new FontManager(context(process.cwd()), 'system', '').resolve()
  let interceptionEnabled = false
  const installation = await installFont({
    setRequestInterception: async () => { interceptionEnabled = true },
    on: () => undefined,
  }, source)
  installation.assertHealthy()
  installation.dispose()
  assert.equal(source.css, '')
  assert.equal(source.assets.size, 0)
  assert.equal(interceptionEnabled, false)
})

test('custom mode accepts a valid absolute TTF and rejects relative paths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'picstatus-custom-font-'))
  try {
    const fontPath = join(directory, 'custom.ttf')
    const ttf = Buffer.alloc(12)
    ttf.writeUInt32BE(0x00010000, 0)
    await writeFile(fontPath, ttf)
    const source = await new FontManager(context(directory), 'custom', fontPath).resolve()
    assert.match(source.css, /format\("truetype"\)/)
    assert.equal(source.assets.size, 1)

    await assert.rejects(
      new FontManager(context(directory), 'custom', 'relative.ttf').resolve(),
      (error: unknown) => error instanceof FontError && error.code === 'configuration',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('installed npm mode exposes local font slices without public URLs', async () => {
  const source = await new FontManager(context(process.cwd()), 'npm', '').resolve()
  assert.match(source.css, new RegExp(`font-family:\\s*"${FONT_FAMILY}"`))
  assert.doesNotMatch(source.css, /local\(/i)
  assert.ok(source.assets.size > 0)
})
