import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context, HTTP } from 'koishi'
import { Config as ConfigSchema, DEFAULT_SITES, type Config, type SiteProxyMode } from '../src/config'
import { collectSites, resolveSiteProxy } from '../src/collectors/network'

interface CapturedRequest {
  url: string
  options: HTTP.RequestConfig & { proxyAgent?: string }
}

function siteConfig(mode: SiteProxyMode, overrides: Partial<Config> = {}): Config {
  return {
    requestTimeout: 1,
    siteProxyMode: mode,
    siteProxyUrl: 'http://127.0.0.1:7890',
    sites: [],
    ...overrides,
  } as Config
}

function mockContext(requests: CapturedRequest[]): Context {
  const http = async (url: string, options: CapturedRequest['options']) => {
    requests.push({ url, options })
    return { status: 200, statusText: 'OK' }
  }
  return { http } as unknown as Context
}

test('config defaults provide ten paired sites and disabled proxy mode', () => {
  const config = ConfigSchema({} as Config)
  assert.equal(config.siteProxyMode, 'disabled')
  assert.equal(config.siteProxyUrl, 'http://127.0.0.1:7890')
  assert.deepEqual(config.sites, DEFAULT_SITES)
  assert.deepEqual(config.sites.map((site) => site.name), [
    '百度', 'Google', 'Gitee', 'GitHub', '哔哩哔哩',
    'YouTube', 'npm 镜像', 'npm 官方', '中科大 Debian', 'Debian 官方',
  ])
  assert.deepEqual(config.sites.map((site) => site.useProxy), [
    false, true, false, true, false, true, false, true, false, true,
  ])

  const legacy = ConfigSchema({
    sites: [{ name: 'Legacy', url: 'https://legacy.test/' }],
  } as Config)
  assert.deepEqual(legacy.sites, [{ name: 'Legacy', url: 'https://legacy.test/', useProxy: false }])
})

test('proxy resolution supports Koishi HTTP and SOCKS protocols', () => {
  const site = { useProxy: true }
  for (const protocol of ['http', 'https', 'socks4', 'socks4a', 'socks5', 'socks5h']) {
    const siteProxyUrl = `${protocol}://127.0.0.1:7890`
    assert.equal(resolveSiteProxy({ siteProxyMode: 'configured', siteProxyUrl }, site), siteProxyUrl)
  }
  assert.equal(resolveSiteProxy({ siteProxyMode: 'inherit', siteProxyUrl: '' }, site), undefined)
  assert.equal(resolveSiteProxy({ siteProxyMode: 'disabled', siteProxyUrl: '' }, site), '')
  assert.equal(resolveSiteProxy({ siteProxyMode: 'configured', siteProxyUrl: 'http://proxy.test' }, { useProxy: false }), '')
  assert.throws(
    () => resolveSiteProxy({ siteProxyMode: 'configured', siteProxyUrl: 'ftp://user:secret@proxy.test' }, site),
    /代理配置无效/,
  )
})

test('configured mode applies proxy only to selected sites', async () => {
  const requests: CapturedRequest[] = []
  const config = siteConfig('configured', {
    siteProxyUrl: 'socks5h://127.0.0.1:1080',
    sites: [
      { name: 'Direct', url: 'https://direct.test/', useProxy: false },
      { name: 'Proxy', url: 'https://proxy.test/', useProxy: true },
    ],
  })
  const results = await collectSites(mockContext(requests), config)

  assert.deepEqual(results.map((item) => item.name), ['Direct', 'Proxy'])
  assert.equal(requests[0].options.proxyAgent, '')
  assert.equal(requests[1].options.proxyAgent, 'socks5h://127.0.0.1:1080')
  assert.equal(requests[0].options.timeout, 1000)
})

test('inherit leaves selected sites untouched while disabled forces direct access', async () => {
  const sites = [
    { name: 'Direct', url: 'https://direct.test/', useProxy: false },
    { name: 'Proxy', url: 'https://proxy.test/', useProxy: true },
  ]
  const inheritedRequests: CapturedRequest[] = []
  await collectSites(mockContext(inheritedRequests), siteConfig('inherit', { sites }))
  assert.equal(inheritedRequests[0].options.proxyAgent, '')
  assert.equal(Object.hasOwn(inheritedRequests[1].options, 'proxyAgent'), false)

  const disabledRequests: CapturedRequest[] = []
  await collectSites(mockContext(disabledRequests), siteConfig('disabled', { sites }))
  assert.deepEqual(disabledRequests.map((item) => item.options.proxyAgent), ['', ''])
})

test('invalid configured proxy fails safely without sending a request', async () => {
  let requestCount = 0
  const ctx = {
    http: async () => {
      requestCount++
      throw new Error('HTTP must not be called')
    },
  } as unknown as Context
  const config = siteConfig('configured', {
    siteProxyUrl: 'ftp://user:VERY_SECRET@proxy.test',
    sites: [{ name: 'Invalid', url: 'https://example.test/', useProxy: true }],
  })
  const results = await collectSites(ctx, config)

  assert.equal(requestCount, 0)
  assert.deepEqual(results, [{ name: 'Invalid', error: '代理配置无效' }])
  assert.ok(!JSON.stringify(results).includes('VERY_SECRET'))
})

test('site results preserve configured order instead of completion time', async () => {
  const ctx = {
    http: async (url: string) => {
      if (url.includes('slow')) await new Promise((resolve) => setTimeout(resolve, 20))
      return { status: 200, statusText: 'OK' }
    },
  } as unknown as Context
  const config = siteConfig('disabled', {
    sites: [
      { name: 'Slow', url: 'https://slow.test/', useProxy: false },
      { name: 'Fast', url: 'https://fast.test/', useProxy: false },
    ],
  })
  const results = await collectSites(ctx, config)
  assert.deepEqual(results.map((item) => item.name), ['Slow', 'Fast'])
  assert.ok((results[0].delay || 0) > (results[1].delay || 0))
})
