import type { Config } from '../config'
import type { MemoryMetric, MetricResult, StatusSnapshot, SwapMetric } from '../types'
import { clampPercent, formatBytes, formatDuration, formatFrequency, formatGiB } from '../utils/format'

export type SegmentKind = 'used' | 'shared' | 'compressed' | 'buffers' | 'cache' | 'swap-used' | 'swap-cache'

export interface SegmentView {
  kind: SegmentKind
  percent: number
}

export interface DonutView {
  percent: number | null
  title: string
  caption: string
  captionDetail?: string
  segments: SegmentView[]
}

export interface MemoryBarView {
  label: string
  value: string
  segments: SegmentView[]
}

export interface ViewModel {
  generatedAt: string
  koishiUptime: string
  systemUptime: string
  system: string
  container: boolean
  cpu: DonutView
  memory: DonutView
  swap: DonutView
  memoryDetails: MemoryBarView[]
  disks: Array<{ name: string; percent: number | null; usage: string; error?: string }>
  diskIo: Array<{ name: string; read: string; write: string }>
  networks: Array<{ name: string; sent: string; received: string }>
  sites: Array<{ name: string; result: string; delay: string; error: boolean }>
  processes: Array<{ name: string; cpu: string; memory: string }>
  bots: Array<{ name: string; platform: string; selfId: string; avatar?: string; connected: string; received: number; sent: number }>
}

function value<T>(metric: MetricResult<T>, fallback: T): T {
  return metric.status === 'ok' ? metric.value : fallback
}

function ratio(value: number, total: number): number {
  return total > 0 ? clampPercent(value / total * 100) ?? 0 : 0
}

function memoryUsed(item: MemoryMetric, mode: Config['memoryPercentMode']): number {
  if (mode === 'available') return Math.max(0, item.total - item.available)
  if (mode === 'occupied') return Math.max(0, item.total - item.free)
  return item.used
}

function memoryPercent(item: MemoryMetric, mode: Config['memoryPercentMode']): number | null {
  if (!item.total) return null
  return clampPercent(memoryUsed(item, mode) / item.total * 100)
}

function memoryCaptionDetail(item: MemoryMetric): string | undefined {
  if (!item.total) return undefined
  if (item.platform === 'linux') {
    return `空${formatGiB(item.free)} 共${formatGiB(item.shared)} 缓${formatGiB(item.buffCache)} 可${formatGiB(item.available)}`
  }
  if (item.platform === 'macos') {
    return `空${formatGiB(item.free)} 缓${formatGiB(item.buffCache)} 可${formatGiB(item.available)}`
  }
  if (item.platform === 'windows') return `可${formatGiB(item.available)}`
  return `空${formatGiB(item.free)} 可${formatGiB(item.available)}`
}

function memoryView(item: MemoryMetric, mode: Config['memoryPercentMode']): DonutView {
  return {
    percent: memoryPercent(item, mode),
    title: 'RAM',
    caption: item.total ? `${formatBytes(memoryUsed(item, mode))} / ${formatBytes(item.total)}` : '未部署',
    captionDetail: memoryCaptionDetail(item),
    segments: item.segments.map((segment) => ({ kind: segment.kind, percent: ratio(segment.value, item.total) })),
  }
}

function swapView(item: SwapMetric): DonutView {
  return {
    percent: item.percent,
    title: 'SWAP',
    caption: item.total ? `${formatBytes(item.used)} / ${formatBytes(item.total)}` : '未配置',
    captionDetail: item.total ? `空${formatGiB(item.free)}` : undefined,
    segments: item.total ? [
      { kind: 'swap-used', percent: ratio(item.used, item.total) },
      { kind: 'swap-cache', percent: ratio(item.cached, item.total) },
    ] : [],
  }
}

function linuxMemoryDetails(memory: MemoryMetric, swap: SwapMetric, enabled: boolean): MemoryBarView[] {
  if (!enabled || memory.platform !== 'linux' || !memory.total) return []
  return [
    {
      label: 'MEM',
      value: `${formatGiB(memory.used)}/${formatGiB(memory.total)}`,
      segments: memory.segments.map((segment) => ({ kind: segment.kind, percent: ratio(segment.value, memory.total) })),
    },
    {
      label: 'SWP',
      value: swap.total ? `${formatGiB(swap.used)}/${formatGiB(swap.total)}` : '未配置',
      segments: swap.total ? [
        { kind: 'swap-used', percent: ratio(swap.used, swap.total) },
        { kind: 'swap-cache', percent: ratio(swap.cached, swap.total) },
      ] : [],
    },
  ]
}

const emptyMemory: MemoryMetric = {
  platform: 'other', percent: null, used: 0, reportedUsed: 0, total: 0, free: 0, available: 0,
  shared: 0, buffers: 0, cache: 0, buffCache: 0, compressed: 0, segments: [],
}
const emptySwap: SwapMetric = { percent: null, used: 0, reportedUsed: 0, total: 0, free: 0, cached: 0 }

export function createView(snapshot: StatusSnapshot, config: Config): ViewModel {
  const cpu = value(snapshot.cpu, { brand: '未知型号', physicalCores: 0, logicalCores: 0, speed: null, percent: null })
  const system = value(snapshot.system, { name: '未知系统', architecture: '', uptime: 0, container: false })
  const memory = value(snapshot.memory, emptyMemory)
  const swap = value(snapshot.swap, emptySwap)
  return {
    generatedAt: snapshot.generatedAt.toLocaleString('zh-CN', { hour12: false }),
    koishiUptime: formatDuration(snapshot.koishiUptime),
    systemUptime: formatDuration(system.uptime),
    system: `${system.name} ${system.architecture}`.trim(),
    container: system.container,
    cpu: {
      percent: cpu.percent,
      title: 'CPU',
      caption: `${cpu.physicalCores || '??'}核 ${cpu.logicalCores || '??'}线程 ${formatFrequency(cpu.speed)}\n${cpu.brand}`,
      segments: [],
    },
    memory: memoryView(memory, config.memoryPercentMode),
    swap: swapView(swap),
    memoryDetails: linuxMemoryDetails(memory, swap, config.showLinuxMemoryDetails),
    disks: value(snapshot.disks, []).map((item) => ({
      name: item.name, percent: item.percent,
      usage: item.error || `${formatBytes(item.used)} / ${formatBytes(item.total)}`,
      error: item.error,
    })),
    diskIo: value(snapshot.diskIo, []).map((item) => ({
      name: item.name, read: formatBytes(item.read, '/s'), write: formatBytes(item.write, '/s'),
    })),
    networks: value(snapshot.networks, []).map((item) => ({
      name: item.name, sent: formatBytes(item.sent, '/s'), received: formatBytes(item.received, '/s'),
    })),
    sites: value(snapshot.sites, []).map((item) => ({
      name: item.name,
      result: item.error || `${item.status ?? '???'} ${item.statusText || ''}`.trim(),
      delay: item.delay == null ? '' : `${item.delay.toFixed(2)}ms`,
      error: Boolean(item.error),
    })),
    processes: value(snapshot.processes, []).map((item) => ({
      name: item.name, cpu: `${item.cpu.toFixed(1)}%`, memory: formatBytes(item.memory),
    })),
    bots: value(snapshot.bots, []).map((item) => ({
      name: item.name, platform: item.platform, selfId: item.selfId, avatar: item.avatar,
      connected: formatDuration(item.connected), received: item.received, sent: item.sent,
    })),
  }
}
