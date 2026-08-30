import os from 'node:os'
import fs from 'node:fs'
import si from 'systeminformation'
import type { CpuMetric, MemoryMetric, MemoryPlatform, MemorySegment, SwapMetric, SystemMetric } from '../types'
import { clampPercent } from '../utils/format'

type MemData = Awaited<ReturnType<typeof si.mem>>

function clampBytes(value: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(value, maximum))
}

function percent(used: number, total: number): number | null {
  return clampPercent(total > 0 ? used / total * 100 : null)
}

function platformName(platform: NodeJS.Platform): MemoryPlatform {
  if (platform === 'linux') return 'linux'
  if (platform === 'android') return 'android'
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  return 'other'
}

function capSegments(segments: MemorySegment[], occupied: number): MemorySegment[] {
  let remaining = clampBytes(occupied)
  return segments.map((segment) => {
    const value = clampBytes(segment.value, remaining)
    remaining -= value
    return { ...segment, value }
  })
}

function parseMeminfoValues(input: string): Map<string, number> {
  const values = new Map<string, number>()
  for (const line of input.split(/\r?\n/)) {
    const match = /^([^:]+):\s+(\d+)\s+kB\s*$/.exec(line)
    if (match) values.set(match[1], Number(match[2]) * 1024)
  }
  return values
}

export function parseLinuxMeminfo(input: string, platform: 'linux' | 'android' = 'linux'): { memory: MemoryMetric; swap: SwapMetric } {
  const values = parseMeminfoValues(input)
  const total = clampBytes(values.get('MemTotal') ?? 0)
  if (!total) throw new Error('/proc/meminfo 缺少有效的 MemTotal')

  const free = clampBytes(values.get('MemFree') ?? 0, total)
  const availableValue = values.get('MemAvailable') ?? free
  const available = clampBytes(availableValue, total)
  const cached = clampBytes(values.get('Cached') ?? 0, total)
  const reclaimable = clampBytes(values.get('SReclaimable') ?? 0, total)
  const sharedValue = clampBytes(values.get('Shmem') ?? 0, total)
  const buffersValue = clampBytes(values.get('Buffers') ?? 0, total)
  const baseUsed = clampBytes(total - free - cached - reclaimable - buffersValue, total)
  const compressedValue = clampBytes(values.get('Zswap') ?? 0, baseUsed)
  const cacheValue = clampBytes(cached + reclaimable - sharedValue, total)
  const occupied = total - free

  const segments = capSegments([
    { kind: 'used', value: baseUsed - compressedValue },
    { kind: 'shared', value: sharedValue },
    { kind: 'compressed', value: compressedValue },
    { kind: 'buffers', value: buffersValue },
    { kind: 'cache', value: cacheValue },
  ], occupied)
  const segment = (kind: MemorySegment['kind']) => segments.find((item) => item.kind === kind)?.value ?? 0
  const compressed = segment('compressed')
  const reportedUsed = segment('used') + compressed
  const shared = segment('shared')
  const used = reportedUsed + shared
  const buffers = segment('buffers')
  const cache = segment('cache')
  const buffCache = shared + buffers + cache

  const swapTotal = clampBytes(values.get('SwapTotal') ?? 0)
  const swapFree = clampBytes(values.get('SwapFree') ?? 0, swapTotal)
  const swapReportedUsed = swapTotal - swapFree
  const swapCached = clampBytes(values.get('SwapCached') ?? 0, swapReportedUsed)
  const swapUsed = swapReportedUsed - swapCached

  return {
    memory: {
      platform, total, free, available, used, reportedUsed, shared, buffers, cache,
      buffCache, compressed, segments, percent: percent(used, total),
    },
    swap: {
      total: swapTotal, free: swapFree, used: swapUsed, reportedUsed: swapReportedUsed,
      cached: swapCached, percent: percent(swapUsed, swapTotal),
    },
  }
}

export function memoryFromSystemInformation(data: MemData, platform = process.platform): { memory: MemoryMetric; swap: SwapMetric } {
  const memoryPlatform = platformName(platform)
  const total = clampBytes(data.total)
  const available = clampBytes(data.available, total)
  const free = clampBytes(memoryPlatform === 'windows' ? available : data.free, total)
  const occupied = total - free
  const active = clampBytes(data.active, occupied)
  const preferredUsed = memoryPlatform === 'windows'
    ? total - available
    : active || clampBytes(data.used, occupied)
  const segments = capSegments([
    { kind: 'used', value: preferredUsed },
    { kind: 'cache', value: occupied - preferredUsed },
  ], occupied)
  const used = segments[0].value
  const cache = segments[1].value

  const swapTotal = clampBytes(data.swaptotal)
  const swapReportedUsed = clampBytes(data.swapused, swapTotal)
  const swapFree = clampBytes(data.swapfree || swapTotal - swapReportedUsed, swapTotal)

  return {
    memory: {
      platform: memoryPlatform, total, free, available, used, reportedUsed: used,
      shared: 0, buffers: 0, cache, buffCache: cache, compressed: 0,
      segments: memoryPlatform === 'windows' ? segments.slice(0, 1) : segments,
      percent: percent(used, total),
    },
    swap: {
      total: swapTotal, free: swapFree, used: swapReportedUsed, reportedUsed: swapReportedUsed,
      cached: 0, percent: percent(swapReportedUsed, swapTotal),
    },
  }
}

export async function collectSystem(): Promise<SystemMetric> {
  const info = await si.osInfo()
  const container = fs.existsSync('/.dockerenv') || Boolean(process.env.KUBERNETES_SERVICE_HOST)
  return {
    name: [info.distro || info.platform, info.release].filter(Boolean).join(' '),
    architecture: info.arch || os.arch(),
    uptime: os.uptime(),
    container,
  }
}

export async function collectCpu(): Promise<CpuMetric> {
  const [cpu, load, speed] = await Promise.all([si.cpu(), si.currentLoad(), si.cpuCurrentSpeed()])
  return {
    brand: cpu.brand || `${cpu.manufacturer} CPU`.trim(),
    physicalCores: cpu.physicalCores || cpu.cores,
    logicalCores: cpu.cores,
    speed: speed.avg || cpu.speed || null,
    percent: clampPercent(load.currentLoad),
  }
}

export async function collectMemory(): Promise<{ memory: MemoryMetric; swap: SwapMetric }> {
  const data = await si.mem()
  if (process.platform === 'linux' || process.platform === 'android') {
    try {
      return parseLinuxMeminfo(await fs.promises.readFile('/proc/meminfo', 'utf8'), process.platform)
    } catch {
      // systeminformation remains a useful aggregate fallback when procfs is unavailable.
    }
  }
  return memoryFromSystemInformation(data)
}
