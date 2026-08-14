import os from 'node:os'
import fs from 'node:fs'
import si from 'systeminformation'
import type { CpuMetric, SystemMetric, UsageMetric } from '../types'
import { clampPercent } from '../utils/format'

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

export async function collectMemory(): Promise<{ memory: UsageMetric; swap: UsageMetric }> {
  const data = await si.mem()
  return {
    memory: {
      percent: clampPercent(data.total ? data.used / data.total * 100 : null),
      used: data.used,
      total: data.total,
    },
    swap: {
      percent: data.swaptotal ? clampPercent(data.swapused / data.swaptotal * 100) : null,
      used: data.swapused,
      total: data.swaptotal,
    },
  }
}

