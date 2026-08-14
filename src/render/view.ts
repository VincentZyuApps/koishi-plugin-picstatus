import type { MetricResult, StatusSnapshot } from '../types'
import { formatBytes, formatDuration, formatFrequency } from '../utils/format'

export interface ViewModel {
  generatedAt: string
  koishiUptime: string
  systemUptime: string
  system: string
  container: boolean
  cpu: { percent: number | null; title: string; caption: string }
  memory: { percent: number | null; title: string; caption: string }
  swap: { percent: number | null; title: string; caption: string }
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

function usage(metric: StatusSnapshot['memory'], title: string) {
  const item = value(metric, { percent: null, used: 0, total: 0 })
  return {
    percent: item.percent,
    title,
    caption: item.total ? `${formatBytes(item.used)} / ${formatBytes(item.total)}` : '未部署',
  }
}

export function createView(snapshot: StatusSnapshot): ViewModel {
  const cpu = value(snapshot.cpu, { brand: '未知型号', physicalCores: 0, logicalCores: 0, speed: null, percent: null })
  const system = value(snapshot.system, { name: '未知系统', architecture: '', uptime: 0, container: false })
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
    },
    memory: usage(snapshot.memory, 'RAM'),
    swap: usage(snapshot.swap, 'SWAP'),
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
