import { Context } from 'koishi'
import si from 'systeminformation'
import type { Config } from '../config'
import type { NetworkMetric, SiteMetric } from '../types'
import { matchesAny } from '../utils/filter'

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
  const results = await Promise.all(config.sites.map(async (site): Promise<SiteMetric> => {
    const started = performance.now()
    try {
      const response = await ctx.http(site.url, {
        method: 'GET', timeout: config.requestTimeout * 1000, redirect: 'follow', responseType: 'text',
      })
      return { name: site.name, status: response.status, statusText: response.statusText, delay: performance.now() - started }
    } catch (error) {
      const code = (error as { code?: string }).code
      return { name: site.name, error: code === 'ETIMEDOUT' ? '超时' : error instanceof Error ? error.name : '请求失败' }
    }
  }))
  return results.sort((a, b) => (a.delay ?? Number.MAX_SAFE_INTEGER) - (b.delay ?? Number.MAX_SAFE_INTEGER))
}
