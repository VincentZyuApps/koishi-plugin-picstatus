import type { Context } from 'koishi'
import {} from 'koishi-plugin-puppeteer'
import type { Config } from '../config'
import { FONT_SAMPLE, FontError, FontManager, installFont, type FontInstallation, type FontPage } from '../font'
import type { BackgroundData, StatusSnapshot } from '../types'
import { buildHtml } from './template'
import { createView } from './view'

export async function renderStatus(
  ctx: Context,
  snapshot: StatusSnapshot,
  background: BackgroundData,
  config: Config,
  fonts: FontManager,
): Promise<Buffer> {
  const font = await fonts.resolve()
  const page = await ctx.puppeteer.page()
  let fontInstallation: FontInstallation | undefined
  try {
    fontInstallation = await installFont(page as unknown as FontPage, font)
    await page.setViewport({ width: config.imageWidth, height: 1200, deviceScaleFactor: 1 })
    await page.setContent(buildHtml(createView(snapshot), background, config, font.css), { waitUntil: 'load' })
    await page.waitForSelector('.canvas', { timeout: 5000 })
    const fontReady = await page.evaluate(async (family, sample, required) => {
      if (document.fonts?.ready) await document.fonts.ready
      await Promise.all(Array.from(document.images).map((image) => image.complete ? undefined : new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true })
        image.addEventListener('error', resolve, { once: true })
      })))
      if (required) {
        if (!document.fonts) return false
        await document.fonts.load(`400 24px "${family}"`, sample)
        if (!document.fonts.check(`400 24px "${family}"`, sample)) return false
      }
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      return true
    }, font.family, FONT_SAMPLE, font.mode !== 'system')
    fontInstallation.assertHealthy()
    if (!fontReady) throw new FontError('browser', `${font.family} 未能在 Chromium 中完成加载`)
    const element = await page.$('.canvas')
    if (!element) throw new Error('找不到状态图根容器')
    const image = await element.screenshot({
      type: config.imageType,
      ...(config.imageType === 'jpeg' ? { quality: config.imageQuality } : {}),
    })
    return Buffer.from(image)
  } finally {
    fontInstallation?.dispose()
    await page.close()
  }
}
