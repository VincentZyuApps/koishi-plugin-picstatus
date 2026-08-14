import si from 'systeminformation'
import type { DiskUsageMetric, IoMetric } from '../types'
import { matchesAny } from '../utils/filter'
import type { Config } from '../config'

export async function collectDisks(config: Config, ignored: RegExp[]): Promise<DiskUsageMetric[]> {
  const disks = await si.fsSize()
  const result = disks.filter((disk) => !matchesAny(disk.mount || disk.fs, ignored)).map((disk) => ({
    name: disk.mount || disk.fs,
    percent: Number.isFinite(disk.use) ? disk.use : null,
    used: disk.used,
    total: disk.size,
  }))
  return result.sort((a, b) => (b.percent ?? -1) - (a.percent ?? -1))
}

export async function collectDiskIo(config: Config): Promise<IoMetric[]> {
  const io = await si.fsStats()
  const result = [{ name: '全部磁盘', read: io.rx_sec ?? 0, write: io.wx_sec ?? 0 }]
  return config.hideIdleIo ? result.filter((item) => item.read || item.write) : result
}

