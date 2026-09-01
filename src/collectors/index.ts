import { Context } from 'koishi'
import type { Config } from '../config'
import type { MetricResult, StatusSnapshot } from '../types'
import { compilePatterns } from '../utils/filter'
import { collectCpu, collectMemory, collectSystem } from './system'
import { collectDiskIo, collectDisks, DiskMetadataCache } from './storage'
import { collectNetworks, collectSites } from './network'
import { collectProcesses } from './process'

type ProcessOverrides = Pick<Config, 'processSort' | 'processCount'>

class Sampler {
  private values = new Map<string, unknown>()
  private running = false

  constructor(private ctx: Context, private interval: number) {}

  get<T>(name: string): T | undefined {
    return this.values.get(name) as T | undefined
  }

  async update<T>(name: string, collect: () => Promise<T>): Promise<T> {
    const value = await collect()
    this.values.set(name, value)
    return value
  }

  start(tasks: Record<string, () => Promise<unknown>>): void {
    if (this.running) return
    this.running = true
    const run = async () => {
      await Promise.all(Object.entries(tasks).map(async ([name, collect]) => {
        try {
          await this.update(name, collect)
        } catch (error) {
          this.ctx.logger('picstatus').debug(`采样 ${name} 失败: ${error instanceof Error ? error.message : error}`)
        }
      }))
    }
    void run()
    const dispose = this.ctx.setInterval(() => void run(), this.interval * 1000)
    this.ctx.on('dispose', () => {
      this.running = false
      dispose()
      this.values.clear()
    })
  }
}

async function result<T>(name: string, timeout: number, task: () => Promise<T>): Promise<MetricResult<T>> {
  let timer: NodeJS.Timeout | undefined
  try {
    const value = await Promise.race([
      task(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} 采集超时`)), timeout) }),
    ])
    return { status: 'ok', value }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class CollectorHub {
  private sampler: Sampler
  private disks: RegExp[]
  private networks: RegExp[]
  private processes: RegExp[]
  private diskMetadata = new DiskMetadataCache()
  private diskDiagnostics = new Set<string>()

  constructor(private ctx: Context, private config: Config) {
    this.sampler = new Sampler(ctx, config.collectInterval)
    this.disks = compilePatterns(config.ignoredDisks)
    this.networks = compilePatterns(config.ignoredNetworks)
    this.processes = compilePatterns(config.ignoredProcesses)
  }

  start(): void {
    this.sampler.start({
      cpu: collectCpu,
      memory: collectMemory,
      disks: () => this.collectDisks(),
      diskIo: () => collectDiskIo(this.config),
      networks: () => collectNetworks(this.config, this.networks),
      processes: () => collectProcesses(this.config, this.processes),
    })
  }

  private collectDisks() {
    return collectDisks(this.config, this.disks, {
      metadata: this.diskMetadata,
      debug: (message) => {
        if (!this.config.debug || this.diskDiagnostics.has(message)) return
        this.diskDiagnostics.add(message)
        this.ctx.logger('picstatus').info(`[debug] ${message}`)
      },
    })
  }

  private sampled<T>(name: string, fallback: () => Promise<T>): Promise<T> {
    const value = this.sampler.get<T>(name)
    return value === undefined ? this.sampler.update(name, fallback) : Promise.resolve(value)
  }

  async collect(bots: StatusSnapshot['bots'], processOverrides?: ProcessOverrides): Promise<StatusSnapshot> {
    const timeout = this.config.collectTimeout * 1000
    const processConfig = processOverrides ? { ...this.config, ...processOverrides } : this.config
    const [system, cpu, memory, disks, diskIo, networks, sites, processes] = await Promise.all([
      result('system', timeout, collectSystem),
      result('cpu', timeout, () => this.sampled('cpu', collectCpu)),
      result('memory', timeout, () => this.sampled('memory', collectMemory)),
      result('disks', timeout, () => this.sampled('disks', () => this.collectDisks())),
      result('diskIo', timeout, () => this.sampled('diskIo', () => collectDiskIo(this.config))),
      result('networks', timeout, () => this.sampled('networks', () => collectNetworks(this.config, this.networks))),
      result('sites', timeout, () => collectSites(this.ctx, this.config)),
      result('processes', timeout, () => processOverrides
        ? collectProcesses(processConfig, this.processes)
        : this.sampled('processes', () => collectProcesses(this.config, this.processes))),
    ])
    return {
      generatedAt: new Date(), koishiUptime: process.uptime(), system, cpu,
      memory: memory.status === 'ok' ? { status: 'ok', value: memory.value.memory } : memory,
      swap: memory.status === 'ok' ? { status: 'ok', value: memory.value.swap } : memory,
      disks, diskIo, networks, sites, processes, bots,
    }
  }
}
