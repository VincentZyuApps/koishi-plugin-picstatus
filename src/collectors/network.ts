import { Context, HTTP } from 'koishi'
import si from 'systeminformation'
import type { Config, SiteConfig } from '../config'
import type { NetworkMetric, SiteMetric } from '../types'
import { matchesAny } from '../utils/filter'

const PROXY_PROTOCOLS = new Set(['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'])

export class SiteProxyError extends Error {
  readonly name = 'SiteProxyError'

  constructor() {
    super('代理配置无效')
  }
}

export function resolveSiteProxy(
  config: Pick<Config, 'siteProxyMode' | 'siteProxyUrl'>,
  site: Pick<SiteConfig, 'useProxy'>,
): string | undefined {
  if (!site.useProxy || config.siteProxyMode === 'disabled') return ''
  if (config.siteProxyMode === 'inherit') return
  try {
    const source = config.siteProxyUrl.trim()
    const url = new URL(source)
    if (!url.hostname || !PROXY_PROTOCOLS.has(url.protocol)) throw new SiteProxyError()
    return source
  } catch {
    throw new SiteProxyError()
  }
}

export async function collectNetworks(config: Config, ignored: RegExp[]): Promise<NetworkMetric[]> {
  const interfaces = await si.networkInterfaces()
  const candidates = interfaces.filter((item) => {
    const hasAddress = Boolean(item.ip4 || item.ip6)
    return hasAddress && !matchesAny(item.iface, ignored) && !matchesAny(item.ifaceName, ignored)
  })
  const unique = [...new Map(candidates.map((item) => [item.iface, item])).values()]
  const collected = await Promise.all(unique.map(async (item) => {
    try {
      const stats = await si.networkStats(item.iface)
      const sent = stats.reduce((total, value) => total + Math.max(0, value.tx_sec || 0), 0)
      const received = stats.reduce((total, value) => total + Math.max(0, value.rx_sec || 0), 0)
      return { name: item.iface, sent, received, rank: networkRank(item.iface, item.virtual) }
    } catch {
      return null
    }
  }))
  const available = collected.filter((item): item is NonNullable<typeof item> => Boolean(item))
  const filtered = config.hideIdleIo ? available.filter((item) => item.sent || item.received) : available
  return filtered
    .sort((a, b) => a.rank - b.rank || b.sent + b.received - a.sent - a.received || a.name.localeCompare(b.name))
    .map(({ name, sent, received }) => ({ name, sent, received }))
}

function networkRank(name: string, virtual: boolean): number {
  if (virtual || /vmware|virtualbox|hyper-v|vethernet|wsl|docker|npcap/i.test(name)) return 2
  if (/vpn|radmin|tailscale|zerotier|tun|tap/i.test(name)) return 1
  return 0
}

export async function collectSites(ctx: Context, config: Config): Promise<SiteMetric[]> {
  return Promise.all(config.sites.map(async (site): Promise<SiteMetric> => {
    const started = performance.now()
    try {
      const request: HTTP.RequestConfig & { proxyAgent?: string } = {
        method: 'GET', timeout: config.requestTimeout * 1000, redirect: 'follow', responseType: 'text',
      }
      const proxyAgent = resolveSiteProxy(config, site)
      if (proxyAgent !== undefined) request.proxyAgent = proxyAgent
      const response = await ctx.http(site.url, request)
      return { name: site.name, status: response.status, statusText: response.statusText, delay: performance.now() - started }
    } catch (error) {
      const code = (error as { code?: string }).code
      const message = error instanceof SiteProxyError
        ? error.message
        : code === 'ETIMEDOUT' ? '超时' : error instanceof Error ? error.name : '请求失败'
      return { name: site.name, error: message }
    }
  }))
}
