import assert from 'node:assert/strict'
import test from 'node:test'
import type { Bot, Context, Session } from 'koishi'
import type { Config } from '../src/config'
import { BotCollector, fetchBotAvatar, MessageCounter, resolveTelegramAvatarPath } from '../src/collectors/bot'
import { validateImageFile } from '../src/utils/image'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const PNG_FILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

test('Telegram avatar paths are extracted from server and file endpoints', () => {
  const serverBot = {
    platform: 'telegram',
    server: 'https://bot.example.com/telegram/123',
  }
  assert.equal(
    resolveTelegramAvatarPath(serverBot, 'https://bot.example.com/telegram/123/photos/avatar%201.jpg?cache=1'),
    'photos/avatar 1.jpg',
  )

  const tokenBot = {
    platform: 'telegram',
    file: { config: { endpoint: 'https://api.telegram.org/file/bot123:secret' } },
  }
  assert.equal(
    resolveTelegramAvatarPath(tokenBot, 'https://api.telegram.org/file/bot123:secret/photos/avatar.jpg'),
    'photos/avatar.jpg',
  )
  assert.equal(resolveTelegramAvatarPath({ platform: 'discord' }, 'https://cdn.example.com/avatar.png'), undefined)
})

test('Telegram avatars use the bot file client with timeout and become data URLs', async () => {
  let globalRequests = 0
  let nativeRequest: { source: string; timeout?: number } | undefined
  const ctx = {
    http: {
      file: async () => {
        globalRequests++
        throw new Error('global HTTP should not be used')
      },
    },
  } as unknown as Context
  const bot = {
    platform: 'telegram',
    server: 'https://bot.example.com/telegram/123',
    file: {
      config: { endpoint: 'https://api.telegram.org/file/bot123:secret' },
      file: async (source: string, options?: { timeout?: number }) => {
        nativeRequest = { source, timeout: options?.timeout }
        return { data: PNG, type: 'image/png; charset=binary' }
      },
    },
  } as unknown as Bot

  const image = await fetchBotAvatar(ctx, bot, 'https://bot.example.com/telegram/123/photos/avatar.png', 4321)
  assert.deepEqual(nativeRequest, {
    source: 'https://api.telegram.org/file/bot123:secret/photos/avatar.png',
    timeout: 4321,
  })
  assert.equal(globalRequests, 0)
  assert.equal(image.mime, 'image/png')
  assert.equal(`data:${image.mime};base64,${image.data.toString('base64')}`, 'data:image/png;base64,iVBORw==')
})

test('Telegram local file mode delegates to the adapter file reader', async () => {
  let requested = ''
  const ctx = {
    http: { file: async () => { throw new Error('global HTTP should not be used') } },
  } as unknown as Context
  const bot = {
    platform: 'telegram',
    server: 'https://bot.example.com/telegram/123',
    local: true,
    file: {
      config: {},
      file: async () => { throw new Error('remote file client should not be used') },
    },
    $getFile: async (filePath: string) => {
      requested = filePath
      return { data: PNG, type: 'image/png' }
    },
  } as unknown as Bot

  const image = await fetchBotAvatar(ctx, bot, 'https://bot.example.com/telegram/123/photos/avatar.png', 1000)
  assert.equal(requested, 'photos/avatar.png')
  assert.equal(image.mime, 'image/png')
})

test('generic platforms keep using the shared HTTP client', async () => {
  let requested = ''
  const ctx = {
    http: {
      file: async (source: string) => {
        requested = source
        return { data: PNG, type: 'image/png', filename: 'avatar.png' }
      },
    },
  } as unknown as Context
  const source = 'https://cdn.example.com/avatar.png'
  const image = await fetchBotAvatar(ctx, { platform: 'discord' } as Bot, source, 1000)
  assert.equal(requested, source)
  assert.equal(image.mime, 'image/png')
})

test('native Telegram failures retain the generic fallback', async () => {
  let globalRequests = 0
  const ctx = {
    http: {
      file: async () => {
        globalRequests++
        return { data: PNG, type: 'image/png', filename: 'avatar.png' }
      },
    },
  } as unknown as Context
  const bot = {
    platform: 'telegram',
    server: 'https://bot.example.com/telegram/123',
    file: {
      config: {},
      file: async () => { throw new Error('native request failed') },
    },
  } as unknown as Bot
  const image = await fetchBotAvatar(ctx, bot, 'https://bot.example.com/telegram/123/photos/avatar.png', 1000)
  assert.equal(globalRequests, 1)
  assert.equal(image.mime, 'image/png')
})

test('Telegram octet-stream avatars are detected without exposing source URLs', async () => {
  const diagnostics: string[] = []
  const token = '123:VERY_SECRET'
  let globalRequests = 0
  const ctx = {
    http: {
      file: async () => {
        globalRequests++
        throw new Error(`fetch https://api.telegram.org/file/bot${token}/avatar failed`)
      },
    },
  } as unknown as Context
  const bot = {
    platform: 'telegram',
    file: {
      config: { endpoint: `https://api.telegram.org/file/bot${token}` },
      file: async () => ({
        data: PNG_FILE,
        type: 'application/octet-stream',
      }),
    },
  } as unknown as Bot

  const image = await fetchBotAvatar(
    ctx,
    bot,
    `https://api.telegram.org/file/bot${token}/photos/avatar.jpg`,
    1000,
    (message) => diagnostics.push(message),
  )
  assert.equal(image.mime, 'image/png')
  assert.equal(globalRequests, 0)
  assert.ok(diagnostics.some((message) => message.includes('mime=application/octet-stream bytes=68')))
  assert.ok(diagnostics.some((message) => message.includes('detected=image/png')))
  assert.ok(!diagnostics.join('\n').includes(token))
  assert.ok(!diagnostics.join('\n').includes('api.telegram.org'))
})

test('image validation rejects invalid, empty and oversized responses', () => {
  assert.throws(() => validateImageFile({ data: PNG, type: 'text/plain' }), /响应不是图片/)
  assert.throws(() => validateImageFile({ data: Buffer.alloc(0), type: 'image/png' }), /图片内容为空/)
  assert.throws(() => validateImageFile({ data: Buffer.alloc(15 * 1024 * 1024 + 1), type: 'image/png' }), /15 MiB/)
})

test('failed avatar downloads use fallback text without leaking Telegram tokens', async () => {
  const token = '123456:VERY_SECRET_TOKEN'
  const logs: string[] = []
  const bot = {
    sid: 'telegram:123456',
    platform: 'telegram',
    adapterName: 'telegram',
    selfId: '123456',
    status: 1,
    server: 'https://bot.example.com/telegram/123456',
    file: {
      config: { endpoint: `https://api.telegram.org/file/bot${token}` },
      file: async () => { throw new Error(`request failed for bot${token}`) },
    },
    user: { id: '123456', name: 'Alice' },
    toJSON() {
      return { platform: 'telegram', status: 1, user: this.user }
    },
    async getLogin() {
      return {
        platform: 'telegram',
        status: 1,
        user: { ...this.user, avatar: `https://api.telegram.org/file/bot${token}/photos/avatar.jpg` },
      }
    },
  } as unknown as Bot
  const ctx = {
    bots: [bot],
    on() {},
    http: {
      file: async () => { throw new Error(`global request failed for bot${token}`) },
    },
    logger: () => ({ debug: (message: string) => logs.push(message) }),
  } as unknown as Context
  const counter = { get: async () => ({ received: 0, sent: 0 }) } as unknown as MessageCounter
  const collector = new BotCollector(ctx, {
    showCurrentBot: true,
    requestTimeout: 1,
  } as Config, counter)

  const result = await collector.collect({ bot } as Session)
  assert.equal(result.status, 'ok')
  if (result.status === 'ok') assert.equal(result.value[0].avatar, undefined)
  assert.equal(logs.length, 1)
  assert.ok(!logs[0].includes(token))
  assert.ok(!logs[0].includes('api.telegram.org'))
})

test('debug config writes safe avatar diagnostics at info level', async () => {
  const token = '123456:VERY_SECRET_TOKEN'
  const infoLogs: string[] = []
  const bot = {
    sid: 'telegram:123456',
    platform: 'telegram',
    adapterName: 'telegram',
    selfId: '123456',
    server: 'https://bot.example.com/telegram/123456',
    file: {
      config: { endpoint: `https://api.telegram.org/file/bot${token}` },
      file: async () => ({
        data: PNG_FILE,
        type: 'application/octet-stream',
      }),
    },
    user: { id: '123456', name: 'Alice' },
    toJSON() { return { platform: 'telegram', status: 1, user: this.user } },
    async getLogin() {
      return {
        platform: 'telegram', status: 1,
        user: { ...this.user, avatar: `https://api.telegram.org/file/bot${token}/photos/avatar.jpg` },
      }
    },
  } as unknown as Bot
  const ctx = {
    bots: [bot],
    on() {},
    http: { file: async () => { throw new Error(`request failed for ${token}`) } },
    logger: () => ({ info: (message: string) => infoLogs.push(message), debug() {} }),
  } as unknown as Context
  const counter = { get: async () => ({ received: 0, sent: 0 }) } as unknown as MessageCounter
  const collector = new BotCollector(ctx, {
    showCurrentBot: true,
    requestTimeout: 1,
    debug: true,
  } as Config, counter)

  await collector.collect({ bot } as Session)
  assert.ok(infoLogs.some((message) => message.includes('mime=application/octet-stream bytes=68')))
  assert.ok(infoLogs.some((message) => message.includes('detected=image/png')))
  assert.ok(infoLogs.some((message) => message.includes('头像已转为 Data URL: mime=image/png')))
  assert.ok(!infoLogs.join('\n').includes(token))
  assert.ok(!infoLogs.join('\n').includes('api.telegram.org'))
})
