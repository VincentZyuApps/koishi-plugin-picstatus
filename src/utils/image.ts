import type { Context } from 'koishi'

const MAX_IMAGE_SIZE = 15 * 1024 * 1024

export async function fetchImage(ctx: Context, source: string, timeout: number): Promise<{ data: Buffer; mime: string }> {
  const file = await ctx.http.file(source, { timeout })
  const mime = (file.mime || file.type || '').split(';')[0].toLowerCase()
  if (!mime.startsWith('image/')) throw new Error(`响应不是图片: ${mime || 'unknown'}`)
  const data = Buffer.from(file.data)
  if (!data.length) throw new Error('图片内容为空')
  if (data.length > MAX_IMAGE_SIZE) throw new Error(`图片超过 ${MAX_IMAGE_SIZE / 1024 / 1024} MiB 限制`)
  return { data, mime }
}

export function toDataUrl(data: Buffer | null, mime: string): string {
  return data ? `data:${mime};base64,${data.toString('base64')}` : ''
}

