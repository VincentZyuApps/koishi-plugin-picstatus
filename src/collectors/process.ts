import si from 'systeminformation'
import type { Config } from '../config'
import type { ProcessMetric } from '../types'
import { matchesAny } from '../utils/filter'

export async function collectProcesses(config: Config, ignored: RegExp[]): Promise<ProcessMetric[]> {
  if (!config.processCount) return []
  const data = await si.processes()
  const result = data.list
    .filter((item) => !matchesAny(item.name, ignored))
    .map((item) => ({ name: item.name || String(item.pid), cpu: item.cpu, memory: item.memRss * 1024 }))
  const key: keyof ProcessMetric = config.processSort === 'memory' ? 'memory' : 'cpu'
  return result.sort((a, b) => Number(b[key]) - Number(a[key])).slice(0, config.processCount)
}

